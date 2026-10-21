/* ============ social-ui.js — apodo, amigos, sala e invitaciones ============ */
(() => {
  const $ = G.UI.$;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** ¿Se puede usar lo online? Si no, explica por qué. */
  function needOnline() {
    if (G.DB.online) return true;
    G.UI.toast(G.DB.guest ? 'Crea una cuenta para jugar con amigos y salir en el ranking.'
      : 'Esto necesita la versión online del juego (con la nube).', 3200);
    return false;
  }

  // ======================= APODO =======================

  G.NickUI = (() => {
    let then = null, skipped = false;

    function init() {
      $('nick-form').onsubmit = async e => {
        e.preventDefault();
        $('nick-err').textContent = '';
        $('nick-ok').disabled = true;
        const r = await G.Social.claimNick($('nick-in').value);
        $('nick-ok').disabled = false;
        if (!r.ok) { $('nick-err').textContent = r.error; G.Audio.sfx('error'); return; }
        G.Audio.sfx('confirm');
        G.UI.toast('Tu apodo es ' + G.Social.me.name);
        const cb = then; then = null;
        if (cb) cb(); else G.MenuUI.open();
      };
      $('nick-later').onclick = () => { skipped = true; then = null; G.MenuUI.open(); };
    }

    /** @param next  qué abrir después de elegirlo */
    function open(next) {
      then = next || null;
      G.UI.show('scr-nick');
      $('nick-err').textContent = '';
      $('nick-in').value = '';
      setTimeout(() => $('nick-in').focus(), 50);
    }

    return { init, open, get skipped() { return skipped; } };
  })();

  /** Abre `fn` si tienes apodo; si no, pide el apodo primero. */
  function withNick(fn) {
    if (!needOnline()) return;
    if (G.Social.me) { fn(); return; }
    G.Social.start().then(r => { if (r === 'ok') fn(); else G.NickUI.open(fn); });
  }

  // ======================= AMIGOS =======================

  G.FriendsUI = (() => {
    function init() {
      $('fr-add').onsubmit = async e => {
        e.preventDefault();
        const name = $('fr-name').value;
        msg('');
        const r = await G.Social.request(name);
        msg(r.ok ? r.msg : r.error, !r.ok);
        if (r.ok) $('fr-name').value = '';
      };
      $('fr-room').onclick = () => G.LobbyUI.open();
      G.Social.on(() => { if (G.UI.isOpen('scr-friends')) render(); });
    }

    function msg(t, bad) {
      $('fr-msg').textContent = t || '';
      $('fr-msg').style.color = bad ? '#ffb0b8' : '';
      if (t) G.Audio.sfx(bad ? 'error' : 'confirm');
    }

    const srvMode = () => G.DB.mode === 'server';

    let toolsWired = false;
    function open() {
      if (!toolsWired) {
        toolsWired = true;
        $('fr-search').oninput = render;
        $('fr-blocked-btn').onclick = () => $('fr-blocked').classList.toggle('hidden');
      }
      withNick(() => {
        G.UI.show('scr-friends', true); msg(''); render();
        // Red local: quién está en línea (sale gratis); en la nube, la lista de amigos al abrir.
        if (srvMode()) G.Social.refreshPresence();
        else G.Social.ensureFriends().then(() => { if (G.UI.isOpen('scr-friends')) render(); });
      });
    }

    /** "hace 5 min", "hace 2 h", "hace 3 días". */
    function ago(t) {
      const m = Math.max(1, Math.round((G.Social.now() - t) / 60000));
      if (m < 60) return 'hace ' + m + ' min';
      const h = Math.round(m / 60);
      if (h < 48) return 'hace ' + h + ' h';
      return 'hace ' + Math.round(h / 24) + ' días';
    }

    // (En la nube, sin "en línea" desde el 20-10-2026: costaba 1/4 de las escrituras de
    // Firestore. En la red local sí: es nuestro servidor.)
    function stateText(f) {
      if (f.status === 'in') return 'Quiere ser tu amigo';
      if (f.status === 'out') return 'Solicitud enviada';
      if (!srvMode()) return '';
      if (!f.online) return f.seen ? 'Visto ' + ago(f.seen) : 'Desconectado';
      return f.play ? 'Jugando' : 'En línea';
    }

    function render() {
      const room = G.Social.room;
      // Red local: todos los jugadores del servidor son ya tus amigos (no hay que añadir a nadie).
      const srv = srvMode();
      $('fr-add').classList.toggle('hidden', srv);
      $('fr-tools').classList.toggle('hidden', !srv);
      if (!srv) $('fr-blocked').classList.add('hidden');
      // La frase se traduce entera antes de meter el nombre (si no, el traductor sólo ve trozos).
      const meName = '<b class="gold" translate="no">' + esc(G.Social.me ? G.Social.me.name : '') + '</b>';
      $('fr-me').innerHTML = srv
        ? G.I18n.f('Jugadores de esta red (todos sois amigos ya). Tú eres {x}.', meName)
        : 'Tu apodo: ' + meName + ' · dáselo a tus amigos para que te añadan.';
      $('fr-room').classList.toggle('hidden', !room);
      const q = srv ? $('fr-search').value.trim().toLowerCase() : '';
      const list = G.Social.friends.filter(f => !q || f.name.toLowerCase().includes(q)).sort((a, b) => {
        const rank = f => f.status === 'in' ? 0 : f.status === 'ok' ? (f.online ? (f.play ? 2 : 1) : 3) : 4;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
      const box = $('fr-list');
      box.innerHTML = '';
      box.classList.toggle('fr-grid', srv);
      if (srv) {
        const on = list.filter(f => f.online).length;
        $('fr-me').innerHTML += ' <span class="st">· ' + G.I18n.f('En línea: {x} de {x}', on, list.length) + '</span>';
      }
      if (srv) renderBlocked();
      if (!list.length) {
        box.innerHTML = srv ? (q ? '<p class="sub">Ningún jugador se llama así.</p>' : '<p class="sub">Todavía no hay más jugadores en este servidor.</p>')
          : '<p class="sub">Aún no tienes amigos añadidos. Escribe arriba el apodo de un amigo.</p>';
        return;
      }
      for (const f of list) {
        const el = document.createElement('div');
        const dot = f.status !== 'ok' ? 'pend' : !srv ? 'on' : !f.online ? 'off' : f.play ? 'play' : 'on';
        const inRoom = room && room.members.some(m => m.uid === f.uid);
        if (srv) {
          // Tarjeta con su compañero Pokémon (red local).
          el.className = 'fr-card' + (f.online ? ' on' : '');
          if (f.dex && G.DEX_BY[f.dex]) el.appendChild(G.UI.spriteCanvas(f.dex, 96, 84, { scale: 2, lively: !!f.online, shiny: !!(f.shiny && G.DEX_BY[f.dex]) }));
          else el.insertAdjacentHTML('beforeend', '<div class="fr-nomon">?</div>');
          el.insertAdjacentHTML('beforeend', `<b translate="no"><a href="#" class="plink" title="Ver su perfil">${esc(f.name)}</a></b>` +
            `<span class="st"><i class="dot ${dot}"></i> ${inRoom ? 'En tu sala' : stateText(f)}</span><div class="fr-acts"></div>`);
        } else {
          el.className = 'fr-row';
          el.innerHTML = `<i class="dot ${dot}"></i><b translate="no"><a href="#" class="plink" title="Ver su perfil">${esc(f.name)}</a></b><span class="st">${inRoom ? 'En tu sala' : stateText(f)}</span><span class="grow"></span>`;
        }
        if (f.status === 'ok') el.querySelector('.plink').onclick = e => { e.preventDefault(); G.ProfileUI.show(f.uid); };
        else el.querySelector('.plink').onclick = e => e.preventDefault();
        const btn = (txt, cls, fn) => {
          const b = document.createElement('button');
          b.className = 'btn small ' + cls; b.textContent = txt; b.onclick = fn; (el.querySelector('.fr-acts') || el).appendChild(b); return b;
        };
        if (f.status === 'in') {
          btn('Aceptar', 'gold', async () => { const r = await G.Social.accept(f.uid); msg(r.ok ? r.msg : r.error, !r.ok); });
          btn('Rechazar', 'ghost', () => G.Social.remove(f.uid));
        } else if (f.status === 'out') {
          btn('Cancelar', 'ghost', () => G.Social.remove(f.uid));
        } else {
          if (!inRoom && (!room || room.isHost)) {
            btn('Invitar', 'gold', async () => {
              const r = await G.Social.invite(f.uid);
              msg(r.ok ? r.msg : r.error, !r.ok);
              if (r.ok) G.LobbyUI.open();
            });
          }
          if (!srv) btn('Quitar', 'ghost', () => { if (confirm('¿Quitar a ' + f.name + ' de tus amigos?')) G.Social.remove(f.uid); });
          else btn('Bloquear', 'ghost', async () => { if (confirm(G.I18n.f('¿Bloquear a {x}? No te podrá invitar ni entrar en tus salas.', f.name))) { const r = await G.Social.block(f.uid, true); if (!r.ok) msg(r.error, true); } });
        }
        box.appendChild(el);
      }
    }

    /** Lista negra (red local): quién está bloqueado, con botón para desbloquear. */
    function renderBlocked() {
      const list = G.Social.blocked, box = $('fr-blocked-list');
      $('fr-blocked-btn').textContent = G.I18n.f('Lista negra ({x})', list.length);
      box.innerHTML = list.length ? '' : '<p class="sub">No has bloqueado a nadie.</p>';
      for (const f of list) {
        const el = document.createElement('div');
        el.className = 'fr-row';
        el.innerHTML = `<i class="dot off"></i><b translate="no">${esc(f.name)}</b><span class="grow"></span>`;
        const b = document.createElement('button');
        b.className = 'btn small'; b.textContent = 'Desbloquear';
        b.onclick = async () => { const r = await G.Social.block(f.uid, false); if (!r.ok) msg(r.error, true); };
        el.appendChild(b);
        box.appendChild(el);
      }
    }

    return { init, open, render };
  })();

  // ======================= SALA =======================

  /** Aforo de la sala (en la red local lo elige el anfitrión). */
  const roomMax = room => (room && room.max) || G.Social.MAX_PLAYERS;
  const isVs = room => !!(room && room.mode === 'vs');
  /** Enfrentamiento: miembros ordenados por equipo (y cuántos hay en cada uno). */
  function teamSplit(room) {
    const n = room.teams || 2, by = [];
    for (let t = 1; t <= n; t++) by.push(room.members.filter(m => (m.team || 1) === t));
    return by;
  }
  /** ¿Se puede empezar un enfrentamiento? Al menos 2 equipos con alguien. */
  function vsReady(room) { return teamSplit(room).filter(l => l.length).length >= 2; }

  G.LobbyUI = (() => {
    let membersKey = '', promptedRejoin = '';

    function init() {
      $('lobby-leave').onclick = async () => {
        await G.Social.leaveRoom();
        G.Net.close();
        G.MenuUI.open();
      };
      $('lobby-menu').onclick = () => G.MenuUI.open();
      $('lobby-start').onclick = start;
      $('lobby-start').dataset.sfx = 'confirm';
      // Red local: volver a la partida en marcha tras recargar la página (ver coop.js, rejoin).
      $('lobby-rejoin').onclick = () => {
        if (!G.Coop.rejoin()) { G.UI.toast('Conectando con el anfitrión… prueba otra vez en unos segundos.', 3000); return; }
        $('lobby-rejoin').disabled = true;
        $('lobby-note').textContent = 'Volviendo a la partida…';
        setTimeout(() => { $('lobby-rejoin').disabled = false; }, 6000);
      };
      // Conecta / desconecta la red al entrar o salir de una sala.
      G.Social.on(what => {
        const room = G.Social.room;
        if (room) {
          G.Net.open(room.id, room.isHost, room.host);
          G.Net.syncMembers(room.members.map(m => m.uid));
        } else if (G.Net.open_ && !(G.Coop.active && G.DB.mode === 'server')) G.Net.close();   // (red local: en plena partida, la conexión sigue aunque el servidor cierre la sala; ver coop.js)
        if (what === 'room-closed') {
          G.UI.toast('La sala se ha cerrado', 2600);
          if (G.UI.isOpen('scr-lobby')) G.MenuUI.open();
        }
        // Tras recargar la página en plena partida: se avisa una vez y se abre la sala para volver.
        if (what === 'room' && room && G.Social.rejoinable && promptedRejoin !== room.id && G.Game.state === 'ui') {
          promptedRejoin = room.id;
          G.UI.toast('Tu partida sigue en marcha: puedes volver a ella.', 4000);
          if (G.UI.isOpen('scr-menu')) open();
        }
        if (G.UI.isOpen('scr-lobby')) render();
      });
      G.Net.onPeer(() => { if (G.UI.isOpen('scr-lobby')) render(); });
    }

    function open() {
      if (!G.Social.room) { G.MenuUI.open(); return; }
      G.Social.refreshMember();
      G.Social.ensureFriends().then(() => { if (G.UI.isOpen('scr-lobby')) { membersKey = ''; render(); } });
      G.UI.show('scr-lobby', true);
      membersKey = '';
      render();
    }

    function close() { G.UI.hide('scr-lobby'); }

    function connText(m, room) {
      if (m.uid === room.host) return 'Anfitrión';
      if (!room.isHost) return m.uid === G.Social.uid ? 'Tú' : 'En la sala';
      const mode = G.Net.mode(m.uid);
      return mode === 'direct' ? (G.Net.viaTurn(m.uid) ? 'Conectado (por servidor)' : 'Conectado') : mode === 'relay' ? 'Conectado (por servidor)' : mode === 'failed' ? 'No se pudo conectar (reintentando…)' : 'Conectando…';
    }

    function render() {
      const room = G.Social.room;
      if (!room) return;
      const ms = room.members;
      const vs = isVs(room);
      $('lobby-sub').textContent = vs
        ? (room.isHost ? 'Enfrentamiento: elegid equipo y empezad cuando haya al menos dos equipos con alguien.'
                       : 'Enfrentamiento: elige tu equipo. El anfitrión empezará la partida.')
        : room.isHost
        ? 'Eres el anfitrión. Invita a tus amigos (hasta ' + roomMax(room) + ') y empezad cuando estéis.'
        : 'Estás en la sala de ' + ((ms.find(m => m.uid === room.host) || {}).name || '…') + '. El anfitrión empezará la partida.';

      // Las tarjetas sólo se rehacen si cambian los miembros (los sprites no parpadean).
      const key = (vs ? 'vs:' : '') + ms.map(m => m.uid + ':' + m.dex + ':' + (m.shiny ? 1 : 0) + ':' + (m.team || 0)).join('|');
      const box = $('lobby-members');
      if (key !== membersKey) {
        membersKey = key;
        box.innerHTML = '';
        // Enfrentamiento: una fila por equipo (3 huecos cada una), con el color del equipo.
        const slots = vs ? teamSplit(room).flatMap((list, ti) => [0, 1, 2].map(i => ({ m: list[i], team: ti + 1 })))
                         : Array.from({ length: roomMax(room) }, (_, i) => ({ m: ms[i], color: G.Coop.COLORS[i] }));
        box.style.gridTemplateColumns = vs ? 'repeat(3, 1fr)' : '';
        for (const sl of slots) {
          const m = sl.m;
          const c = document.createElement('div');
          c.className = 'lob-card' + (m ? '' : ' empty');
          const col = vs ? G.Coop.TEAM_COLORS[sl.team - 1] : sl.color;
          if (m) {
            c.style.setProperty('--pc', col);
            c.appendChild(G.UI.spriteCanvas(m.dex, 120, 96, { scale: 2, lively: true, shiny: !!m.shiny }));
            c.insertAdjacentHTML('beforeend', `${vs ? '<small style="color:' + col + '">' + G.I18n.f('Equipo {x}', sl.team) + '</small>' : ''}<b translate="no">${esc(m.name)}</b><small>${esc((G.DEX_BY[m.dex] || {}).name || '')}</small><span class="conn" data-u="${m.uid}"></span>`);
          } else c.innerHTML = vs ? '<span style="color:' + col + '">' + G.I18n.f('Equipo {x}', sl.team) + '</span><span>Libre</span>' : '<span>Libre</span>';
          box.appendChild(c);
        }
      }
      // Enfrentamiento: botones para cambiarte de equipo.
      const tb = $('lobby-teams');
      tb.classList.toggle('hidden', !vs);
      if (vs) {
        const mine = (ms.find(m => m.uid === G.Social.uid) || {}).team || 1;
        const by = teamSplit(room);
        tb.innerHTML = '';
        by.forEach((list, ti) => {
          const b = document.createElement('button');
          b.className = 'btn small' + (mine === ti + 1 ? ' gold' : '');
          b.style.borderColor = G.Coop.TEAM_COLORS[ti];
          b.textContent = G.I18n.f('Equipo {x}', ti + 1) + ' (' + list.length + '/3)';
          b.disabled = mine === ti + 1 || list.length >= 3;
          b.onclick = async () => { const r = await G.Social.setTeam(ti + 1); if (!r.ok) G.UI.toast(r.error); };
          tb.appendChild(b);
        });
      }
      box.querySelectorAll('.conn').forEach(el => {
        const m = ms.find(x => x.uid === el.dataset.u);
        if (!m) return;
        const t = connText(m, room);
        el.textContent = t;
        el.className = 'conn' + (t === 'Conectando…' ? ' wait' : '');
      });

      // Invitar (sólo el anfitrión y si queda sitio).
      const canInvite = room.isHost && ms.length < roomMax(room);
      $('lobby-inv-title').classList.toggle('hidden', !canInvite);
      const inv = $('lobby-invite');
      inv.classList.toggle('hidden', !canInvite);
      if (canInvite) {
        inv.innerHTML = '';
        const free = G.Social.friends.filter(f => f.status === 'ok' && !ms.some(m => m.uid === f.uid));
        if (!free.length) inv.innerHTML = '<p class="sub" style="margin:0">Aún no tienes amigos añadidos.</p>';
        for (const f of free) {
          const el = document.createElement('div');
          el.className = 'fr-row';
          el.innerHTML = `<i class="dot on"></i><b translate="no">${esc(f.name)}</b><span class="grow"></span>`;
          const b = document.createElement('button');
          b.className = 'btn small gold'; b.textContent = 'Invitar';
          b.onclick = async () => { const r = await G.Social.invite(f.uid); G.UI.toast(r.ok ? r.msg : r.error); };
          el.appendChild(b);
          inv.appendChild(el);
        }
      }

      const btn = $('lobby-start');
      btn.classList.toggle('hidden', !room.isHost);
      const connecting = ms.some(m => m.uid !== room.host && G.Net.mode(m.uid) === 'connecting');
      const failed = ms.some(m => m.uid !== room.host && G.Net.mode(m.uid) === 'failed');
      btn.disabled = !room.isHost || ms.length < 2 || connecting || failed || (vs && !vsReady(room));
      btn.textContent = 'Empezar partida (' + ms.length + '/' + roomMax(room) + ')';
      $('lobby-note').textContent = !room.isHost ? 'Cuando el anfitrión empiece, entraréis todos a la vez.'
        : ms.length < 2 ? 'Necesitas al menos un amigo en la sala.'
        : vs && !vsReady(room) ? 'Hacen falta al menos dos equipos con algún jugador.'
        : failed ? 'No se puede conectar con algún amigo: su red (o la tuya) no deja jugar en grupo. Probad con otra wifi o datos móviles; se reintenta solo.'
        : connecting ? 'Conectando con tus amigos…' : 'La partida empieza para todos a la vez.';
      // Partida en marcha a la que puedes volver (recargaste la página): sólo ese botón.
      const rej = G.Social.rejoinable;
      $('lobby-rejoin').classList.toggle('hidden', !rej);
      if (rej) {
        btn.classList.add('hidden');
        $('lobby-inv-title').classList.add('hidden'); inv.classList.add('hidden');
        if (!$('lobby-rejoin').disabled) $('lobby-note').textContent = 'La partida sigue en marcha: puedes volver a ella con tu Pokémon tal como lo tenías.';
      }
    }

    function start() {
      const room = G.Social.room;
      if (!room || !room.isHost || room.members.length < 2) return;
      if (isVs(room) && !vsReady(room)) return;
      const cfg = {
        k: 'start', seed: Math.floor(Math.random() * 1e6), host: room.host,
        mode: isVs(room) ? 'vs' : 'coop', teams: isVs(room) ? room.teams : 0,
        members: room.members.map(m => ({ uid: m.uid, name: m.name, dex: m.dex, shiny: !!m.shiny, team: isVs(room) ? (m.team || 1) : 0 }))
      };
      G.Social.setOpen(false);
      G.Net.broadcast(cfg);
      G.Flow.startCoop(cfg);
    }

    return { init, open, close, render };
  })();

  // ======================= INVITACIONES =======================

  G.InvitePop = (() => {
    let cur = null;

    function init() {
      $('inv-yes').onclick = async () => {
        if (!cur) return;
        const from = cur.from;
        hide();
        const r = await G.Social.acceptInvite(from);
        if (!r.ok) { G.UI.toast(r.error, 3000); return; }
        G.LobbyUI.open();
      };
      $('inv-no').onclick = () => { if (cur) G.Social.declineInvite(cur.from); hide(); };
      G.Social.on(what => { if (what === 'invites' || what === 'room') refresh(); });
    }

    function hide() { cur = null; $('invite-pop').classList.add('hidden'); }

    /** Enseña la invitación más antigua si estás en los menús (no en plena partida). */
    function refresh() {
      const room = G.Social.room;
      const list = G.Social.invites.filter(i => !room || i.room !== room.id).sort((a, b) => a.at - b.at);
      if (!list.length || G.Game.state !== 'ui' || !G.DB.loggedIn) { hide(); return; }
      if (cur && cur.from === list[0].from) return;
      cur = list[0];
      $('inv-text').innerHTML = `${G.Icons.html('friends', 22)} <b class="gold" translate="no">${esc(cur.name)}</b> te invita a jugar en su sala`;
      $('invite-pop').classList.remove('hidden');
      G.Audio.sfx('shiny');
    }

    return { init, refresh };
  })();

  G.SocialUI = {
    init() { G.NickUI.init(); G.FriendsUI.init(); G.LobbyUI.init(); G.InvitePop.init(); },
    withNick, needOnline
  };
})();
