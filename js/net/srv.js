/* ============ srv.js — conexión WebSocket con server/server.js (red local) ============
 * Sólo en modo servidor (G.DB.mode === 'server'). Por aquí van la presencia,
 * las salas, las invitaciones, la señalización WebRTC y el relé de la partida
 * (ver server/lan.js para los mensajes).
 *
 * Si se corta, vuelve a conectar sola (1 s, 2 s, 4 s, 4 s...) sin
 * límite de intentos: la partida en grupo sigue viva mientras tanto y el
 * servidor guarda tu sitio en la sala un rato (ver coop.js).
 *
 * API:  connect() · close() · send(msg) -> bool · call(msg) -> Promise (respuesta { k:'re', ... })
 *       on(fn(msg)) · onState(fn('open'|'closed')) · get open · get uid
 */
G.Srv = (() => {
  let ws = null, wanted = false, open = false, tries = 0, retryT = 0, rid = 0;
  const waits = new Map();          // id -> { res, t }
  const handlers = new Set(), stateHandlers = new Set();
  let hello = null;

  function url() {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return p + '//' + location.host + '/ws?token=' + encodeURIComponent(G.DB.token || '');
  }

  function connect() {
    wanted = true;
    if (ws || !G.DB.token) return;
    let w;
    try { w = new WebSocket(url()); } catch (e) { scheduleRetry(); return; }
    ws = w;
    w.onopen = () => { if (ws !== w) return; open = true; tries = 0; emitState('open'); };
    w.onmessage = e => {
      if (ws !== w) return;
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.k === 'hello') hello = m;
      if (m.k === 're' && waits.has(m.id)) { const p = waits.get(m.id); waits.delete(m.id); clearTimeout(p.t); p.res(m); return; }
      handlers.forEach(fn => { try { fn(m); } catch (err) { console.warn('[Srv]', err); } });
    };
    w.onclose = () => { if (ws !== w) return; ws = null; const was = open; open = false; failWaits(); if (was) emitState('closed'); if (wanted) scheduleRetry(); };
    w.onerror = () => { /* onclose llega después */ };
  }

  function scheduleRetry() {
    clearTimeout(retryT);
    const ms = Math.min(4000, 1000 * Math.pow(2, tries++)) * (0.8 + Math.random() * 0.4);
    retryT = setTimeout(() => { if (wanted && !ws) connect(); }, ms);
  }
  // Al volver la red o a la pestaña, se intenta al momento.
  addEventListener('online', () => { if (wanted && !ws) { clearTimeout(retryT); tries = 0; connect(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wanted && !ws) { clearTimeout(retryT); connect(); } });

  function close() {
    wanted = false;
    clearTimeout(retryT);
    const w = ws; ws = null; open = false; hello = null;
    failWaits();
    if (w) { try { w.close(); } catch (e) { /* nada */ } }
  }

  function failWaits() {
    for (const p of waits.values()) { clearTimeout(p.t); p.res({ k: 're', ok: false, error: 'Sin conexión con el servidor.' }); }
    waits.clear();
  }

  function send(msg) {
    if (!open || !ws) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }

  /** Mensaje con respuesta (room.create, room.join, inv...). Nunca se queda colgado: 8 s de tope. */
  function call(msg) {
    return new Promise(res => {
      const id = ++rid;
      msg.id = id;
      if (!send(msg)) { res({ k: 're', ok: false, error: 'Sin conexión con el servidor.' }); return; }
      const t = setTimeout(() => { if (waits.has(id)) { waits.delete(id); res({ k: 're', ok: false, error: 'El servidor no responde.' }); } }, 8000);
      waits.set(id, { res, t });
    });
  }

  function emitState(s) { stateHandlers.forEach(fn => { try { fn(s); } catch (e) { console.warn('[Srv]', e); } }); }

  return {
    connect, close, send, call,
    on(fn) { handlers.add(fn); }, off(fn) { handlers.delete(fn); },
    onState(fn) { stateHandlers.add(fn); },
    get open() { return open; },
    get uid() { return hello ? hello.uid : (G.DB.key || null); },
    /** Sitio guardado en la sala si te desconectas en plena partida (ms, lo dice el servidor). */
    get grace() { return hello && hello.grace ? hello.grace : 180000; }
  };
})();
