/* ============ input.js — teclado y ratón (el táctil está en touch.js y el mando en gamepad.js) ============ */
G.Input = (() => {
  const down = new Set();
  const pressed = new Set();   // se limpia cada frame
  let mx = 0, my = 0, mdown = false;

  const MOVE_KEYS = {
    up: ['keyw', 'arrowup'], down: ['keys', 'arrowdown'],
    left: ['keya', 'arrowleft'], right: ['keyd', 'arrowright']
  };

  function code(e) { return (e.code || e.key).toLowerCase(); }

  // Sólo cuenta lo que viene del teclado y el ratón de verdad: las pulsaciones
  // que se inventa un script de la página (dispatchEvent) llegan con
  // isTrusted = false y no mueven ni atacan (antitrampas, 21-10-2026).
  addEventListener('keydown', e => {
    if (!e.isTrusted) return;
    const c = code(e);
    if (!down.has(c)) pressed.add(c);
    down.add(c);
    // Evita que el navegador haga scroll con flechas/espacio durante el juego.
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', 'tab'].includes(c)) e.preventDefault();
  });
  addEventListener('keyup', e => { if (e.isTrusted) down.delete(code(e)); });
  addEventListener('blur', () => { down.clear(); });
  let movedAt = 0;               // última vez que se movió el ratón (apuntado a mano)
  addEventListener('mousemove', e => { if (!e.isTrusted) return; mx = e.clientX; my = e.clientY; movedAt = performance.now(); });
  addEventListener('mousedown', e => { if (e.isTrusted) mdown = true; });
  addEventListener('mouseup', e => { if (e.isTrusted) mdown = false; });

  return {
    /** Vector de movimiento del jugador (teclado, joystick táctil o mando). */
    axis() {
      const t = G.Touch && G.Touch.vector();
      if (t && (t[0] || t[1])) return t;
      const g = G.Pad && G.Pad.vector();
      if (g && (g[0] || g[1])) return g;
      let x = 0, y = 0;
      if (MOVE_KEYS.left.some(k => down.has(k))) x -= 1;
      if (MOVE_KEYS.right.some(k => down.has(k))) x += 1;
      if (MOVE_KEYS.up.some(k => down.has(k))) y -= 1;
      if (MOVE_KEYS.down.some(k => down.has(k))) y += 1;
      return G.U.norm(x, y);
    },
    held(c) { return down.has(c); },
    /** true sólo en el frame en que se pulsó. */
    tap(c) { return pressed.has(c); },
    /** Una pulsación que no viene del teclado (el mando): cuenta como tecla en este fotograma. */
    virtual(c) { pressed.add(c); },
    mouse() { return { x: mx, y: my, down: mdown }; },
    /** Cuándo se movió el ratón por última vez (performance.now). */
    get mouseMovedAt() { return movedAt; },
    /** Dónde apunta el ratón en el mundo (el lienzo ocupa toda la ventana). */
    mouseWorld() { return { x: G.Camera.left() + mx / G.Camera.scale, y: G.Camera.top() + my / G.Camera.scale }; },
    endFrame() { pressed.clear(); }
  };
})();
