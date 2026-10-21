/* ============ server/lan.js — 排行榜、玩家、房間與中繼（區域網路） ============
 * 由 server/server.js 提供遊戲時，所有「線上」功能都在這裡、在這台電腦上，取代 Firebase。
 *
 *   排行榜    server/data/ranking.json   { boards: { 表名: { id: 紀錄 } }, reports: [...] }
 *            表名與 js/net/ranking.js 相同（s_d20261016、s_w2026-42j、s_m202610j、
 *            s_all2、s_all2_p25、g_…）。期間以這台電腦的「本地時間」計算
 *            （不像雲端用西班牙時間：區網內大家都在同一個時區）。
 *   個人檔案  server/data/profiles.json  { 帳號鍵: 公開檔案 }
 *   在線狀態  記憶體（誰的 WebSocket 還開著）＋ server/data/presence.json（最後上線時間）
 *   房間      記憶體：{ id, host, open, members }。玩家在對戰中斷線時位置保留 GRACE 毫秒（可以回來）。
 *
 * WebSocket（/ws?token=…），JSON 訊息 { k, … }（需要回覆時帶 `id`，回覆為 { k:'re', id, ok, … }）：
 *   客戶端 -> 伺服器   play {on} · room.create {dex,shiny} · room.join {room,dex,shiny} · room.leave ·
 *                      room.open {open} · room.member {dex,shiny} · inv {to} · inv.cancel {to} ·
 *                      q {to,d}（對戰中繼） · sig {to,sig}（WebRTC 信令）
 *   伺服器 -> 客戶端   hello {uid,name} · pres {list} · room {room} · room.closed {room} ·
 *                      inv {from,name,room,at} · inv.cancel {from} · q {f,d} · sig {f,sig}
 */
'use strict';
const path = require('path'), crypto = require('crypto');
const ws = require('./ws');

const GRACE = 180 * 1000;         // 對戰中斷線者的位置保留時間（重新整理＋登入也來得及）
const TOP = 50, MAX_PLAYERS = 8, MAX_T = 3600, MIN_T = 120;
// 對抗賽：最多 3 隊、每隊 3 人（9 人）。
const VS_TEAM = 3, VS_TEAMS_MAX = 3;

module.exports = function createLan(ctx) {
  const { DATA, readJson, writeJson, accounts, sessionByToken } = ctx;
  const F_RANK = path.join(DATA, 'ranking.json'), F_PROF = path.join(DATA, 'profiles.json'), F_PRES = path.join(DATA, 'presence.json');
  // 黑名單：server/data/blocks.json  { 帳號鍵: [被封鎖的帳號鍵, …] }
  const F_BLOCK = path.join(DATA, 'blocks.json');
  const blocksOf = key => (readJson(F_BLOCK, {})[key] || []);
  function setBlocks(key, list) { const all = readJson(F_BLOCK, {}); all[key] = list; writeJson(F_BLOCK, all); }
  const isBlocked = (by, who) => blocksOf(by).includes(who);

  // ---------------- 排行榜 ----------------

  function isoWeek(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return { year: t.getUTCFullYear(), week: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
  }
  const ALL = 'all2';
  function boardIds(date = new Date()) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    const w = isoWeek(y, m, d);
    const p2 = n => String(n).padStart(2, '0');
    return { d: 'd' + y + p2(m) + p2(d), w: 'w' + w.year + '-' + p2(w.week) + 'j', m: 'm' + y + p2(m) + 'j', a: ALL };
  }
  const PERIODS = ['d', 'w', 'm', 'a'];
  function boardName(mode, period, dex) {
    if (!['s', 'g'].includes(mode) || !PERIODS.includes(period)) return null;
    return mode + '_' + boardIds()[period] + (dex && period === 'a' ? '_p' + dex : '');
  }
  const rank = () => readJson(F_RANK, { boards: {}, reports: [] });
  const rowOf = (id, v) => ({ id, t: v.t, uids: v.uids || [], names: v.names || [], dex: v.dex || [], shiny: v.shiny || [], lv: v.lv, kills: v.kills });
  const sorted = top => Object.entries(top || {}).map(([id, v]) => rowOf(id, v)).sort((a, b) => b.t - a.t);

  /** 把結束的一場記進所有相關的表。→ 有刷新紀錄的期間 */
  function submit(ses, body) {
    const mode = body.mode === 'g' ? 'g' : 's';
    const t = Math.floor(+body.t || 0), lv = Math.max(1, +body.lv | 0), kills = Math.max(0, +body.kills | 0);
    if (!(t >= MIN_T) || t > MAX_T) return [];
    const accs = accounts();
    let members;
    if (mode === 's') members = [{ uid: ses.key, name: ses.acc.name, dex: +body.dex | 0, shiny: !!body.shiny }];
    else {
      members = (Array.isArray(body.members) ? body.members : []).map(m => ({ uid: String(m.uid || ''), dex: +m.dex | 0, shiny: !!m.shiny }))
        .filter(m => accs[m.uid]).map(m => Object.assign(m, { name: accs[m.uid].name }));
      if (members.length < 2 || !members.some(m => m.uid === ses.key)) return [];
      members.sort((a, b) => (a.uid < b.uid ? -1 : 1));
    }
    const id = members.map(m => m.uid).join('_');
    const entry = { t, uids: members.map(m => m.uid), names: members.map(m => m.name), dex: members.map(m => m.dex),
                    shiny: members.map(m => m.shiny), lv, kills, at: Date.now() };
    const ids = boardIds();
    const boards = PERIODS.map(p => [mode + '_' + ids[p], p]);
    for (const d of new Set(entry.dex)) boards.push([mode + '_' + ALL + '_p' + d, 'p']);
    const r = rank();
    const better = [];
    for (const [b, p] of boards) {
      const top = r.boards[b] = r.boards[b] || {};
      if (top[id] && top[id].t >= t) continue;
      top[id] = entry;
      if (p !== 'p' && !better.includes(p)) better.push(p);
    }
    if (better.length) writeJson(F_RANK, r);
    return better;
  }

  function board(ses, mode, period, dex) {
    const b = boardName(mode, period, dex);
    if (!b) return null;
    const rows = sorted(rank().boards[b]);
    const i = rows.findIndex(x => x.uids.includes(ses.key));
    return { board: b, rows: rows.slice(0, TOP), me: i >= 0 ? { pos: i + 1, t: rows[i].t, row: rows[i] } : null };
  }

  function report(ses, body) {
    const r = rank();
    const key = String(body.board || '') + '__' + String(body.id || '');
    if (!r.reports.some(x => x.key === key && x.by === ses.key)) {
      r.reports.push({ key, by: ses.key, at: Date.now() });
      writeJson(F_RANK, r);
    }
    return true;
  }

  /** 刪帳號時：移除他的紀錄（含隊伍紀錄）與個人檔案。 */
  function accountDeleted(key) {
    const r = rank();
    let changed = false;
    for (const b of Object.keys(r.boards)) {
      for (const id of Object.keys(r.boards[b])) {
        if ((r.boards[b][id].uids || []).includes(key)) { delete r.boards[b][id]; changed = true; }
      }
    }
    if (changed) writeJson(F_RANK, r);
    const prof = readJson(F_PROF, {});
    if (prof[key]) { delete prof[key]; writeJson(F_PROF, prof); }
    const c = conns.get(key);
    if (c) c.conn.close();
  }

  // ---------------- 個人檔案 ----------------

  function putProfile(ses, body) {
    const prof = readJson(F_PROF, {});
    const d = body && typeof body === 'object' ? body : {};
    prof[ses.key] = Object.assign({}, d, { name: ses.acc.name, at: Date.now() });
    writeJson(F_PROF, prof);
    return true;
  }
  function getProfile(key) { return readJson(F_PROF, {})[key] || null; }

  // ---------------- 在線狀態 ----------------

  const conns = new Map();          // 帳號鍵 -> { conn, key, name, play, room }
  const seen = readJson(F_PRES, {});
  let presT = 0, seenT = 0;

  function players() {
    const accs = accounts();
    return Object.keys(accs).sort().map(k => {
      const c = conns.get(k);
      // 夥伴寶可夢（好友卡片顯示用），從存檔讀取。
      const sv = readJson(path.join(DATA, 'saves', k + '.json'), null) || {};
      return { uid: k, name: accs[k].name, online: !!c, play: !!(c && c.play), room: c && c.room ? c.room : '', seen: seen[k] || 0,
               dex: sv.partner || 0, shiny: !!sv.partnerShiny };
    });
  }
  /** 通知所有人（延遲 300 毫秒合併：進房間會連續改變好幾樣東西）。 */
  function presChanged() {
    clearTimeout(presT);
    presT = setTimeout(() => {
      const msg = JSON.stringify({ k: 'pres', list: players() });
      const rl = JSON.stringify({ k: 'rooms', list: roomList() });
      for (const c of conns.values()) { c.conn.send(msg); c.conn.send(rl); }
    }, 300);
  }
  /** 「多人遊戲」看到的房間列表（全部列出：開放的可以進，其他顯示「遊戲中」）。 */
  function roomList() {
    const accs = accounts();
    return [...rooms.values()].map(r => ({ id: r.id, host: r.host, hostName: (accs[r.host] || {}).name || r.host,
      open: r.open, n: r.members.size, max: r.max || MAX_PLAYERS, mode: r.mode || 'coop', teams: r.teams || 0 })).sort((a, b) => (b.open - a.open) || (a.n - b.n));
  }
  function touchSeen(key) {
    seen[key] = Date.now();
    clearTimeout(seenT);
    seenT = setTimeout(() => writeJson(F_PRES, seen), 5000);
  }

  // ---------------- 房間 ----------------

  const rooms = new Map();          // id -> { id, host, open, members: Map(uid -> { uid, name, dex, shiny, at, on, goneT }) }

  function roomView(r) {
    const ms = [...r.members.values()].map(m => ({ uid: m.uid, name: m.name, dex: m.dex, shiny: m.shiny, at: m.at, on: m.on, team: m.team || 0 }))
      .sort((a, b) => (a.uid === r.host ? -1 : b.uid === r.host ? 1 : a.at - b.at));
    return { id: r.id, host: r.host, open: r.open, max: r.max || MAX_PLAYERS, mode: r.mode || 'coop', teams: r.teams || 0, members: ms };
  }
  function sendRoom(r) {
    const msg = JSON.stringify({ k: 'room', room: roomView(r) });
    for (const m of r.members.values()) { const c = conns.get(m.uid); if (c && c.room === r.id) c.conn.send(msg); }
  }
  function closeRoom(r) {
    rooms.delete(r.id);
    const msg = JSON.stringify({ k: 'room.closed', room: r.id });
    for (const m of r.members.values()) {
      clearTimeout(m.goneT);
      const c = conns.get(m.uid);
      if (c && c.room === r.id) { c.room = ''; c.conn.send(msg); }
    }
    presChanged();
  }
  function removeMember(r, uid) {
    const m = r.members.get(uid);
    if (!m) return;
    clearTimeout(m.goneT);
    r.members.delete(uid);
    const c = conns.get(uid);
    if (c && c.room === r.id) c.room = '';
    if (uid === r.host || !r.members.size) closeRoom(r); else sendRoom(r);
    presChanged();
  }
  function leaveRoom(c) {
    if (!c.room) return;
    const r = rooms.get(c.room);
    c.room = '';
    if (r) removeMember(r, c.key);
  }
  /** 連線斷了：在大廳就直接移除；對戰中則保留位置一段時間。 */
  function connGone(c) {
    if (!c.room) return;
    const r = rooms.get(c.room);
    c.room = '';
    if (!r) return;
    const m = r.members.get(c.key);
    if (!m) return;
    if (r.open) { removeMember(r, c.key); return; }
    m.on = false;
    clearTimeout(m.goneT);
    m.goneT = setTimeout(() => { if (rooms.get(r.id) === r && !m.on) removeMember(r, c.key); }, GRACE);
    sendRoom(r);
  }

  function joinRoom(c, id, dex, shiny) {
    const r = rooms.get(id);
    if (!r) return { ok: false, error: '那個房間已經不存在了。' };
    const back = r.members.get(c.key);
    if (!back && !r.open) return { ok: false, error: '那個房間已經開始遊戲了。' };
    if (!back && isBlocked(r.host, c.key)) return { ok: false, error: '你無法加入這個房間。' };
    if (!back && r.members.size >= (r.max || MAX_PLAYERS)) return { ok: false, error: '房間已滿（最多 ' + (r.max || MAX_PLAYERS) + ' 人）。' };
    if (c.room && c.room !== id) leaveRoom(c);
    c.room = id;
    if (back) { clearTimeout(back.goneT); back.on = true; if (dex) { back.dex = dex; back.shiny = !!shiny; } }
    else r.members.set(c.key, { uid: c.key, name: c.name, dex: dex | 0, shiny: !!shiny, at: Date.now(), on: true, goneT: 0, team: r.mode === 'vs' ? smallestTeam(r) : 0 });
    sendRoom(r);
    presChanged();
    return { ok: true, room: roomView(r), back: !!back };
  }

  /** 對抗賽：人最少的隊（給新加入的人）。 */
  function smallestTeam(r) {
    const n = Array(r.teams + 1).fill(0);
    for (const m of r.members.values()) if (m.team) n[m.team]++;
    let best = 1;
    for (let t = 2; t <= r.teams; t++) if (n[t] < n[best]) best = t;
    return best;
  }

  // ---------------- WebSocket ----------------

  function upgrade(req, socket, head) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
    const ses = sessionByToken(url.searchParams.get('token') || '');
    if (!ses) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    const conn = ws.accept(req, socket, head);
    if (!conn) return;
    // 同一帳號從另一個分頁或裝置連進來：保留新的（並接手原本的房間）。
    const old = conns.get(ses.key);
    let room = '';
    if (old) { room = old.room; old.room = ''; old.conn.close(); conns.delete(ses.key); }
    // 重新整理頁面後回來：還保留著位置的房間（對戰中斷線的那種）也接回去。
    if (!room) for (const r of rooms.values()) if (r.members.has(ses.key)) { room = r.id; break; }
    const c = { conn, key: ses.key, name: ses.acc.name, play: false, room };
    conns.set(ses.key, c);
    if (room) { const r = rooms.get(room); const m = r && r.members.get(ses.key); if (m) { clearTimeout(m.goneT); m.on = true; sendRoom(r); } else c.room = ''; }
    // hello 帶上目前所在的房間：客戶端重新整理後才知道自己還在對戰裡。
    conn.send(JSON.stringify({ k: 'hello', uid: c.key, name: c.name, grace: GRACE, blocks: blocksOf(c.key), room: c.room && rooms.get(c.room) ? roomView(rooms.get(c.room)) : null }));
    conn.on('message', text => { let m; try { m = JSON.parse(text); } catch (e) { return; } if (m && typeof m === 'object') onMessage(c, m); });
    conn.on('close', () => {
      if (conns.get(ses.key) !== c) return;
      conns.delete(ses.key);
      touchSeen(ses.key);
      connGone(c);
      presChanged();
    });
    touchSeen(ses.key);
    presChanged();
  }

  const reply = (c, m, extra) => { if (m.id != null) c.conn.send(JSON.stringify(Object.assign({ k: 're', id: m.id, ok: true }, extra))); };
  const sendTo = (uid, obj) => { const t = conns.get(uid); if (t) t.conn.send(JSON.stringify(obj)); return !!t; };

  function onMessage(c, m) {
    switch (m.k) {
      case 'play': c.play = !!m.on; presChanged(); break;
      case 'room.create': {
        if (c.room) leaveRoom(c);
        const id = crypto.randomBytes(4).toString('hex');
        // 房主選的人數（2..MAX_PLAYERS）。對抗賽：隊數 × 3。
        const vs = m.mode === 'vs';
        const teams = vs ? Math.max(2, Math.min(VS_TEAMS_MAX, m.teams | 0 || 2)) : 0;
        const max = vs ? teams * VS_TEAM : Math.max(2, Math.min(MAX_PLAYERS, (m.max | 0) || MAX_PLAYERS));
        const r = { id, host: c.key, open: true, max, mode: vs ? 'vs' : 'coop', teams, members: new Map() };
        rooms.set(id, r);
        reply(c, m, joinRoom(c, id, m.dex | 0, m.shiny));
        break;
      }
      case 'room.join': reply(c, m, joinRoom(c, String(m.room || ''), m.dex | 0, m.shiny)); break;
      case 'room.leave': leaveRoom(c); reply(c, m, {}); break;
      case 'room.open': {
        const r = rooms.get(c.room);
        if (r && r.host === c.key) { r.open = !!m.open; sendRoom(r); presChanged(); }
        break;
      }
      case 'room.list': reply(c, m, { list: roomList() }); break;
      case 'room.team': {
        // 對抗賽：換隊（每隊最多 3 人）。
        const r = rooms.get(c.room), mm = r && r.members.get(c.key);
        if (!r || !mm || r.mode !== 'vs') { reply(c, m, { ok: false, error: '這不是對抗賽房間。' }); break; }
        const t = m.team | 0;
        if (t < 1 || t > r.teams) { reply(c, m, { ok: false, error: '沒有這個隊伍。' }); break; }
        const n = [...r.members.values()].filter(x => x.team === t && x.uid !== c.key).length;
        if (n >= VS_TEAM) { reply(c, m, { ok: false, error: '那個隊伍已滿（3 人）。' }); break; }
        mm.team = t;
        sendRoom(r);
        reply(c, m, {});
        break;
      }
      case 'room.member': {
        const r = rooms.get(c.room), mm = r && r.members.get(c.key);
        if (mm) { mm.dex = m.dex | 0; mm.shiny = !!m.shiny; sendRoom(r); }
        break;
      }
      case 'inv': {
        const r = rooms.get(c.room);
        if (!r) { reply(c, m, { ok: false, error: '請先建立房間。' }); break; }
        if (r.host !== c.key) { reply(c, m, { ok: false, error: '只有房主可以邀請。' }); break; }
        if (r.members.size >= (r.max || MAX_PLAYERS)) { reply(c, m, { ok: false, error: '房間已滿。' }); break; }
        const to = String(m.to || '');
        // 對方把你封鎖了（或你封鎖了對方）：邀請送不出去，不說明原因。
        if (isBlocked(to, c.key) || isBlocked(c.key, to)) { reply(c, m, { ok: false, error: '無法邀請那位玩家。' }); break; }
        const ok = sendTo(to, { k: 'inv', from: c.key, name: c.name, room: r.id, at: Date.now() });
        reply(c, m, ok ? {} : { ok: false, error: '那位玩家現在不在線上。' });
        break;
      }
      case 'block': case 'unblock': {
        const who = String(m.to || '');
        if (!who || who === c.key || !accounts()[who]) { reply(c, m, { ok: false, error: '沒有這個玩家。' }); break; }
        const list = blocksOf(c.key).filter(k => k !== who);
        if (m.k === 'block') list.push(who);
        setBlocks(c.key, list);
        reply(c, m, { blocks: list });
        break;
      }
      case 'inv.cancel': sendTo(String(m.to || ''), { k: 'inv.cancel', from: c.key }); break;
      case 'q': case 'sig': {
        // 只在同一房間的成員之間轉送。
        const r = rooms.get(c.room);
        if (!r || !r.members.has(String(m.to || ''))) break;
        sendTo(String(m.to), m.k === 'q' ? { k: 'q', f: c.key, d: m.d } : { k: 'sig', f: c.key, sig: m.sig });
        break;
      }
      default: break;
    }
  }

  // ---------------- HTTP API ----------------

  /** 帳號以外的 /api/… 路由。→ 結果；不是這裡的路由則回 undefined */
  function api(route, url, body, ses) {
    if (route === 'POST /api/rank') return { ok: true, better: submit(ses, body) };
    if (route === 'POST /api/rank/report') return { ok: report(ses, body) };
    const m = /^GET \/api\/rank\/([sg])\/([dwma])$/.exec(route);
    if (m) { const r = board(ses, m[1], m[2], +url.searchParams.get('dex') || 0); return Object.assign({ ok: true }, r); }
    if (route === 'GET /api/players') return { ok: true, list: players() };
    if (route === 'PUT /api/profile') return { ok: putProfile(ses, body) };
    const p = /^GET \/api\/profile\/([a-z0-9_ñáéíóú]+)$/i.exec(route);
    if (p) return { ok: true, profile: getProfile(decodeURIComponent(p[1]).toLowerCase()) };
    return undefined;
  }

  return { api, upgrade, accountDeleted, players };
};
