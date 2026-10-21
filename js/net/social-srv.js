/* ============ social-srv.js — jugadores, salas e invitaciones en la red local ============
 * La versión de G.Social para el modo servidor (server/server.js): misma API
 * que social.js (nube), pero:
 *   - no hay apodos ni solicitudes: TODOS los jugadores del servidor son ya
 *     tus amigos y el nombre de la cuenta es el apodo;
 *   - el "en línea" lo sabe el servidor (quién tiene el WebSocket abierto);
 *   - salas, invitaciones y el relé de la partida van por G.Srv (WebSocket).
 * G.Social (social.js) elige esta versión o la de la nube según G.DB.mode.
 */
G.SocialSrv = (() => {
  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;
  const MAX_PLAYERS = 8;      // en la red local caben 8 (en la nube siguen siendo 4)
  const INVITE_TTL = 3 * 60 * 1000;

  let me = null, started = false, playing = false;
  let players = new Map();          // uid -> { uid, name, pid, status:'ok', online, play, room, seen }
  let room = null;                  // { id, host, isHost, members: [{ uid, name, dex, shiny, at, on }], open }
  const invites = new Map();        // fromUid -> { from, name, room, at }
  const listeners = new Set();
  let wired = false;

  function emit(what) { listeners.forEach(fn => { try { fn(what); } catch (e) { console.warn(e); } }); }
  const now = () => Date.now();

  // ---------------- arranque ----------------

  async function start() {
    if (!G.DB.online || G.DB.mode !== 'server') return 'off';
    if (started) return 'ok';
    started = true;
    me = { uid: G.DB.key, name: G.DB.user };
    if (!wired) { wired = true; G.Srv.on(onMsg); G.Srv.onState(onState); }
    G.Srv.connect();
    refreshPresence(true);
    return 'ok';
  }

  async function stop() {
    if (!started) return;
    await leaveRoom().catch(() => {});
    G.Srv.close();
    players.clear(); invites.clear();
    me = null; started = false; playing = false; room = null;
    emit('stop');
  }

  function onState(s) {
    if (s !== 'open') { emit('net'); return; }
    // Conexión recuperada: de vuelta a la sala (el servidor guarda tu sitio un rato en plena partida).
    if (room) {
      const id = room.id;
      G.Srv.call({ k: 'room.join', room: id, dex: G.DB.save.partner, shiny: !!G.DB.save.partnerShiny && G.DB.ownsShiny(G.DB.save.partner) })
        .then(r => { if (room && room.id === id && !r.ok) closedRoom(); });
    }
    if (playing) G.Srv.send({ k: 'play', on: true });
    emit('net');
  }

  function onMsg(m) {
    switch (m.k) {
      case 'pres': applyPlayers(m.list || []); break;
      case 'room': if (!room || room.id === m.room.id) setRoom(m.room); break;
      case 'room.closed': if (room && room.id === m.room) closedRoom(); break;
      // Tras recargar la página, el servidor dice en qué sala seguías (sitio guardado en plena partida).
      case 'hello': blocks = new Set(m.blocks || []); emit('friends'); if (m.room && (!room || room.id === m.room.id)) { setRoom(m.room); afterHello(); } break;
      case 'rooms': rooms = m.list || []; emit('rooms'); break;
      case 'inv': {
        if (!m.from || m.from === (me && me.uid)) break;
        invites.set(m.from, { from: m.from, name: m.name, room: m.room, at: m.at || now() });
        emit('invites');
        break;
      }
      case 'inv.cancel': if (invites.delete(m.from)) emit('invites'); break;
      default: break;
    }
  }

  // ---------------- jugadores (= amigos) ----------------

  // Lista negra (se guarda en el servidor): esos jugadores no salen en la lista ni pueden invitarte.
  let blocks = new Set();
  async function block(uid, on = true) {
    const r = await G.Srv.call({ k: on ? 'block' : 'unblock', to: uid });
    if (!r.ok) return { ok: false, error: r.error || 'No se pudo.' };
    blocks = new Set(r.blocks || []);
    emit('friends');
    return { ok: true };
  }

  function applyPlayers(list) {
    const next = new Map();
    for (const p of list) {
      if (!me || p.uid === me.uid) continue;
      next.set(p.uid, { uid: p.uid, name: p.name, pid: '', status: 'ok', online: !!p.online, play: !!p.play, room: p.room || '', seen: p.seen || 0, dex: p.dex || 0, shiny: !!p.shiny });
    }
    players = next;
    emit('friends');
    emit('presence');
  }

  let presAt = 0;
  async function refreshPresence(force = false) {
    if (!started || (!force && Date.now() - presAt < 5000)) return;
    presAt = Date.now();
    try { const r = await G.DB.api('GET', 'players'); if (r && r.list) applyPlayers(r.list); }
    catch (e) { /* sin servidor ahora mismo: se queda lo último */ }
  }

  const NO_NEED = { ok: false, error: 'En este servidor todos los jugadores ya sois amigos: no hace falta añadir a nadie.' };
  async function claimNick() { return { ok: true }; }
  async function request() { return NO_NEED; }
  async function accept() { return NO_NEED; }
  async function remove() { return NO_NEED; }

  function setPlaying(p) {
    if (playing === !!p) return;
    playing = !!p;
    G.Srv.send({ k: 'play', on: playing });
  }

  // ---------------- salas ----------------

  function memberInfo() {
    const s = G.DB.save;
    return { dex: s.partner, shiny: !!s.partnerShiny && G.DB.ownsShiny(s.partner) };
  }

  let rooms = [];                   // salas del servidor (lista de "Multijugador")
  async function listRooms() {
    const r = await G.Srv.call({ k: 'room.list' });
    if (r.ok) { rooms = r.list || []; emit('rooms'); }
    return rooms;
  }

  function setRoom(v) {
    room = { id: v.id, host: v.host, isHost: v.host === (me && me.uid), members: v.members || [], open: v.open !== false, max: v.max || MAX_PLAYERS,
             mode: v.mode || 'coop', teams: v.teams || 0 };
    emit('room');
  }

  /** @param opts  { mode: 'coop' | 'vs', teams: 2 | 3 } (enfrentamiento: equipos de 3) */
  async function createRoom(max, opts = {}) {
    if (room) return room;
    const r = await G.Srv.call(Object.assign({ k: 'room.create', max: max | 0, mode: opts.mode || 'coop', teams: opts.teams | 0 }, memberInfo()));
    if (!r.ok) throw new Error(r.error || 'No se pudo crear la sala.');
    setRoom(r.room);
    return room;
  }

  async function joinRoom(id) {
    if (room && room.id === id) return { ok: true };
    if (room) await leaveRoom();
    const r = await G.Srv.call(Object.assign({ k: 'room.join', room: id }, memberInfo()));
    if (!r.ok) return { ok: false, error: r.error || 'No se pudo entrar en la sala.' };
    setRoom(r.room);
    return { ok: true };
  }

  /** Recargaste siendo el anfitrión: la partida no se puede recuperar (el anfitrión manda en todo): se cierra la sala. */
  function afterHello() {
    if (room && room.isHost && !room.open && !(G.Coop && G.Coop.active)) {
      leaveRoom();
      if (G.UI && G.UI.toast) G.UI.toast('La partida que dirigías se ha perdido al recargar la página.', 4200);
    }
  }

  /** ¿Hay una partida en marcha a la que puedes volver (sala empezada, tú invitado y aún no dentro)? */
  function rejoinable() { return !!(room && !room.open && !room.isHost && !(G.Coop && G.Coop.active)); }

  function closedRoom() {
    if (!room) return;
    room = null;
    emit('room-closed');
  }

  async function leaveRoom() {
    if (!room) return;
    room = null;
    G.Srv.send({ k: 'room.leave' });
    emit('room');
  }

  function setOpen(open) { if (room && room.isHost) G.Srv.send({ k: 'room.open', open: !!open }); }
  /** Enfrentamiento: cambiarte de equipo. */
  async function setTeam(t) {
    if (!room) return { ok: false, error: 'No estás en ninguna sala.' };
    const r = await G.Srv.call({ k: 'room.team', team: t | 0 });
    return r.ok ? { ok: true } : { ok: false, error: r.error || 'No se pudo cambiar de equipo.' };
  }
  function refreshMember() { if (room && me) G.Srv.send(Object.assign({ k: 'room.member' }, memberInfo())); }

  // ---------------- invitaciones ----------------

  async function invite(other) {
    const f = players.get(other);
    if (!f) return { ok: false, error: 'No hay ningún jugador con ese nombre.' };
    if (room && room.members.length >= MAX_PLAYERS) return { ok: false, error: 'La sala está llena.' };
    if (room && !room.isHost) return { ok: false, error: 'Sólo el anfitrión de la sala puede invitar.' };
    try { if (!room) await createRoom(); } catch (e) { return { ok: false, error: e.message }; }
    const r = await G.Srv.call({ k: 'inv', to: other });
    if (!r.ok) return { ok: false, error: r.error || 'No se pudo invitar.' };
    return { ok: true, msg: 'Invitación enviada a ' + f.name };
  }

  async function acceptInvite(from) {
    const inv = invites.get(from);
    invites.delete(from);
    emit('invites');
    if (!inv || now() - inv.at > INVITE_TTL) return { ok: false, error: 'La invitación ha caducado.' };
    return joinRoom(inv.room);
  }

  function declineInvite(from) { invites.delete(from); emit('invites'); }

  // ---------------- perfil público ----------------

  function profileData() { return G.SocialCloud.profileData(); }

  let pubT = 0, pubLast = '';
  function publishProfile() {
    if (!me) return;
    clearTimeout(pubT);
    pubT = setTimeout(() => {
      if (!me) return;
      const d = Object.assign(profileData(), { name: me.name });
      const key = JSON.stringify(d);
      if (key === pubLast) return;
      pubLast = key;
      G.DB.api('PUT', 'profile', d).catch(() => { pubLast = ''; });
    }, 800);
  }

  const profCache = new Map();
  async function getProfile(other) {
    if (!started) return null;
    if (me && other === me.uid) return Object.assign(profileData(), { name: me.name });
    const c = profCache.get(other);
    if (c && Date.now() - c.at < 60 * 1000) return c.v;
    let v = null;
    try { v = (await G.DB.api('GET', 'profile/' + encodeURIComponent(other))).profile || null; } catch (e) { /* nada */ }
    if (v) profCache.set(other, { at: Date.now(), v });
    return v;
  }

  G.DB.onLeave(why => stop(why));

  return {
    start, stop, claimNick, request, accept, remove, publishProfile, getProfile, profileData,
    createRoom, joinRoom, leaveRoom, setOpen, refreshMember, setPlaying, refreshPresence,
    invite, acceptInvite, declineInvite, listRooms, setTeam,
    get rooms() { return rooms; },
    on(fn) { listeners.add(fn); }, off(fn) { listeners.delete(fn); },
    get me() { return me; },
    get started() { return started; },
    get friends() { return [...players.values()].filter(p => !blocks.has(p.uid)); },
    get blocked() { return [...players.values()].filter(p => blocks.has(p.uid)); },
    block,
    get invites() { return [...invites.values()].filter(i => now() - i.at <= INVITE_TTL); },
    get room() { return room; },
    get rejoinable() { return rejoinable(); },
    get uid() { return me ? me.uid : null; },
    now, VALID, MAX_PLAYERS
  };
})();
