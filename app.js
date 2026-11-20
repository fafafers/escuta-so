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

function startGame() { go('menu'); }

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
