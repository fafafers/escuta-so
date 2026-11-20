/* Escuta Só! — jogo de discriminação auditiva de pares mínimos (surdo × sonoro).
 * JavaScript puro, sem frameworks e sem build. Todos os dados ficam no aparelho.
 *
 * Organização do arquivo:
 *   1. Núcleo: utilidades, navegação, diálogos, desbloqueio de áudio, telas inicial e da fono
 *   2. Banco de dados, banco de palavras, áudio (tocar, gravar, recortar silêncio)
 *   3. Modos de jogo, recompensas e álbum
 *   4. Área da fono: rodada, crianças, evolução, backup e ajustes
 */
'use strict';

const APP_VERSION = '1.0.0';

/* =========================================================================
 * 1. NÚCLEO
 * ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const rand = n => Math.floor(Math.random() * n);
const other = side => (side === 'a' ? 'b' : 'a');
const pct = (hit, tot) => (tot ? Math.round((100 * hit) / tot) : 0);
const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR');
const fmtShortDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDateTime = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const daysSince = iso => (Date.now() - Date.parse(iso)) / 86400000;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cria um elemento: h('button', { class: 'btn', onclick }, 'texto', filho, [lista]) */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  if (value !== undefined) el.value = value;
  return el;
}
function add(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false || k === '') continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function iconBtn(icon, label, onclick, cls = '') {
  return h('button', { class: 'icon-btn ' + cls, type: 'button', 'aria-label': label, title: label, onclick }, icon);
}

/* ---------- estado e ajustes ---------- */
const DEFAULT_SETTINGS = {
  pauseMs: 1000,          // pausa entre as duas palavras (modo Igual ou diferente)
  volume: 0.9,
  trials: 10,             // tentativas por rodada (8 a 10)
  modes: { same: true, which: true, drag: true },
};
const State = {
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  child: null,            // criança jogando agora
};
const GUEST = { id: 'guest', nick: 'Visitante', avatar: '🙂' };
const MODES = {};          // preenchido na parte 3

/* ---------- navegação entre telas ---------- */
const Screens = {};
const InitHooks = [];
let leaveFns = [];
let navId = 0;
let currentScreen = 'start';

function onLeave(fn) { leaveFns.push(fn); }
function runLeave() {
  const fns = leaveFns;
  leaveFns = [];
  for (const fn of fns) { try { fn(); } catch (e) { console.error(e); } }
}

async function go(name, params = {}) {
  const id = ++navId;
  runLeave();
  if (typeof Sound !== 'undefined') Sound.stop();
  closeOverlay();
  const app = $('#app');
  app.replaceChildren();
  app.dataset.screen = name;
  currentScreen = name;
  window.scrollTo(0, 0);
  try {
    await Screens[name].render(app, params, () => id === navId);
  } catch (err) {
    console.error(err);
    if (id === navId) {
      app.replaceChildren(h('div', { class: 'error-box' },
        h('p', null, 'Algo deu errado.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => go('start') }, 'Voltar ao início')));
    }
  }
}

/* ---------- diálogos ---------- */
function openOverlay(content, { dismissible = true, cls = '' } = {}) {
  const ov = $('#overlay');
  ov.replaceChildren(h('div', { class: 'dialog ' + cls, role: 'dialog', 'aria-modal': 'true' }, content));
  ov.hidden = false;
  ov.onclick = e => { if (dismissible && e.target === ov) closeOverlay(); };
}
function closeOverlay() {
  const ov = $('#overlay');
  ov.hidden = true;
  ov.replaceChildren();
  ov.onclick = null;
}
function confirmBox(message, { ok = 'Sim', cancel = 'Cancelar', danger = false } = {}) {
  return new Promise(resolve => {
    const done = v => { closeOverlay(); resolve(v); };
    openOverlay([
      h('p', { class: 'dialog-msg' }, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => done(false) }, cancel),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => done(true) }, ok)),
    ], { dismissible: false });
  });
}
function toast(msg, ms = 3200) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/* ---------- botão de segurar 3 s (entrada da área da fono) ---------- */
function holdButton({ ms = 3000, onDone, label = 'Área da fono: segure por 3 segundos' } = {}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const btn = h('button', {
    class: 'hold-btn', type: 'button', 'aria-label': label, title: label,
    html: `<svg viewBox="0 0 60 60" aria-hidden="true"><circle class="hold-track" cx="30" cy="30" r="${R}"/>`
      + `<circle class="hold-ring" cx="30" cy="30" r="${R}" style="stroke-dasharray:${C};stroke-dashoffset:${C}"/></svg>`
      + '<span class="hold-icon" aria-hidden="true">⚙️</span>',
  });
  btn.style.setProperty('--hold-ms', ms + 'ms');
  const ring = btn.querySelector('.hold-ring');
  let timer = null;
  let hintTimer = null;
  const reset = () => {
    btn.classList.remove('holding');
    ring.style.strokeDashoffset = C;
  };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    btn.classList.add('holding');
    ring.style.strokeDashoffset = 0;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; reset(); onDone(); }, ms);
  });
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    reset();
    btn.classList.add('hint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => btn.classList.remove('hint'), 1600);
  };
  ['pointerup', 'pointercancel'].forEach(ev => btn.addEventListener(ev, cancel));
  btn.addEventListener('contextmenu', e => e.preventDefault());
  return btn;
}

/* ---------- áudio: contexto e desbloqueio ----------
 * Os navegadores só liberam som depois de um toque. O botão "Começar" (e qualquer
 * toque) chama AudioEngine.unlock(). */
const AudioEngine = {
  ctx: null,
  master: null,
  ttsWarm: false,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = State.settings.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  },
  unlock() {
    // iPad/iPhone: tocar mesmo com a chave/modo silencioso ligado (Safari 16.4+)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* ok */ }
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch (_) { /* ok */ }
    if (!this.ttsWarm && 'speechSynthesis' in window) {
      this.ttsWarm = true;
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.lang = 'pt-BR';
        speechSynthesis.speak(u);
      } catch (_) { /* ok */ }
    }
  },
  async resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (_) { /* ok */ } }
    return ctx;
  },
  setVolume(v) { if (this.master) this.master.gain.value = v; },
};
['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
  if (!AudioEngine.ctx || AudioEngine.ctx.state !== 'running') AudioEngine.unlock();
}, { capture: true, passive: true }));

/* ---------- personagens em SVG ---------- */
const SPEAKER_SVG = '<svg viewBox="0 0 64 64" aria-hidden="true">'
  + '<path d="M10 24h10l14-12v40L20 40H10z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'
  + '<path class="wave w1" d="M42 24a11 11 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'
  + '<path class="wave w2" d="M48 16a22 22 0 0 1 0 32" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
const PLAY_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 4 L36 20 L8 36 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';

/** Bichinho simples: shape = 'round' | 'square' | 'drop' */
function critter({ color = '#3a86ff', shape = 'round', cls = '' } = {}) {
  const ink = '#1d2b4f';
  const body = {
    round: `<ellipse cx="34" cy="91" rx="10" ry="6" fill="${color}"/><ellipse cx="66" cy="91" rx="10" ry="6" fill="${color}"/>`
      + `<ellipse cx="50" cy="57" rx="39" ry="35" fill="${color}"/>`,
    square: `<path d="M24 28 L19 8 L38 20 Z M76 28 L81 8 L62 20 Z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`
      + `<rect x="13" y="20" width="74" height="72" rx="24" fill="${color}"/>`,
    drop: `<path d="M50 6 C62 24 89 42 89 64 C89 84 71 95 50 95 C29 95 11 84 11 64 C11 42 38 24 50 6 Z" fill="${color}"/>`,
  }[shape] || '';
  return `<svg class="critter ${cls}" viewBox="0 0 100 100" aria-hidden="true">${body}`
    + '<g class="eyes"><circle cx="37" cy="54" r="9.5" fill="#fff"/><circle cx="63" cy="54" r="9.5" fill="#fff"/>'
    + `<circle cx="38.6" cy="55.2" r="4.8" fill="${ink}"/><circle cx="64.6" cy="55.2" r="4.8" fill="${ink}"/>`
    + '<circle cx="40.2" cy="53.4" r="1.7" fill="#fff"/><circle cx="66.2" cy="53.4" r="1.7" fill="#fff"/></g>'
    + '<circle cx="25" cy="68" r="5.5" fill="#ff8fab" opacity=".55"/><circle cx="75" cy="68" r="5.5" fill="#ff8fab" opacity=".55"/>'
    + `<path class="mouth-closed" d="M41 70 Q50 79 59 70" fill="none" stroke="${ink}" stroke-width="3.6" stroke-linecap="round"/>`
    + `<ellipse class="mouth-open" cx="50" cy="74" rx="7.5" ry="6.5" fill="${ink}"/></svg>`;
}

/* ---------- tela inicial ---------- */
function fonoButton() {
  const btn = holdButton({ onDone: () => { fonoReturnTo = currentScreen; go('fono'); } });
  // Bolinha laranja discreta quando o backup está atrasado (sem texto para a criança).
  if (typeof backupDue === 'function') backupDue().then(due => btn.classList.toggle('alert', due));
  return btn;
}


Screens.start = {
  render(app) {
    add(app, [
      h('div', { class: 'start-top' }, fonoButton()),
      h('div', { class: 'start-center' },
        h('div', { class: 'logo', html: critter({ color: '#3a86ff', shape: 'round', cls: 'logo-critter' }) }),
        h('h1', { class: 'title' }, 'Escuta ', h('span', null, 'Só!')),
        h('button', {
          class: 'btn-start', type: 'button',
          onclick: () => { AudioEngine.unlock(); startGame(); },
        }, h('span', { class: 'play-ico', html: PLAY_SVG }), h('span', null, 'Começar'))),
    ]);
  },
};

/* ---------- menu dos modos de jogo ---------- */
Screens.menu = {
  render(app) {
    const child = State.child || GUEST;
    const modes = Object.values(MODES).filter(m => State.settings.modes[m.id]);
    add(app, [
      h('div', { class: 'topbar' },
        iconBtn('🏠', 'Início', () => go('start')),
        h('button', { class: 'child-chip', type: 'button', 'aria-label': 'Trocar criança', onclick: () => go(Screens.who ? 'who' : 'start') },
          h('span', { class: 'avatar' }, child.avatar), h('span', null, child.nick)),
        h('div', { class: 'spacer' }),
        Screens.album && iconBtn('📖', 'Álbum de figurinhas', () => go('album')),
        fonoButton()),
      modes.length
        ? h('div', { class: 'mode-grid' }, modes.map(m => h('button', {
          class: 'mode-card mode-' + m.id, type: 'button', 'aria-label': m.name,
          onclick: () => go('game', { mode: m.id }),
        }, h('span', { class: 'mode-art', html: m.art() }), h('span', { class: 'mode-name' }, m.name))))
        : h('p', { class: 'empty' }, 'Nenhum modo de jogo ativo.'),
    ]);
  },
};

/* ---------- área da fono (estrutura; as abas são registradas nas partes 2 e 4) ---------- */
const FonoTabs = [];      // { id, label, icon, order, render(el, show) }
const FonoBanners = [];   // avisos no topo, ex.: lembrete de backup — fn(el, show)
let fonoLastTab = null;
let fonoReturnTo = 'start';

Screens.fono = {
  async render(app, { tab } = {}) {
    const tabs = FonoTabs.slice().sort((a, b) => a.order - b.order);
    const banners = h('div', { class: 'fono-banners' });
    const content = h('section', { class: 'fono-content' });
    const nav = h('nav', { class: 'fono-tabs', 'aria-label': 'Seções' }, tabs.map(t => h('button', {
      class: 'fono-tab', type: 'button', 'data-tab': t.id, onclick: () => show(t.id),
    }, h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, t.icon), h('span', null, t.label))));
    const back = () => go(fonoReturnTo === 'menu' && State.child ? 'menu' : 'start');
    add(app, [
      h('header', { class: 'fono-header' },
        h('h1', null, 'Área da fono'),
        h('span', { class: 'muted small' }, 'versão ' + APP_VERSION),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', onclick: back }, '✖ Voltar ao jogo')),
      banners,
      h('div', { class: 'fono-body' }, nav, content),
    ]);

    async function show(id) {
      const t = tabs.find(x => x.id === id) || tabs[0];
      if (!t) return;
      runLeave();
      if (typeof Sound !== 'undefined') Sound.stop();
      fonoLastTab = t.id;
      for (const b of nav.children) b.classList.toggle('active', b.dataset.tab === t.id);
      banners.replaceChildren();
      for (const fn of FonoBanners) { try { await fn(banners, show); } catch (e) { console.error(e); } }
      content.replaceChildren();
      await t.render(content, show);
    }

    if (!tabs.length) { content.append(h('p', { class: 'empty' }, 'Em construção.')); return; }
    await show(tab || fonoLastTab || tabs[0].id);
  },
};

/* ---------- inicialização ---------- */
async function init() {
  for (const fn of InitHooks) {
    try { await fn(); } catch (e) { console.error('init', e); }
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
  }
  go('start');
}
document.addEventListener('DOMContentLoaded', init);

/* =========================================================================
 * 2. BANCO DE DADOS, PALAVRAS E ÁUDIO
 * ========================================================================= */

/* ---------- IndexedDB: tudo fica no aparelho ---------- */
const STORES = ['pairs', 'audio', 'children', 'sessions', 'kv'];

const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('escuta-so', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'audio' || s === 'kv' ? 'key' : 'id' });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  },
  read(store, fn) {
    return new Promise((resolve, reject) => {
      const r = fn(this.db.transaction(store, 'readonly').objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  get(store, key) { return this.read(store, s => s.get(key)); },
  all(store) { return this.read(store, s => s.getAll()); },
  count(store) { return this.read(store, s => s.count()); },
  /** Escrita que só termina quando a transação foi gravada de fato. */
  write(stores, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(stores, 'readwrite');
      fn(t);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transação cancelada'));
    });
  },
  put(store, value) { return this.write(store, t => t.objectStore(store).put(value)); },
  del(store, key) { return this.write(store, t => t.objectStore(store).delete(key)); },
  async kv(key, fallback) {
    const r = await this.get('kv', key);
    return r === undefined ? fallback : r.value;
  },
  setKv(key, value) { return this.put('kv', { key, value }); },
};

/* ---------- banco de palavras ----------
 * Cada par: { id, contrast, a: palavra surda, b: palavra sonora, figure, order }
 * Cada palavra: { text, emoji, img: { mime, data: ArrayBuffer } | null } */
const CONTRASTS = {
  pb: { label: '/p/ × /b/', short: 'P × B', color: '#e76f51' },
  td: { label: '/t/ × /d/', short: 'T × D', color: '#2a9d8f' },
  chj: { label: '/ʃ/ × /ʒ/', short: 'CH × J', color: '#8e6cd1' },
  fv: { label: '/f/ × /v/', short: 'F × V', color: '#e9a23b' },
  kg: { label: '/k/ × /g/', short: 'K × G', color: '#3a86ff' },
  sz: { label: '/s/ × /z/', short: 'S × Z', color: '#e63995' },
  outro: { label: 'outro contraste', short: 'Outro', color: '#6b6f80' },
};
const TARGET_CONTRASTS = ['pb', 'td', 'chj'];
const DEFAULT_PAIRS = [
  ['pb', 'pote', '🫙', 'bote', '⛵'],
  ['pb', 'pomba', '🕊️', 'bomba', '💣'],
  ['pb', 'pia', '🚰', 'Bia', '👧'],
  ['td', 'tia', '👩', 'dia', '☀️'],
  ['td', 'toca', '🕳️', 'doca', '⚓'],
  ['chj', 'queixo', '🧔', 'queijo', '🧀'],
  ['chj', 'chato', '😒', 'jato', '✈️'],
  ['fv', 'faca', '🔪', 'vaca', '🐄'],
  ['kg', 'calo', '🦶', 'galo', '🐓'],
  ['sz', 'caça', '🏹', 'casa', '🏠'],
];

const Bank = {
  pairs: [],
  recorded: new Set(),   // chaves "idDoPar:a" / "idDoPar:b" que têm voz gravada
  async load() {
    this.pairs = (await DB.all('pairs')).sort((x, y) => (x.order || 0) - (y.order || 0));
    this.recorded = new Set(await DB.read('audio', s => s.getAllKeys()));
  },
  async seedIfEmpty() {
    if (await DB.kv('seeded', false)) return;
    const pairs = DEFAULT_PAIRS.map(([contrast, at, ae, bt, be], i) => ({
      id: 'p' + (i + 1),
      contrast,
      a: { text: at, emoji: ae, img: null },
      b: { text: bt, emoji: be, img: null },
      figure: true,
      order: i + 1,
    }));
    await DB.write(['pairs', 'kv'], t => {
      pairs.forEach(p => t.objectStore('pairs').put(p));
      t.objectStore('kv').put({ key: 'seeded', value: true });
    });
  },
  get(id) { return this.pairs.find(p => p.id === id); },
  hasAudio(pair, side) { return this.recorded.has(pair.id + ':' + side); },
  async save(pair) { await DB.put('pairs', pair); await this.load(); },
  async remove(id) {
    await DB.write(['pairs', 'audio'], t => {
      t.objectStore('pairs').delete(id);
      t.objectStore('audio').delete(id + ':a');
      t.objectStore('audio').delete(id + ':b');
    });
    Sound.forget(id + ':a');
    Sound.forget(id + ':b');
    await this.load();
  },
};

async function loadSettings() {
  const saved = await DB.kv('settings', {});
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.assign(s, saved);
  s.modes = Object.assign({}, DEFAULT_SETTINGS.modes, saved.modes || {});
  State.settings = s;
  AudioEngine.setVolume(s.volume);
}
function saveSettings() { return DB.setKv('settings', State.settings); }

function requestPersistentStorage() {
  // Pede ao navegador para não apagar os dados sozinho quando faltar espaço.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
    }
  } catch (_) { /* ok */ }
}

InitHooks.push(async () => {
  await DB.open();
  await Bank.seedIfEmpty();
  await Bank.load();
  await loadSettings();
  requestPersistentStorage();
});

/* ---------- figuras (emoji ou foto) ---------- */
const imageUrls = new WeakMap();
function imageUrl(img) {
  let url = imageUrls.get(img.data);
  if (!url) {
    url = URL.createObjectURL(new Blob([img.data], { type: img.mime }));
    imageUrls.set(img.data, url);
  }
  return url;
}
function figureEl(pair, side) {
  const w = pair[side];
  if (w.img) return h('img', { class: 'fig-img', src: imageUrl(w.img), alt: '', draggable: 'false' });
  return h('span', { class: 'fig-emoji', 'aria-hidden': 'true' }, w.emoji || '❓');
}
function pickImage() {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: 'image/*', style: 'position:fixed;left:-9999px' });
    input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
    document.body.append(input);
    input.click();
  });
}
/** Reduz a foto para no máximo 480 px e salva como JPEG (ocupa pouco espaço). */
async function resizeImage(file, max = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.85));
    return { mime: 'image/jpeg', data: await blob.arrayBuffer() };
  } finally {
    URL.revokeObjectURL(url);
  }
}
function contrastChip(cid) {
  const c = CONTRASTS[cid] || CONTRASTS.outro;
  return h('span', { class: 'chip', style: `--c:${c.color}` }, c.short,
    cid !== 'outro' && h('span', { class: 'chip-ipa' }, c.label));
}

/* ---------- tocar palavras ----------
 * Usa a gravação da fono; se não houver, a voz sintética pt-BR (menos precisa). */
let ptVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  const lang = v => (v.lang || '').toLowerCase().replace('_', '-');
  return voices.find(v => lang(v) === 'pt-br' && v.localService)
    || voices.find(v => lang(v) === 'pt-br')
    || voices.find(v => lang(v).startsWith('pt'))
    || null;
}
if ('speechSynthesis' in window) {
  ptVoice = pickVoice();
  speechSynthesis.onvoiceschanged = () => { ptVoice = pickVoice(); };
}

const Sound = {
  cache: new Map(),      // chave -> AudioBuffer já decodificado
  sources: new Set(),
  token: 0,
  decode(arrayBuffer) {
    const ctx = AudioEngine.ensure();
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.catch) p.catch(reject);
    });
  },
  async buffer(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const rec = await DB.get('audio', key);
    if (!rec || !AudioEngine.ensure()) return null;
    try {
      const buf = await this.decode(rec.data.slice(0));
      this.cache.set(key, buf);
      return buf;
    } catch (e) {
      console.warn('não consegui decodificar', key, e);
      return null;
    }
  },
  forget(key) { this.cache.delete(key); },
  playBuffer(buf) {
    return new Promise(resolve => {
      const ctx = AudioEngine.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(AudioEngine.master);
      this.sources.add(src);
      let done = false;
      const finish = () => { if (done) return; done = true; this.sources.delete(src); resolve(); };
      src.onended = finish;
      src.start();
      setTimeout(finish, buf.duration * 1000 + 600);   // segurança, caso o "ended" não chegue
    });
  },
  speak(text) {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { setTimeout(resolve, 700); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      if (ptVoice) u.voice = ptVoice;
      u.rate = 0.85;
      u.volume = Math.min(1, State.settings.volume);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, 900 + text.length * 160);
      speechSynthesis.speak(u);
    });
  },
  /** Toca uma palavra. Devolve true se precisou usar a voz sintética. */
  async word(pair, side) {
    await AudioEngine.resume();
    const buf = Bank.hasAudio(pair, side) ? await this.buffer(pair.id + ':' + side) : null;
    if (buf && AudioEngine.ctx) { await this.playBuffer(buf); return false; }
    await this.speak(pair[side].text);
    return true;
  },
  stop() {
    this.token++;
    for (const s of this.sources) { try { s.stop(); } catch (_) { /* ok */ } }
    this.sources.clear();
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (_) { /* ok */ } }
  },
  /** Toca uma sequência de palavras com pausa entre elas. Um novo play cancela o anterior. */
  async sequence(steps, pauseMs = 0) {
    this.stop();
    const my = this.token;
    let tts = false;
    for (let i = 0; i < steps.length; i++) {
      if (my !== this.token) return { cancelled: true, tts };
      const s = steps[i];
      if (s.onStart) s.onStart();
      tts = (await this.word(s.pair, s.side)) || tts;
      if (my !== this.token) return { cancelled: true, tts };
      if (s.onEnd) s.onEnd();
      if (i < steps.length - 1) await sleep(pauseMs);
    }
    return { cancelled: my !== this.token, tts };
  },
  /** Sons curtos e alegres, sintetizados (não precisam de arquivo). */
  chime(kind = 'win') {
    const ctx = AudioEngine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const notes = {
      win: [523.25, 659.25, 783.99, 1046.5],
      star: [783.99, 1174.66],
      tap: [880],
      open: [392, 523.25, 659.25, 783.99, 1046.5, 1318.5],
    }[kind] || [];
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = t0 + i * (kind === 'open' ? 0.07 : 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g);
      g.connect(AudioEngine.master);
      o.start(t);
      o.stop(t + 0.4);
    });
  },
};

/* ---------- gravar ----------
 * getUserMedia + MediaRecorder no formato que o aparelho suporta
 * (webm/opus no Android, mp4/aac no Safari). Depois a gravação é decodificada,
 * o silêncio do começo e do fim é recortado e o resultado é salvo como WAV,
 * que toca igual em qualquer aparelho (importante para o backup). */
const Recorder = {
  supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); },
  mimeType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
    return types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || '';
  },
  async start({ maxMs = 4000, onLevel } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      // Sem filtros do navegador: eles podem apagar consoantes fracas (ex.: o vozeamento do /b/).
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const mime = this.mimeType();
    let rec;
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (_) { rec = new MediaRecorder(stream); }
    const chunks = [];
    let raf = 0;
    let srcNode = null;
    const ctx = await AudioEngine.resume();
    if (ctx && onLevel) {
      try {
        srcNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        srcNode.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
          onLevel(peak);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (_) { /* medidor é opcional */ }
    }
    const cleanup = () => {
      cancelAnimationFrame(raf);
      try { if (srcNode) srcNode.disconnect(); } catch (_) { /* ok */ }
      stream.getTracks().forEach(t => t.stop());   // libera o microfone (no iPad o som volta ao alto-falante)
    };
    const done = new Promise((resolve, reject) => {
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); };
      rec.onerror = e => { cleanup(); reject(e.error || new Error('erro na gravação')); };
    });
    const stop = () => { clearTimeout(timer); if (rec.state !== 'inactive') rec.stop(); };
    const timer = setTimeout(stop, maxMs);
    rec.start();
    return { stop, done };
  },
};

/** Recorta o silêncio e iguala o volume. Devolve null se não ouviu nada. */
function trimAndNormalize(x, sr) {
  const win = Math.max(1, Math.round(sr * 0.01));          // janelas de 10 ms
  const n = Math.floor(x.length / win);
  if (n < 5) return null;
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * win, e = i + win; i < e; i++) s += x[i] * x[i];
    rms[f] = Math.sqrt(s / win);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const noise = sorted[Math.floor(n * 0.1)];
  const loud = sorted[Math.floor(n * 0.98)];
  if (loud < 0.004 || loud < noise * 3) return null;
  // Limiar baixo de propósito, para não cortar o vozeamento inicial do /b/ /d/ /g/ nem fricativas fracas.
  const thr = Math.min(Math.max(noise * 4, loud * 0.03), loud * 0.25);
  const RUN = 3;   // precisa de 30 ms seguidos acima do limiar (ignora o "clique" do toque)
  const above = f => { for (let k = 0; k < RUN; k++) if (rms[f + k] <= thr) return false; return true; };
  let first = -1;
  let last = -1;
  for (let f = 0; f + RUN <= n; f++) if (above(f)) { first = f; break; }
  for (let f = n - RUN; f >= 0; f--) if (above(f)) { last = f + RUN - 1; break; }
  if (first < 0) return null;

  // Margem fixa antes e depois: assim a pausa entre as palavras fica sempre igual.
  const PRE = Math.round(sr * 0.12);
  const POST = Math.round(sr * 0.15);
  const s0 = first * win;
  const s1 = Math.min(x.length, (last + 1) * win);
  const out = new Float32Array(PRE + (s1 - s0) + POST);
  for (let i = 0; i < out.length; i++) {
    const j = s0 - PRE + i;
    out[i] = j >= 0 && j < x.length ? x[j] : 0;
  }

  // Volume: iguala pela energia da fala, sem estourar o pico.
  let sum = 0;
  let cnt = 0;
  for (let f = first; f <= last; f++) if (rms[f] > thr) { sum += rms[f] * rms[f]; cnt++; }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const speechRms = Math.sqrt(sum / Math.max(cnt, 1)) || 1e-6;
  const gain = Math.min(0.1 / speechRms, 0.95 / (peak || 1e-6), 20);
  const fade = Math.round(sr * 0.01);
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fade) g *= i / fade;
    else if (i > out.length - fade) g *= (out.length - i) / fade;
    out[i] *= g;
  }
  return out;
}

function encodeWav(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

async function processRecording(blob) {
  const raw = await blob.arrayBuffer();
  let buf;
  try {
    buf = await Sound.decode(raw.slice(0));
  } catch (e) {
    console.warn('sem recorte (não decodificou)', e);
    return { data: raw, mime: blob.type || 'audio/webm', processed: false };
  }
  const mono = buf.getChannelData(0).slice();
  if (buf.numberOfChannels > 1) {
    for (let c = 1; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i];
    }
    for (let i = 0; i < mono.length; i++) mono[i] /= buf.numberOfChannels;
  }
  const out = trimAndNormalize(mono, buf.sampleRate);
  if (!out) return null;
  return { data: encodeWav(out, buf.sampleRate), mime: 'audio/wav', processed: true, seconds: out.length / buf.sampleRate };
}

async function saveRecording(key, rec) {
  await DB.put('audio', { key, mime: rec.mime, data: rec.data, seconds: rec.seconds || null, updated: new Date().toISOString() });
  Bank.recorded.add(key);
  Sound.forget(key);
}
async function deleteRecording(key) {
  await DB.del('audio', key);
  Bank.recorded.delete(key);
  Sound.forget(key);
}
function micError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    toast('O microfone foi bloqueado. Libere o microfone para este site nas configurações do navegador e tente de novo.', 6000);
  } else if (name === 'NotFoundError') {
    toast('Nenhum microfone encontrado neste aparelho.', 5000);
  } else {
    toast('Não foi possível gravar: ' + ((e && e.message) || e), 5000);
  }
}

/* ---------- aba "Gravar palavras" ---------- */
FonoTabs.push({ id: 'gravar', label: 'Gravar palavras', icon: '🎙️', order: 2, render: renderRecordTab });

async function renderRecordTab(el) {
  let leaving = false;
  let active = null;            // gravação em andamento: { key, stop }
  onLeave(() => { leaving = true; if (active) active.stop(); });
  const canRecord = Recorder.supported();
  const summary = h('div', { class: 'rec-summary' });
  const list = h('div', { class: 'pair-list' });

  add(el, [
    h('div', { class: 'tab-head' },
      h('h2', null, 'Gravar palavras'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editPairDialog(null, draw) }, '➕ Novo par')),
    summary,
    !canRecord && h('div', { class: 'banner warn' }, 'Este navegador não permite gravar áudio. No iPad use o Safari e no Android use o Chrome, ambos atualizados.'),
    h('details', { class: 'tips' },
      h('summary', null, 'Dicas para gravar'),
      h('ul', null,
        h('li', null, 'Grave num lugar silencioso, com o tablet a uns 20 cm da boca.'),
        h('li', null, 'Toque em Gravar, diga a palavra e toque em Parar (a gravação para sozinha depois de 4 segundos).'),
        h('li', null, 'O silêncio do começo e do fim é cortado automaticamente e o volume das palavras é igualado.'),
        h('li', null, 'Grave as duas palavras de um par em seguida, com a mesma entonação e intensidade, para que a única diferença seja o vozeamento.'),
        h('li', null, 'Depois de gravar, a palavra toca sozinha para você conferir. Se não gostar, é só regravar.'))),
    list,
  ]);

  function updateSummary() {
    const total = Bank.pairs.length * 2;
    const done = Bank.pairs.reduce((n, p) => n + Bank.hasAudio(p, 'a') + Bank.hasAudio(p, 'b'), 0);
    summary.replaceChildren(
      h('div', { class: 'progress-line' }, h('div', { class: 'progress-fill', style: `width:${total ? (100 * done) / total : 0}%` })),
      h('p', null, h('strong', null, `${done} de ${total} palavras com voz gravada. `),
        done < total
          ? h('span', { class: 'muted' }, 'As que faltam usam a voz sintética do aparelho, que é menos precisa para diferenciar surdo × sonoro.')
          : 'Tudo gravado! 🎉'));
  }

  function draw() {
    list.replaceChildren();
    for (const cid of Object.keys(CONTRASTS)) {
      const pairs = Bank.pairs.filter(p => p.contrast === cid);
      if (!pairs.length) continue;
      list.append(h('h3', { class: 'group-title' }, contrastChip(cid)), ...pairs.map(pairCard));
    }
    if (!Bank.pairs.length) list.append(h('p', { class: 'empty' }, 'Nenhum par cadastrado. Toque em “Novo par”.'));
    updateSummary();
  }

  function pairCard(pair) {
    return h('article', { class: 'pair-card' },
      h('div', { class: 'pair-head' },
        h('span', { class: 'badge ' + (pair.figure ? 'fig' : 'sound') }, pair.figure ? '🖼️ tem figura' : '👂 só som'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => editPairDialog(pair, draw) }, '✏️ Editar')),
      wordRow(pair, 'a'),
      wordRow(pair, 'b'));
  }

  function wordRow(pair, side) {
    const key = pair.id + ':' + side;
    const status = h('span', { class: 'rec-status' });
    const fill = h('span', { class: 'meter-fill' });
    const recBtn = h('button', { class: 'btn rec-btn', type: 'button', disabled: !canRecord });
    const playBtn = h('button', { class: 'btn', type: 'button' }, '▶️ Ouvir');
    const delBtn = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Apagar gravação', title: 'Apagar gravação' }, '🗑️');
    const row = h('div', { class: 'word-row' },
      h('div', { class: 'word-fig' }, figureEl(pair, side)),
      h('div', { class: 'word-info' },
        h('span', { class: 'word-text' }, pair[side].text),
        pair.contrast !== 'outro' && h('span', { class: 'muted small' }, side === 'a' ? 'surda' : 'sonora'),
        status),
      h('span', { class: 'meter', 'aria-hidden': 'true' }, fill),
      h('div', { class: 'word-actions' }, recBtn, playBtn, delBtn));

    function paint(state = '') {
      const has = Bank.hasAudio(pair, side);
      status.className = 'rec-status ' + (state === 'rec' ? 'recording' : has ? 'ok' : 'none');
      status.textContent = state === 'rec' ? '● gravando…' : state === 'proc' ? 'recortando…' : has ? '✔ voz gravada' : 'sem gravação';
      recBtn.textContent = state === 'rec' ? '⏹️ Parar' : has ? '🔁 Regravar' : '⏺️ Gravar';
      recBtn.classList.toggle('recording', state === 'rec');
      row.classList.toggle('recording', state === 'rec');
      delBtn.hidden = !has;
      fill.style.transform = 'scaleX(0)';
    }

    recBtn.onclick = async () => {
      if (active) { if (active.key === key) active.stop(); return; }
      Sound.stop();
      try {
        const ctl = await Recorder.start({ maxMs: 4000, onLevel: p => { fill.style.transform = `scaleX(${Math.min(1, p * 1.6)})`; } });
        active = { key, stop: ctl.stop };
        paint('rec');
        const blob = await ctl.done;
        active = null;
        if (leaving) return;
        paint('proc');
        const res = await processRecording(blob);
        if (!res) { paint(); toast('Não deu para ouvir a palavra. Fale um pouco mais perto do aparelho e tente de novo.', 4500); return; }
        await saveRecording(key, res);
        paint();
        updateSummary();
        await Sound.sequence([{ pair, side }]);
      } catch (e) {
        active = null;
        paint();
        micError(e);
      }
    };
    playBtn.onclick = async () => {
      if (active) return;
      const r = await Sound.sequence([{ pair, side }]);
      if (r.tts && !r.cancelled) toast('Sem gravação: essa foi a voz sintética do aparelho.');
    };
    delBtn.onclick = async () => {
      if (!(await confirmBox(`Apagar a gravação de “${pair[side].text}”?`, { ok: 'Apagar', danger: true }))) return;
      await deleteRecording(key);
      paint();
      updateSummary();
    };
    paint();
    return row;
  }

  draw();
}

/* ---------- editar / criar par ---------- */
function editPairDialog(pair, onDone) {
  const isNew = !pair;
  const d = isNew
    ? {
      id: uid(), contrast: 'pb', figure: true,
      order: Bank.pairs.reduce((m, p) => Math.max(m, p.order || 0), 0) + 1,
      a: { text: '', emoji: '', img: null }, b: { text: '', emoji: '', img: null },
    }
    : { ...pair, a: { ...pair.a }, b: { ...pair.b } };

  const contrastSel = h('select', { class: 'input', value: d.contrast },
    Object.entries(CONTRASTS).map(([id, c]) => h('option', { value: id }, id === 'outro' ? 'Outro contraste' : `${c.short}  —  ${c.label}`)));
  const figYes = h('input', { type: 'radio', name: 'fig', checked: d.figure });
  const figNo = h('input', { type: 'radio', name: 'fig', checked: !d.figure });

  const sideBox = s => {
    const w = d[s];
    const prev = h('div', { class: 'edit-preview' });
    const text = h('input', { class: 'input', type: 'text', value: w.text, maxlength: 30, autocomplete: 'off', spellcheck: 'false' });
    text.oninput = () => { w.text = text.value; };
    const emoji = h('input', { class: 'input emoji-input', type: 'text', value: w.emoji, maxlength: 16, autocomplete: 'off' });
    emoji.oninput = () => { w.emoji = emoji.value.trim(); paint(); };
    const rmBtn = h('button', { class: 'btn small ghost', type: 'button' }, 'Usar emoji');
    rmBtn.onclick = () => { w.img = null; paint(); };
    const photoBtn = h('button', { class: 'btn small', type: 'button' }, '📷 Foto da galeria');
    photoBtn.onclick = async () => {
      const f = await pickImage();
      if (!f) return;
      try { w.img = await resizeImage(f); paint(); } catch (_) { toast('Não consegui abrir essa imagem.'); }
    };
    function paint() { prev.replaceChildren(figureEl(d, s)); rmBtn.hidden = !w.img; }
    paint();
    return h('fieldset', { class: 'edit-side' },
      h('legend', null, s === 'a' ? 'Palavra 1 (surda)' : 'Palavra 2 (sonora)'),
      prev,
      h('label', { class: 'field' }, h('span', null, 'Palavra'), text),
      h('label', { class: 'field' }, h('span', null, 'Emoji (use o teclado de emojis)'), emoji),
      h('div', { class: 'row wrap' }, photoBtn, rmBtn));
  };

  const save = async () => {
    d.contrast = contrastSel.value;
    d.figure = figYes.checked;
    d.a.text = d.a.text.trim();
    d.b.text = d.b.text.trim();
    if (!d.a.text || !d.b.text) { toast('Preencha as duas palavras.'); return; }
    const removed = [];
    if (!isNew) {
      for (const s of ['a', 'b']) {
        if (pair[s].text !== d[s].text && Bank.hasAudio(pair, s)) {
          await deleteRecording(pair.id + ':' + s);
          removed.push(pair[s].text);
        }
      }
    }
    await Bank.save(d);
    closeOverlay();
    if (removed.length) toast(`A gravação de “${removed.join('” e “')}” foi apagada porque a palavra mudou. Grave de novo.`, 5000);
    onDone();
  };
  const remove = async () => {
    closeOverlay();
    if (await confirmBox(`Apagar o par “${pair.a.text} × ${pair.b.text}” e as gravações dele?`, { ok: 'Apagar', danger: true })) {
      await Bank.remove(pair.id);
      onDone();
    }
  };

  openOverlay([
    h('h2', null, isNew ? 'Novo par' : 'Editar par'),
    h('label', { class: 'field' }, h('span', null, 'Contraste'), contrastSel),
    h('div', { class: 'edit-sides' }, sideBox('a'), sideBox('b')),
    h('div', { class: 'field' },
      h('span', null, 'Uso nos jogos'),
      h('label', { class: 'radio' }, figYes, h('span', null, h('strong', null, 'Tem figura'), ' — vale para todos os modos')),
      h('label', { class: 'radio' }, figNo, h('span', null, h('strong', null, 'Só som'), ' — só no modo “Igual ou diferente?”'))),
    h('div', { class: 'dialog-actions' },
      !isNew && h('button', { class: 'btn ghost danger-text', type: 'button', onclick: remove }, '🗑️ Apagar par'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ghost', type: 'button', onclick: closeOverlay }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Salvar')),
  ], { dismissible: false, cls: 'wide' });
}

/* =========================================================================
 * 3. MODOS DE JOGO, RECOMPENSAS E ÁLBUM
 * ========================================================================= */

const CRITTER_A = { color: '#3a86ff', shape: 'round' };    // "igual": dois destes
const CRITTER_B = { color: '#fb8500', shape: 'square' };   // "diferente": um de cada
const HELPERS = [
  { color: '#2ec4b6', shape: 'drop' },
  { color: '#8e6cd1', shape: 'round' },
  { color: '#ff5d8f', shape: 'square' },
];
const STICKERS = ['🦄', '🚀', '🐳', '🦖', '🍦', '🎈', '🌻', '🐞', '🌈', '🍉', '🎸', '🦜',
  '🐙', '🍩', '🚂', '🎠', '🧁', '🦩', '🐠', '🪁', '🍭', '🦔', '🐢', '🦋'];

function startGame() { go('who'); }

async function allChildren() {
  return (await DB.all('children')).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
}
async function sessionsOf(childId) {
  return (await DB.all('sessions')).filter(s => s.childId === childId).sort((a, b) => a.date.localeCompare(b.date));
}
/** Pares escolhidos pela fono para a criança (padrão: os pares-alvo P×B, T×D, CH×J). */
async function roundPairIds(childId) {
  const saved = await DB.kv('round:' + childId, null);
  if (Array.isArray(saved)) return saved;
  return Bank.pairs.filter(p => TARGET_CONTRASTS.includes(p.contrast)).map(p => p.id);
}
async function pairsForMode(mode, childId) {
  const ids = new Set(await roundPairIds(childId));
  return Bank.pairs.filter(p => ids.has(p.id) && (!MODES[mode].needsFigure || p.figure));
}

/** Monta a rodada: contrastes intercalados; no modo 1 ~40% das rodadas são "iguais";
 *  nos modos 2 e 3 a palavra-alvo e o lado da figura certa ficam equilibrados. */
function buildTrials(mode, pairs, n) {
  const seq = [];
  while (seq.length < n) {
    const groups = {};
    for (const p of shuffle(pairs)) (groups[p.contrast] = groups[p.contrast] || []).push(p);
    const lists = shuffle(Object.values(groups));
    const longest = Math.max(...lists.map(l => l.length));
    for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) seq.push(l[i]);
  }
  seq.length = n;
  for (let i = 1; i < n; i++) {           // evita o mesmo par duas vezes seguidas
    if (seq[i] !== seq[i - 1]) continue;
    const j = seq.findIndex((p, k) => k > i && p !== seq[i]);
    if (j > 0) [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  const balanced = k => shuffle(Array.from({ length: n }, (_, i) => i < k));
  if (mode === 'same') {
    const isSame = balanced(Math.round(n * 0.4));
    const startA = balanced(Math.round(n / 2));
    return seq.map((pair, i) => {
      const s = startA[i] ? 'a' : 'b';
      return { pair, order: isSame[i] ? [s, s] : [s, other(s)] };
    });
  }
  const targetA = balanced(Math.round(n / 2));
  const targetLeft = balanced(Math.round(n / 2));
  return seq.map((pair, i) => ({ pair, target: targetA[i] ? 'a' : 'b', targetLeft: targetLeft[i] }));
}

/* ---------- efeitos de comemoração ---------- */
function burst(el, glyphs = ['⭐', '✨', '🌟', '💛']) {
  const r = el.getBoundingClientRect();
  const layer = h('div', { class: 'burst', style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px` });
  const count = 14;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const d = 0.5 * Math.max(r.width, 140) + Math.random() * 70;
    layer.append(h('span', {
      style: `--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px;--rot:${rand(360) - 180}deg;animation-delay:${rand(120)}ms`,
    }, glyphs[i % glyphs.length]));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1600);
}
async function celebrate(el) {
  Sound.chime('win');
  el.classList.add('win');
  burst(el);
  await sleep(1300);
  el.classList.remove('win');
}

/* ---------- quem vai jogar? ---------- */
Screens.who = {
  async render(app, params, alive) {
    const kids = await allChildren();
    if (!alive()) return;
    if (!kids.length) { State.child = GUEST; go('menu'); return; }
    const pick = k => { State.child = k; Sound.chime('tap'); go('menu'); };
    const card = k => h('button', { class: 'who-card', type: 'button', 'aria-label': k.nick, onclick: () => pick(k) },
      h('span', { class: 'avatar big' }, k.avatar), h('span', { class: 'who-name' }, k.nick));
    add(app, [
      h('div', { class: 'topbar' }, iconBtn('🏠', 'Início', () => go('start')), h('div', { class: 'spacer' }), fonoButton()),
      h('div', { class: 'who-grid' }, kids.map(card), card(GUEST)),
    ]);
  },
};

/* ---------- motor do jogo ---------- */
function waitChoice(options) {
  return new Promise(resolve => { for (const [el, value] of options) el.onclick = () => resolve(value); });
}
function revealEl(pair, side) {
  if (pair.figure) return figureEl(pair, side);
  return h('span', { class: 'reveal-critter', html: critter(side === 'a' ? CRITTER_A : CRITTER_B) });
}
/** Depois de um erro: sem som de "errado" e sem X. Toca as duas palavras do par,
 *  destacando cada figura enquanto ela toca, e mostra com um brilho qual era a certa. */
async function showCorrection(g, steps, correctEl) {
  await sleep(450);
  if (!g.alive()) return;
  await g.play(steps, 'busy');
  if (!g.alive()) return;
  correctEl.classList.add('hint-correct');
  await sleep(1200);
  correctEl.classList.remove('hint-correct');
}
const baseResult = pair => ({ pairId: pair.id, contrast: pair.contrast, words: `${pair.a.text} × ${pair.b.text}` });

function flyTo(el, target) {
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const dx = (+el.dataset.dx || 0) + (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (+el.dataset.dy || 0) + (b.top + b.height / 2) - (a.top + a.height / 2);
  el.classList.add('flying');
  el.style.transform = `translate(${dx}px, ${dy}px) scale(.3)`;
}

/** Arrastar uma figura até o bichinho (toque simples também vale). */
function dragChoice(cards, zone, stage) {
  return new Promise(resolve => {
    const offs = [];
    const finish = (idx, dropped) => { offs.forEach(off => off()); resolve({ idx, dropped }); };
    cards.forEach((card, idx) => {
      let st = null;
      const reset = () => { card.dataset.dx = 0; card.dataset.dy = 0; card.style.transform = ''; };
      const isOver = () => {
        const a = card.getBoundingClientRect();
        const b = zone.getBoundingClientRect();
        const cx = a.left + a.width / 2;
        const cy = a.top + a.height / 2;
        const pad = 40;
        return cx > b.left - pad && cx < b.right + pad && cy > b.top - pad && cy < b.bottom + pad;
      };
      const down = e => {
        if (stage.dataset.lock || st) return;
        e.preventDefault();
        try { card.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
        st = { id: e.pointerId, x: e.clientX, y: e.clientY };
        card.classList.add('dragging');
      };
      const move = e => {
        if (!st || e.pointerId !== st.id) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        card.dataset.dx = dx;
        card.dataset.dy = dy;
        card.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
        zone.classList.toggle('drop-hover', isOver());
      };
      const up = e => {
        if (!st || e.pointerId !== st.id) return;
        const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
        st = null;
        card.classList.remove('dragging');
        zone.classList.remove('drop-hover');
        if (isOver()) { finish(idx, true); return; }
        reset();
        if (moved < 14) finish(idx, false);    // foi um toque
      };
      const cancel = () => {
        if (!st) return;
        st = null;
        card.classList.remove('dragging');
        zone.classList.remove('drop-hover');
        reset();
      };
      card.addEventListener('pointerdown', down);
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerup', up);
      card.addEventListener('pointercancel', cancel);
      offs.push(() => {
        card.removeEventListener('pointerdown', down);
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerup', up);
        card.removeEventListener('pointercancel', cancel);
      });
    });
  });
}

Object.assign(MODES, {
  /* 1. IGUAL OU DIFERENTE: duas palavras com pausa; a criança escolhe os bichinhos iguais ou diferentes. */
  same: {
    id: 'same',
    name: 'Igual ou diferente?',
    needsFigure: false,
    art: () => `<span class="art-pair">${critter(CRITTER_A)}${critter(CRITTER_A)}</span>`
      + `<span class="art-pair">${critter(CRITTER_A)}${critter(CRITTER_B)}</span>`,
    async run(trial, g) {
      const { pair, order } = trial;
      const same = order[0] === order[1];
      const bubbles = order.map(() => h('div', { class: 'bubble', html: SPEAKER_SVG }));
      const bSame = h('button', { class: 'answer answer-same', type: 'button', 'aria-label': 'Igual', html: `<span class="critters">${critter(CRITTER_A)}${critter(CRITTER_A)}</span>` });
      const bDiff = h('button', { class: 'answer answer-diff', type: 'button', 'aria-label': 'Diferente', html: `<span class="critters">${critter(CRITTER_A)}${critter(CRITTER_B)}</span>` });
      g.stage.replaceChildren(h('div', { class: 'bubbles' }, bubbles), h('div', { class: 'answers' }, bSame, bDiff));
      const steps = order.map((side, i) => ({ pair, side, el: bubbles[i] }));
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play(steps); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const saidSame = await waitChoice([[bSame, true], [bDiff, false]]);
      g.endInput([bSame, bDiff]);
      const correct = saidSame === same;
      if (correct) {
        await celebrate(saidSame ? bSame : bDiff);
      } else {
        order.forEach((side, i) => { bubbles[i].classList.add('revealed'); bubbles[i].replaceChildren(revealEl(pair, side)); });
        await showCorrection(g, steps, same ? bSame : bDiff);
      }
      return {
        ...baseResult(pair), stim: order.join('-'), expected: same ? 'igual' : 'diferente',
        answer: saidSame ? 'igual' : 'diferente', correct, replays: Math.max(0, replays),
      };
    },
  },

  /* 2. QUAL EU FALEI?: duas figuras (lados sorteados), toca uma palavra. */
  which: {
    id: 'which',
    name: 'Qual eu falei?',
    needsFigure: true,
    art: () => '<span class="art-cards"><span class="mini-card">🧀</span><span class="mini-card">🧔</span></span>',
    async run(trial, g) {
      const { pair, target, targetLeft } = trial;
      const sides = targetLeft ? [target, other(target)] : [other(target), target];
      const cards = sides.map(s => h('button', { class: 'answer fig-card', type: 'button', 'aria-label': pair[s].text }, figureEl(pair, s)));
      g.stage.replaceChildren(h('div', { class: 'cards' }, cards));
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play([{ pair, side: target }]); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const idx = await waitChoice(cards.map((c, i) => [c, i]));
      g.endInput(cards);
      const correct = sides[idx] === target;
      const right = cards[sides.indexOf(target)];
      if (correct) await celebrate(right);
      else await showCorrection(g, sides.map((s, i) => ({ pair, side: s, el: cards[i] })), right);
      return {
        ...baseResult(pair), stim: target, expected: pair[target].text, answer: pair[sides[idx]].text,
        correct, replays: Math.max(0, replays), targetSide: targetLeft ? 'esquerda' : 'direita',
      };
    },
  },

  /* 3. AJUDE O BICHINHO: o bichinho "pede" uma palavra; a criança arrasta a figura até ele. */
  drag: {
    id: 'drag',
    name: 'Ajude o bichinho',
    needsFigure: true,
    art: () => `<span class="art-drag">${critter(HELPERS[0])}<span class="mini-card tilt">🧀</span></span>`,
    async run(trial, g) {
      const { pair, target, targetLeft } = trial;
      const sides = targetLeft ? [target, other(target)] : [other(target), target];
      const talkBtn = h('button', { class: 'buddy-bubble', type: 'button', 'aria-label': 'Ouvir de novo', html: SPEAKER_SVG });
      const body = h('div', { class: 'buddy-body', html: critter(g.helper) });
      const buddy = h('div', { class: 'buddy' }, body, talkBtn);
      const cards = sides.map(s => h('button', { class: 'answer fig-card draggable', type: 'button', 'aria-label': pair[s].text }, figureEl(pair, s)));
      g.stage.replaceChildren(buddy, h('div', { class: 'cards' }, cards));
      let replays = -1;
      let answered = false;
      const listen = async () => {
        if (answered) return;
        replays++;
        buddy.classList.add('talking');
        const r = await g.play([{ pair, side: target }]);
        if (!r.cancelled) { buddy.classList.remove('talking'); g.lock(''); }
      };
      g.replayBtn.onclick = listen;
      talkBtn.onclick = listen;
      listen();
      const { idx, dropped } = await dragChoice(cards, buddy, g.stage);
      answered = true;
      talkBtn.onclick = null;
      g.endInput(cards);
      buddy.classList.remove('talking');
      const correct = sides[idx] === target;
      const right = cards[sides.indexOf(target)];
      if (correct) {
        flyTo(cards[idx], body);
        await sleep(380);
        await celebrate(body);
      } else {
        cards[idx].style.transform = '';
        await sleep(300);
        await showCorrection(g, sides.map((s, i) => ({ pair, side: s, el: cards[i] })), right);
      }
      return {
        ...baseResult(pair), stim: target, expected: pair[target].text, answer: pair[sides[idx]].text,
        correct, replays: Math.max(0, replays), interaction: dropped ? 'arrastou' : 'tocou',
      };
    },
  },
});

function renderNoPairs(app, M) {
  add(app, [
    h('div', { class: 'topbar' }, iconBtn('🏠', 'Voltar', () => go('menu'))),
    h('div', { class: 'no-pairs' },
      h('div', { class: 'no-pairs-art', html: critter({ color: '#8e6cd1', shape: 'drop' }) }),
      h('p', null, h('strong', null, 'Nenhum par disponível para este modo.')),
      h('p', { class: 'muted' }, M.needsFigure
        ? 'Este modo usa figuras. Na área da fono, em “Rodada”, escolha pares marcados como “tem figura”.'
        : 'Na área da fono, em “Rodada”, escolha os pares desta criança.')),
  ]);
}

Screens.game = {
  async render(app, { mode }, alive) {
    const M = MODES[mode];
    const child = State.child || GUEST;
    const pairs = await pairsForMode(mode, child.id);
    if (!alive()) return;
    if (!pairs.length) { renderNoPairs(app, M); return; }

    const n = Math.max(1, State.settings.trials);
    const trials = buildTrials(mode, pairs, n);
    const session = {
      id: uid(), childId: child.id, date: new Date().toISOString(), mode, planned: n, complete: false,
      pauseMs: State.settings.pauseMs, appVersion: APP_VERSION, trials: [],
    };
    let left = false;
    onLeave(() => {
      left = true;
      // Saiu no meio: guarda o que já foi jogado, marcado como incompleto.
      if (!session.complete && session.trials.length) DB.put('sessions', session).catch(e => console.error(e));
    });

    const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, trials.map(() => h('span', { class: 'dot' })));
    const ttsBadge = h('span', { class: 'tts-badge', hidden: true, title: 'Palavra sem gravação: tocando a voz sintética do aparelho, que é menos precisa.' }, 'voz sintética');
    const replayBtn = h('button', { class: 'btn-replay', type: 'button', 'aria-label': 'Ouvir de novo', title: 'Ouvir de novo', html: SPEAKER_SVG });
    const stage = h('div', { class: 'stage stage-' + mode });
    add(app, [
      h('div', { class: 'game-top' },
        h('div', { class: 'game-top-side' }, iconBtn('🏠', 'Sair do jogo', askExit), ttsBadge),
        replayBtn,
        h('div', { class: 'game-top-side end' }, dots)),
      stage,
    ]);

    function askExit() {
      openOverlay(h('div', { class: 'exit-ask' },
        h('div', { class: 'exit-art', html: critter(CRITTER_A) }),
        h('div', { class: 'exit-actions' },
          h('button', { class: 'big-choice', type: 'button', 'aria-label': 'Sair do jogo', onclick: () => go('menu') }, '🏠'),
          h('button', { class: 'big-choice go-on', type: 'button', 'aria-label': 'Continuar jogando', onclick: closeOverlay }, '▶️'))),
      { cls: 'exit-dialog' });
    }

    const g = {
      stage,
      replayBtn,
      helper: HELPERS[rand(HELPERS.length)],
      tts: false,
      alive: () => alive() && !left,
      lock(state) { stage.dataset.lock = state || ''; },
      async play(steps, lock = 'listen') {
        g.lock(lock);
        steps.forEach(s => s.el && s.el.classList.remove('speaking'));
        replayBtn.classList.add('playing');
        const r = await Sound.sequence(steps.map(s => ({
          pair: s.pair,
          side: s.side,
          onStart: () => s.el && s.el.classList.add('speaking'),
          onEnd: () => s.el && s.el.classList.remove('speaking'),
        })), State.settings.pauseMs);
        if (!r.cancelled) {
          replayBtn.classList.remove('playing');
          if (r.tts) g.tts = true;
          ttsBadge.hidden = !r.tts;
        }
        return r;
      },
      endInput(els) {
        els.forEach(e => { e.onclick = null; });
        replayBtn.onclick = null;
        Sound.stop();
        replayBtn.classList.remove('playing');
        stage.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
        g.lock('busy');
      },
    };

    for (let i = 0; i < trials.length; i++) {
      await sleep(i === 0 ? 500 : 300);
      if (!g.alive()) return;
      dots.children[i].classList.add('current');
      g.tts = false;
      const res = await M.run(trials[i], g);
      if (!g.alive()) return;
      res.tts = g.tts;
      session.trials.push(res);
      dots.children[i].className = 'dot done';
    }
    session.complete = true;
    await DB.put('sessions', session);
    const hits = session.trials.filter(t => t.correct).length;
    const reward = await grantReward(child.id, hits / session.trials.length);
    if (g.alive()) go('reward', { ...reward, mode });
  },
};

/* ---------- estrelas, figurinhas e álbum ---------- */
async function getAlbum(childId) {
  const a = await DB.kv('album:' + childId, null);
  return a && a.stickers ? a : { stickers: {}, stars: 0 };
}
async function grantReward(childId, acc) {
  const stars = acc >= 0.9 ? 3 : acc >= 0.6 ? 2 : 1;     // sempre ganha pelo menos 1 estrela
  const album = await getAlbum(childId);
  const missing = STICKERS.filter(s => !album.stickers[s]);
  const sticker = missing.length ? missing[rand(missing.length)] : STICKERS[rand(STICKERS.length)];
  const isNew = !album.stickers[sticker];
  album.stickers[sticker] = (album.stickers[sticker] || 0) + 1;
  album.stars = (album.stars || 0) + stars;
  await DB.setKv('album:' + childId, album);
  return { stars, sticker, isNew };
}

Screens.reward = {
  async render(app, { stars = 1, sticker = '🌟', isNew = false, mode = 'same' }, alive) {
    const starEls = [1, 2, 3].map(i => h('span', { class: 'rstar' + (i <= stars ? ' earned' : '') }, '⭐'));
    const buddy = h('div', { class: 'reward-critter', html: critter(CRITTER_A) });
    const gift = h('button', { class: 'gift', type: 'button', 'aria-label': 'Abrir o presente' }, '🎁');
    const reveal = h('div', { class: 'sticker-reveal', hidden: true },
      h('span', { class: 'sticker-big' }, sticker),
      isNew && h('span', { class: 'new-tag', 'aria-hidden': 'true' }, '✨'));
    const actions = h('div', { class: 'reward-actions', hidden: true },
      iconBtn('🏠', 'Voltar ao menu', () => go('menu')),
      iconBtn('🔁', 'Jogar de novo', () => go('game', { mode })),
      iconBtn('📖', 'Ver o álbum', () => go('album')));
    add(app, h('div', { class: 'reward' },
      h('div', { class: 'reward-stars' }, starEls),
      h('div', { class: 'reward-mid' }, buddy, gift, reveal),
      actions));
    for (const [i, el] of starEls.entries()) {
      await sleep(i === 0 ? 300 : 450);
      if (!alive()) return;
      el.classList.add('show');
      if (i < stars) Sound.chime('star');
    }
    buddy.classList.add('win');
    gift.classList.add('ready');
    gift.onclick = () => {
      gift.onclick = null;
      gift.classList.add('opening');
      Sound.chime('open');
      setTimeout(() => {
        if (!alive()) return;
        gift.hidden = true;
        reveal.hidden = false;
        burst(reveal, ['✨', '🎉', '⭐', '💫']);
        actions.hidden = false;
      }, 500);
    };
  },
};

Screens.album = {
  async render(app, params, alive) {
    const child = State.child || GUEST;
    const album = await getAlbum(child.id);
    if (!alive()) return;
    const got = STICKERS.filter(s => album.stickers[s]).length;
    add(app, [
      h('div', { class: 'topbar' },
        iconBtn('⬅️', 'Voltar', () => go('menu')),
        h('div', { class: 'child-chip' }, h('span', { class: 'avatar' }, child.avatar), h('span', null, child.nick)),
        h('div', { class: 'spacer' }),
        h('div', { class: 'album-score', title: `${album.stars} estrelas · ${got} de ${STICKERS.length} figurinhas` },
          h('span', null, '⭐ ', album.stars), h('span', null, '🃏 ', `${got}/${STICKERS.length}`))),
      h('div', { class: 'album-grid' }, STICKERS.map(s => {
        const c = album.stickers[s] || 0;
        if (!c) return h('div', { class: 'slot' }, h('span', { class: 'slot-q' }, '?'));
        const slot = h('button', { class: 'slot got', type: 'button', 'aria-label': 'figurinha' },
          h('span', { class: 'slot-emoji' }, s), c > 1 && h('span', { class: 'slot-count' }, '×' + c));
        slot.onclick = () => { slot.classList.remove('win'); void slot.offsetWidth; slot.classList.add('win'); Sound.chime('tap'); };
        return slot;
      })),
    ]);
  },
};
