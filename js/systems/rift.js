/* ============ rift.js — grietas y arena del legendario ============
 *
 * De vez en cuando (pocas veces por partida) se abre una GRIETA cerca de un
 * jugador. Dura GRIETA_TTL segundos; si entras, te lleva (con todo el grupo)
 * a una arena cerrada en el Mundo Distorsión, contra un Pokémon LEGENDARIO.
 *
 *   ganas    el legendario suelta tickets (el ×10, la mitad de las veces) y monedas, y cada uno se lleva un
 *            VÍNCULO (fusiona movimientos, ver Player.fuse); a los pocos
 *            segundos volvéis al mapa donde estabais y se elige la fusión
 *   pierdes  (caéis todos o se acaba el tiempo) volvéis sin premio, con algo
 *            de vida; la partida sigue
 *
 * Mientras dura la arena, los enemigos del mapa se guardan (EnemyMgr.stash) y
 * no aparecen nuevos; al volver todo sigue como estaba.
 *
 * Cooperativo: lo decide el anfitrión. Mensajes (ver coop.js):
 *   'rift' x y ttl · 'riftx' · 'arena' cfg · 'aw' (ganada) · 'al' (perdida)
 *   y del invitado al anfitrión 're' (he entrado en la grieta).
 */
G.Rift = (() => {
  // (0.14 hasta el 11-10-2026: más grietas para que se vean los vínculos)
  // Menos azar (12-10-2026): cada vez que no sale, la siguiente es más
  // probable (20 %, 40 %, 60 %, 80 %, 100 %): como mucho 2,5 min sin grieta.
  // Desde 2 min antes de la Sentencia de Arceus (minuto 30) ya no se abren.
  const CHECK = 30, CHANCE = 0.2, TTL = 45;
  const ARENA_R = 11, ARENA_TIME = 120, FROM = 75;
  let rift = null;          // { x, y, ttl, t, team } (team: enfrentamiento, equipo que la ha cogido)
  let arena = null;         // { tx, ty, r, dex, shiny, x, y, back, biome, t, phase, endT, bossId, team, mine }
  let checkT = CHECK, asked = false, downT = 0, misses = 0, claimMsgT = 0;
  const authority = () => !G.Coop.active || G.Coop.isHost;
  const TS = () => G.Tiles.T * G.Sprites.PX;
  // Enfrentamiento: la grieta es de UN equipo (el primero que la toca). Sólo
  // ese equipo viaja a la arena; los demás siguen en el mapa y el anfitrión
  // lleva las dos cosas a la vez (la arena está en otra zona del mismo mundo).
  const vs = () => G.Coop.vs;
  /** Jugadores que van a la arena (en enfrentamiento, sólo los del equipo). */
  const arenaPlayers = team => (vs() ? G.Coop.players().filter(p => p.team === team) : G.Game.everyone());
  /** ¿Está `o` dentro de la zona de la arena? (para no hacer salir enemigos allí) */
  function inside(o) { return !!arena && G.U.dist2(o.x, o.y, arena.x, arena.y) < (arena.r * TS() * 2) ** 2; }

  function reset() { rift = null; arena = null; checkT = CHECK; asked = false; downT = 0; misses = 0; }

  // ---------------- grieta en el mapa ----------------

  function update(dt, pl, time) {
    if (rift) {
      rift.t += dt;
      rift.ttl -= dt;
      if (rift.ttl <= 0) { rift = null; return; }
      if (claimMsgT > 0) claimMsgT -= dt;
      if (!arena && !pl.dead && G.U.dist2(pl.x, pl.y, rift.x, rift.y - 10) < 30 * 30) {
        if (vs() && rift.team && rift.team !== G.Coop.myTeam) {
          if (claimMsgT <= 0) { claimMsgT = 3; G.Spawner.say('Esta grieta ya la ha cogido el equipo ' + rift.team, 2.4, true); }
        } else enter();
      }
    } else if (!arena && authority() && time > FROM && time < G.Judgment.AT - 120) {
      checkT -= dt;
      if (checkT <= 0) {
        checkT = CHECK;
        if (G.EnemyMgr.bossAlive()) return;           // con un jefe vivo no cuenta como intento
        if (Math.random() < CHANCE * (1 + misses)) { misses = 0; open(); }
        else misses++;
      }
    }
    if (arena) arenaTick(dt, pl);
  }

  function open() {
    const alive = G.Game.everyone().filter(p => !p.dead);
    const near = G.U.pick(alive.length ? alive : [G.Game.player]);
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.2832, d = G.U.rand(380, 560);
      const x = near.x + Math.cos(a) * d, y = near.y + Math.sin(a) * d * 0.85;
      if (!G.World.isFree(x, y, 22)) continue;
      show(x, y, TTL);
      if (G.Coop.isHost) G.Coop.broadcast(['rift', Math.round(x), Math.round(y), TTL]);
      return;
    }
  }

  /** Aparece la grieta (también la que manda el anfitrión). */
  function show(x, y, ttl) {
    rift = { x, y, ttl, t: 0, team: 0 };
    asked = false;
    // (El aviso grande lo dibuja hud.js mientras rift.t < 4,5 s.)
    G.Audio.sfx('rift');
    G.FX.ring(x, y, 6, 80, '#b48aff', 0.7, 5);
  }

  function enter() {
    if (asked) return;
    asked = true;
    if (authority()) start(null, G.Coop.myTeam);
    else G.Coop.toHost(['re']);
  }

  // ---------------- arena ----------------

  /** Quien manda: elige legendario y lugar, y avisa a todos. */
  let nextType = null;          // pruebas/vídeos: tipo de la próxima arena

  /** @param team  enfrentamiento: equipo que entra (el anfitrión lo sabe por quién lo pide) */
  function start(forceType, team = 0) {
    if (arena) return;
    forceType = forceType || nextType; nextType = null;
    let pool = G.DEX.filter(p => p.leg && G.SPRITE_META[p.dex]);
    if (forceType && pool.some(p => p.types.includes(forceType))) pool = pool.filter(p => p.types.includes(forceType));
    // Los legendarios que aún no has vencido salen 4 veces más (menos repetidos).
    const beaten = (G.DB.save && G.DB.save.legends) || {};
    const ws = pool.map(p => (beaten[p.dex] ? 1 : 4));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0), mi = 0;
    while (mi < pool.length - 1 && (r -= ws[mi]) > 0) mi++;
    const mon = pool[mi];
    const cfg = {
      tx: 5000 + Math.floor(Math.random() * 3000), ty: 5000 + Math.floor(Math.random() * 3000), r: ARENA_R,
      dex: mon.dex, shiny: G.Sprites.hasShiny(mon.dex) && Math.random() < 1 / 512,
      // La arena es la de uno de sus tipos, al azar.
      type: forceType || G.U.pick(mon.types),
      team: vs() ? team : 0
    };
    if (G.Coop.isHost) {
      if (vs()) {
        // Sólo viaja el equipo; a los demás se les cierra la grieta.
        G.Coop.emitTeam(['arena', cfg], team);
        for (let t = 1; t <= G.Coop.teamsN; t++) if (t !== team) G.Coop.emitTeam(['riftc', team], t);
      } else G.Coop.broadcast(['arena', cfg]);
    }
    begin(cfg);
    spawnLegend();
  }

  /** En cada ordenador: viaje a la arena. */
  function begin(cfg) {
    const pl = G.Game.player;
    const ts = TS();
    // Enfrentamiento: `mine` = tú vas a la arena. El anfitrión de otro equipo la
    // lleva (legendario, tiempo) sin moverse del mapa.
    const mine = !vs() || cfg.team === G.Coop.myTeam;
    arena = Object.assign({}, cfg, {
      x: cfg.tx * ts + ts / 2, y: cfg.ty * ts + ts / 2,
      back: { x: pl.x, y: pl.y }, biome: G.World.biome, t: 0, phase: 'fight', endT: 0, bossId: 0, mine
    });
    if (mine) rift = null; else if (rift) { rift.team = cfg.team; rift.ttl = Math.min(rift.ttl, 15); }
    asked = false; downT = 0;
    // (Enfrentamiento: el mapa sigue para los otros equipos: no se guardan los enemigos.)
    if (!vs()) { if (authority()) G.EnemyMgr.stash(); else G.EnemyMgr.clearRemote(); }
    G.World.setArena({ tx: cfg.tx, ty: cfg.ty, r: cfg.r, type: cfg.type });
    if (!mine) return;
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Hazards.clear();
    G.World.setBiome(G.Tiles.arenaBiome(cfg.type), true);
    // Cada arena trae su clima (el volcán, sol; el glaciar, nieve...).
    const th = G.Tiles.ARENA_THEMES[cfg.type];
    if (th && th.weather) G.Weather.force(th.weather, ARENA_TIME + 15);
    // Todos al sur de la arena, en fila; el legendario aparece al norte.
    const ps = arenaPlayers(cfg.team);
    ps.forEach((p, i) => { p.x = arena.x + (i - (ps.length - 1) / 2) * 34; p.y = arena.y + ts * 3; });
    G.Camera.x = pl.x; G.Camera.y = pl.y;
    G.Game.flash('#c9a6ff', 0.9);
    G.Audio.sfx('rift');
    G.Spawner.say('Has entrado en la grieta…', 2.4, true);
  }

  function spawnLegend() {
    const mon = G.DEX_BY[arena.dex];
    const t = G.Game.st.time;
    const n = arenaPlayers(arena.team).length || 1;     // (enfrentamiento: sólo el equipo que entra)
    const ts = TS();
    const def = {
      dex: mon.dex, name: mon.name,
      hp: Math.round((3200 + t * 9) * G.Coop.scaleHp(n) * (n > 1 ? 1.4 : 1)),
      spd: Math.round(G.U.clamp(48 + (mon.spd - 78) * 0.6, 48, 105)),
      dmg: Math.round(36 + t / 20), xp: Math.round(500 + t * 1.2),
      behavior: mon.types.some(x => ['psychic', 'electric', 'ghost', 'fairy', 'fire', 'water', 'ice', 'dragon'].includes(x)) ? 'ranged' : 'charger',
      shotDmg: Math.round(18 + t / 40), shotCd: 0.9, range: 300
    };
    const e = new G.Enemy(def, arena.x, arena.y - ts * 3.5, { hp: 1, spd: 1, dmg: 1 }, true);
    e.legend = true;
    // Choca con las paredes y columnas como tú: si volara por encima de las
    // rocas, tus disparos no podrían alcanzarle (bug de Celebi).
    e.flying = false;
    if (arena.shiny) e.makeShiny();
    G.EnemyMgr.add(e);
    arena.bossId = e.id;
    G.Spawner.say('¡' + e.name + (e.shiny ? ' shiny' : '') + ' te esperaba en la grieta!', 3.2);
    G.Camera.kick(1.1);
    G.Audio.sfx('boss');
  }

  /** Nadie sale del círculo de la arena (por si algo empuja demasiado). */
  function keepInside() {
    const ts = TS(), max = (arena.r - 1.4) * ts;
    for (const e of G.EnemyMgr.all()) {
      if (e.remote) continue;
      const dx = e.x - arena.x, dy = e.y - arena.y, d = Math.hypot(dx, dy);
      if (vs() && d > max * 2) continue;              // enfrentamiento: los del mapa no son de la arena
      if (d > max) { e.x = arena.x + dx / d * max; e.y = arena.y + dy / d * max; }
    }
  }

  function arenaTick(dt, pl) {
    arena.t += dt;
    if (arena.phase === 'fight') {
      if (!authority()) return;
      keepInside();
      const boss = G.EnemyMgr.get(arena.bossId);
      const tell = ev => { if (G.Coop.isHost) { if (vs()) G.Coop.emitTeam(ev, arena.team); else G.Coop.broadcast(ev); } };
      if (!boss || boss.dead) { tell(['aw']); won(); return; }
      const ps = arenaPlayers(arena.team);
      const allDown = !ps.length || ps.every(p => p.dead);
      downT = allDown ? downT + dt : 0;
      if (downT > 1.4 || arena.t > ARENA_TIME) { tell(['al']); lost(); }
      return;
    }
    arena.endT -= dt;
    if (arena.endT <= 0) finish();
  }

  function won() {
    if (!arena || arena.phase !== 'fight') return;
    arena.phase = 'won'; arena.endT = 5;
    if (!arena.mine) return;                           // (anfitrión de otro equipo: sólo la lleva)
    G.Progress.event('rift', { type: arena.type });
    G.Pickups.pullAll();
    G.Spawner.say('¡Has vencido a ' + G.DEX_BY[arena.dex].name + '! Recoge el premio…', 3.4, true);
    G.Audio.sfx('legend');
    const pl = G.Game.player;
    if (pl) {
      pl.bonds++;
      G.FX.dmgText(pl.x, pl.y - pl.bodyH - 10, '¡Vínculo!', '#ff8ad8', true);
      G.FX.ring(pl.x, pl.y, 8, 90, '#ff8ad8', 0.7, 5);
    }
  }

  function lost() {
    if (!arena || arena.phase !== 'fight') return;
    arena.phase = 'lost'; arena.endT = 1.2;
    if (!arena.mine) return;
    G.Spawner.say('La grieta os ha expulsado…', 2.6, true);
    G.Audio.sfx('back');
  }

  /** En cada ordenador: vuelta al mapa. */
  function finish() {
    const pl = G.Game.player;
    const a = arena;
    arena = null;
    // Invitado: no se borra nada. El anfitrión avisa de los de la arena que se
    // van y de los del mapa que vuelven; si el invitado terminaba su cuenta
    // atrás un poco más tarde (pasa casi siempre), borraba los que acababan de
    // volver y no se veían hasta que caían (sólo sus ataques).
    if (authority() && !vs()) G.EnemyMgr.restore();
    if (!a.mine) return;                               // (anfitrión de otro equipo: nada que deshacer)
    G.World.setBiome(a.biome, true);
    G.Weather.clear();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.Hazards.clear();
    for (const p of arenaPlayers(a.team)) { p.x = a.back.x; p.y = a.back.y; }
    pl.x = a.back.x; pl.y = a.back.y;
    if (pl.dead) pl.revive(0.3);
    G.Camera.x = pl.x; G.Camera.y = pl.y;
    G.Game.flash('#c9a6ff', 0.8);
    if (pl.bonds > 0) G.Game.offerBond();
  }

  // ---------------- dibujo ----------------

  /** La grieta, para ordenarla por Y con el resto de la escena. */
  function drawable() {
    if (!rift) return null;
    return {
      y: rift.y,
      draw(ctx) {
        const P = G.Sprites.PX;
        const img = G.Tiles.propSprite(0, 'rift', Math.floor(rift.t * 8) % 4);
        const w = img.width * P, h = img.height * P;
        const fadeIn = Math.min(1, rift.t * 2), fadeOut = Math.min(1, rift.ttl / 1.5);
        ctx.save();
        // Enfrentamiento: cogida por otro equipo: apagada y con su color.
        const claimed = rift.team && G.Coop.vs && rift.team !== G.Coop.myTeam;
        if (claimed) ctx.globalAlpha = 0.45;
        ctx.globalAlpha *= 0.25 * fadeIn * fadeOut;
        ctx.fillStyle = claimed ? G.Coop.TEAM_COLORS[rift.team - 1] : '#7b3cff';
        ctx.beginPath(); ctx.ellipse(rift.x, rift.y, 34, 12, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = (claimed ? 0.45 : 1) * fadeIn * fadeOut;
        ctx.drawImage(img, Math.round(rift.x - w / 2), Math.round(rift.y - h + 4), w, h);
        ctx.restore();
        if (Math.random() < 0.3) G.FX.px(rift.x + G.U.rand(-14, 14), rift.y - G.U.rand(10, 80), '#d9c2ff', { vy: -40, life: 0.6 });
      }
    };
  }

  // ---------------- red ----------------

  function onEvent(ev) {
    switch (ev[0]) {
      case 'rift': show(ev[1], ev[2], ev[3]); break;
      case 'riftx': rift = null; break;
      case 'riftc': if (rift) { rift.team = ev[1]; rift.ttl = Math.min(rift.ttl, 15); } break;
      case 'arena': begin(ev[1]); break;
      case 'aw': won(); break;
      case 'al': lost(); break;
    }
  }

  return {
    reset, update, drawable, onEvent, inside,
    /** Anfitrión: un invitado ha tocado la grieta (enfrentamiento: con su equipo). */
    enterRequest(team = 0) { if (!arena && !(vs() && rift && rift.team && rift.team !== team)) start(null, team); },
    get rift() { return rift; }, get arena() { return arena; },
    /** ¿Estás TÚ en la arena? (en enfrentamiento el anfitrión puede llevarla sin estar) */
    get inArena() { return !!arena && arena.mine !== false; },
    get timeLeft() { return arena ? Math.max(0, ARENA_TIME - arena.t) : 0; },
    debugOpen() { open(); },
    /** Para pruebas: arena de un tipo ya. */
    debugArena(type) { start(type); },
    /** Para vídeos: la próxima grieta en la que entres será de este tipo. */
    debugNextType(type) { nextType = type; }
  };
})();
