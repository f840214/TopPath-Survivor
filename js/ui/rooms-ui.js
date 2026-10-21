/* ============ rooms-ui.js — "Multijugador": lista de salas del servidor de red local ============
 * Sólo en modo servidor (G.DB.mode === 'server'): el servidor manda la lista de
 * salas abiertas (mensaje 'rooms') y cualquiera entra sin invitación. Desde
 * aquí se crea una sala nueva o se entra en una; después se va a la sala
 * (G.LobbyUI) como siempre.
 */
G.RoomsUI = (() => {
  const $ = G.UI.$;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let wired = false, busy = false;

  let mode = 'coop', size = 4, teams = 2;

  /** Grupo de chips: uno marcado; `fn` recibe el valor elegido. */
  function chips(el, fn) {
    el.querySelectorAll('.chip').forEach(c => { c.onclick = () => {
      el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
      fn(c.dataset.v);
    }; });
  }

  function init() {
    if (wired) return;
    wired = true;
    const sz = $('rooms-size');
    for (let n = 2; n <= G.Social.MAX_PLAYERS; n++) sz.insertAdjacentHTML('beforeend', `<button class="chip${n === size ? ' on' : ''}" data-v="${n}">${n}</button>`);
    chips(sz, v => { size = +v; });
    chips($('rooms-teams'), v => { teams = +v; });
    chips($('rooms-mode'), v => {
      mode = v;
      const vs = mode === 'vs';
      document.querySelectorAll('#scr-rooms .rooms-coop').forEach(el => el.classList.toggle('hidden', vs));
      document.querySelectorAll('#scr-rooms .rooms-vs').forEach(el => el.classList.toggle('hidden', !vs));
    });
    $('rooms-create').onclick = async () => {
      if (busy) return;
      busy = true;
      try {
        const vs = mode === 'vs';
        await G.Social.createRoom(vs ? 0 : size, vs ? { mode: 'vs', teams } : { mode: 'coop' });
        G.LobbyUI.open();
      } catch (e) { G.UI.toast(e.message || 'No se pudo crear la sala.'); }
      busy = false;
    };
    $('rooms-refresh').onclick = () => refresh(true);
    G.Social.on(what => { if (what === 'rooms' && G.UI.isOpen('scr-rooms')) render(); });
  }

  async function refresh(force) {
    try { await G.Social.listRooms(force); } catch (e) { /* se queda la última lista */ }
    render();
  }

  function render() {
    const box = $('rooms-list');
    const list = G.Social.rooms || [];
    const mine = G.Social.room;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<p class="note center">No hay ninguna sala abierta. ¡Crea una y los demás podrán entrar!</p>';
      return;
    }
    for (const r of list) {
      const el = document.createElement('div');
      const full = r.n >= r.max, inIt = mine && mine.id === r.id;
      el.className = 'room-card' + (r.open && !full ? ' open' : '');
      // El nombre no se traduce, la frase sí (G.I18n.f): dentro de translate="no" el traductor automático no entra.
      el.innerHTML = `<b translate="no">${G.I18n.f('Sala de {x}', esc(r.hostName))}</b>` +
        `<span class="meta"><span class="badge ${r.mode === 'vs' ? 'vs' : 'coop'}">${r.mode === 'vs' ? G.I18n.f('Enfrentamiento · {x} equipos', r.teams) : 'Cooperativo'}</span>` +
        `<span><i class="cap"><i style="width:${Math.round(100 * r.n / r.max)}%"></i></i> ${r.n}/${r.max}</span>` +
        `<span>${r.open ? 'Esperando jugadores' : 'En partida'}</span></span>`;
      const b = document.createElement('button');
      b.className = 'btn ' + (inIt ? 'gold' : full || !r.open ? 'ghost' : 'gold');
      b.textContent = inIt ? 'Volver' : full ? 'Llena' : !r.open ? 'En partida' : 'Entrar';
      b.disabled = !inIt && (full || !r.open);
      b.onclick = async () => {
        if (busy) return;
        busy = true;
        const res = inIt ? { ok: true } : await G.Social.joinRoom(r.id);
        busy = false;
        if (!res.ok) { G.UI.toast(res.error); refresh(true); return; }
        G.LobbyUI.open();
      };
      el.appendChild(b);
      box.appendChild(el);
    }
  }

  function open() {
    if (!G.DB.online) {
      G.UI.toast(G.DB.guest ? 'Crea una cuenta para jugar en grupo.' : 'Esto necesita el servidor de la red local.', 3200);
      return;
    }
    init();
    const go = () => {
      G.UI.show('scr-rooms', true);
      $('rooms-list').innerHTML = '<p class="note center">Cargando…</p>';
      refresh(true);
    };
    if (G.Social.me) go(); else G.Social.start().then(r => { if (r === 'ok') go(); else G.NickUI.open(go); });
  }

  return { open, render };
})();
