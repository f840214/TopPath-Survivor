#!/usr/bin/env node
/* ============ server/server.js — 區域網路伺服器 ============
 * 提供遊戲網頁，並把帳號與存檔保存在「這台電腦」上，不需要 Firebase 或網際網路。
 * 安裝在區網內的一台電腦，其他人用瀏覽器連進來即可。
 *
 *   node server/server.js            -> http://<這台電腦的IP>:8877
 *   PORT=3000 node server/server.js  -> 換埠
 *   node server/server.js --reset 名稱 新密碼   （重設密碼）
 *   node server/server.js --list              （列出帳號）
 *
 * 資料（不進倉庫，見 .gitignore）：
 *   server/data/accounts.json       { 帳號鍵: { name, salt, hash, created } }
 *   server/data/sessions.json       { token: { key, at } }
 *   server/data/saves/<帳號鍵>.json  每個帳號的存檔
 *
 * API（JSON）。需要登入的請求帶  Authorization: Bearer <token>。
 *   GET  /api/ping                 -> { ps: 1 }  （遊戲靠它判斷是否由這個伺服器提供）
 *   POST /api/register {name,pass} -> { ok, token, name, key, save }
 *   POST /api/login    {name,pass} -> { ok, token, name, key, save }
 *   GET  /api/session              -> { ok, name, key, save }
 *   PUT  /api/save     {save}      -> { ok, save }   （儲存並回傳伺服器上的版本）
 *   POST /api/logout               -> { ok }
 *   POST /api/delete   {pass}      -> { ok }
 *   排行榜、玩家、個人檔案與 WebSocket /ws（房間、邀請、合作模式中繼）：見 server/lan.js。
 *
 * 沒有任何相依套件，只需要 Node 18 以上。
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const createLan = require('./lan');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const SAVES = path.join(DATA, 'saves');
const F_ACC = path.join(DATA, 'accounts.json'), F_SES = path.join(DATA, 'sessions.json');
const PORT = +process.env.PORT || 8877;
const HOST = process.env.HOST || '0.0.0.0';
const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;
const MIN_PASS = 4;
const MAX_BODY = 4 * 1024 * 1024;          // 一份存檔只有幾 KB
const SESSION_DAYS = 365;

// ---------------- 檔案 ----------------

fs.mkdirSync(SAVES, { recursive: true });

function readJson(f, def) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; }
}
/** 原子寫入：先寫暫存檔再改名（斷電也不會留下寫到一半的檔案）。 */
function writeJson(f, v) {
  const tmp = f + '.tmp', data = JSON.stringify(v);
  // 在同步資料夾（iCloud、OneDrive、Dropbox）裡改名偶爾會因檔案被占用而失敗：重試幾次，仍不行就直接寫入。
  for (let i = 0; i < 5; i++) {
    try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); return; }
    catch (e) { if (i === 4) { console.warn('[資料] 無法改名', f, e.code); fs.writeFileSync(f, data); try { fs.unlinkSync(tmp); } catch (e2) { /* 略 */ } } else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1)); }
  }
}
const accounts = () => readJson(F_ACC, {});
const sessions = () => readJson(F_SES, {});
const saveFile = key => path.join(SAVES, key + '.json');

// ---------------- 密碼 ----------------

const hash = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
function checkPass(acc, pass) {
  const a = Buffer.from(hash(pass || '', acc.salt), 'hex'), b = Buffer.from(acc.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const keyOf = name => name.trim().toLowerCase();

// ---------------- 登入狀態（session） ----------------

function newSession(key) {
  const ses = sessions();
  const now = Date.now();
  // 順便清掉過期的。
  for (const t of Object.keys(ses)) if (now - ses[t].at > SESSION_DAYS * 86400e3) delete ses[t];
  const token = crypto.randomBytes(24).toString('hex');
  ses[token] = { key, at: now };
  writeJson(F_SES, ses);
  return token;
}
function sessionByToken(token) {
  if (!/^[a-f0-9]{48}$/.test(token || '')) return null;
  const s = sessions()[token];
  if (!s || Date.now() - s.at > SESSION_DAYS * 86400e3) return null;
  const acc = accounts()[s.key];
  return acc ? { token, key: s.key, acc } : null;
}
function sessionOf(req) {
  const m = /^Bearer\s+([a-f0-9]{48})$/.exec(req.headers.authorization || '');
  return m ? sessionByToken(m[1]) : null;
}

// 排行榜、在線玩家、房間與合作模式中繼（server/lan.js）。
const lan = createLan({ DATA, readJson, writeJson, accounts, sessionByToken });
function dropSession(token) {
  const ses = sessions();
  if (ses[token]) { delete ses[token]; writeJson(F_SES, ses); }
}
function dropAllSessions(key) {
  const ses = sessions();
  for (const t of Object.keys(ses)) if (ses[t].key === key) delete ses[t];
  writeJson(F_SES, ses);
}

// ---------------- API ----------------

class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function api(req, res, url) {
  const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
  const route = req.method + ' ' + url.pathname;

  if (route === 'GET /api/ping') return { ps: 1, v: 1, name: os.hostname() };

  if (route === 'POST /api/register') {
    const name = String(body.name || '').trim(), pass = String(body.pass || '');
    if (!VALID.test(name)) throw new ApiError(400, '名稱必須是 3 到 16 個字母、數字或底線。');
    if (pass.length < MIN_PASS) throw new ApiError(400, `密碼至少要 ${MIN_PASS} 個字元。`);
    const accs = accounts(), key = keyOf(name);
    if (accs[key]) throw new ApiError(409, '這個名稱已被使用。');
    const salt = crypto.randomBytes(12).toString('hex');
    accs[key] = { name, salt, hash: hash(pass, salt), created: Date.now() };
    writeJson(F_ACC, accs);
    return { ok: true, token: newSession(key), name, key, save: null };
  }

  if (route === 'POST /api/login') {
    const name = String(body.name || '').trim(), pass = String(body.pass || '');
    const acc = accounts()[keyOf(name)];
    if (!acc || !checkPass(acc, pass)) throw new ApiError(401, '帳號或密碼錯誤。');
    const key = keyOf(name);
    return { ok: true, token: newSession(key), name: acc.name, key, save: readJson(saveFile(key), null) };
  }

  // 以下都需要登入。
  const ses = sessionOf(req);
  if (!ses) throw new ApiError(401, '登入已過期，請重新登入。');

  if (route === 'GET /api/session') {
    return { ok: true, name: ses.acc.name, key: ses.key, save: readJson(saveFile(ses.key), null) };
  }

  if (route === 'PUT /api/save') {
    const s = body.save;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new ApiError(400, '存檔無效。');
    const cur = readJson(saveFile(ses.key), null);
    // 保留較新的那份（遊戲端已經把兩份合併過）。
    const keep = cur && (cur.updated || 0) > (s.updated || 0) ? cur : s;
    if (keep === s) writeJson(saveFile(ses.key), s);
    return { ok: true, save: keep };
  }

  if (route === 'POST /api/logout') { dropSession(ses.token); return { ok: true }; }

  if (route === 'POST /api/delete') {
    if (!checkPass(ses.acc, String(body.pass || ''))) throw new ApiError(401, '密碼錯誤。');
    const accs = accounts();
    delete accs[ses.key];
    writeJson(F_ACC, accs);
    dropAllSessions(ses.key);
    try { fs.unlinkSync(saveFile(ses.key)); } catch (e) { /* 本來就沒有存檔 */ }
    lan.accountDeleted(ses.key);
    return { ok: true };
  }

  const r = lan.api(route, url, body, ses);
  if (r !== undefined) return r;

  throw new ApiError(404, '找不到：' + route);
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { rej(new ApiError(413, '資料太大。')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { rej(new ApiError(400, 'JSON 格式錯誤。')); }
    });
    req.on('error', rej);
  });
}

// ---------------- 靜態檔案 ----------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm'
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  // 伺服器資料與隱藏檔永遠不對外提供。
  if (/^\/server(\/|$)/.test(p) || /\/\./.test(p)) return send(res, 404, '找不到');
  let file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) return send(res, 404, '找不到');
  let st = stat(file);
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = stat(file); }
  if (!st) return send(res, 404, '找不到');
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
  // 遊戲每 5 分鐘檢查 version.json 以自動更新：這些檔案不能被快取。
  if (ext === '.html' || ext === '.json') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
function stat(f) { try { return fs.statSync(f); } catch (e) { return null; } }
function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---------------- 伺服器 ----------------

function start() {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      try { sendJson(res, 200, await api(req, res, url)); }
      catch (e) {
        if (!(e instanceof ApiError)) console.error('[api]', req.method, url.pathname, e);
        sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : '伺服器錯誤：' + ((e && (e.code || e.message)) || '未知') + '（請看伺服器的終端機）。' });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '不允許的方法');
    serveStatic(req, res, url);
  });
  srv.on('upgrade', (req, socket, head) => lan.upgrade(req, socket, head));
  srv.listen(PORT, HOST, () => {
    const ips = [].concat(...Object.values(os.networkInterfaces())).filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`TopPath Survivor 區網伺服器已啟動，埠 ${PORT}`);
    console.log(`  這台電腦：   http://localhost:${PORT}/`);
    if (fs.existsSync('/.dockerenv')) console.log('  （在 Docker 容器內：區網內其他裝置請用「跑 Docker 的那台電腦」的 IP，埠號同上）');
    else for (const ip of ips) console.log(`  區網內其他裝置： http://${ip}:${PORT}/`);
    console.log(`  資料位置：   ${DATA}`);
    console.log('  （按 Ctrl+C 停止）');
  });
}

// ---------------- 命令列管理 ----------------

function cli(args) {
  if (args[0] === '--list') {
    const accs = accounts();
    const keys = Object.keys(accs).sort();
    if (!keys.length) return console.log('目前沒有任何帳號。');
    for (const k of keys) {
      const s = readJson(saveFile(k), null);
      console.log(`${accs[k].name.padEnd(16)}  建立於 ${new Date(accs[k].created).toLocaleDateString()}  ` +
        (s ? `${Object.keys(s.owned || {}).length} 隻寶可夢 · ${s.coins || 0} 金幣 · 遊玩 ${s.stats ? s.stats.runs : 0} 場` : '尚無存檔'));
    }
    return;
  }
  if (args[0] === '--reset') {
    const [, name, pass] = args;
    const accs = accounts(), key = keyOf(name || '');
    if (!accs[key]) return console.error('沒有這個帳號：' + name);
    if (!pass || pass.length < MIN_PASS) return console.error(`密碼至少要 ${MIN_PASS} 個字元。`);
    accs[key].salt = crypto.randomBytes(12).toString('hex');
    accs[key].hash = hash(pass, accs[key].salt);
    writeJson(F_ACC, accs);
    dropAllSessions(key);
    return console.log('已重設密碼：' + accs[key].name);
  }
  return false;
}

if (require.main === module) {
  if (cli(process.argv.slice(2)) === false) start();
}
