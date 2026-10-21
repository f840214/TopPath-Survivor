/* ============ coop.js — partida cooperativa (hasta 4 jugadores; 8 en la red local) ============
 *
 * Quién manda en qué:
 *   ANFITRIÓN   enemigos (aparición, IA, vida, muerte), objetos del suelo,
 *               experiencia y nivel del equipo, reloj, fin de la partida.
 *   CADA UNO    su propio Pokémon: posición, vida, ataques y lo que le golpea.
 *               Sus golpes a enemigos se mandan al anfitrión, que los aplica.
 *
 * Los invitados ven COPIAS de los enemigos del anfitrión (enemy.remote) y los
 * ataques de los compañeros como "fantasmas" que no hacen daño (ver combat.js).
 *
 * Quién está eligiendo (objeto o vínculo) y quién ha elegido carta de nivel va
 * además en CADA envío (no sólo en un aviso suelto): si un aviso se pierde
 * porque la conexión parpadea, el siguiente envío lo arregla y nadie se queda
 * esperando a otro para siempre (pasaba en 2026-10).
 *
 * Mensajes (por net.js, unas 15 veces por segundo; 5 si va por el relé):
 *   invitado -> anfitrión  { k:'f', p:[estado], ev:[eventos] }
 *   anfitrión -> invitado  { k:'f', t, lv, xp, xn, ki, bo, co, p:{uid:[estado]},
 *                            e:[[id,x,y,vida,anim,dir,estados]], ev:[eventos],
 *                            ja:[x,y,anim,dir] (Arceus, sólo en la Sentencia) }
 *   anfitrión -> todos     { k:'start', seed, host, members:[{uid,name,dex,shiny}] }
 *
 * Desconexiones (modo servidor, red local): si a un invitado se le corta la
 * conexión, el anfitrión le guarda el sitio GRACE_MS (su Pokémon desaparece
 * y nadie le espera para elegir cartas) y, si vuelve, sigue donde estaba. Si
 * es el anfitrión quien se corta, los invitados se quedan parados ese mismo
 * tiempo antes de dar la partida por perdida. (En la nube se sigue como
 * siempre: quien se desconecta, se ha ido.)
 *
 * Volver tras recargar la página (red local): cada uno manda al anfitrión
 * cada ~5 s (y al cambiar algo) un resumen de su Pokémon ('b': movimientos,
 * objeto, mejoras, vida, posición). Si recarga, el servidor le devuelve a la
 * sala y pide 'rejoin'; el anfitrión contesta 'rejoined' con la configuración
 * de la partida, el reloj y ese resumen, y el juego se reconstruye (game.js,
 * startRun con restore). El anfitrión no puede volver: él es la partida.
 */
G.Coop = (() => {
  const ANIMS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Charge', 'Hurt', 'Faint'];
  const COLORS = ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8', '#ff9f5a', '#c9a0ff', '#6ff0e0', '#ff6b6b'];
  // Enfrentamiento (red local): hasta 3 equipos de 3; cada equipo con su color.
  const TEAM_COLORS = ['#5fc8ff', '#ff6b6b', '#7ee07a'];
  const PVP_K = 0.25;                   // daño de jugador a jugador: una cuarta parte
  let vs = false, teamsN = 0, myTeam = 0;
  let tms = [];                         // anfitrión: por equipo { level, xp, xpNext, kills }
  let scores = [];                      // todos: marcador que manda el anfitrión [[bajas, nivel], ...]
  let hostOwed = 0;                     // anfitrión: cartas de nivel que le debe su equipo
  const teamOf = uid => (uid === me ? myTeam : (mates.get(uid) || {}).team || 1);
  // Mensajes por segundo: 15 directo, 4 por el TURN de Cloudflare (se paga por
  // GB: era 7 y se iban unos 110 GB al día, el 12-10-2026) y 3 por el relé de
  // la Realtime Database (1 $ el GB: sólo si todo lo demás falla).
  const RATE_FAST = 1 / 15, RATE_TURN = 1 / 4, RATE_SLOW = 1 / 3;
  // (Red local: el relé es nuestro propio servidor y no cuesta nada: a toda velocidad también.)
  const rateFor = u => (G.Net.slow(u) ? (G.DB.mode === 'server' ? RATE_FAST : RATE_SLOW) : G.Net.viaTurn(u) ? RATE_TURN : RATE_FAST);
  const NEAR = 950;                     // radio de enemigos que se mandan a cada uno

  let active = false, host = false, me = null, hostUid = null;
  let local = null;                     // tu Player
  const mates = new Map();              // uid -> { uid, name, color, pl, connected, q:[], flushT, xpMul }
  let outEv = [];                       // invitado: eventos para el anfitrión
  let flushT = 0;
  let hitFrom = null;                   // invitado cuyo golpe se está aplicando (no repetirle el número)
  let api = {};                         // callbacks del juego (game.js)
  let waiting = new Set();              // subida de nivel: quién falta por elegir
  let holds = new Set();                // quién está eligiendo una fusión (la partida se para para todos)
  // El anfitrión mueve a los enemigos: si cambia de pestaña (o se le congela),
  // todo se para para todos. Antes los enemigos se quedaban quietos y los demás
  // seguían jugando con una ventaja enorme.
  let hostAway = false, stalled = false, lastHostAt = 0;
  // Cartas de nivel: número de la ronda (anfitrión), la última que te ha llegado
  // y la última que has elegido (invitado). Y el último "quién elige" aplicado.
  let levelSeq = 0, levelNow = 1, seenSeq = 0, doneSeq = 0, lastHo = '';
  const STALL_MS = 2500;
  let members = [];
  // Sitio guardado a quien se desconecta (modo servidor). El servidor guarda
  // la plaza en la sala algo más (server/lan.js, GRACE) para que dé tiempo.
  const GRACE_MS = 180 * 1000;        // 3 min: da tiempo a recargar la página y volver a entrar
  let cfg0 = null;                      // la configuración de 'start' (para quien vuelve)
  let buildKey = '', buildT = 0;        // último resumen enviado y cuándo toca el siguiente
  const BUILD_S = 5;
  const srvMode = () => G.DB.mode === 'server';
  const NO_FRAME_MS = 6000;             // anfitrión: sin noticias de un invitado -> desconectado
  let hostLostT = 0;                    // invitado: cuenta atrás desde que el anfitrión no responde

  // ---------------- escalado de dificultad ----------------

  // Hasta 4 como siempre; del 5.º al 8.º (red local) cada uno añade menos, si no sería injugable.
  const scaleRate = n => 1 + 0.75 * Math.min(3, Math.max(0, n - 1)) + 0.45 * Math.max(0, n - 4);
  const scaleHp = n => 1 + 0.3 * Math.min(3, Math.max(0, n - 1)) + 0.2 * Math.max(0, n - 4);

  // ---------------- arranque / fin ----------------

  /**
   * @param cfg   { seed, host, members }
   * @param pl    tu Player (ya creado)
   * @param cb    { levelStart(lv), resume(), waiting(names), over(data), lost(msg), team(t), shiny(dex) }
   */
  function begin(cfg, pl, cb) {
    active = true;
    me = G.Net.uid; hostUid = cfg.host;
    host = me === hostUid;
    local = pl;
    api = cb;
    members = cfg.members;
    mates.clear();
    outEv = []; flushT = 0; waiting = new Set(); holds = new Set();
    hostAway = false; stalled = false; lastHostAt = performance.now();
    levelSeq = 0; levelNow = 1; seenSeq = 0; doneSeq = 0; lastHo = '';
    cfg0 = cfg; buildKey = ''; buildT = 0;
    vs = cfg.mode === 'vs'; teamsN = vs ? (cfg.teams || 2) : 0; hostOwed = 0;
    myTeam = vs ? ((cfg.members.find(m => m.uid === me) || {}).team || 1) : 0;
    tms = vs ? Array.from({ length: teamsN }, () => ({ level: 1, xp: 0, xpNext: G.Player.xpFor(1), kills: 0 })) : [];
    scores = vs ? tms.map(() => [0, 1]) : [];
    pl.team = myTeam; pl.pvpDead = false; pl.respawnT = 0;
    // Enfrentamiento: cada equipo empieza en su lado; cooperativo: todos en fila.
    const at = (m, i) => {
      if (!vs) return [(i - (cfg.members.length - 1) / 2) * 34, 0];
      const t = (m.team || 1) - 1, a = (t / teamsN) * 6.2832 - Math.PI / 2;
      const k = cfg.members.filter(o => (o.team || 1) === t + 1).indexOf(m);
      return [Math.cos(a) * 120 + (k - 1) * 30, Math.sin(a) * 100];
    };
    cfg.members.forEach((m, i) => {
      const [x, y] = at(m, i);
      const col = vs ? TEAM_COLORS[(m.team || 1) - 1] : COLORS[i];
      if (m.uid === me) { pl.x = x; pl.y = y; pl.uid = me; pl.coopHost = host; pl.tagColor = col; return; }
      const mon = G.DEX_BY[m.dex] || G.DEX_BY[25];
      const p = new G.Player(mon, {}, !!m.shiny);
      p.remote = true; p.uid = m.uid; p.tag = m.name; p.tagColor = col; p.revLabel = 'Quédate a su lado';
      p.team = vs ? (m.team || 1) : 0;
      p.x = x; p.y = y;
      p.net = { x, y, ang: Math.PI / 2, walk: 0, hp: p.maxHp, maxHp: p.maxHp, dead: 0, mv: G.startMoveOf(mon.dex), ml: 1, mag: 78, aim: Math.PI / 2, rev: 0 };
      G.Sprites.preload([mon.dex], 8000, p.shiny);
      mates.set(m.uid, { uid: m.uid, name: m.name, color: col, team: p.team, pl: p, connected: true, q: [], flushT: 0, xpMul: 1,
                         lost: false, lostT: 0, lastAt: performance.now() + 15000, owed: 0, choosing: false, luSeq: 0 });
    });
  }

  function end() {
    active = false; host = false; local = null;
    vs = false; teamsN = 0; myTeam = 0; tms = []; scores = []; hostOwed = 0;
    for (const m of mates.values()) clearTimeout(m.lostT);
    clearTimeout(hostLostT); hostLostT = 0;
    mates.clear(); outEv = []; waiting = new Set(); holds = new Set();
    // Red local: si la sala se cerró mientras jugabais, la conexión se cierra ahora.
    if (srvMode() && !G.Social.room && G.Net.open_) G.Net.close();
  }

  /** Te vas de la partida (los demás siguen). */
  function leave() {
    if (!active) return;
    if (host) {
      // Si se va el anfitrión, la partida termina para todos.
      emit(['ov', Object.assign(api.summary ? api.summary() : {}, { why: 'host' }, vs ? { teams: teamsSummary() } : {})]);
      flushAll();
    } else {
      outEv.push(['bye']);
      flushClient(true);
    }
    end();
  }

  // ---------------- lista de jugadores ----------------

  function players() {
    const out = [local];
    for (const m of mates.values()) if (m.connected) out.push(m.pl);
    return out;
  }
  function puppets() { const out = []; for (const m of mates.values()) if (m.connected) out.push(m.pl); return out; }

  /**
   * Multiplicador de la experiencia del equipo: la media de los bonus de
   * cada uno, y repartida entre los que sois (en grupo cae mucho más, y si no
   * se subiría de nivel el triple de rápido que en solitario).
   */
  function xpFactor() {
    let s = local.xpMul, n = 1;
    for (const m of mates.values()) if (m.connected) { s += m.xpMul || 1; n++; }
    return (s / n) / local.xpMul / (1 + 0.6 * (n - 1));
  }

  // ---------------- enfrentamiento: equipos ----------------

  /** Factor de experiencia de un equipo (como xpFactor, pero sólo con los suyos). */
  function teamXpFactor(t) {
    let s = 0, n = 0;
    if (myTeam === t) { s += local.xpMul; n++; }
    for (const m of mates.values()) if (m.connected && m.team === t) { s += m.xpMul || 1; n++; }
    if (!n) return 1;
    return (s / n) / (1 + 0.6 * (n - 1));
  }

  /** Anfitrión: experiencia para el equipo de `who` (quien ha recogido el orbe). */
  function teamXp(who, amount) {
    if (!vs || !host) return;
    const t = teamOf(who.uid || me), ts = tms[t - 1];
    if (!ts) return;
    ts.xp += amount * teamXpFactor(t);
    let up = 0;
    while (ts.xp >= ts.xpNext) { ts.xp -= ts.xpNext; ts.level++; ts.xpNext = G.Player.xpFor(ts.level); up++; }
    if (up) {
      // Cada uno del equipo elige sus cartas a su ritmo (la partida no se para).
      if (myTeam === t) hostOwed += up;
      for (const m of mates.values()) if (m.team === t) m.owed += up;
    }
    mirrorHost();
  }

  /** Anfitrión: el nivel y las bajas de tu equipo van en tu Pokémon (HUD y resumen). */
  function mirrorHost() {
    if (!vs || !host) return;
    const ts = tms[myTeam - 1];
    local.level = ts.level; local.xp = ts.xp; local.xpNext = ts.xpNext; local.kills = ts.kills;
    scores = tms.map(x => [x.kills, x.level]);
  }

  /** Anfitrión: ha caído un enemigo; la baja es del equipo de quien dio el último golpe. */
  function enemyKilled(e) {
    if (!vs || !host) return;
    const t = teamOf(e.killer || me);
    if (tms[t - 1]) tms[t - 1].kills++;
    mirrorHost();
  }

  /** Marcador final: equipos ordenados por bajas (el primero gana). */
  function teamsSummary() {
    if (!vs) return null;
    return tms.map((t, i) => ({
      team: i + 1, kills: t.kills, level: t.level,
      names: members.filter(m => (m.team || 1) === i + 1).map(m => m.name)
    })).sort((a, b) => b.kills - a.kills || b.level - a.level);
  }

  /** Anfitrión: evento sólo para un equipo (menos `except`). */
  function emitTeam(ev, t, except) {
    if (!host) return;
    for (const m of mates.values()) if (m.connected && m.team === t && m.uid !== except) m.q.push(ev);
  }

  /** ¿Es `p` (un compañero de red) de otro equipo? Sólo en enfrentamiento. */
  function enemyOf(p) { return vs && !!p && p.team !== myTeam; }

  // ---------------- estado de un jugador ----------------

  const r1 = v => Math.round(v), r2 = v => Math.round(v * 100) / 100;

  function myState() {
    // Con un vínculo se manda la órbita si la hay (es lo único que los demás no ven por los 'c').
    const g = local.activeGroup();
    const m = g.find(x => x.kind === 'orbit') || g[0];
    return [r1(local.x), r1(local.y), r2(local.moveAngle), local.walking ? 1 : 0, r1(local.hp), r1(local.maxHp),
            local.dead ? 1 : 0, m ? m.id : '', m ? m.lvl : 1, r1(local.magnet), r2(local.aim), r2(local.xpMul),
            r2(local.reviveT || 0), api.choosing && api.choosing() ? 1 : 0, doneSeq, local.respawnT > 0 ? 1 : 0];
  }

  function readState(a) {
    return { x: a[0], y: a[1], ang: a[2], walk: a[3], hp: a[4], maxHp: a[5], dead: a[6], mv: a[7], ml: a[8],
             mag: a[9], aim: a[10], xpMul: a[11], rev: a[12], ch: a[13], ld: a[14], rs: a[15] || 0 };
  }

  // ---------------- resumen del Pokémon (para volver tras recargar) ----------------

  function buildOf(p) {
    return { dex: p.dex, sh: p.shiny ? 1 : 0, hp: r1(p.hp), mhp: r1(p.maxHp), x: r1(p.x), y: r1(p.y),
             mv: p.slots.map(g => g.map(m => [m.id, m.lvl, m.evolved ? 1 : 0])), act: p.active, it: p.item || null,
             st: { atkMul: p.atkMul, spdMul: p.spdMul, cdMul: p.cdMul, dmgReduce: p.dmgReduce, regenFlat: p.regenFlat, magnet: p.magnet,
                   xpMul: p.xpMul, maxMoves: p.maxMoves, critChance: p.critChance, bonds: p.bonds, rerolls: p.rerolls, statsTaken: p.statsTaken } };
  }
  /** El resumen si ha cambiado algo (salvo vida y posición) o han pasado BUILD_S segundos; si no, null. */
  function dueBuild(dt) {
    if (!local) return null;
    buildT -= dt;
    const b = buildOf(local);
    const key = JSON.stringify([b.mv, b.act, b.it, b.st, b.mhp]);
    if (key === buildKey && buildT > 0) return null;
    buildKey = key; buildT = BUILD_S;
    return b;
  }
  let hostBuild = null;                 // el del anfitrión (por simetría; él no puede volver)

  /** Anfitrión: a quien vuelve (o llevaba un rato sin conexión) se le reenvía lo que hay en el mapa. */
  function resendWorld(m) {
    for (const e of G.EnemyMgr.all()) if (!e.dead && !e.remote) m.q.push(['ne', e.id, e.dex, r1(e.x), r1(e.y), e.boss ? 1 : 0, e.shiny ? 1 : 0, Math.ceil(e.maxHp), r2(e.dmg), e.behavior]);
    for (const o of G.Pickups.all()) if (o.id != null) m.q.push(['pk', o.id, o.kind, r1(o.x), r1(o.y), o.value]);
    const rf = G.Rift.rift;
    if (rf && !G.Rift.arena) m.q.push(['rift', r1(rf.x), r1(rf.y), Math.max(1, (rf.ttl || 0) - (rf.t || 0))]);
    const w = G.Weather.current;
    if (w && w.kind) m.q.push(['wx', w.kind, Math.max(1, Math.round(w.left || 1))]);
  }

  /** Anfitrión: un invitado ha recargado la página y quiere volver. */
  function onRejoin(from) {
    const m = mates.get(from);
    if (!m || m.gone) { G.Net.send(from, { k: 'rejoined', ok: false }); return; }
    const st = api.team();
    const rep = { k: 'rejoined', ok: true, cfg: cfg0, t: r2(st.time), lv: st.level, xp: r2(st.xp), xn: st.xpNext, ki: st.kills, bo: st.bosses, co: st.coins,
                  tk: [st.t1, st.t10], build: m.build || null, team: m.team };
    if (vs) { const ts = tms[m.team - 1]; if (ts) { rep.lv = ts.level; rep.xp = r2(ts.xp); rep.xn = ts.xpNext; rep.ki = ts.kills; } rep.ts = scores; }
    G.Net.send(from, rep);
    m.lastAt = performance.now();
    if (m.lost) mateBack(from);
    else { m.connected = true; m.q = []; m.flushT = 0; G.Net.reconnect(from); resendWorld(m); }
  }

  /** Invitado: pedir al anfitrión volver a la partida (tras recargar). → false si aún no hay sala abierta */
  function rejoin() {
    if (active || G.Net.isHost || !G.Net.open_ || !G.Net.hostUid) return false;
    G.Net.send(G.Net.hostUid, { k: 'rejoin' });
    return true;
  }

  // ---------------- envío ----------------

  /** Anfitrión: evento para todos los invitados (menos `except`). */
  function emit(ev, except) {
    if (!host) return;
    for (const m of mates.values()) if (m.connected && m.uid !== except) m.q.push(ev);
  }

  /** Anfitrión: evento sólo para los que están cerca (números de daño). */
  function emitNear(ev, x, y, except) {
    for (const m of mates.values()) {
      if (!m.connected || m.uid === except) continue;
      if (G.U.dist2(m.pl.x, m.pl.y, x, y) > 700 * 700) continue;
      if (m.q.length > 400) continue;
      m.q.push(ev);
    }
  }

  function enemyList(near) {
    const out = [];
    const r2n = NEAR * NEAR;
    for (const e of G.EnemyMgr.all()) {
      if (e.dead || G.U.dist2(e.x, e.y, near.x, near.y) > r2n) continue;
      const a = ANIMS.indexOf(e.anim.cur);
      out.push([e.id, r1(e.x), r1(e.y), Math.ceil(e.hp), a < 0 ? 0 : a, e.anim.dir,
                (e.burn > 0 ? 1 : 0) | (e.poison > 0 ? 2 : 0) | (e.shield > 0 ? 4 : 0)]);
    }
    return out;
  }

  function hostFrame(m) {
    const st = api.team();
    const p = { [me]: myState() };
    for (const o of mates.values()) {
      if (o.connected && o.uid !== m.uid && o.state) p[o.uid] = o.state;
    }
    const ev = m.q; m.q = [];
    const f = { k: 'f', t: r2(st.time), lv: st.level, xp: r2(st.xp), xn: st.xpNext, ki: st.kills, bo: st.bosses, co: st.coins, tk: [st.t1, st.t10],
                p, e: enemyList(m.pl), ev };
    if (vs) {
      // Enfrentamiento: a cada uno, el nivel y las bajas de SU equipo; y el marcador de todos.
      const ts = tms[m.team - 1];
      if (ts) { f.lv = ts.level; f.xp = r2(ts.xp); f.xn = ts.xpNext; f.ki = ts.kills; }
      f.ts = scores;
    }
    const ja = G.Judgment.netState();       // Arceus en la Sentencia
    if (ja) f.ja = ja;
    // Siempre: quién está eligiendo y, si hay cartas de nivel, cuáles (ver arriba).
    // (En enfrentamiento nadie para la partida a los demás: no se manda.)
    if (!vs) {
      f.ho = holdNames();
      if (waiting.size) f.lu = [levelSeq, levelNow];
    }
    return f;
  }

  function flushAll() { for (const m of mates.values()) if (m.connected) G.Net.send(m.uid, hostFrame(m)); }

  function flushClient(force) {
    if (!force && !outEv.length && flushT > 0) return;
    G.Net.toHost({ k: 'f', p: myState(), ev: outEv });
    outEv = [];
  }

  /** Cada fotograma (también en la pantalla de subida de nivel). */
  function tick(dt) {
    if (!active) return;
    if (host) {
      const now = performance.now();
      // Enfrentamiento: cartas de nivel pendientes, cada uno a su ritmo.
      if (vs && hostOwed > 0 && !(api.inLevelUp && api.inLevelUp())) { hostOwed--; api.levelStart(tms[myTeam - 1].level); }
      if (srvMode()) { const b = dueBuild(dt); if (b) hostBuild = b; }
      for (const m of mates.values()) {
        // Modo servidor: si un invitado lleva un rato sin mandar nada, se le guarda el sitio.
        if (srvMode() && m.connected && now - m.lastAt > NO_FRAME_MS) mateLost(m.uid);
        if (!m.connected) continue;
        if (vs && m.owed > 0 && !m.choosing) { m.owed--; m.choosing = true; m.luSeq = ++levelSeq; m.q.push(['lu', tms[m.team - 1].level, m.luSeq]); }
        m.flushT -= dt;
        if (m.flushT > 0) continue;
        m.flushT = rateFor(m.uid);
        G.Net.send(m.uid, hostFrame(m));
      }
    } else {
      if (!stalled && performance.now() - lastHostAt > STALL_MS) { stalled = true; updateAway(); hostStalled(); }
      flushT -= dt;
      if (flushT <= 0) {
        flushT = rateFor(hostUid);
        const f = { k: 'f', p: myState(), ev: outEv };
        if (srvMode()) { const b = dueBuild(dt); if (b) f.b = b; }
        G.Net.toHost(f);
        outEv = [];
      }
    }
  }

  // ---------------- recepción ----------------

  G.Net.on((from, msg) => {
    if (!msg) return;
    if (msg.k === 'start') { if (G.Flow.startCoop) G.Flow.startCoop(msg); return; }
    if (msg.k === 'rejoin') { if (active && host) onRejoin(from); return; }
    if (msg.k === 'rejoined') { if (!active && G.Flow.rejoinCoop) G.Flow.rejoinCoop(msg); return; }
    if (!active || msg.k !== 'f') return;
    if (host) onClientFrame(from, msg); else if (from === hostUid) onHostFrame(msg);
  });

  G.Net.onPeer((u, mode) => {
    if (!active || (mode !== 'closed' && mode !== 'failed')) return;
    if (host) mateGone(u);
    else if (u === hostUid) { const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.'); }
  });

  function mateGone(u) {
    const m = mates.get(u);
    if (!m || m.gone) return;
    clearTimeout(m.lostT);
    m.connected = false; m.lost = false; m.gone = true;
    G.Projectiles.clearOrbs(m.pl);
    G.Spawner.say(m.name + ' ha dejado la partida', 2.6);
    if (waiting.has(u)) picked(u);
    if (holds.has(u)) holdOff(u);
    if (api.mateLeft) api.mateLeft(m);
  }

  // --- desconexiones con sitio guardado (modo servidor) ---

  /** Anfitrión: un invitado se ha quedado sin conexión: se le espera GRACE_MS. */
  function mateLost(u) {
    const m = mates.get(u);
    if (!m || !m.connected || m.gone) return;
    m.connected = false; m.lost = true;
    G.Projectiles.clearOrbs(m.pl);
    G.Spawner.say(m.name + ' se ha desconectado: se le guarda el sitio un momento', 3.2);
    if (waiting.has(u)) picked(u);
    if (holds.has(u)) holdOff(u);
    clearTimeout(m.lostT);
    m.lostT = setTimeout(() => { if (active && mates.get(u) === m && m.lost) mateGone(u); }, GRACE_MS);
  }

  /** Anfitrión: el invitado ha vuelto (ha llegado un envío suyo). */
  function mateBack(u) {
    const m = mates.get(u);
    if (!m || !m.lost || m.gone) return;
    clearTimeout(m.lostT); m.lostT = 0;
    m.lost = false; m.connected = true; m.q = []; m.flushT = 0;
    G.Spawner.say(m.name + ' ha vuelto a la partida', 2.6);
    G.Net.reconnect(u);
    resendWorld(m);                   // lo que apareció mientras no estaba
    flushAll();
  }

  /** Invitado (modo servidor): el anfitrión no responde: GRACE_MS y se da por perdida. */
  function hostStalled() {
    if (!srvMode() || hostLostT) return;
    hostLostT = setTimeout(() => {
      hostLostT = 0;
      if (!active || host || !stalled) return;
      const cb = api.lost; end(); if (cb) cb('Se ha perdido la conexión con el anfitrión.');
    }, GRACE_MS);
  }

  // Modo servidor: la sala dice quién sigue conectado (server/lan.js marca on=false a quien se corta).
  G.Social.on(what => {
    if (what !== 'room' || !active || !host || !srvMode()) return;
    const room = G.Social.room;
    if (!room || !room.members) return;
    for (const m of mates.values()) {
      const mm = room.members.find(x => x.uid === m.uid);
      if (!mm) continue;                                   // (si ya no está en la sala, net.js lo cierra: mateGone)
      if (mm.on === false && m.connected && performance.now() - m.lastAt > STALL_MS) mateLost(m.uid);
    }
  });

  // --- en el anfitrión ---

  function onClientFrame(from, msg) {
    const m = mates.get(from);
    if (!m || m.gone) return;
    m.lastAt = performance.now();
    if (m.lost) mateBack(from);
    if (!m.connected) return;
    if (msg.b) m.build = msg.b;
    if (msg.p) { m.state = msg.p; m.pl.net = readState(msg.p); m.xpMul = m.pl.net.xpMul || 1; reconcile(from, m.pl.net); }
    for (const ev of msg.ev || []) {
      switch (ev[0]) {
        case 'h': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead || e.remote) break;
          hitFrom = from;
          e.hurt(ev[2], ev[3], ev[4], ev[5], ev[6]);
          hitFrom = null;
          break;
        }
        case 's': {
          const e = G.EnemyMgr.get(ev[1]);
          if (!e || e.dead) break;
          if (ev[2] === 'b') e.applyBurn(ev[3]);
          else if (ev[2] === 'p') e.applyPoison(ev[3]);
          else if (ev[2] === 's') e.applySlow(ev[3]);
          break;
        }
        case 'c':
          G.Combat.ghostCast(m.pl, ev[1], ev[2], ev[3], ev[4]);
          emit(['c', from, ev[1], ev[2], ev[3], ev[4]], from);
          break;
        case 'pb':
          G.World.breakAt(ev[1], ev[2]);
          emit(['pb', ev[1], ev[2]], from);
          break;
        case 'lp': if (vs) m.choosing = false; else picked(from); break;
        case 'hs': if (!vs) holdOn(from); break;
        case 'he': if (!vs) holdOff(from); break;
        case 're': G.Rift.enterRequest(vs ? m.team : 0); break;
        case 'bye': mateGone(from); break;
      }
    }
  }

  /** Anfitrión: lo que dice cada envío del invitado manda sobre avisos que se hayan perdido. */
  function reconcile(from, n) {
    if (n.ch === undefined) return;                        // versión vieja del juego
    if (vs) { const m = mates.get(from); if (m && m.choosing && n.ld >= m.luSeq) m.choosing = false; return; }
    if (n.ch && !holds.has(from)) holdOn(from);
    else if (!n.ch && holds.has(from)) holdOff(from);
    if (waiting.has(from) && n.ld >= levelSeq) picked(from);
  }

  // --- en el invitado ---

  /** Invitado: se para (o sigue) según si el anfitrión está. */
  function updateAway() { if (api.away) api.away(hostAway || stalled ? nameOf(hostUid) : null); }

  // Anfitrión: al irse de la pestaña avisa a todos al momento (después ya no
  // podrá mandar nada) y al volver, que sigue.
  document.addEventListener('visibilitychange', () => {
    if (!active || !host) return;
    emit(['ha', document.hidden ? 1 : 0]);
    flushAll();
  });

  function onHostFrame(msg) {
    lastHostAt = performance.now();
    if (stalled) { stalled = false; updateAway(); }
    if (hostLostT) { clearTimeout(hostLostT); hostLostT = 0; }
    for (const ev of msg.ev || []) applyHostEvent(ev);
    if (msg.ja) G.Judgment.netApply(msg.ja);
    // Quién elige y las cartas de nivel, aunque se haya perdido algún aviso.
    if (msg.ho) {
      const k = msg.ho.join('|');
      if (k !== lastHo) { lastHo = k; api.hold && api.hold(msg.ho); }
      if (msg.lu && msg.lu[0] > seenSeq) { seenSeq = msg.lu[0]; api.levelStart(msg.lu[1]); }
      else if (!msg.lu && api.inLevelUp && api.inLevelUp()) api.resume();
    }
    if (msg.ts) scores = msg.ts;
    api.syncTeam({ time: msg.t, level: msg.lv, xp: msg.xp, xpNext: msg.xn, kills: msg.ki, bosses: msg.bo, coins: msg.co,
                   t1: (msg.tk || [])[0], t10: (msg.tk || [])[1] });
    for (const u in msg.p || {}) {
      const m = mates.get(u);
      if (m) m.pl.net = readState(msg.p[u]);
    }
    const now = performance.now();
    for (const a of msg.e || []) {
      const e = G.EnemyMgr.get(a[0]);
      if (!e || !e.remote || e.dead) continue;
      const n = e.net;
      const dts = (now - (n.last || now)) / 1000;
      if (dts > 0.02 && dts < 1) {
        n.vx = G.U.clamp((a[1] - n.x) / dts, -600, 600);
        n.vy = G.U.clamp((a[2] - n.y) / dts, -600, 600);
      } else { n.vx = 0; n.vy = 0; }
      n.x = a[1]; n.y = a[2]; n.age = 0; n.last = now;
      e.hp = Math.min(e.maxHp, a[3]);
      n.anim = a[4]; n.dir = a[5]; n.st = a[6];
    }
  }

  function applyHostEvent(ev) {
    switch (ev[0]) {
      case 'ne':
        G.EnemyMgr.addRemote({ id: ev[1], dex: ev[2], x: ev[3], y: ev[4], boss: !!ev[5], shiny: !!ev[6], hp: ev[7], dmg: ev[8], beh: ev[9] });
        break;
      case 'ed': G.EnemyMgr.removeRemote(ev[1], true); break;
      case 'eg': G.EnemyMgr.removeRemote(ev[1], false); break;
      case 'hn': { const e = G.EnemyMgr.get(ev[1]); if (e && !e.dead) e.showHurt(ev[2], ev[3]); break; }
      case 'es':
        G.Projectiles.spawn({ x: ev[1], y: ev[2], vx: ev[3], vy: ev[4], dmg: ev[5], r: ev[6], life: ev[7],
                              friendly: false, color: '#ff7a9e', vis: G.VFX.forType(ev[8]), mtype: ev[8] });
        break;
      case 'c': { const m = mates.get(ev[1]); if (m) G.Combat.ghostCast(m.pl, ev[2], ev[3], ev[4], ev[5]); break; }
      case 'item': api.item(ev[1]); break;
      case 'pk': G.Pickups.addRemote(ev[1], ev[2], ev[3], ev[4], ev[5]); break;
      case 'pc': G.Pickups.removeId(ev[1]); break;
      case 'mag': G.Pickups.pullAll(); G.FX.ring(local.x, local.y, 10, 420, '#ff9ed8', 0.6, 4); break;
      case 'bomb':
        G.FX.ring(ev[1], ev[2], 20, G.Camera.outerRadius(), '#ff7b3d', 0.5, 6);
        if (G.U.dist2(ev[1], ev[2], local.x, local.y) < 500 * 500) G.Camera.kick(0.8);
        G.Audio.sfx('break');
        break;
      case 'pb': G.World.breakAt(ev[1], ev[2]); break;
      case 'say': G.Spawner.say(ev[1], ev[2]); break;
      case 'heal': if (!local.dead) { local.heal(local.maxHp * ev[1]); G.FX.ring(local.x, local.y, 6, 60, '#5fe08a', 0.4, 3); } break;
      case 'lu': if (!ev[2] || ev[2] > seenSeq) { seenSeq = ev[2] || seenSeq; api.levelStart(ev[1]); } break;
      case 'lw': api.waiting(ev[1]); break;
      case 'lr': api.resume(); break;
      case 'hp': lastHo = (ev[1] || []).join('|'); api.hold && api.hold(ev[1]); break;
      case 'ha': hostAway = !!ev[1]; updateAway(); break;
      case 'sh': api.shiny(ev[1]); break;
      case 'ov': { const cb = api.over; const d = ev[1]; end(); cb(d); break; }
      case 'rift': case 'riftx': case 'riftc': case 'arena': case 'aw': case 'al': G.Rift.onEvent(ev); break;
      case 'jd': case 'jk': G.Judgment.onEvent(ev); break;
      case 'wx': G.Weather.onEvent(ev); break;
      case 'ev': G.Events.onNet(ev); break;
      case 'hz': G.Hazards.add(ev[1], true); break;
      case 'fxr': G.FX.ring(ev[1], ev[2], 8, ev[3], ev[4], 0.5, 3); break;
    }
  }

  // ---------------- ganchos que llaman los módulos del juego ----------------

  /** Tu ataque: los demás lo repiten como fantasma. */
  function cast(pl, m) {
    if (!active || pl !== local) return;
    if (host) emit(['c', me, m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
    else outEv.push(['c', m.id, m.lvl, r2(pl.aim), m.evolved ? 1 : 0]);
  }

  // invitado
  function hit(e, d, color, dx, dy, knock) { outEv.push(['h', e.id, d, color, r1(dx), r1(dy), knock || 0]); }
  function status(e, kind, val) { outEv.push(['s', e.id, kind, val]); }

  // anfitrión
  function hurtShown(e, d, color) { emitNear(['hn', e.id, d, color], e.x, e.y, hitFrom); }
  function enemyAdded(e) {
    emit(['ne', e.id, e.dex, r1(e.x), r1(e.y), e.boss ? 1 : 0, e.shiny ? 1 : 0, Math.ceil(e.maxHp), r2(e.dmg), e.behavior]);
  }
  function enemyGone(e, died) { emit([died ? 'ed' : 'eg', e.id]); }
  function enemyShot(p, type) { emit(['es', r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.dmg), p.r, p.life, type]); }
  function pickupAdded(o) { emit(['pk', o.id, o.kind, r1(o.x), r1(o.y), o.value]); }
  function pickupGone(id) { emit(['pc', id]); }
  function say(text, secs) { emit(['say', text, secs]); }

  function propBroken(p) {
    if (host) emit(['pb', p.tx, p.ty]);
    else outEv.push(['pb', p.tx, p.ty]);
  }

  /** Anfitrión: alguien ha cogido un objeto. Devuelve true si es para ti. */
  function collected(p, who) {
    emit(['pc', p.id]);
    if (p.kind === 'magnet') emit(['mag']);
    if (p.kind === 'bomb') emit(['bomb', r1(who.x), r1(who.y)]);
    if ((p.kind === 'heal' || p.kind === 'item') && who !== local) {
      const m = mates.get(who.uid);
      if (m) m.q.push(p.kind === 'heal' ? ['heal', 0.3] : ['item', p.value]);
    }
  }

  function shinyCaught(e) { emit(['sh', e.dex]); }

  // ---------------- subida de nivel compartida ----------------

  function levelStart(level) {
    waiting = new Set([me]);
    for (const m of mates.values()) if (m.connected) waiting.add(m.uid);
    levelSeq++; levelNow = level;
    emit(['lu', level, levelSeq]);
    flushAll();
    api.levelStart(level);
    sendWaiting();
  }

  function nameOf(u) { return u === me ? (G.Social.me ? G.Social.me.name : 'Tú') : (mates.get(u) || {}).name || '?'; }

  function sendWaiting() {
    const names = [...waiting].map(nameOf);
    emit(['lw', names]);
    api.waiting(names);
  }

  /** Alguien ha elegido carta (anfitrión). */
  function picked(u) {
    if (!waiting.delete(u)) return;
    if (waiting.size) { sendWaiting(); return; }
    emit(['lr']);
    flushAll();
    api.resume();
  }

  // ---------------- fusiones: pausa para todos ----------------
  // Mientras alguien elige qué movimientos fusiona (vínculo de un legendario),
  // la partida se para para todos, como con las cartas de nivel.

  function holdNames() { return [...holds].map(nameOf); }

  /** Anfitrión: `u` empieza a elegir. */
  function holdOn(u) {
    holds.add(u);
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** Anfitrión: `u` ha terminado (o se ha ido). */
  function holdOff(u) {
    if (!holds.delete(u)) return;
    emit(['hp', holdNames()]); flushAll();
    api.hold && api.hold(holdNames());
  }

  /** Tú empiezas / terminas de elegir fusión. (Enfrentamiento: nadie para a los demás.) */
  function holdStart() { if (vs) return; if (host) holdOn(me); else { outEv.push(['hs']); flushClient(true); } }
  function holdEnd() { if (vs) return; if (host) holdOff(me); else { outEv.push(['he']); flushClient(true); } }

  /** Has elegido tu carta. */
  function localPicked() {
    if (host) { if (!vs) picked(me); }
    else { doneSeq = seenSeq; outEv.push(['lp']); flushClient(true); }
  }

  /** Anfitrión: se acabó para todos. */
  function over(data) {
    if (vs) data = Object.assign({}, data, { teams: teamsSummary() });
    emit(['ov', data]);
    flushAll();
    end();
  }

  return {
    ANIMS, COLORS, TEAM_COLORS, PVP_K, begin, end, leave, tick, players, puppets, xpFactor, scaleRate, scaleHp,
    rejoin, buildOf,
    // Enfrentamiento
    teamXp, enemyKilled, teamsSummary, emitTeam, enemyOf, teamOf,
    get vs() { return active && vs; },
    get myTeam() { return myTeam; },
    get teamsN() { return teamsN; },
    get scores() { return scores; },
    get hitFrom() { return hitFrom; },
    cast, hit, status, hurtShown, enemyAdded, enemyGone, enemyShot, pickupAdded, pickupGone, say,
    propBroken, collected, shinyCaught, levelStart, localPicked, over, holdStart, holdEnd,
    /** Anfitrión: evento para todos. Invitado: evento para el anfitrión. */
    broadcast(ev) { emit(ev); },
    toHost(ev) { if (active && !host) { outEv.push(ev); flushClient(true); } },
    mate(u) { return mates.get(u); },
    get mates() { return [...mates.values()]; },
    get members() { return members; },
    get active() { return active; },
    get isHost() { return active && host; },
    get local() { return local; }
  };
})();
