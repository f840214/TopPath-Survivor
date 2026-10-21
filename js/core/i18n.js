/* ============ i18n.js — idiomas (español / inglés / chino tradicional) ============
 * El juego está escrito en español. Si el idioma es inglés, todo texto que
 * se enseña se traduce con el diccionario de js/data/lang-en.js, sin tener que
 * tocar cada pantalla:
 *   - el DOM (menús, cartas, avisos...) con un MutationObserver,
 *   - el canvas (HUD, avisos, números) envolviendo fillText/strokeText,
 *   - confirm()/alert().
 *
 * El diccionario usa el texto español como clave. Tres niveles:
 *   1. frase exacta                    'Volver' -> 'Back'
 *   2. patrón con huecos {x}           '¡Has conseguido a {x} shiny!' -> 'You got a shiny {x}!'
 *                                      (lo que cae en el hueco también se traduce)
 *   3. trozos dentro de un texto más largo, sólo palabras enteras
 * Lo que escriben los jugadores (apodos) va marcado con translate="no".
 *
 * Idioma: el elegido en Ajustes; si no, /en/ en la dirección o el del navegador
 * (español si el navegador está en español, inglés en cualquier otro caso).
 */
G.I18n = (() => {
  const KEY = 'ps.lang';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* nada */ }
  const byPath = /\/en(\/|$)/.test(location.pathname) ? 'en' : null;
  const nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'es').toLowerCase();
  // 'zh' = chino tradicional (js/data/lang-zh.js, del parche de la comunidad).
  const lang = saved === 'es' || saved === 'en' || saved === 'zh' ? saved : byPath || (nav.startsWith('es') ? 'es' : nav.startsWith('zh') ? 'zh' : 'en');
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang;

  const exact = new Map(), exactLow = new Map();
  let patterns = [], frag = null, fragLow = null, fragMap = new Map();
  const cache = new Map();
  const L = '\\p{L}\\p{N}';
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Añade traducciones { 'texto en español': 'texto traducido' } del idioma `forLang` (sólo se cargan las del idioma activo). */
  function add(dict, forLang = 'en') {
    if (forLang !== lang) return;
    const fr = [];
    for (const [es, en] of Object.entries(dict)) {
      if (!en || es === en) continue;
      if (es.includes('{x}')) {
        const parts = es.split('{x}').map(reEsc);
        patterns.push({ re: new RegExp('^' + parts.join('(.+?)') + '$', 'u'), reI: new RegExp('^' + parts.join('(.+?)') + '$', 'iu'), en });
      } else {
        exact.set(es, en);
        exactLow.set(es.toLowerCase(), en);
        if (es.length >= 4 || /\s/.test(es)) { fr.push(es); fragMap.set(es.toLowerCase(), en); }
      }
    }
    // Una sola expresión con todos los trozos (los más largos primero), sólo palabras enteras.
    const all = [...fragMap.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|');
    frag = all ? new RegExp(`(?<![${L}])(${all})(?![${L}])`, 'giu') : null;
    cache.clear();
  }

  function keepCase(src, en) {
    if (src === src.toUpperCase() && /\p{L}/u.test(src)) return en.toUpperCase();
    return en;
  }

  /** Traduce un texto (sin espacios de los lados) al idioma actual. */
  function t(s) {
    if (lang === 'es' || !s || typeof s !== 'string') return s;
    if (!/\p{L}/u.test(s)) return s;
    const c = cache.get(s);
    if (c !== undefined) return c;
    let r = core(s);
    if (cache.size > 4000) cache.clear();
    cache.set(s, r);
    return r;
  }

  function core(s) {
    // Respeta los espacios de alrededor (nodos de texto del DOM).
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    // Los textos del HTML pueden ocupar varias líneas: se comparan con los espacios juntos.
    const lead = m[1], tail = m[3], body = m[2].replace(/\s+/g, ' ');
    if (!body) return s;
    const upper = body === body.toUpperCase() && /\p{L}/u.test(body);
    let r = exact.get(body);
    if (r === undefined && upper) { const e = exactLow.get(body.toLowerCase()); if (e !== undefined) r = keepCase(body, e); }
    if (r === undefined) {
      for (const p of patterns) {
        const mm = (upper ? p.reI : p.re).exec(body);
        if (!mm) continue;
        let i = 1;
        r = p.en.replace(/\{x\}/g, () => { const g = mm[i++]; return g === undefined ? '' : core(g); });
        r = keepCase(body, r);
        break;
      }
    }
    if (r === undefined && frag) {
      r = body.replace(frag, w => keepCase(w, fragMap.get(w.toLowerCase()) || w));
    }
    return lead + (r === undefined ? body : r) + tail;
  }

  /** Texto con huecos para el código: T('Nivel {x}', 5). */
  function f(es, ...vals) { let i = 0; return t(es).replace(/\{x\}/g, () => vals[i++]); }

  // ---------------- chino: casos que dependen de dónde sale el texto ----------------
  const ZH = lang === 'zh';
  const ZH_MOVE_CTX = '.card .nm, #scr-bond .ds, #bond-sub, .move-icons, #starter-info, #dex-detail p, #over-stats b, .bind-slots option, .ban-moves button';
  const ZH_TYPE_CTX = '.type-chip, .type, .tag-chip';
  const ZH_TYPES = new Set(['一般', '火', '水', '電', '草', '冰', '格鬥', '毒', '地面', '飛行', '超能力', '蟲', '岩石', '幽靈', '龍', '惡', '鋼', '妖精']);
  const zhMove = s => s.replace(/(?<![\p{L}\p{N}])Psíquico(?![\p{L}\p{N}])/gu, '精神強念');
  /** Traduce un texto según el elemento en que está (sólo cambia algo en chino). */
  function tIn(s, el) {
    if (!ZH || !el || !el.closest) return t(s);
    const r = t(el.closest(ZH_TYPE_CTX) ? s : el.closest(ZH_MOVE_CTX) ? zhMove(s) : s);
    const body = r.trim();
    return el.closest(ZH_TYPE_CTX) && ZH_TYPES.has(body) ? r.replace(body, body + '系') : r;
  }

  // ---------------- DOM ----------------
  const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
  // En chino sí se traducen las novedades (van en español e inglés con translate="no"; el diccionario las tiene).
  const skipEl = el => {
    if (!el || !el.closest) return false;
    const p = el.closest('[translate="no"], script, style, code');
    return !!p && !(ZH && p.classList && p.classList.contains('news-day'));
  };

  function doText(n) {
    const p = n.parentElement;
    if (!p || skipEl(p)) return;
    const v = n.nodeValue;
    if (n.__tr === v) return;
    const r = tIn(v, p);
    n.__tr = r;
    if (r !== v) n.nodeValue = r;
  }
  function doEl(el) {
    if (skipEl(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const r = tIn(v, el); if (r !== v) el.setAttribute(a, r); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1 || skipEl(root)) return;
    doEl(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }

  function startDom() {
    if (lang === 'es') return;
    // Los enlaces a las páginas de la web, a su versión en inglés.
    const EN_LINKS = lang === 'en' ? { 'guia/': 'en/guide/', 'pokedex/': 'en/pokedex/' } : {};
    document.querySelectorAll('a[href]').forEach(a => { const h = a.getAttribute('href'); if (EN_LINKS[h]) a.setAttribute('href', EN_LINKS[h]); });
    walk(document.body);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doEl(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    document.title = t(document.title);
  }

  // ---------------- canvas y ventanas del navegador ----------------
  if (lang !== 'es') {
    const P = CanvasRenderingContext2D.prototype;
    // La fuente pixel no tiene caracteres chinos: en chino se dibuja con la del sistema.
    const ZH_FONT = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif';
    for (const k of ['fillText', 'strokeText', 'measureText']) {
      const orig = P[k];
      P[k] = ZH
        ? function (s, ...a) {
            const font = this.font;
            if (font.includes('Pixelify')) this.font = font.replace(/Pixelify/g, ZH_FONT);
            try { return orig.call(this, typeof s === 'string' ? t(/^Psíquico( \+\d+)?$/.test(s.trim()) ? zhMove(s) : s) : s, ...a); }
            finally { this.font = font; }
          }
        : function (s, ...a) { return orig.call(this, typeof s === 'string' ? t(s) : s, ...a); };
    }
    const oc = window.confirm, oa = window.alert;
    window.confirm = s => oc.call(window, t(s));
    window.alert = s => oa.call(window, t(s));
  }

  function set(l) {
    try { localStorage.setItem(KEY, l); } catch (e) { /* nada */ }
    location.reload();
  }

  return { lang, add, t, f, set, startDom, walk };
})();
G.T = G.I18n.t;
