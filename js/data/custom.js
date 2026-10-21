/* ============ custom.js — personajes propios (fuera de la Pokédex) ============
 * Personajes dibujados para este juego (PixelLab, exportados en formato PMD:
 * columnas = fotogramas, filas = 8 direcciones, igual que SpriteCollab).
 *
 * Se añaden a G.DEX y G.SPRITE_META al cargar, DESPUÉS de pokedex.js y
 * sprites-meta.js; esos dos ficheros son generados y no se tocan, así los
 * personajes sobreviven a tools/fetch_pokedex.py y tools/fetch_sprites.py.
 *
 * Campos propios:
 *   custom  true   no sale como salvaje ni como jefe (sólo en el gacha y como compañero)
 *   moves          repertorio fijo (en vez del pool de sus tipos + normal)
 *   start          movimiento inicial
 *   pa/sa df/sd    Ataque / At. Esp. (atk = el mayor) y Defensa / Def. Esp., como en pokedex.js
 *   sprite         geometría como en sprites-meta.js; k = escala del sprite
 *                  (0.5 para arte a 64 px: el de PMD mide ~32)
 * Las hojas van en assets/pokemon/{dex}/ (Idle y Walk como mínimo; las
 * animaciones que falten usan Idle).
 */
// Banner "Dado Arcoíris" (gen 10): seis magos épicos dibujados a partir de bocetos propios.
G.CUSTOM_MONS = [
  {
    dex: 2001, name: 'Belle', types: ['ghost', 'psychic'],
    hp: 95, spd: 140, atk: 1.46, pa: 1.28, sa: 1.46, df: 70, sd: 90, rarity: 5, bst: 620, starter: false, gen: 1, custom: true,
    start: 'shadow-ball',
    moves: ['shadow-ball', 'confusion', 'psybeam', 'psychic', 'psycho-cut', 'hex', 'lick', 'substitute', 'swords-dance', 'harden'],
    sprite: { s: 2, k: 0.5, v: 1, a: {
      Idle: { w: 48, h: 64, n: 4, r: 8, d: [12, 12, 12, 12], ax: 23.5, ay: 61.5 },
      Walk: { w: 48, h: 64, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 23.5, ay: 61.5 },
      // Attack y Shoot: PixelLab (v3, 8 fotogramas); el lienzo creció a 88 px, el ancla sigue en los pies.
      Attack: { w: 88, h: 88, n: 8, r: 8, d: [3, 2, 2, 2, 2, 2, 2, 3], ax: 43.5, ay: 72.5 },
      Shoot: { w: 88, h: 88, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 3], ax: 43.5, ay: 72.5 }
    } }
  },
  { dex: 2002, name: 'Glacius', types: ['ice', 'psychic'], hp: 130, spd: 95, atk: 1.15, pa: 1.01, sa: 1.15, df: 80, sd: 95, rarity: 4, bst: 540, starter: false, gen: 10, custom: true,
    start: 'powder-snow', moves: ['powder-snow', 'ice-beam', 'hail', 'confusion', 'psybeam', 'psychic', 'agility', 'harden'], sprite: { s: 2, k: 0.5, v: 2, a: {
      Idle: { w: 100, h: 100, n: 4, r: 8, d: [12, 12, 12, 12], ax: 49.5, ay: 84.5 },
      Walk: { w: 100, h: 100, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 49.5, ay: 84.5 },
      Attack: { w: 100, h: 100, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 49.5, ay: 84.5 }
    } } },
  { dex: 2003, name: 'Floria', types: ['grass', 'fairy'], hp: 150, spd: 90, atk: 1.05, pa: 0.92, sa: 1.05, df: 85, sd: 100, rarity: 4, bst: 535, starter: false, gen: 10, custom: true,
    start: 'razor-leaf', moves: ['razor-leaf', 'vine-whip', 'leaf-storm', 'giga-drain', 'fairy-wind', 'dazzling-gleam', 'aqua-ring', 'swords-dance'], sprite: { s: 2, k: 0.5, v: 2, a: {
      Idle: { w: 100, h: 100, n: 4, r: 8, d: [12, 12, 12, 12], ax: 49.5, ay: 84.0 },
      Walk: { w: 100, h: 100, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 49.5, ay: 84.5 },
      Attack: { w: 100, h: 100, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 49.5, ay: 84.5 }
    } } },
  { dex: 2004, name: 'Amora', types: ['fairy', 'psychic'], hp: 120, spd: 115, atk: 1.1, pa: 0.97, sa: 1.1, df: 75, sd: 95, rarity: 4, bst: 530, starter: false, gen: 10, custom: true,
    start: 'fairy-wind', moves: ['fairy-wind', 'dazzling-gleam', 'confusion', 'psycho-cut', 'psychic', 'aqua-ring', 'agility', 'substitute'], sprite: { s: 2, k: 0.5, v: 2, a: {
      Idle: { w: 96, h: 96, n: 4, r: 8, d: [12, 12, 12, 12], ax: 47.5, ay: 80.5 },
      Walk: { w: 96, h: 96, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 47.5, ay: 80.5 },
      Attack: { w: 96, h: 96, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 47.5, ay: 80.5 }
    } } },
  { dex: 2005, name: 'Ignis', types: ['fire', 'fighting'], hp: 110, spd: 120, atk: 1.35, pa: 1.19, sa: 1.35, df: 70, sd: 70, rarity: 4, bst: 555, starter: false, gen: 10, custom: true,
    start: 'ember', moves: ['ember', 'flamethrower', 'fire-spin', 'heat-wave', 'will-o-wisp', 'flame-wheel', 'karate-chop', 'swords-dance'], sprite: { s: 2, k: 0.5, v: 2, a: {
      Idle: { w: 100, h: 100, n: 4, r: 8, d: [12, 12, 12, 12], ax: 49.5, ay: 84.5 },
      Walk: { w: 100, h: 100, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 49.5, ay: 84.5 },
      Attack: { w: 100, h: 100, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 49.5, ay: 84.5 }
    } } },
  { dex: 2006, name: 'Dulcín', types: ['fairy', 'normal'], hp: 125, spd: 125, atk: 1.0, pa: 1.0, sa: 0.95, df: 80, sd: 80, rarity: 4, bst: 520, starter: false, gen: 10, custom: true,
    start: 'quick-attack', moves: ['quick-attack', 'fairy-wind', 'dazzling-gleam', 'hyper-voice', 'body-slam', 'bubble-beam', 'agility', 'substitute'], sprite: { s: 2, k: 0.5, v: 2, a: {
      Idle: { w: 104, h: 104, n: 4, r: 8, d: [12, 12, 12, 12], ax: 51.5, ay: 87.0 },
      Walk: { w: 104, h: 104, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 51.5, ay: 86.5 },
      Attack: { w: 104, h: 104, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 51.5, ay: 87.5 }
    } } },
  { dex: 2007, name: 'Voltio', types: ['electric', 'flying'], hp: 100, spd: 135, atk: 1.3, pa: 1.14, sa: 1.3, df: 65, sd: 75, rarity: 4, bst: 550, starter: false, gen: 10, custom: true,
    start: 'thunder-shock', moves: ['thunder-shock', 'discharge', 'thunderbolt', 'gust', 'wing-attack', 'aerial-ace', 'agility', 'harden'], sprite: { s: 2, k: 0.5, v: 3, a: {
      Idle: { w: 100, h: 100, n: 4, r: 8, d: [12, 12, 12, 12], ax: 49.5, ay: 83.5 },
      Walk: { w: 100, h: 100, n: 8, r: 8, d: [5, 5, 5, 5, 5, 5, 5, 5], ax: 49.5, ay: 83.5 },
      Attack: { w: 100, h: 100, n: 8, r: 8, d: [2, 2, 2, 2, 2, 2, 2, 2], ax: 49.5, ay: 83.5 }
    } } }
];

for (const c of G.CUSTOM_MONS) {
  const p = Object.assign({}, c);
  delete p.sprite;
  // (Sin ellos la ficha de la colección fallaba y se quedaba con el Pokémon de antes.)
  if (p.pa == null) p.pa = p.atk;
  if (p.sa == null) p.sa = p.atk;
  if (p.df == null) p.df = 75;
  if (p.sd == null) p.sd = 75;
  if (!G.DEX_BY[p.dex]) G.DEX.push(p);
  G.DEX_BY[p.dex] = p;
  G.SPRITE_META[p.dex] = c.sprite;
}
