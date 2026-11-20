/* Escuta Só! — jogo de discriminação auditiva de pares mínimos (surdo × sonoro).
 * JavaScript puro, sem frameworks e sem build. Todos os dados ficam no aparelho.
 *
 * Organização do arquivo:
 *   1. Núcleo: utilidades, faixas etárias, navegação, diálogos, desbloqueio de áudio, telas inicial e da fono
 *   2. Banco de dados, banco de palavras, áudio (tocar, gravar, recortar silêncio)
 *   3. Motor do jogo, atividades dos Pequenos Ouvintes, recompensas e álbum
 *   4. Área da fono: rodada, crianças, evolução, backup e ajustes
 *   (as partes seguintes acrescentam as atividades dos Detetives do Som e o restante)
 */
'use strict';

const APP_VERSION = '2.0.1';

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
  trialsBy: {},           // tentativas por rodada, por faixa (vazio = padrão da faixa)
  packs: {},              // pacote padrão de atividades por faixa: { faixa: { atividade: true/false } }
  noiseType: 'mix',       // ruído do "Ruído na escuta": mix | babble | rain | party
};

/* ---------- faixas etárias ----------
 * Cada faixa é só um objeto de configuração. As telas leem daqui o nome, o visual
 * (theme), o tipo de menu, a recompensa, as atividades e os contrastes-alvo.
 * Para criar uma faixa nova (ex.: 6 a 8 anos), basta acrescentar um objeto aqui
 * e incluir o id em GROUP_ORDER; as atividades usadas precisam existir em ACTIVITIES. */
const AGE_GROUPS = {
  pequenos: {
    id: 'pequenos',
    name: 'Pequenos Ouvintes',
    ages: '4 a 5 anos',
    icon: '🧸',
    theme: 'kids',            // visual colorido, com bichinhos e sem texto
    menu: 'cards',            // cartões grandes com desenhos
    reward: 'stickers',       // estrelas + figurinha para o álbum
    trials: 8,
    trialOptions: [8, 9, 10],
    targets: ['pb', 'td', 'chj'],
    activities: ['same', 'which', 'drag', 'rhyme', 'claps', 'onset', 'sounds', 'memory'],
    offByDefault: [],
  },
  detetives: {
    id: 'detetives',
    name: 'Detetives do Som',
    ages: '9 a 11 anos',
    icon: '🕵️',
    theme: 'agent',           // visual de jogo, com missões e níveis
    menu: 'map',              // mapa de fases
    reward: 'missions',       // pontos, patentes e insígnias
    trials: 10,
    trialOptions: [8, 10, 12],
    targets: ['td', 'kg', 'fv'],
    activities: ['hidden', 'silly', 'dictation', 'noise', 'chopped', 'code', 'intruder', 'blitz', 'dichotic'],
    offByDefault: ['blitz', 'dichotic'],   // a fono liga quando quiser
  },
};
const GROUP_ORDER = ['pequenos', 'detetives'];
const DEFAULT_GROUP = 'pequenos';
const groupOf = id => AGE_GROUPS[id] || AGE_GROUPS[DEFAULT_GROUP];
const kidGroup = kid => (kid && AGE_GROUPS[kid.group] ? kid.group : DEFAULT_GROUP);
const trialsFor = G => (G.trialOptions.includes(State.settings.trialsBy[G.id]) ? State.settings.trialsBy[G.id] : G.trials);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const State = {
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  child: null,            // criança jogando agora
  group: DEFAULT_GROUP,   // faixa escolhida agora
};
const GUEST = { id: 'guest', nick: 'Visitante', avatar: '🙂' };
const ACTIVITIES = {};    // atividades de todas as faixas (partes 3 e 5)

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
  // Telas da criança usam o visual da faixa escolhida; as outras, o visual neutro.
  document.documentElement.dataset.theme = Screens[name] && Screens[name].themed ? groupOf(State.group).theme : 'neutral';
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
    + `<g class="eyes" style="animation-delay:-${rand(5000)}ms"><circle cx="37" cy="54" r="9.5" fill="#fff"/><circle cx="63" cy="54" r="9.5" fill="#fff"/>`
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


/* Primeira tela: escolha da faixa etária (o toque também libera o som). */
Screens.start = {
  async render(app, params, alive) {
    const last = await DB.kv('lastGroup', null);
    if (!alive()) return;
    const card = G => h('button', {
      class: `group-card group-${G.theme}` + (G.id === last ? ' last' : ''), type: 'button', 'aria-label': `${G.name}, ${G.ages}`,
      onclick: () => { AudioEngine.unlock(); chooseGroup(G.id); },
    },
    h('span', { class: 'group-art', html: groupArt(G) }),
    h('span', { class: 'group-name' }, G.icon + ' ' + G.name),
    h('span', { class: 'group-ages' }, G.ages),
    G.id === last && h('span', { class: 'group-last' }, 'última escolha'));
    add(app, [
      h('div', { class: 'start-top' },
        h('div', { class: 'brand' },
          h('span', { class: 'logo', html: critter({ color: '#3a86ff', shape: 'round', cls: 'logo-critter' }) }),
          h('h1', { class: 'title' }, 'Escuta ', h('span', null, 'Só!'))),
        h('div', { class: 'spacer' }),
        fonoButton()),
      h('div', { class: 'group-grid' }, GROUP_ORDER.map(id => card(AGE_GROUPS[id]))),
    ]);
  },
};
function groupArt(G) {
  if (G.theme === 'agent') {
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="50" cy="50" r="30" fill="none" stroke="#5ef2d6" stroke-width="9"/>'
      + '<path d="M72 72 L104 104" stroke="#5ef2d6" stroke-width="13" stroke-linecap="round"/>'
      + '<path d="M36 50 q7 -12 14 0 t14 0" fill="none" stroke="#c6ff4d" stroke-width="5" stroke-linecap="round"/></svg>';
  }
  return `<span class="group-critters">${critter({ color: '#3a86ff', shape: 'round' })}${critter({ color: '#fb8500', shape: 'square' })}</span>`;
}
function chooseGroup(id) {
  State.group = id;
  DB.setKv('lastGroup', id).catch(() => {});
  go('who');
}

/* ---------- menu das atividades ----------
 * O formato do menu vem da faixa (G.menu): 'cards' (Pequenos) ou 'map' (Detetives). */
const MenuStyles = {};
Screens.menu = {
  themed: true,
  async render(app, params, alive) {
    const child = State.child || GUEST;
    const G = groupOf(State.group);
    const acts = await activitiesFor(child.id, G.id);
    if (!alive()) return;
    const top = h('div', { class: 'topbar' },
      iconBtn('🏠', 'Início', () => go('start')),
      h('button', { class: 'child-chip', type: 'button', 'aria-label': 'Trocar criança', onclick: () => go('who') },
        h('span', { class: 'avatar' }, child.avatar), h('span', null, child.nick)),
      h('div', { class: 'spacer' }));
    app.append(top);
    await (MenuStyles[G.menu] || MenuStyles.cards)(app, { child, G, acts, top, alive });
    top.append(fonoButton());
  },
};
MenuStyles.cards = (app, { acts, top }) => {
  top.append(iconBtn('📖', 'Álbum de figurinhas', () => go('album')));
  app.append(acts.length
    ? h('div', { class: 'mode-grid' + (acts.length > 4 ? ' many' : '') }, acts.map(m => h('button', {
      class: 'mode-card mode-' + m.id, type: 'button', 'aria-label': m.name,
      onclick: () => go('game', { mode: m.id }),
    }, h('span', { class: 'mode-art', html: m.art() }), h('span', { class: 'mode-name' }, m.name))))
    : h('p', { class: 'empty' }, 'Nenhuma atividade ativa para esta criança.'));
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
const DB_VERSION = 2;

/* Versões do banco:
 *   1 — primeira versão (pares, gravações, crianças, sessões, ajustes)
 *   2 — faixas etárias: cada par ganha "groups", cada criança e cada sessão ganham "group".
 * A migração só acrescenta campos: nada é apagado. Dados antigos sem esses campos
 * também são aceitos pelo código (ver normPair / kidGroup / normSession). */
function migrateToV2(tx) {
  const each = (store, fix) => {
    tx.objectStore(store).openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (!cur) return;
      const v = cur.value;
      if (fix(v)) cur.update(v);
      cur.continue();
    };
  };
  each('pairs', p => { if (Array.isArray(p.groups)) return false; p.groups = ['pequenos']; return true; });
  each('children', k => { if (k.group) return false; k.group = 'pequenos'; return true; });
  each('sessions', s => { if (s.group) return false; s.group = 'pequenos'; return true; });
}
const normPair = p => (Array.isArray(p.groups) && p.groups.length ? p : { ...p, groups: ['pequenos'] });
const normKid = k => (k.group ? k : { ...k, group: 'pequenos' });
const normSession = s => (s.group ? s : { ...s, group: 'pequenos' });

const DB = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('escuta-so', DB_VERSION);
      req.onupgradeneeded = e => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'audio' || s === 'kv' ? 'key' : 'id' });
        }
        if (e.oldVersion >= 1 && e.oldVersion < 2) migrateToV2(req.transaction);
      };
      // A versão antiga continua aberta em outra aba/janela e segura o banco: avisa e espera ela fechar.
      req.onblocked = () => { if (this.onBlocked) this.onBlocked(); };
      req.onsuccess = () => {
        this.db = req.result;
        // Se outra aba abrir uma versão mais nova, esta fecha o banco para não travar a atualização.
        this.db.onversionchange = () => { this.db.close(); toast('O jogo foi atualizado em outra aba. Recarregue esta página.', 8000); };
        resolve();
      };
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
/* Pares da primeira versão: valem para as duas faixas (as gravações são as mesmas). */
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
/* Banco inicial dos Detetives do Som (palavras escritas; emoji quando houver).
 * Pares iguais aos de cima (tia/dia, faca/vaca, calo/galo) não são duplicados. */
const DETECTIVE_PAIRS = [
  ['td', 'tia', '👩', 'dia', '☀️'], ['td', 'tela', '📺', 'dela', ''], ['td', 'teu', '', 'deu', ''],
  ['td', 'tom', '🎵', 'dom', ''], ['td', 'trama', '🧶', 'drama', '🎭'], ['td', 'nata', '🥛', 'nada', '🏊'],
  ['td', 'rota', '🗺️', 'roda', ''],
  ['kg', 'calo', '🦶', 'galo', '🐓'], ['kg', 'cola', '🧴', 'gola', '👔'], ['kg', 'cama', '🛏️', 'gama', ''],
  ['kg', 'coma', '', 'goma', '🍬'], ['kg', 'foco', '🔦', 'fogo', '🔥'], ['kg', 'vaca', '🐄', 'vaga', '🅿️'],
  ['kg', 'cravo', '', 'gravo', ''],
  ['fv', 'faca', '🔪', 'vaca', '🐄'], ['fv', 'fila', '', 'vila', '🏘️'], ['fv', 'foto', '📷', 'voto', '🗳️'],
  ['fv', 'fala', '🗣️', 'vala', ''], ['fv', 'feio', '👹', 'veio', ''], ['fv', 'fé', '🙏', 'vê', '👀'],
];
const SEED_VERSION = 2;
const sameText = (x, y) => x.trim().toLowerCase() === y.trim().toLowerCase();

const Bank = {
  pairs: [],
  recorded: new Set(),   // chaves das gravações: "idDoPar:a", "w:palavra", "s:ta", "f:frase", "snd:som"…
  async load() {
    this.pairs = (await DB.all('pairs')).map(normPair).sort((x, y) => (x.order || 0) - (y.order || 0));
    this.recorded = new Set(await DB.read('audio', s => s.getAllKeys()));
  },
  /** Coloca os pares iniciais. Roda uma vez por versão do banco inicial e nunca apaga nada. */
  async seed() {
    const seeded = await DB.kv('seeded', false);
    const ver = await DB.kv('seedVersion', seeded ? 1 : 0);
    if (ver >= SEED_VERSION) return;
    const pairs = (await DB.all('pairs')).map(normPair);
    const changed = new Set();
    const word = (text, emoji) => ({ text, emoji, img: null });
    let order = pairs.reduce((m, p) => Math.max(m, p.order || 0), 0);
    if (ver < 1) {
      DEFAULT_PAIRS.forEach(([contrast, at, ae, bt, be], i) => {
        const p = { id: 'p' + (i + 1), contrast, a: word(at, ae), b: word(bt, be), figure: true, order: i + 1, groups: ['pequenos', 'detetives'] };
        pairs.push(p);
        changed.add(p);
      });
      order = DEFAULT_PAIRS.length;
    } else {
      // Atualização da versão 1: os pares originais que a fono não mudou passam a valer também para os Detetives.
      DEFAULT_PAIRS.forEach(([, at, , bt], i) => {
        const p = pairs.find(x => x.id === 'p' + (i + 1));
        if (p && sameText(p.a.text, at) && sameText(p.b.text, bt) && !p.groups.includes('detetives')) {
          p.groups = [...p.groups, 'detetives'];
          changed.add(p);
        }
      });
    }
    DETECTIVE_PAIRS.forEach(([contrast, at, ae, bt, be], i) => {
      const found = pairs.find(x => sameText(x.a.text, at) && sameText(x.b.text, bt));
      if (found) {
        if (!found.groups.includes('detetives')) { found.groups = [...found.groups, 'detetives']; changed.add(found); }
        return;
      }
      const p = { id: 'd' + (i + 1), contrast, a: word(at, ae), b: word(bt, be), figure: !!(ae && be), order: ++order, groups: ['detetives'] };
      pairs.push(p);
      changed.add(p);
    });
    await DB.write(['pairs', 'kv'], t => {
      changed.forEach(p => t.objectStore('pairs').put(p));
      t.objectStore('kv').put({ key: 'seeded', value: true });
      t.objectStore('kv').put({ key: 'seedVersion', value: SEED_VERSION });
    });
  },
  inGroup(gid) { return this.pairs.filter(p => p.groups.includes(gid)); },
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
  s.trialsBy = Object.assign({}, saved.trialsBy || {});
  s.packs = Object.assign({}, saved.packs || {});
  // Ajustes da versão 1: os "modos ativos" viram o pacote padrão dos Pequenos Ouvintes.
  if (saved.modes && !s.packs.pequenos) s.packs.pequenos = { ...saved.modes };
  delete s.modes;
  delete s.trials;
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

function showUpdateWait() {
  $('#app').replaceChildren(h('div', { class: 'update-wait' },
    h('div', { class: 'logo', html: critter({ color: '#3a86ff', shape: 'round', cls: 'logo-critter' }) }),
    h('h1', null, 'Atualizando o Escuta Só!…'),
    h('p', null, 'A versão antiga do jogo ainda está aberta em outra aba ou janela. Feche o Escuta Só! nas outras abas (ou feche o app e abra de novo) para terminar a atualização.'),
    h('p', { class: 'muted' }, 'Seus dados estão guardados: nada foi apagado.')));
}

InitHooks.push(async () => {
  DB.onBlocked = showUpdateWait;
  await DB.open();
  await Bank.seed();
  await Bank.load();
  await loadSettings();
  const last = await DB.kv('lastGroup', null);
  if (AGE_GROUPS[last]) State.group = last;
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

/** Converte um passo de som em item tocável. Passos aceitos: { pair, side } ou { key, text, synth }. */
function itemOf(s) {
  if (s.pair) return { key: s.pair.id + ':' + s.side, text: s.pair[s.side].text };
  return s;
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
  /** Toca uma gravação. fx (opcional, Detetives do Som), aplicados por código sobre a gravação da fono:
   *    noise:   { type: 'babble'|'rain'|'party', snr }  ruído de fundo com relação sinal/ruído em dB
   *    lowpass: frequência de corte em Hz                som abafado
   *    gate:    { rate, duty }                           cortes curtos de silêncio (duty = fração cortada)
   *    pan:     -1 (esquerda) … 1 (direita)              um ouvido só */
  playBuffer(buf, fx = null) {
    return new Promise(resolve => {
      const ctx = AudioEngine.ctx;
      const t0 = ctx.currentTime + 0.03;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      let node = src;
      let lead = 0;
      let tail = 0;
      const extra = [];
      const bus = ctx.createGain();
      bus.connect(AudioEngine.master);
      if (fx && fx.lowpass) {
        for (let i = 0; i < 2; i++) {            // dois filtros em série: corte mais íngreme
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = fx.lowpass;
          f.Q.value = 0.7;
          node.connect(f);
          node = f;
        }
      }
      if (fx && fx.gate) {
        const gg = ctx.createGain();
        const period = 1 / fx.gate.rate;
        const off = period * fx.gate.duty;
        gg.gain.setValueAtTime(1, t0);
        for (let t = t0 + period - off; t < t0 + buf.duration; t += period) {
          gg.gain.setValueAtTime(1, t);
          gg.gain.linearRampToValueAtTime(0, t + 0.004);
          gg.gain.setValueAtTime(0, t + off - 0.004);
          gg.gain.linearRampToValueAtTime(1, t + off);
        }
        node.connect(gg);
        node = gg;
      }
      if (fx && fx.pan != null) {
        // ChannelMerger funciona em todos os navegadores (StereoPanner não existe em Safari antigo).
        const merger = ctx.createChannelMerger(2);
        node.connect(merger, 0, fx.pan < 0 ? 0 : 1);
        node = merger;
      }
      if (fx && fx.noise) {
        const g = Math.pow(10, -fx.noise.snr / 20);       // ganho do ruído em relação à fala
        const scale = Math.min(1, 1.15 / (1 + g));       // abaixa os dois juntos para não distorcer
        lead = 0.5;
        tail = 0.35;
        const ns = NoiseGen.source(ctx, fx.noise.type);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t0);
        ng.gain.exponentialRampToValueAtTime(g * scale, t0 + 0.15);
        ng.gain.setValueAtTime(g * scale, t0 + lead + buf.duration + tail - 0.15);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + lead + buf.duration + tail);
        ns.connect(ng);
        ng.connect(bus);
        ns.start(t0, Math.random() * 3);
        ns.stop(t0 + lead + buf.duration + tail + 0.05);
        extra.push(ns);
        const sg = ctx.createGain();
        sg.gain.value = scale;
        node.connect(sg);
        node = sg;
      }
      node.connect(bus);
      this.sources.add(src);
      extra.forEach(x => this.sources.add(x));
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.sources.delete(src);
        extra.forEach(x => this.sources.delete(x));
        setTimeout(() => { try { bus.disconnect(); } catch (_) { /* ok */ } }, 200);
        resolve();
      };
      src.start(t0 + lead);
      setTimeout(finish, (lead + buf.duration + tail) * 1000 + 80);
    });
  },
  /** Duas gravações ao mesmo tempo, uma em cada ouvido (escuta dicótica). */
  async dual(left, right) {
    await AudioEngine.resume();
    const [bl, br] = await Promise.all([this.buffer(left.key), this.buffer(right.key)]);
    if (!bl || !br) return true;
    await Promise.all([this.playBuffer(bl, { pan: -1 }), this.playBuffer(br, { pan: 1 })]);
    return false;
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
  /** Toca uma palavra de um par. Devolve true se precisou usar a voz sintética. */
  word(pair, side) { return this.item(itemOf({ pair, side })); },
  /** Toca qualquer item: { key, text, synth?, fx? }. Ordem: gravação da fono → som sintetizado → voz sintética.
   *  Devolve true se precisou usar a voz sintética. */
  async item(it, fx = null) {
    await AudioEngine.resume();
    const buf = it.key && Bank.recorded.has(it.key) ? await this.buffer(it.key) : null;
    if (buf && AudioEngine.ctx) { await this.playBuffer(buf, fx); return false; }
    if (it.synth && AudioEngine.ctx) { await Synth.play(it.synth); return false; }
    await this.speakWithFx(it.text, fx);
    return true;
  },
  /** Voz sintética: os efeitos não se aplicam a ela (só o ruído de fundo, tocado junto). */
  async speakWithFx(text, fx) {
    if (!fx || !fx.noise || !AudioEngine.ctx) return this.speak(text);
    const ctx = AudioEngine.ctx;
    const ns = NoiseGen.source(ctx, fx.noise.type);
    const ng = ctx.createGain();
    ng.gain.value = Math.min(1.2, 0.6 * Math.pow(10, -fx.noise.snr / 20));
    ns.connect(ng);
    ng.connect(AudioEngine.master);
    ns.start();
    this.sources.add(ns);
    await sleep(450);
    await this.speak(text);
    await sleep(250);
    try { ns.stop(); } catch (_) { /* ok */ }
    this.sources.delete(ns);
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
      tts = (await this.item(itemOf(s), s.fx)) || tts;
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

/* ---------- aba "Gravar palavras": organizada por faixa e por par ---------- */
FonoTabs.push({ id: 'gravar', label: 'Gravar palavras', icon: '🎙️', order: 2, render: renderRecordTab });
let recGroup = null;

/** O que pode ser gravado em cada faixa, em seções. count: entra no contador "faltam gravar". */
function recordSections(gid) {
  const out = [];
  const pairs = Bank.inGroup(gid);
  out.push({ id: 'pairs', title: 'Pares surdo × sonoro', count: true, pairs });
  if (gid === 'pequenos') {
    const word = w => ({ key: wordKey(w.text), text: w.text, fig: wordFig(w) });
    out.push({ id: 'rhyme', title: 'Palavras do “Qual rima?”', count: true, items: ACTIVITY_WORDS.rhyme().map(word) });
    out.push({ id: 'onset', title: 'Palavras do “Mesmo começo”', count: true, items: ACTIVITY_WORDS.onset().map(word) });
    out.push({ id: 'claps', title: 'Palavras do “Bate palminhas”', count: true, items: ACTIVITY_WORDS.claps().map(word) });
    out.push({
      id: 'sounds', title: 'Sons do “Que som é esse?” e do “O bicho sumiu”', count: false,
      note: 'Opcional: os sons já vêm prontos (sintetizados). Grave por cima se quiser usar sons de verdade; apagando a gravação, volta o som pronto.',
      items: Object.entries(SOUNDS).map(([id, s]) => ({ key: 'snd:' + id, text: s.name, synth: id, fig: h('span', { class: 'fig-emoji' }, s.emoji), maxMs: 4000 })),
    });
  } else {
    const cs = CONTRAST_ORDER.filter(c => SYLLABLES[c] && pairs.some(p => p.contrast === c));
    out.push({
      id: 'syl', title: 'Sílabas do “Código secreto”', count: true,
      items: cs.flatMap(c => SYLLABLES[c].map((s, i) => ({ key: 's:' + s[0], text: s[0], sub: CONTRASTS[c].short, fig: h('span', { class: 'syl-fig' }, s[0].toUpperCase()), tts: s[1] }))),
    });
    out.push({
      id: 'sent', title: 'Frases da “Frase maluca”', count: false,
      note: 'Opcional: grave a frase inteira, já com a palavra trocada. Sem gravação, o jogo junta as suas gravações das palavras e usa a voz sintética só no que faltar.',
      items: SENTENCES.map(s => ({ key: 'f:' + s.id, text: sentenceText(s), sub: CONTRASTS[s.contrast].short + ' · trocada: ' + sentenceWrong(s), sentence: s, maxMs: 8000 })),
    });
  }
  return out;
}
const sectionKeys = sec => (sec.pairs ? sec.pairs.flatMap(p => [p.id + ':a', p.id + ':b']) : sec.items.map(i => i.key));

async function renderRecordTab(el) {
  let leaving = false;
  let active = null;            // gravação em andamento: { key, stop }
  onLeave(() => { leaving = true; if (active) active.stop(); });
  const canRecord = Recorder.supported();
  if (!AGE_GROUPS[recGroup]) recGroup = State.group;
  const seg = h('div', { class: 'seg-group wide', role: 'tablist' });
  const summary = h('div', { class: 'rec-summary' });
  const list = h('div', { class: 'pair-list' });
  let sections = [];

  add(el, [
    h('div', { class: 'tab-head' },
      h('h2', null, 'Gravar palavras'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editPairDialog(null, draw, recGroup) }, '➕ Novo par')),
    seg,
    summary,
    !canRecord && h('div', { class: 'banner warn' }, 'Este navegador não permite gravar áudio. No iPad use o Safari e no Android use o Chrome, ambos atualizados.'),
    h('details', { class: 'tips' },
      h('summary', null, 'Dicas para gravar'),
      h('ul', null,
        h('li', null, 'Grave num lugar silencioso, com o tablet a uns 20 cm da boca.'),
        h('li', null, 'Toque em Gravar, diga a palavra e toque em Parar (a gravação para sozinha depois de 4 segundos; frases, depois de 8).'),
        h('li', null, 'O silêncio do começo e do fim é cortado automaticamente e o volume é igualado.'),
        h('li', null, 'Grave as duas palavras de um par em seguida, com a mesma entonação e intensidade, para que a única diferença seja o vozeamento.'),
        h('li', null, 'Ruído, filtro e som em um ouvido só (Detetives do Som) são aplicados por código sobre a sua gravação: não precisa gravar versões extras.'),
        h('li', null, 'Os pares que aparecem nas duas faixas usam a mesma gravação.'))),
    list,
  ]);

  function paintSeg() {
    seg.replaceChildren(...GROUP_ORDER.map(id => h('button', {
      class: 'seg' + (id === recGroup ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === recGroup),
      onclick: () => { if (active) return; recGroup = id; paintSeg(); draw(); },
    }, `${AGE_GROUPS[id].icon} ${AGE_GROUPS[id].name}`)));
  }

  function updateSummary() {
    const keys = new Set(sections.filter(s => s.count).flatMap(sectionKeys));
    const total = keys.size;
    const done = [...keys].filter(k => Bank.recorded.has(k)).length;
    summary.replaceChildren(
      h('div', { class: 'progress-line' }, h('div', { class: 'progress-fill', style: `width:${total ? (100 * done) / total : 0}%` })),
      h('p', null, done < total
        ? [h('strong', null, `Faltam ${total - done} de ${total} gravações nesta faixa. `),
          h('span', { class: 'muted' }, 'As que faltam usam a voz sintética do aparelho, que é menos precisa para diferenciar surdo × sonoro.')]
        : h('strong', null, `Tudo gravado nesta faixa (${total})! 🎉`)));
    list.querySelectorAll('[data-sec]').forEach(sum => {
      const sec = sections.find(s => s.id === sum.dataset.sec);
      if (sec) sum.querySelector('.sec-count').replaceChildren(missingBadge(sectionKeys(sec)));
    });
    list.querySelectorAll('[data-contrast]').forEach(t => {
      const keys = Bank.inGroup(recGroup).filter(p => p.contrast === t.dataset.contrast).flatMap(p => [p.id + ':a', p.id + ':b']);
      t.querySelector('.sec-count').replaceChildren(missingBadge(keys));
    });
  }
  function missingBadge(keys) {
    const miss = keys.filter(k => !Bank.recorded.has(k)).length;
    return miss ? h('span', { class: 'badge warn' }, `faltam ${miss} de ${keys.length}`) : h('span', { class: 'badge fig' }, `✔ ${keys.length} gravadas`);
  }

  function draw() {
    list.replaceChildren();
    sections = recordSections(recGroup);
    for (const sec of sections) {
      const body = h('div', { class: 'sec-body' });
      if (sec.note) body.append(h('p', { class: 'muted small' }, sec.note));
      if (sec.pairs) {
        for (const cid of CONTRAST_ORDER) {
          const pairs = sec.pairs.filter(p => p.contrast === cid);
          if (!pairs.length) continue;
          body.append(h('h3', { class: 'group-title', 'data-contrast': cid }, contrastChip(cid), ' ', h('span', { class: 'sec-count' })), ...pairs.map(pairCard));
        }
        if (!sec.pairs.length) body.append(h('p', { class: 'empty' }, 'Nenhum par nesta faixa. Toque em “Novo par”.'));
      } else {
        body.append(h('div', { class: 'pair-card' }, sec.items.map(it => recRow(it))));
      }
      list.append(h('details', { class: 'rec-sec', open: sec.id === 'pairs' },
        h('summary', { 'data-sec': sec.id }, h('span', { class: 'sec-title' }, sec.title), ' ', h('span', { class: 'sec-count' })),
        body));
    }
    updateSummary();
  }

  function pairCard(pair) {
    const shared = pair.groups.length > 1;
    return h('article', { class: 'pair-card' },
      h('div', { class: 'pair-head' },
        recGroup === 'pequenos' && h('span', { class: 'badge ' + (pair.figure ? 'fig' : 'sound') }, pair.figure ? '🖼️ tem figura' : '👂 só som'),
        shared && h('span', { class: 'badge' }, 'nas duas faixas'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => editPairDialog(pair, draw, recGroup) }, '✏️ Editar')),
      recRow({ key: pair.id + ':a', text: pair.a.text, fig: figureEl(pair, 'a'), sub: pair.contrast !== 'outro' && 'surda' }),
      recRow({ key: pair.id + ':b', text: pair.b.text, fig: figureEl(pair, 'b'), sub: pair.contrast !== 'outro' && 'sonora' }));
  }

  /** Uma linha de gravação: figura, texto, situação, medidor e botões. */
  function recRow(it) {
    const key = it.key;
    const status = h('span', { class: 'rec-status' });
    const fill = h('span', { class: 'meter-fill' });
    const recBtn = h('button', { class: 'btn rec-btn', type: 'button', disabled: !canRecord });
    const playBtn = h('button', { class: 'btn', type: 'button' }, '▶️ Ouvir');
    const delBtn = h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Apagar gravação', title: 'Apagar gravação' }, '🗑️');
    const row = h('div', { class: 'word-row' + (it.sentence ? ' sentence-row' : '') },
      h('div', { class: 'word-fig' }, it.fig || h('span', { class: 'fig-emoji' }, '💬')),
      h('div', { class: 'word-info' },
        h('span', { class: 'word-text' }, it.text),
        it.sub && h('span', { class: 'muted small' }, it.sub),
        status),
      h('span', { class: 'meter', 'aria-hidden': 'true' }, fill),
      h('div', { class: 'word-actions' }, recBtn, playBtn, delBtn));
    const playSteps = () => (it.sentence ? sentenceSteps(it.sentence) : [{ key, text: it.tts || it.text, synth: it.synth }]);

    function paint(state = '') {
      const has = Bank.recorded.has(key);
      status.className = 'rec-status ' + (state === 'rec' ? 'recording' : has ? 'ok' : it.synth ? 'ok' : 'none');
      status.textContent = state === 'rec' ? '● gravando…' : state === 'proc' ? 'recortando…' : has ? '✔ voz gravada' : it.synth ? 'som pronto' : 'sem gravação';
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
        const ctl = await Recorder.start({ maxMs: it.maxMs || 4000, onLevel: p => { fill.style.transform = `scaleX(${Math.min(1, p * 1.6)})`; } });
        active = { key, stop: ctl.stop };
        paint('rec');
        const blob = await ctl.done;
        active = null;
        if (leaving) return;
        paint('proc');
        const res = await processRecording(blob);
        if (!res) { paint(); toast('Não deu para ouvir. Fale um pouco mais perto do aparelho e tente de novo.', 4500); return; }
        await saveRecording(key, res);
        paint();
        updateSummary();
        await Sound.sequence([{ key, text: it.text }]);
      } catch (e) {
        active = null;
        paint();
        micError(e);
      }
    };
    playBtn.onclick = async () => {
      if (active) return;
      const r = await Sound.sequence(playSteps(), 60);
      if (r.tts && !r.cancelled) toast('Sem gravação: essa foi a voz sintética do aparelho.');
    };
    delBtn.onclick = async () => {
      if (!(await confirmBox(`Apagar a gravação de “${it.text}”?`, { ok: 'Apagar', danger: true }))) return;
      await deleteRecording(key);
      paint();
      updateSummary();
    };
    paint();
    return row;
  }

  paintSeg();
  draw();
}

/* ---------- editar / criar par ---------- */
function editPairDialog(pair, onDone, editGroup = null) {
  const isNew = !pair;
  const d = isNew
    ? {
      id: uid(), contrast: 'pb', figure: true, groups: [editGroup || DEFAULT_GROUP],
      order: Bank.pairs.reduce((m, p) => Math.max(m, p.order || 0), 0) + 1,
      a: { text: '', emoji: '', img: null }, b: { text: '', emoji: '', img: null },
    }
    : { ...normPair(pair), a: { ...pair.a }, b: { ...pair.b } };
  const groupChecks = GROUP_ORDER.map(id => {
    const cb = h('input', { type: 'checkbox', checked: d.groups.includes(id) });
    cb.dataset.gid = id;
    return h('label', { class: 'check' }, cb, h('span', null, `${AGE_GROUPS[id].icon} ${AGE_GROUPS[id].name}`));
  });

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
    d.groups = groupChecks.map(l => l.querySelector('input')).filter(cb => cb.checked).map(cb => cb.dataset.gid);
    if (!d.groups.length) { toast('Marque pelo menos uma faixa.'); return; }
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
    h('div', { class: 'field' }, h('span', null, 'Faixas que usam este par'), h('div', { class: 'row wrap' }, groupChecks)),
    h('div', { class: 'field' },
      h('span', null, 'Uso nos jogos (Pequenos Ouvintes)'),
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

async function allChildren() {
  return (await DB.all('children')).map(normKid).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
}
async function allSessions() {
  return (await DB.all('sessions')).map(normSession);
}
async function sessionsOf(childId, gid = null) {
  return (await allSessions()).filter(s => s.childId === childId && (!gid || s.group === gid)).sort((a, b) => a.date.localeCompare(b.date));
}
/** Pares escolhidos pela fono para a criança numa faixa (padrão: os pares-alvo da faixa). */
async function roundPairIds(childId, gid) {
  let saved = await DB.kv(`round:${childId}:${gid}`, null);
  if (!Array.isArray(saved) && gid === 'pequenos') saved = await DB.kv('round:' + childId, null);   // versão 1
  if (Array.isArray(saved)) return saved;
  const G = groupOf(gid);
  return Bank.inGroup(gid).filter(p => G.targets.includes(p.contrast)).map(p => p.id);
}
function saveRoundPairIds(childId, gid, ids) { return DB.setKv(`round:${childId}:${gid}`, ids); }
async function pairsForActivity(def, childId, gid) {
  const ids = new Set(await roundPairIds(childId, gid));
  return Bank.inGroup(gid).filter(p => ids.has(p.id)
    && (!def.needsFigure || p.figure)
    && (!def.needsAudio || (Bank.hasAudio(p, 'a') && Bank.hasAudio(p, 'b'))));
}
/** Atividades ligadas para a criança: escolha individual da fono → pacote padrão da faixa → padrão do jogo. */
async function childActs(childId, gid) { return DB.kv(`acts:${childId}:${gid}`, null); }
function packOn(gid, id) {
  const G = groupOf(gid);
  const pack = State.settings.packs[gid] || {};
  return id in pack ? !!pack[id] : !G.offByDefault.includes(id);
}
async function activitiesFor(childId, gid) {
  const G = groupOf(gid);
  const custom = await childActs(childId, gid);
  return G.activities.filter(id => ACTIVITIES[id])
    .filter(id => (custom && id in custom ? custom[id] : packOn(gid, id)))
    .map(id => ACTIVITIES[id]);
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
/* Mostra as crianças cadastradas na faixa escolhida (a faixa fica no cadastro;
 * a fono troca em Área da fono → Crianças ou → Rodada). */
Screens.who = {
  themed: true,
  async render(app, params, alive) {
    const G = groupOf(State.group);
    const kids = (await allChildren()).filter(k => kidGroup(k) === G.id);
    if (!alive()) return;
    if (!kids.length) { State.child = GUEST; go('menu'); return; }
    const pick = k => { State.child = k; Sound.chime('tap'); go('menu'); };
    const card = k => h('button', { class: 'who-card', type: 'button', 'aria-label': k.nick, onclick: () => pick(k) },
      h('span', { class: 'avatar big' }, k.avatar), h('span', { class: 'who-name' }, k.nick));
    add(app, [
      h('div', { class: 'topbar' },
        iconBtn('🏠', 'Início', () => go('start')),
        h('span', { class: 'group-chip' }, G.icon, ' ', G.name),
        h('div', { class: 'spacer' }), fonoButton()),
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

function dragHint(from, to) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const x0 = a.left + a.width / 2;
  const y0 = a.top + a.height / 2;
  const hand = h('div', {
    class: 'drag-hint', 'aria-hidden': 'true',
    style: `--x0:${x0}px;--y0:${y0}px;--dx:${b.left + b.width / 2 - x0}px;--dy:${b.top + b.height / 2 - y0}px`,
  }, '👆');
  document.body.append(hand);
  onLeave(() => hand.remove());
  setTimeout(() => hand.remove(), 3800);
}

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

Object.assign(ACTIVITIES, {
  /* 1. IGUAL OU DIFERENTE: duas palavras com pausa; a criança escolhe os bichinhos iguais ou diferentes. */
  same: {
    id: 'same',
    name: 'Igual ou diferente?',
    icon: '👯',
    desc: 'Discriminação auditiva: duas palavras (iguais ou do par mínimo) e a criança diz se são iguais ou diferentes.',
    needsFigure: false,
    build: (ctx, n) => buildTrials('same', ctx.pairs, n),
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
    icon: '👉',
    desc: 'Identificação: ouve uma palavra do par e aponta a figura certa.',
    needsFigure: true,
    build: (ctx, n) => buildTrials('which', ctx.pairs, n),
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
    icon: '🐾',
    desc: 'Identificação com ação: o bichinho pede uma palavra e a criança arrasta a figura até ele.',
    needsFigure: true,
    build: (ctx, n) => buildTrials('drag', ctx.pairs, n),
    art: () => `<span class="art-drag">${critter(HELPERS[0])}<span class="mini-card tilt">🧀</span></span>`,
    async run(trial, g) {
      const { pair, target, targetLeft } = trial;
      const sides = targetLeft ? [target, other(target)] : [other(target), target];
      const talkBtn = h('button', { class: 'buddy-bubble', type: 'button', 'aria-label': 'Ouvir de novo', html: SPEAKER_SVG });
      const body = h('div', { class: 'buddy-body', html: critter(g.helper) });
      const buddy = h('div', { class: 'buddy' }, body, talkBtn);
      const cards = sides.map(s => h('button', { class: 'answer fig-card draggable', type: 'button', 'aria-label': pair[s].text }, figureEl(pair, s)));
      const cardRow = h('div', { class: 'cards' }, cards);
      g.stage.replaceChildren(buddy, cardRow);
      let replays = -1;
      let answered = false;
      const listen = async () => {
        if (answered) return;
        replays++;
        buddy.classList.add('talking');
        const r = await g.play([{ pair, side: target }]);
        if (r.cancelled) return;
        buddy.classList.remove('talking');
        g.lock('');
        // Na primeira rodada, uma mãozinha mostra o gesto (sem apontar para nenhuma figura).
        if (g.showDragHint) { g.showDragHint = false; dragHint(cardRow, body); }
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

/* =========================================================================
 * 3b. PEQUENOS OUVINTES: ATIVIDADES NOVAS
 * ========================================================================= */

/* ---------- sons não verbais, sintetizados com Web Audio ----------
 * Cada som pode ser substituído por uma gravação da fono (chave "snd:<id>"). */
const SOUNDS = {
  dog: { name: 'cachorro', emoji: '🐶', tts: 'au au', animal: true },
  cat: { name: 'gato', emoji: '🐱', tts: 'miau', animal: true },
  cow: { name: 'vaca', emoji: '🐮', tts: 'muuu', animal: true },
  duck: { name: 'pato', emoji: '🦆', tts: 'quá quá', animal: true },
  bird: { name: 'passarinho', emoji: '🐦', tts: 'piu piu', animal: true },
  horn: { name: 'buzina', emoji: '🚗', tts: 'bi bi' },
  bell: { name: 'sino', emoji: '🔔', tts: 'dlim dlom' },
  rain: { name: 'chuva', emoji: '🌧️', tts: 'chuá' },
  phone: { name: 'telefone', emoji: '☎️', tts: 'trim trim' },
};
const ANIMALS = Object.keys(SOUNDS).filter(id => SOUNDS[id].animal);
const soundItem = id => ({ key: 'snd:' + id, text: SOUNDS[id].tts, synth: id });

const Synth = {
  noiseBuf: null,
  noise(ctx) {
    if (!this.noiseBuf) {
      const n = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  },
  /** Envelope: sobe em `a` segundos até `peak`, fica até `hold` e cai até `end`. */
  env(param, t, a, peak, hold, end) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + hold);
    param.exponentialRampToValueAtTime(0.0001, t + end);
  },
  /** Fonte "vocal": oscilador → filtros de formante → envelope. */
  voice(ctx, out, t, { type = 'sawtooth', f0, formants, a = 0.02, hold, end, peak = 0.35 }) {
    const o = ctx.createOscillator();
    o.type = type;
    f0(o.frequency, t);
    const g = ctx.createGain();
    this.env(g.gain, t, a, peak, hold, end);
    formants.forEach(([f, q, lvl, sweep]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      if (sweep) sweep(bp.frequency, t); else bp.frequency.value = f;
      const fg = ctx.createGain();
      fg.gain.value = lvl;
      o.connect(bp);
      bp.connect(fg);
      fg.connect(g);
    });
    g.connect(out);
    o.start(t);
    o.stop(t + end + 0.05);
    return o;
  },
  defs: {
    dog(ctx, out, t) {
      [0, 0.34].forEach(dt => {
        Synth.voice(ctx, out, t + dt, {
          f0: (p, s) => { p.setValueAtTime(560, s); p.exponentialRampToValueAtTime(280, s + 0.17); },
          formants: [[900, 1.4, 1], [2200, 3, 0.4]], a: 0.008, hold: 0.04, end: 0.2, peak: 0.6,
        });
        const n = Synth.noise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1;
        const g = ctx.createGain();
        Synth.env(g.gain, t + dt, 0.004, 0.25, 0.01, 0.06);
        n.connect(bp); bp.connect(g); g.connect(out);
        n.start(t + dt); n.stop(t + dt + 0.08);
      });
      return 0.62;
    },
    cat(ctx, out, t) {
      Synth.voice(ctx, out, t, {
        f0: (p, s) => { p.setValueAtTime(430, s); p.linearRampToValueAtTime(760, s + 0.28); p.linearRampToValueAtTime(480, s + 0.8); },
        formants: [
          [0, 3, 1, (p, s) => { p.setValueAtTime(700, s); p.linearRampToValueAtTime(2000, s + 0.22); p.linearRampToValueAtTime(850, s + 0.75); }],
          [2800, 5, 0.25],
        ],
        a: 0.06, hold: 0.6, end: 0.85, peak: 0.55,
      });
      return 0.9;
    },
    cow(ctx, out, t) {
      Synth.voice(ctx, out, t, {
        f0: (p, s) => { p.setValueAtTime(118, s); p.linearRampToValueAtTime(128, s + 0.4); p.linearRampToValueAtTime(96, s + 1.2); },
        formants: [[300, 1.2, 1.2], [650, 2.5, 0.6]],
        a: 0.18, hold: 0.9, end: 1.3, peak: 0.7,
      });
      return 1.35;
    },
    duck(ctx, out, t) {
      [0, 0.24].forEach(dt => Synth.voice(ctx, out, t + dt, {
        type: 'square',
        f0: (p, s) => { p.setValueAtTime(300, s); p.exponentialRampToValueAtTime(220, s + 0.15); },
        formants: [[1100, 6, 1], [2500, 6, 0.6]], a: 0.01, hold: 0.06, end: 0.17, peak: 0.6,
      }));
      return 0.48;
    },
    bird(ctx, out, t) {
      const chirp = (s, f1, f2, d) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f1, s);
        o.frequency.exponentialRampToValueAtTime(f2, s + d);
        const g = ctx.createGain();
        Synth.env(g.gain, s, 0.01, 0.3, d * 0.6, d);
        o.connect(g); g.connect(out);
        o.start(s); o.stop(s + d + 0.02);
      };
      [0, 0.15, 0.3].forEach(dt => chirp(t + dt, 2600, 4300, 0.09));
      [0.5, 0.56, 0.62, 0.68].forEach(dt => chirp(t + dt, 3800, 3300, 0.045));
      return 0.78;
    },
    horn(ctx, out, t) {
      [[0, 0.32], [0.46, 0.9]].forEach(([s, e]) => [392, 494].forEach(f => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 2200;
        const g = ctx.createGain();
        Synth.env(g.gain, t + s, 0.02, 0.16, e - s - 0.03, e - s);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(t + s); o.stop(t + e + 0.02);
      }));
      return 0.95;
    },
    bell(ctx, out, t) {
      [[0, 660], [0.75, 523]].forEach(([dt, base]) => [[1, 0.5, 2.2], [2, 0.25, 1.4], [2.4, 0.2, 1.1], [3, 0.12, 0.9], [4.5, 0.08, 0.6]].forEach(([m, lvl, dec]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * m;
        const g = ctx.createGain();
        Synth.env(g.gain, t + dt, 0.003, lvl, 0.004, dec);
        o.connect(g); g.connect(out);
        o.start(t + dt); o.stop(t + dt + dec + 0.05);
      }));
      return 2.4;
    },
    rain(ctx, out, t) {
      const dur = 2.2;
      const n = Synth.noise(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 700;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.5);
      g.gain.setValueAtTime(0.2, t + dur - 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
      n.start(t); n.stop(t + dur + 0.05);
      for (let i = 0; i < 28; i++) {
        const s = t + 0.2 + Math.random() * (dur - 0.5);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(1800 + Math.random() * 2500, s);
        o.frequency.exponentialRampToValueAtTime(900, s + 0.03);
        const dg = ctx.createGain();
        Synth.env(dg.gain, s, 0.002, 0.06 + Math.random() * 0.08, 0.004, 0.035);
        o.connect(dg); dg.connect(out);
        o.start(s); o.stop(s + 0.05);
      }
      return dur;
    },
    phone(ctx, out, t) {
      [0, 0.6].forEach(dt => {
        const g = ctx.createGain();
        g.gain.value = 0;
        const trem = ctx.createOscillator();
        trem.frequency.value = 22;
        const tg = ctx.createGain();
        tg.gain.value = 0.1;
        trem.connect(tg); tg.connect(g.gain);
        [1150, 1450].forEach(f => {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          const og = ctx.createGain();
          Synth.env(og.gain, t + dt, 0.01, 1, 0.38, 0.42);
          o.connect(og); og.connect(g);
          o.start(t + dt); o.stop(t + dt + 0.45);
        });
        g.connect(out);
        trem.start(t + dt); trem.stop(t + dt + 0.45);
      });
      return 1.05;
    },
    drum(ctx, out, t) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      const g = ctx.createGain();
      Synth.env(g.gain, t, 0.003, 0.9, 0.01, 0.22);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.25);
      return 0.22;
    },
  },
  /** Toca um som sintetizado e espera terminar (Sound.stop() interrompe). */
  play(id) {
    const ctx = AudioEngine.ensure();
    const def = this.defs[id];
    if (!ctx || !def) return sleep(300);
    const bus = ctx.createGain();
    bus.connect(AudioEngine.master);
    const dur = def(ctx, bus, ctx.currentTime + 0.03);
    const handle = { stop: () => { try { bus.disconnect(); } catch (_) { /* ok */ } } };
    Sound.sources.add(handle);
    return new Promise(resolve => setTimeout(() => { Sound.sources.delete(handle); handle.stop(); resolve(); }, dur * 1000 + 80));
  },
  /** Batida curta (não espera). */
  tap(id = 'drum') {
    const ctx = AudioEngine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const bus = ctx.createGain();
    bus.connect(AudioEngine.master);
    this.defs[id](ctx, bus, ctx.currentTime + 0.01);
    setTimeout(() => { try { bus.disconnect(); } catch (_) { /* ok */ } }, 600);
  },
};

/* ---------- palavras das atividades (gravadas pela fono com a chave "w:<palavra>") ---------- */
function wordKey(text) {
  return 'w:' + text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const W = (text, emoji) => ({ text, emoji });
const wordItem = w => ({ key: wordKey(w.text), text: w.text });
const wordFig = w => h('span', { class: 'fig-emoji', 'aria-hidden': 'true' }, w.emoji);

const RHYME_SETS = [
  { model: W('pão', '🍞'), match: W('mão', '✋'), others: [W('bola', '⚽'), W('gato', '🐱')] },
  { model: W('gato', '🐱'), match: W('pato', '🦆'), others: [W('sol', '☀️'), W('casa', '🏠')] },
  { model: W('janela', '🪟'), match: W('panela', '🍲'), others: [W('carro', '🚗'), W('uva', '🍇')] },
  { model: W('rato', '🐭'), match: W('sapato', '👞'), others: [W('lua', '🌙'), W('bola', '⚽')] },
  { model: W('cão', '🐶'), match: W('avião', '✈️'), others: [W('pé', '🦶'), W('flor', '🌸')] },
  { model: W('chinelo', '🩴'), match: W('martelo', '🔨'), others: [W('uva', '🍇'), W('sol', '☀️')] },
  { model: W('abelha', '🐝'), match: W('orelha', '👂'), others: [W('peixe', '🐟'), W('mesa', '🪑')] },
  { model: W('bota', '👢'), match: W('gota', '💧'), others: [W('casa', '🏠'), W('dado', '🎲')] },
  { model: W('foguete', '🚀'), match: W('sorvete', '🍦'), others: [W('bola', '⚽'), W('gato', '🐱')] },
  { model: W('estrela', '⭐'), match: W('vela', '🕯️'), others: [W('sapo', '🐸'), W('uva', '🍇')] },
];
/* Mesmo começo: sons-alvo /p/ /b/ /t/ /d/; um dos distratores sempre começa com o par do som. */
const ONSET_SETS = [
  { contrast: 'pb', model: W('bola', '⚽'), match: W('boné', '🧢'), others: [W('pato', '🦆'), W('dado', '🎲')] },
  { contrast: 'pb', model: W('pato', '🦆'), match: W('pipoca', '🍿'), others: [W('banana', '🍌'), W('tomate', '🍅')] },
  { contrast: 'td', model: W('tomate', '🍅'), match: W('tartaruga', '🐢'), others: [W('dado', '🎲'), W('pipoca', '🍿')] },
  { contrast: 'td', model: W('dado', '🎲'), match: W('dente', '🦷'), others: [W('tênis', '👟'), W('bola', '⚽')] },
  { contrast: 'pb', model: W('banana', '🍌'), match: W('bota', '👢'), others: [W('pera', '🍐'), W('dinossauro', '🦕')] },
  { contrast: 'pb', model: W('peixe', '🐟'), match: W('pé', '🦶'), others: [W('boné', '🧢'), W('tesoura', '✂️')] },
  { contrast: 'td', model: W('tesoura', '✂️'), match: W('telefone', '☎️'), others: [W('dedo', '☝️'), W('pipoca', '🍿')] },
  { contrast: 'td', model: W('dinossauro', '🦕'), match: W('dedo', '☝️'), others: [W('tomate', '🍅'), W('bola', '⚽')] },
];
const CLAP_WORDS = [
  [W('pão', '🍞'), 1], [W('sol', '☀️'), 1], [W('flor', '🌸'), 1], [W('mar', '🌊'), 1], [W('trem', '🚂'), 1],
  [W('gato', '🐱'), 2], [W('bola', '⚽'), 2], [W('casa', '🏠'), 2], [W('uva', '🍇'), 2], [W('peixe', '🐟'), 2],
  [W('banana', '🍌'), 3], [W('sapato', '👞'), 3], [W('macaco', '🐒'), 3], [W('cavalo', '🐴'), 3], [W('panela', '🍲'), 3],
  [W('borboleta', '🦋'), 4], [W('abacaxi', '🍍'), 4], [W('telefone', '☎️'), 4], [W('bicicleta', '🚲'), 4], [W('melancia', '🍉'), 4],
];
/** Todas as palavras avulsas de uma lista de conjuntos, sem repetir (para a aba de gravação). */
function uniqueWords(list) {
  const seen = new Map();
  for (const w of list) if (!seen.has(wordKey(w.text))) seen.set(wordKey(w.text), w);
  return [...seen.values()];
}
const ACTIVITY_WORDS = {
  rhyme: () => uniqueWords(RHYME_SETS.flatMap(s => [s.model, s.match, ...s.others])),
  onset: () => uniqueWords(ONSET_SETS.flatMap(s => [s.model, s.match, ...s.others])),
  claps: () => uniqueWords(CLAP_WORDS.map(([w]) => w)),
};

/** Posições equilibradas para a resposta certa entre k opções. */
const balancedPositions = (n, k) => shuffle(Array.from({ length: n }, (_, i) => i % k));
function cycle(list, n) {
  const out = [];
  while (out.length < n) {
    const next = shuffle(list);
    if (out.length && next[0] === out[out.length - 1] && next.length > 1) next.push(next.shift());
    out.push(...next);
  }
  out.length = n;
  return out;
}

/** Modelo + 3 figuras (Qual rima? e Mesmo começo): toca o modelo e depois cada opção. */
function buildModelTrials(sets, n) {
  const pos = balancedPositions(n, 3);
  return cycle(sets, n).map((set, i) => {
    const options = shuffle(set.others).slice(0, 2);
    options.splice(pos[i], 0, set.match);
    return { model: set.model, options, answer: pos[i], contrast: set.contrast || null };
  });
}
async function runModelChoice(trial, g, kind) {
  const { model, options, answer } = trial;
  const modelCard = h('button', { class: 'fig-card model-card', type: 'button', 'aria-label': 'Ouvir a palavra' }, wordFig(model));
  const cards = options.map(w => h('button', { class: 'answer fig-card', type: 'button', 'aria-label': w.text }, wordFig(w)));
  g.stage.replaceChildren(h('div', { class: 'model-row' }, modelCard, h('span', { class: 'model-ear', 'aria-hidden': 'true', html: SPEAKER_SVG })),
    h('div', { class: 'cards three' }, cards));
  const modelStep = () => ({ ...wordItem(model), el: modelCard });
  let replays = -1;
  const listen = async () => {
    replays++;
    const r = await g.play([modelStep(), ...options.map((w, i) => ({ ...wordItem(w), el: cards[i] }))], 'listen', 700);
    if (!r.cancelled) g.lock('');
  };
  g.replayBtn.onclick = listen;
  modelCard.onclick = async () => {
    if (g.stage.dataset.lock) return;
    const r = await g.play([modelStep()]);
    if (!r.cancelled) g.lock('');
  };
  listen();
  const idx = await g.choose(cards.map((c, i) => [c, i]));
  g.endInput([...cards, modelCard]);
  const correct = idx === answer;
  if (correct) await celebrate(cards[idx]);
  else await showCorrection(g, [modelStep(), { ...wordItem(options[answer]), el: cards[answer] }], cards[answer]);
  return {
    item: model.text, itemKey: `${kind}:${model.text}`, contrast: trial.contrast, words: model.text,
    expected: options[answer].text, answer: options[idx].text, correct, replays: Math.max(0, replays),
  };
}

const miniCards = (...emojis) => '<span class="art-cards">' + emojis.map(e => `<span class="mini-card">${e}</span>`).join('') + '</span>';

Object.assign(ACTIVITIES, {
  /* QUAL RIMA?: palavra-modelo e três figuras; uma rima com o modelo. */
  rhyme: {
    id: 'rhyme',
    name: 'Qual rima?',
    icon: '🎵',
    desc: 'Consciência fonológica (rima): ouve a palavra-modelo e escolhe, entre três figuras, a que rima.',
    usesPairs: false,
    art: () => miniCards('🍞', '✋'),
    build: (ctx, n) => buildModelTrials(RHYME_SETS, n),
    run: (trial, g) => runModelChoice(trial, g, 'rhyme'),
  },

  /* BATE PALMINHAS: toca uma palavra e a criança bate no tambor uma vez por sílaba. */
  claps: {
    id: 'claps',
    name: 'Bate palminhas',
    icon: '🥁',
    desc: 'Consciência silábica: ouve a palavra e bate no tambor uma vez por sílaba (1 a 4 sílabas).',
    usesPairs: false,
    art: () => '<span class="art-claps"><span class="mini-card">🥁</span><span class="beat-mini"><i></i><i></i><i></i></span></span>',
    build(ctx, n) {
      const byCount = [1, 2, 3, 4].map(c => shuffle(CLAP_WORDS.filter(([, s]) => s === c)));
      const counts = cycle([1, 2, 3, 4], n);
      const used = [0, 0, 0, 0];
      return counts.map(c => {
        const list = byCount[c - 1];
        const [word, syl] = list[used[c - 1]++ % list.length];
        return { word, syl };
      });
    },
    async run(trial, g) {
      const { word, syl } = trial;
      const wordCard = h('button', { class: 'fig-card model-card', type: 'button', 'aria-label': 'Ouvir a palavra' }, wordFig(word));
      const drum = h('button', { class: 'answer drum', type: 'button', 'aria-label': 'Tambor' }, h('span', { class: 'drum-face' }, '🥁'));
      const beats = h('div', { class: 'beats', 'aria-hidden': 'true' });
      const okBtn = h('button', { class: 'answer claps-ok', type: 'button', 'aria-label': 'Pronto', disabled: true }, '👍');
      const undoBtn = h('button', { class: 'answer claps-undo', type: 'button', 'aria-label': 'Apagar', disabled: true }, '↩️');
      g.stage.replaceChildren(
        h('div', { class: 'model-row' }, wordCard),
        h('div', { class: 'claps-row' }, undoBtn, drum, okBtn),
        beats);
      let taps = 0;
      const paint = () => {
        okBtn.disabled = taps === 0;
        undoBtn.disabled = taps === 0;
      };
      const addBeat = () => { const b = h('span', { class: 'beat' }); beats.append(b); return b; };
      drum.onclick = () => {
        if (taps >= 8) return;
        taps++;
        Synth.tap('drum');
        drum.classList.remove('hit'); void drum.offsetWidth; drum.classList.add('hit');
        addBeat();
        paint();
      };
      undoBtn.onclick = () => { if (!taps) return; taps--; beats.lastChild.remove(); paint(); };
      let replays = -1;
      const listen = async () => {
        replays++;
        const r = await g.play([{ ...wordItem(word), el: wordCard }]);
        if (!r.cancelled) g.lock('');
      };
      g.replayBtn.onclick = listen;
      wordCard.onclick = () => { if (!g.stage.dataset.lock) listen(); };
      listen();
      await g.choose([[okBtn, true]]);
      const answer = taps;
      g.endInput([drum, okBtn, undoBtn, wordCard]);
      const correct = answer === syl;
      if (correct) {
        await celebrate(beats);
      } else {
        // Mostra o jeito certo: toca a palavra e bate o tambor uma vez por sílaba.
        await sleep(450);
        if (!g.alive()) return null;
        beats.replaceChildren();
        await g.play([{ ...wordItem(word), el: wordCard }], 'busy');
        for (let i = 0; i < syl && g.alive(); i++) {
          await sleep(i ? 520 : 300);
          Synth.tap('drum');
          drum.classList.remove('hit'); void drum.offsetWidth; drum.classList.add('hit');
          addBeat().classList.add('demo');
        }
        await sleep(900);
      }
      return {
        item: word.text, itemKey: 'claps:' + word.text, contrast: null, words: word.text,
        expected: syl, answer, correct, replays: Math.max(0, replays),
      };
    },
  },

  /* MESMO COMEÇO: "qual começa igual a BOLA?" — três figuras, uma com o mesmo som inicial. */
  onset: {
    id: 'onset',
    name: 'Mesmo começo',
    icon: '🔤',
    desc: 'Consciência fonêmica (som inicial /p/ /b/ /t/ /d/): escolhe a figura que começa com o mesmo som do modelo; um distrator sempre começa com o par surdo/sonoro.',
    usesPairs: false,
    art: () => miniCards('⚽', '🧢'),
    build: (ctx, n) => buildModelTrials(ONSET_SETS, n),
    run: (trial, g) => runModelChoice(trial, g, 'onset'),
  },

  /* QUE SOM É ESSE?: som não verbal (sintetizado ou gravado) e três figuras. */
  sounds: {
    id: 'sounds',
    name: 'Que som é esse?',
    icon: '🔔',
    desc: 'Aquecimento e atenção auditiva: reconhece sons não verbais (bichos, buzina, sino, chuva, telefone).',
    usesPairs: false,
    art: () => miniCards('🔔', '🐶'),
    build(ctx, n) {
      const ids = Object.keys(SOUNDS);
      const pos = balancedPositions(n, 3);
      return cycle(ids, n).map((target, i) => {
        const options = shuffle(ids.filter(x => x !== target)).slice(0, 2);
        options.splice(pos[i], 0, target);
        return { target, options };
      });
    },
    async run(trial, g) {
      const { target, options } = trial;
      const cards = options.map(id => h('button', { class: 'answer fig-card', type: 'button', 'aria-label': SOUNDS[id].name },
        h('span', { class: 'fig-emoji', 'aria-hidden': 'true' }, SOUNDS[id].emoji)));
      const bubble = h('div', { class: 'bubble sound-bubble', html: SPEAKER_SVG });
      g.stage.replaceChildren(bubble, h('div', { class: 'cards three' }, cards));
      let replays = -1;
      const listen = async () => {
        replays++;
        const r = await g.play([{ ...soundItem(target), el: bubble }]);
        if (!r.cancelled) g.lock('');
      };
      g.replayBtn.onclick = listen;
      listen();
      const idx = await g.choose(cards.map((c, i) => [c, i]));
      g.endInput(cards);
      const right = cards[options.indexOf(target)];
      const correct = options[idx] === target;
      if (correct) await celebrate(right);
      else await showCorrection(g, [{ ...soundItem(target), el: right }], right);
      return {
        item: SOUNDS[target].name, itemKey: 'snd:' + target, contrast: null, words: SOUNDS[target].name,
        expected: SOUNDS[target].name, answer: SOUNDS[options[idx]].name, correct, replays: Math.max(0, replays),
      };
    },
  },

  /* O BICHO SUMIU: sequência de 2 ou 3 sons de bichos; a criança toca as figuras na mesma ordem. */
  memory: {
    id: 'memory',
    name: 'O bicho sumiu',
    icon: '🌳',
    desc: 'Memória auditiva sequencial: ouve 2 a 3 sons de bichos e toca as figuras na mesma ordem (sobe para 3 com 2 acertos seguidos).',
    usesPairs: false,
    art: () => '<span class="art-memory"><span class="mini-card">🌳</span><span class="mini-card peek">🐮</span><span class="mini-card">🌳</span></span>',
    adaptive: { kind: 'seq', start: 2, min: 2, max: 3, up: 2, down: 2, persist: false, label: l => `${l} bichos` },
    build: (ctx, n) => Array.from({ length: n }, () => ({})),
    async run(trial, g) {
      const len = g.adapt.level;
      const seq = shuffle(ANIMALS).slice(0, len);
      const shown = shuffle([...seq, ...shuffle(ANIMALS.filter(a => !seq.includes(a))).slice(0, 4 - len)]);
      const slots = seq.map(() => h('div', { class: 'bush' }, h('span', { class: 'bush-leaf', 'aria-hidden': 'true' }, '🌳')));
      const cards = shown.map(id => h('button', { class: 'answer fig-card small', type: 'button', 'aria-label': SOUNDS[id].name },
        h('span', { class: 'fig-emoji', 'aria-hidden': 'true' }, SOUNDS[id].emoji)));
      g.stage.replaceChildren(h('div', { class: 'bushes' }, slots), h('div', { class: 'cards four' }, cards));
      const steps = () => seq.map((id, i) => ({ ...soundItem(id), el: slots[i] }));
      let replays = -1;
      const listen = async () => {
        replays++;
        slots.forEach(s => s.classList.remove('filled'));
        const r = await g.play(steps(), 'listen', 450);
        if (!r.cancelled) g.lock('');
      };
      g.replayBtn.onclick = listen;
      listen();
      const answer = [];
      while (answer.length < len) {
        const idx = await g.choose(cards.map((c, i) => [c, i]));
        if (idx == null) return null;
        if (!answer.length) g.replayBtn.onclick = null;   // depois do primeiro toque não dá para ouvir de novo
        const id = shown[idx];
        Sound.chime('tap');
        const slot = slots[answer.length];
        slot.classList.add('filled');
        slot.replaceChildren(h('span', { class: 'fig-emoji pop', 'aria-hidden': 'true' }, SOUNDS[id].emoji));
        answer.push(id);
      }
      g.endInput(cards);
      const correct = answer.every((id, i) => id === seq[i]);
      if (correct) {
        await celebrate(slots[slots.length - 1].parentNode);
      } else {
        await sleep(600);
        if (!g.alive()) return null;
        slots.forEach((s, i) => s.replaceChildren(h('span', { class: 'bush-leaf', 'aria-hidden': 'true' }, '🌳')));
        await g.play(seq.map((id, i) => ({
          ...soundItem(id), el: slots[i],
          onStart: () => { slots[i].classList.add('filled'); slots[i].replaceChildren(h('span', { class: 'fig-emoji pop', 'aria-hidden': 'true' }, SOUNDS[id].emoji)); },
        })), 'busy', 450);
        await sleep(900);
      }
      return {
        item: `${len} bichos`, itemKey: 'memory:' + len, contrast: null, words: seq.map(id => SOUNDS[id].name).join(' – '),
        expected: seq.map(id => SOUNDS[id].name).join('-'), answer: answer.map(id => SOUNDS[id].name).join('-'),
        correct, seqLen: len, replays: Math.max(0, replays),
      };
    },
  },
});

function noPairsMsg(def) {
  if (def.needsFigure) return 'Esta atividade usa figuras. Na área da fono, em “Rodada”, escolha pares marcados como “tem figura”.';
  if (def.needsAudio) return 'Esta atividade precisa das gravações da fono (as duas palavras de cada par). Grave os pares em “Gravar palavras” e escolha-os em “Rodada”.';
  return 'Na área da fono, em “Rodada”, escolha os pares desta criança.';
}
function renderUnavailable(app, msg) {
  add(app, [
    h('div', { class: 'topbar' }, iconBtn('🏠', 'Voltar', () => go('menu'))),
    h('div', { class: 'no-pairs' },
      h('div', { class: 'no-pairs-art', html: critter({ color: '#8e6cd1', shape: 'drop' }) }),
      h('p', null, h('strong', null, 'Esta atividade ainda não tem o que tocar.')),
      h('p', { class: 'muted' }, msg)),
  ]);
}

/* ---------- dificuldade adaptativa ----------
 * Escada simples: sobe um nível depois de `up` acertos seguidos e desce depois de
 * `down` erros seguidos. O nível fica salvo por criança e atividade para a próxima sessão. */
const Adaptive = {
  async load(childId, def) {
    const A = def.adaptive;
    const key = `adapt:${childId}:${def.id}`;
    const saved = A.persist === false ? null : await DB.kv(key, null);
    const level = clamp(saved ? saved.level - (A.warmup || 0) : A.start, A.min, A.max);
    return {
      level,
      run: 0,
      miss: 0,
      label(l) { return A.label(l == null ? this.level : l); },
      update(correct) {
        if (correct) {
          this.miss = 0;
          if (++this.run >= A.up) { this.run = 0; this.level = Math.min(A.max, this.level + 1); }
        } else {
          this.run = 0;
          if (++this.miss >= A.down) { this.miss = 0; this.level = Math.max(A.min, this.level - 1); }
        }
      },
      save(maxPlayed) {
        if (A.persist === false) return Promise.resolve();
        const best = Math.max(saved && saved.best || 0, maxPlayed || 0);
        return DB.setKv(key, { level: this.level, best, date: new Date().toISOString() }).catch(() => {});
      },
    };
  },
};

/* Recompensa do fim da rodada: o tipo vem da faixa (G.reward). */
const Rewards = {
  async stickers(child, session) {
    const hits = session.trials.filter(t => t.correct).length;
    const reward = await grantReward(child.id, session.trials.length ? hits / session.trials.length : 0);
    return { screen: 'reward', params: { ...reward, mode: session.mode } };
  },
};

Screens.game = {
  themed: true,
  async render(app, { mode }, alive) {
    const def = ACTIVITIES[mode];
    const G = groupOf(State.group);
    const child = State.child || GUEST;
    if (!def) { go('menu'); return; }
    const ctx = { child, G, def, pairs: def.usesPairs === false ? [] : await pairsForActivity(def, child.id, G.id) };
    if (!alive()) return;
    const problem = def.check ? def.check(ctx) : (def.usesPairs !== false && !ctx.pairs.length ? noPairsMsg(def) : null);
    if (problem) { renderUnavailable(app, problem); return; }

    const adapt = def.adaptive ? await Adaptive.load(child.id, def) : null;
    if (!alive()) return;
    ctx.adapt = adapt;
    const timed = def.timed || 0;                       // segundos (Missão relâmpago)
    const trials = def.build(ctx, timed ? 200 : trialsFor(G));
    const session = {
      id: uid(), childId: child.id, group: G.id, date: new Date().toISOString(), mode: def.id,
      planned: timed ? null : trials.length, complete: false,
      pauseMs: State.settings.pauseMs, appVersion: APP_VERSION, trials: [],
    };
    if (timed) session.timed = timed;
    if (adapt) session.adaptive = { kind: def.adaptive.kind, start: adapt.level, end: adapt.level, max: adapt.level };
    let left = false;
    let timer = null;
    onLeave(() => {
      left = true;
      if (timer) timer.stop();
      // Saiu no meio: guarda o que já foi jogado, marcado como incompleto.
      if (!session.complete && session.trials.length) {
        if (adapt) adapt.save(session.adaptive.max);
        DB.put('sessions', session).catch(e => console.error(e));
      }
    });

    const dots = timed ? null : h('div', { class: 'dots', 'aria-hidden': 'true' }, trials.map(() => h('span', { class: 'dot' })));
    const timeFill = h('span', { class: 'time-fill' });
    const scoreEl = h('span', { class: 'time-score' }, '0');
    const progress = timed ? h('div', { class: 'time-box', 'aria-label': 'Tempo' }, h('span', { class: 'time-bar' }, timeFill), scoreEl) : dots;
    const ttsBadge = h('span', { class: 'tts-badge', hidden: true, title: 'Palavra sem gravação: tocando a voz sintética do aparelho, que é menos precisa.' }, 'voz sintética');
    const levelChip = h('span', { class: 'level-chip', hidden: !adapt });
    const replayBtn = h('button', { class: 'btn-replay', type: 'button', 'aria-label': 'Ouvir de novo', title: 'Ouvir de novo', html: SPEAKER_SVG });
    const stage = h('div', { class: 'stage stage-' + def.id });
    add(app, [
      h('div', { class: 'game-top' },
        h('div', { class: 'game-top-side' }, iconBtn('🏠', 'Sair do jogo', askExit),
          h('span', { class: 'game-title' }, def.name), ttsBadge),
        replayBtn,
        h('div', { class: 'game-top-side end' }, levelChip, progress)),
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

    if (timed) {
      let raf = 0;
      let t0 = 0;
      let done;
      const over = new Promise(r => { done = r; });
      timer = {
        over: false,
        promise: over,
        start() {
          t0 = performance.now();
          const tick = () => {
            const f = Math.min(1, (performance.now() - t0) / (timed * 1000));
            timeFill.style.transform = `scaleX(${1 - f})`;
            progress.classList.toggle('ending', f > 0.83);
            if (f >= 1) { timer.over = true; done(null); return; }
            raf = requestAnimationFrame(tick);
          };
          tick();
        },
        stop() { cancelAnimationFrame(raf); },
      };
    }

    const g = {
      stage,
      replayBtn,
      G,
      child,
      ctx,
      adapt,
      helper: HELPERS[rand(HELPERS.length)],
      showDragHint: def.id === 'drag',
      tts: false,
      alive: () => alive() && !left,
      lock(state) { stage.dataset.lock = state || ''; },
      /** Espera a resposta. Na Missão relâmpago, devolve null se o tempo acabar antes. */
      choose(options) {
        const pick = waitChoice(options);
        return timer ? Promise.race([pick, timer.promise]) : pick;
      },
      timeUp: () => !!(timer && timer.over),
      async play(steps, lock = 'listen', pauseMs = State.settings.pauseMs) {
        g.lock(lock);
        steps.forEach(s => s.el && s.el.classList.remove('speaking'));
        replayBtn.classList.add('playing');
        const r = await Sound.sequence(steps.map(s => ({
          ...s,
          onStart: () => { if (s.el) s.el.classList.add('speaking'); if (s.onStart) s.onStart(); },
          onEnd: () => { if (s.el) s.el.classList.remove('speaking'); if (s.onEnd) s.onEnd(); },
        })), pauseMs);
        if (!r.cancelled) {
          replayBtn.classList.remove('playing');
          if (r.tts) g.tts = true;
          ttsBadge.hidden = !r.tts;
        }
        return r;
      },
      noteTts(on) { if (on) { g.tts = true; ttsBadge.hidden = false; } },
      endInput(els) {
        els.forEach(e => { e.onclick = null; });
        replayBtn.onclick = null;
        Sound.stop();
        replayBtn.classList.remove('playing');
        stage.querySelectorAll('.speaking').forEach(e => e.classList.remove('speaking'));
        g.lock('busy');
      },
    };

    if (def.intro) {                                     // tela de preparo (ex.: "use fone de ouvido")
      await def.intro(g);
      if (!g.alive()) return;
    }
    for (let i = 0; i < trials.length; i++) {
      await sleep(i === 0 ? 500 : 300);
      if (!g.alive()) return;
      if (timer && i === 0) timer.start();
      if (g.timeUp()) break;
      if (dots) dots.children[i].classList.add('current');
      g.tts = false;
      ttsBadge.hidden = true;
      const level = adapt ? adapt.level : null;
      if (adapt) levelChip.textContent = adapt.label(level);
      const res = await def.run(trials[i], g);
      if (!g.alive()) return;
      if (!res) break;                                   // o tempo acabou no meio da tentativa
      res.tts = res.tts || g.tts;
      if (adapt) {
        res.level = level;
        session.adaptive.max = Math.max(session.adaptive.max, level);
        adapt.update(res.correct);
        session.adaptive.end = adapt.level;
      }
      session.trials.push(res);
      if (dots) dots.children[i].className = 'dot done';
      if (timed) scoreEl.textContent = String(session.trials.filter(t => t.correct).length);
      if (g.timeUp()) break;
    }
    if (timer) timer.stop();
    session.complete = true;
    if (timed) session.score = session.trials.filter(t => t.correct).length;
    if (adapt) await adapt.save(session.adaptive.max);
    await DB.put('sessions', session);
    const out = await (Rewards[G.reward] || Rewards.stickers)(child, session, def);
    if (g.alive()) go(out.screen, out.params);
  },
};

/* =========================================================================
 * 3c. DETETIVES DO SOM: ATIVIDADES, MISSÕES E INSÍGNIAS
 * ========================================================================= */

/* ---------- ruídos de fundo gerados por código (Ruído na escuta) ----------
 * Cada ruído é gerado uma vez (6 s), normalizado para a mesma energia da fala gravada
 * (RMS 0,1) e tocado em loop a partir de um ponto sorteado. */
const NOISE_TYPES = {
  babble: { name: 'burburinho', icon: '🗣️' },
  rain: { name: 'chuva', icon: '🌧️' },
  party: { name: 'festa', icon: '🎉' },
};
const NoiseGen = {
  cache: {},
  /** Ressonador de 2 polos (formante). */
  reso(freq, bw, sr) {
    const r = Math.exp(-Math.PI * bw / sr);
    const a1 = 2 * r * Math.cos(2 * Math.PI * freq / sr);
    const a2 = -r * r;
    let y1 = 0;
    let y2 = 0;
    return x => { const y = (1 - r) * x + a1 * y1 + a2 * y2; y2 = y1; y1 = y; return y; };
  },
  /** Burburinho: 6 "vozes" com sílabas de formantes sorteados (parece conversa, mas sem palavras). */
  babble(sr, n, talkers = 6) {
    const out = new Float32Array(n);
    for (let k = 0; k < talkers; k++) {
      const f0 = 95 + Math.random() * 140;
      let phase = Math.random();
      let i = Math.floor(Math.random() * sr * 0.2);
      while (i < n) {
        const len = Math.floor(sr * (0.11 + Math.random() * 0.17));
        const voiced = Math.random() < 0.78;
        const r1 = this.reso(280 + Math.random() * 600, 90, sr);
        const r2 = this.reso(900 + Math.random() * 1500, 140, sr);
        const amp = 0.4 + Math.random() * 0.6;
        for (let j = 0; j < len && i < n; j++, i++) {
          const env = Math.sin(Math.PI * j / len);
          let x;
          if (voiced) {
            phase += f0 * (1 + 0.04 * Math.sin(i / sr * 6 + k)) / sr;
            if (phase >= 1) phase -= 1;
            x = (phase < 0.08 ? 1 : 0) - 0.08;
          } else {
            x = (Math.random() * 2 - 1) * 0.25;
          }
          out[i] += (r1(x) + 0.7 * r2(x)) * env * amp;
        }
        if (Math.random() < 0.22) i += Math.floor(sr * Math.random() * 0.18);
      }
    }
    return out;
  },
  rain(sr, n) {
    const out = new Float32Array(n);
    let lp = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      lp += 0.55 * (w - lp);                 // passa-baixa suave
      out[i] = (lp - prev) * 0.9 + lp * 0.3; // tira um pouco dos graves
      prev = lp;
    }
    for (let d = 0; d < n / sr * 70; d++) {   // gotas
      const s = Math.floor(Math.random() * n);
      const f = 1500 + Math.random() * 3000;
      const a = 0.3 + Math.random() * 0.7;
      const len = Math.floor(sr * 0.02);
      for (let j = 0; j < len && s + j < n; j++) out[s + j] += a * Math.sin(2 * Math.PI * f * j / sr) * Math.exp(-j / (len / 4));
    }
    return out;
  },
  party(sr, n) {
    const out = this.babble(sr, n, 8);
    const notes = [261.6, 329.6, 392, 440, 349.2, 293.7];
    const beat = Math.floor(sr * 0.5);
    for (let b = 0; b * beat < n; b++) {
      const f = notes[b % notes.length];
      for (let j = 0; j < beat && b * beat + j < n; j++) {
        const t = j / sr;
        const i = b * beat + j;
        out[i] += 0.12 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3);          // música
        out[i] += 0.35 * Math.sin(2 * Math.PI * (60 + 40 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18); // bumbo
      }
    }
    for (let c = 0; c < n / sr * 3; c++) {     // copos
      const s = Math.floor(Math.random() * n);
      for (let j = 0; j < sr * 0.15 && s + j < n; j++) out[s + j] += 0.15 * Math.sin(2 * Math.PI * 3200 * j / sr) * Math.exp(-j / (sr * 0.03));
    }
    return out;
  },
  buffer(ctx, type) {
    if (this.cache[type]) return this.cache[type];
    const sr = ctx.sampleRate;
    const n = sr * 6;
    const data = (this[type] || this.babble).call(this, sr, n);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i] * data[i];
    const g = 0.1 / (Math.sqrt(sum / n) || 1);
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) {
      let v = data[i] * g;
      if (i < fade) v *= i / fade; else if (i > n - fade) v *= (n - i) / fade;   // emenda do loop sem estalo
      data[i] = Math.max(-0.99, Math.min(0.99, v));
    }
    const buf = ctx.createBuffer(1, n, sr);
    buf.getChannelData(0).set(data);
    this.cache[type] = buf;
    return buf;
  },
  source(ctx, type) {
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(ctx, NOISE_TYPES[type] ? type : 'babble');
    src.loop = true;
    return src;
  },
};

/* Níveis das atividades adaptativas (1 = mais fácil). */
const NOISE_SNR = [null, 12, 9, 6, 3, 0, -3, -6, -9];                  // dB (fala acima do ruído)
const LOWPASS_HZ = [null, 4000, 3000, 2200, 1600, 1200, 900, 700, 500]; // corte do filtro
const GATE_DUTY = [null, 0.15, 0.22, 0.3, 0.36, 0.42, 0.48, 0.54, 0.6]; // fração cortada (8 cortes por segundo)
const fmtDb = v => (v > 0 ? '+' : '') + v + ' dB';
const ADAPT_INFO = {
  noise: { name: 'nível de ruído', detail: l => `relação sinal/ruído ${fmtDb(NOISE_SNR[l])}` },
  filter: { name: 'nível do filtro', detail: l => `passa-baixa ${LOWPASS_HZ[l]} Hz ou ${Math.round(GATE_DUTY[l] * 100)}% cortado` },
  seq: { name: 'tamanho da sequência', detail: l => `${l} itens` },
  word: { name: 'nível do ditado', detail: l => ['', 'palavras de 2 sílabas, 1 letra-isca', 'todas as palavras, 1 letra-isca', 'todas as palavras, 2 letras-isca'][l] || '' },
};

/* ---------- palavras escritas ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Onde as duas palavras do par diferem: { pre, aEnd, bEnd, suf } (comparando sem acentos). */
function pairDiff(pair) {
  const a = pair.a.text;
  const b = pair.b.text;
  const pa = [...a].map(c => plain(c));
  const pb = [...b].map(c => plain(c));
  let pre = 0;
  while (pre < pa.length && pre < pb.length && pa[pre] === pb[pre]) pre++;
  let suf = 0;
  while (suf < pa.length - pre && suf < pb.length - pre && pa[pa.length - 1 - suf] === pb[pb.length - 1 - suf]) suf++;
  return { pre, suf };
}
/** Pedaço da palavra que muda no par (ex.: faca/vaca → "f"; chato/jato → "ch"). */
function diffPart(pair, side) {
  const { pre, suf } = pairDiff(pair);
  const chars = [...pair[side].text];
  return chars.slice(pre, chars.length - suf).join('');
}
function markDiff(pair, side) {
  const { pre, suf } = pairDiff(pair);
  const chars = [...pair[side].text];
  const mid = chars.slice(pre, chars.length - suf).join('');
  return esc(chars.slice(0, pre).join('')) + `<mark>${esc(mid)}</mark>` + esc(chars.slice(chars.length - suf).join(''));
}
/** Contagem simples de sílabas (grupos de vogais; "qu"/"gu" antes de e/i não contam). */
function syllables(word) {
  const w = plain(word).replace(/([qg])u(?=[ei])/g, '$1');
  return (w.match(/[aeiou]+/g) || []).reduce((n, g) => n + (g.length >= 3 ? 2 : /^(ia|io|ea|eo|oa|ua)$/.test(g) && w.endsWith(g) ? 2 : 1), 0);
}
function wordBtn(pair, side, cls = '') {
  return h('button', { class: 'answer word-btn ' + cls, type: 'button', 'aria-label': pair[side].text },
    pair[side].emoji && h('span', { class: 'word-emoji', 'aria-hidden': 'true' }, pair[side].emoji),
    h('span', { class: 'word-txt' }, pair[side].text));
}

/** Correção dos Detetives: mostra as duas formas lado a lado (letra que muda destacada) e toca as duas. */
async function showCompare(g, pair, right, note = '') {
  await sleep(350);
  if (!g.alive()) return;
  const card = side => h('div', { class: 'cmp-card' },
    pair[side].emoji && h('span', { class: 'cmp-emoji', 'aria-hidden': 'true' }, pair[side].emoji),
    h('span', { class: 'cmp-word', html: markDiff(pair, side) }));
  const ca = card('a');
  const cb = card('b');
  const panel = h('div', { class: 'compare' },
    note && h('p', { class: 'cmp-note' }, note),
    h('div', { class: 'cmp-row' }, ca, h('span', { class: 'cmp-vs' }, '×'), cb));
  g.stage.append(panel);
  await g.play([{ pair, side: 'a', el: ca }, { pair, side: 'b', el: cb }], 'busy', 700);
  if (!g.alive()) return;
  (right === 'a' ? ca : cb).classList.add('hint-correct');
  await sleep(1400);
  panel.remove();
}
async function quickWin(el) {
  Sound.chime('win');
  el.classList.add('win');
  burst(el, ['⚡', '✨', '⭐', '💥']);
  await sleep(1000);
  el.classList.remove('win');
}
/** Pares (com as duas palavras) agrupados por contraste. */
function byContrast(pairs) {
  const m = {};
  for (const p of pairs) (m[p.contrast] = m[p.contrast] || []).push(p);
  return m;
}

/* ---------- Frase maluca ---------- */
const SENTENCES = [
  { id: 'td1', contrast: 'td', text: 'Bom {tia}! Hoje o sol está lindo.', right: 'dia' },
  { id: 'td2', contrast: 'td', text: 'A minha {dia} faz um bolo delicioso.', right: 'tia' },
  { id: 'td3', contrast: 'td', text: 'O carro furou a {rota} no caminho.', right: 'roda' },
  { id: 'td4', contrast: 'td', text: 'Eu comi morango com {nada}.', right: 'nata' },
  { id: 'td5', contrast: 'td', text: 'O filme passou na {dela} do cinema.', right: 'tela' },
  { id: 'kg1', contrast: 'kg', text: 'O {calo} cantou cocoricó de manhã.', right: 'galo' },
  { id: 'kg2', contrast: 'kg', text: 'Colei o desenho com {gola}.', right: 'cola' },
  { id: 'kg3', contrast: 'kg', text: 'O bombeiro apagou o {foco}.', right: 'fogo' },
  { id: 'kg4', contrast: 'kg', text: 'Deitei na {gama} para dormir.', right: 'cama' },
  { id: 'kg5', contrast: 'kg', text: 'A {vaga} deu leite no pasto.', right: 'vaca' },
  { id: 'fv1', contrast: 'fv', text: 'O menino tomou leite de {faca}.', right: 'vaca' },
  { id: 'fv2', contrast: 'fv', text: 'Corta o pão com a {vaca}.', right: 'faca' },
  { id: 'fv3', contrast: 'fv', text: 'Tirei uma {voto} com o celular.', right: 'foto' },
  { id: 'fv4', contrast: 'fv', text: 'Minha avó mora numa {fila} bem pequena.', right: 'vila' },
  { id: 'fv5', contrast: 'fv', text: 'Meu amigo {vala} muito alto.', right: 'fala' },
  { id: 'pb1', contrast: 'pb', text: 'O pirata remou o seu {pote} até a ilha.', right: 'bote' },
  { id: 'pb2', contrast: 'pb', text: 'Lavei as mãos na {Bia}.', right: 'pia' },
  { id: 'sz1', contrast: 'sz', text: 'Moro numa {caça} amarela.', right: 'casa' },
  { id: 'chj1', contrast: 'chj', text: 'Comi pão com {queixo}.', right: 'queijo' },
  { id: 'chj2', contrast: 'chj', text: 'O {chato} voou bem alto no céu.', right: 'jato' },
];
const sentenceWrong = s => s.text.match(/\{([^}]+)\}/)[1];
const sentenceText = s => s.text.replace(/[{}]/g, '');
/** Par do banco que tem as duas palavras da frase (para usar as gravações da fono). */
function sentencePair(s) {
  const w = sentenceWrong(s);
  return Bank.pairs.find(p => (sameText(p.a.text, w) && sameText(p.b.text, s.right)) || (sameText(p.b.text, w) && sameText(p.a.text, s.right))) || null;
}
/** Passos para tocar a frase: a gravação da frase inteira; se não houver, junta as gravações
 *  de cada palavra e usa a voz sintética só no que faltar. */
function sentenceSteps(s, el) {
  const fk = 'f:' + s.id;
  if (Bank.recorded.has(fk)) return [{ key: fk, text: sentenceText(s), el }];
  const pair = sentencePair(s);
  const wrong = sentenceWrong(s);
  const steps = [];
  let buffer = [];
  const flush = () => { if (buffer.length) steps.push({ text: buffer.join(' '), el }); buffer = []; };
  for (const tok of s.text.split(/\s+/)) {
    const isWrong = tok.includes('{');
    const word = tok.replace(/[{}.,!?]/g, '');
    let key = wordKey(word);
    if (isWrong && pair) key = pair.id + ':' + (sameText(pair.a.text, wrong) ? 'a' : 'b');
    if (Bank.recorded.has(key)) { flush(); steps.push({ key, text: word, el }); } else buffer.push(tok.replace(/[{}]/g, ''));
  }
  flush();
  return steps;
}

/* ---------- Código secreto ---------- */
const SYLLABLES = {
  pb: [['pa', 'pá'], ['ba', 'bá']], td: [['ta', 'tá'], ['da', 'dá']], kg: [['ca', 'cá'], ['ga', 'gá']],
  fv: [['fa', 'fá'], ['va', 'vá']], sz: [['sa', 'sá'], ['za', 'zá']], chj: [['cha', 'chá'], ['ja', 'já']],
};
const sylItem = (c, i) => ({ key: 's:' + SYLLABLES[c][i][0], text: SYLLABLES[c][i][1] });

/** Identificação simples (duas palavras escritas): usada em Ruído, Som picotado e Missão relâmpago. */
async function runIdentify(trial, g, { fx = null, quick = false, extra = {} } = {}) {
  const { pair, target, targetLeft } = trial;
  const sides = targetLeft ? [target, other(target)] : [other(target), target];
  const btns = sides.map(s => wordBtn(pair, s));
  const signal = h('div', { class: 'signal', html: SPEAKER_SVG });
  g.stage.replaceChildren(signal, h('div', { class: 'word-row2' }, btns));
  let replays = -1;
  const listen = async () => {
    replays++;
    const r = await g.play([{ pair, side: target, fx, el: signal }]);
    if (!r.cancelled) g.lock('');
  };
  g.replayBtn.onclick = listen;
  listen();
  const idx = await g.choose(btns.map((b, i) => [b, i]));
  if (idx == null) { g.endInput(btns); return null; }
  g.endInput(btns);
  const correct = sides[idx] === target;
  const right = btns[sides.indexOf(target)];
  if (quick) {
    right.classList.add(correct ? 'flash-ok' : 'hint-correct');
    if (correct) Sound.chime('tap');
    await sleep(correct ? 350 : 800);
  } else if (correct) await quickWin(right);
  else await showCompare(g, pair, target);
  return {
    ...baseResult(pair), stim: target, expected: pair[target].text, answer: pair[sides[idx]].text,
    correct, replays: Math.max(0, replays), ...extra,
  };
}

const detArt = (icon, label) => `<span class="mission-art"><span class="mission-icon">${icon}</span><span class="mission-tag">${label}</span></span>`;

Object.assign(ACTIVITIES, {
  /* 1. LETRA ESCONDIDA: ouve a palavra e completa a letra que falta (ex.: _aca → F ou V). */
  hidden: {
    id: 'hidden',
    name: 'Letra escondida',
    icon: '🔡',
    desc: 'Ouvir e escrever: ouve a palavra e escolhe a letra que falta (_aca: F ou V). Treino direto da troca na escrita.',
    art: () => detArt('🔡', '_ACA'),
    build: (ctx, n) => buildTrials('which', ctx.pairs, n),
    async run(trial, g) {
      const { pair, target, targetLeft } = trial;
      const { pre, suf } = pairDiff(pair);
      const chars = [...pair[target].text];
      const blank = h('span', { class: 'blank' }, '?');
      const wordEl = h('div', { class: 'hidden-word' },
        chars.slice(0, pre).join(''), blank, chars.slice(chars.length - suf).join(''));
      const sides = targetLeft ? [target, other(target)] : [other(target), target];
      const btns = sides.map(s => h('button', { class: 'answer letter-btn', type: 'button' }, diffPart(pair, s).toUpperCase()));
      g.stage.replaceChildren(h('div', { class: 'signal', html: SPEAKER_SVG }), wordEl, h('div', { class: 'word-row2' }, btns));
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play([{ pair, side: target, el: wordEl }]); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const idx = await g.choose(btns.map((b, i) => [b, i]));
      g.endInput(btns);
      const correct = sides[idx] === target;
      blank.textContent = diffPart(pair, target);
      blank.classList.add(correct ? 'ok' : 'fixed');
      if (correct) await quickWin(btns[idx]);
      else await showCompare(g, pair, target);
      return {
        ...baseResult(pair), stim: target, expected: diffPart(pair, target), answer: diffPart(pair, sides[idx]),
        correct, replays: Math.max(0, replays),
      };
    },
  },

  /* 2. FRASE MALUCA: acha a palavra trocada na frase e corrige com o par certo. */
  silly: {
    id: 'silly',
    name: 'Frase maluca',
    icon: '🤪',
    desc: 'Compreensão e julgamento: ouve uma frase com uma palavra trocada pelo par, acha a palavra errada e escolhe a certa.',
    art: () => detArt('🤪', 'leite de FACA?'),
    check(ctx) {
      const cs = new Set(ctx.pairs.map(p => p.contrast));
      if (!SENTENCES.some(s => cs.has(s.contrast))) return 'A Frase maluca tem frases de T×D, K×G, F×V, P×B, S×Z e CH×J. Em “Rodada”, escolha pares de algum desses contrastes.';
      return null;
    },
    build(ctx, n) {
      const cs = new Set(ctx.pairs.map(p => p.contrast));
      return cycle(SENTENCES.filter(s => cs.has(s.contrast)), n).map(s => ({ s }));
    },
    async run(trial, g) {
      const { s } = trial;
      const wrong = sentenceWrong(s);
      const pair = sentencePair(s);
      const sentence = h('div', { class: 'sentence' });
      const toks = s.text.split(/\s+/);
      const chips = toks.map(tok => h('button', { class: 'answer chip-word', type: 'button' }, tok.replace(/[{}]/g, '')));
      add(sentence, chips);
      const wrongIdx = toks.findIndex(t => t.includes('{'));
      const prompt = h('p', { class: 'det-prompt' }, '🔍 Qual palavra está errada?');
      g.stage.replaceChildren(prompt, sentence);
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play(sentenceSteps(s, sentence), 'listen', 60); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const picked = await g.choose(chips.map((c, i) => [c, i]));
      const found = picked === wrongIdx;
      chips.forEach(c => { c.onclick = null; c.disabled = true; });
      chips[wrongIdx].classList.add('suspect');
      if (found) { Sound.chime('star'); chips[wrongIdx].classList.add('win'); } else {
        chips[picked].classList.add('miss');
        await sleep(700);
      }
      // Passo 2: corrigir.
      const options = shuffle([wrong, s.right]);
      const fixBtns = options.map(w => h('button', { class: 'answer word-btn', type: 'button' }, h('span', { class: 'word-txt' }, w)));
      prompt.textContent = '✏️ Qual é a palavra certa?';
      g.stage.append(h('div', { class: 'word-row2' }, fixBtns));
      g.lock('');
      const choice = await g.choose(fixBtns.map((b, i) => [b, options[i]]));
      g.endInput(fixBtns);
      const fixed = sameText(choice, s.right);
      const correct = found && fixed;
      chips[wrongIdx].textContent = chips[wrongIdx].textContent.replace(wrong, s.right);
      chips[wrongIdx].classList.add('fixed');
      if (correct) await quickWin(sentence);
      else if (pair) await showCompare(g, pair, sameText(pair.a.text, s.right) ? 'a' : 'b', `Na frase o certo é “${s.right}”.`);
      else await sleep(1500);
      return {
        pairId: pair ? pair.id : null, contrast: s.contrast, words: pair ? `${pair.a.text} × ${pair.b.text}` : `${wrong} × ${s.right}`,
        item: sentenceText(s), itemKey: 'silly:' + s.id, expected: s.right, answer: choice,
        found, fixed, correct, replays: Math.max(0, replays),
      };
    },
  },

  /* 3. DITADO DETETIVE: ouve a palavra e monta com letras (com 1–2 letras-isca do par). */
  dictation: {
    id: 'dictation',
    name: 'Ditado detetive',
    icon: '🧩',
    desc: 'Ditado com letras móveis: monta a palavra ouvida; há letras-isca do par trocado. Começa com palavras de 2 sílabas e sobe.',
    art: () => detArt('🧩', 'F A C A'),
    adaptive: { kind: 'word', start: 1, min: 1, max: 3, up: 3, down: 2, label: l => `Nível ${l}` },
    build: (ctx, n) => buildTrials('which', ctx.pairs, n),
    async run(trial, g) {
      const level = g.adapt.level;
      // Escolhe a palavra pelo nível: 1 = só palavras de 2 sílabas com até 5 letras.
      let { pair, target } = trial;
      const fits = (p, s) => level > 1 || (syllables(p[s].text) === 2 && [...p[s].text].length <= 5);
      if (!fits(pair, target)) {
        const alt = shuffle(g.ctx.pairs.flatMap(p => ['a', 'b'].map(s => [p, s]))).find(([p, s]) => fits(p, s));
        if (alt) [pair, target] = alt;
      }
      const word = pair[target].text.toUpperCase();
      const letters = [...word];
      const decoys = [...diffPart(pair, other(target)).toUpperCase()];
      if (level >= 3) {
        const pool = [...'BCDFGJLMNPRSTVZ'].filter(c => !letters.includes(c) && !decoys.includes(c));
        decoys.push(pool[rand(pool.length)]);
      }
      const tiles = shuffle([...letters, ...decoys]).map(ch => h('button', { class: 'answer tile', type: 'button' }, ch));
      const slots = letters.map(() => h('button', { class: 'slot-letter', type: 'button', 'aria-label': 'espaço' }));
      const check = h('button', { class: 'answer btn-check', type: 'button', disabled: true }, '✔ Conferir');
      const tray = h('div', { class: 'tiles' }, tiles);
      g.stage.replaceChildren(h('div', { class: 'signal', html: SPEAKER_SVG }), h('div', { class: 'slots' }, slots), tray, check);
      const filled = slots.map(() => null);
      const paint = () => { check.disabled = filled.some(x => !x); };
      const place = (tile, i) => {
        if (i == null) i = filled.findIndex(x => !x);
        if (i < 0) return;
        if (filled[i]) unplace(i);
        filled[i] = tile;
        slots[i].textContent = tile.textContent;
        slots[i].classList.add('full');
        tile.classList.add('used');
        Synth.tap('drum');
        paint();
      };
      const unplace = i => {
        const t = filled[i];
        if (!t) return;
        t.classList.remove('used');
        filled[i] = null;
        slots[i].textContent = '';
        slots[i].classList.remove('full');
        paint();
      };
      slots.forEach((s, i) => { s.onclick = () => { if (!g.stage.dataset.lock) unplace(i); }; });
      // Arrastar a letra até um espaço (tocar também funciona: vai para o próximo espaço livre).
      tiles.forEach(tile => {
        let st = null;
        tile.addEventListener('pointerdown', e => {
          if (g.stage.dataset.lock || tile.classList.contains('used')) return;
          e.preventDefault();
          try { tile.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
          st = { x: e.clientX, y: e.clientY, id: e.pointerId };
          tile.classList.add('dragging');
        });
        tile.addEventListener('pointermove', e => {
          if (!st || e.pointerId !== st.id) return;
          tile.style.transform = `translate(${e.clientX - st.x}px, ${e.clientY - st.y}px) scale(1.1)`;
        });
        const end = e => {
          if (!st || e.pointerId !== st.id) return;
          const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
          st = null;
          tile.classList.remove('dragging');
          tile.style.transform = '';
          if (e.type === 'pointercancel') return;
          if (moved < 12) { place(tile); return; }
          const target = slots.findIndex(s => { const r = s.getBoundingClientRect(); return e.clientX > r.left - 10 && e.clientX < r.right + 10 && e.clientY > r.top - 20 && e.clientY < r.bottom + 20; });
          if (target >= 0) place(tile, target);
        };
        tile.addEventListener('pointerup', end);
        tile.addEventListener('pointercancel', end);
      });
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play([{ pair, side: target }]); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      await g.choose([[check, true]]);
      g.endInput([check, ...slots]);
      tiles.forEach(t => { t.disabled = true; });
      const built = filled.map(t => t.textContent).join('');
      const correct = built === word;
      if (correct) {
        slots.forEach(s => s.classList.add('ok'));
        await quickWin(slots[slots.length - 1].parentNode);
      } else {
        slots.forEach((s, i) => { s.textContent = letters[i]; s.classList.toggle('fixed', filled[i].textContent !== letters[i]); });
        await showCompare(g, pair, target);
      }
      return {
        ...baseResult(pair), stim: target, expected: pair[target].text, answer: built.toLowerCase(),
        correct, replays: Math.max(0, replays),
      };
    },
  },

  /* 4. RUÍDO NA ESCUTA: a palavra com ruído de fundo; o ruído sobe com 3 acertos seguidos e desce com 2 erros. */
  noise: {
    id: 'noise',
    name: 'Ruído na escuta',
    icon: '🎧',
    desc: 'Figura-fundo: identifica a palavra do par com ruído de fundo (burburinho, chuva, festa). Adaptativo: o ruído sobe com 3 acertos seguidos e desce com 2 erros.',
    art: () => detArt('🎉', 'S/R'),
    adaptive: { kind: 'noise', start: 1, min: 1, max: 8, up: 3, down: 2, warmup: 1, label: l => `Ruído ${l}` },
    build: (ctx, n) => buildTrials('which', ctx.pairs, n),
    run(trial, g) {
      const level = g.adapt.level;
      const types = Object.keys(NOISE_TYPES);
      const type = NOISE_TYPES[State.settings.noiseType] ? State.settings.noiseType : types[rand(types.length)];
      const p = runIdentify(trial, g, { fx: { noise: { type, snr: NOISE_SNR[level] } }, extra: { noiseType: type, snr: NOISE_SNR[level] } });
      g.stage.prepend(h('span', { class: 'noise-tag', title: NOISE_TYPES[type].name }, NOISE_TYPES[type].icon));
      return p;
    },
  },

  /* 5. SOM PICOTADO: a palavra abafada (passa-baixa) ou com cortes curtos; mesma regra adaptativa. */
  chopped: {
    id: 'chopped',
    name: 'Som picotado',
    icon: '✂️',
    desc: 'Fechamento auditivo: identifica a palavra abafada (filtro passa-baixa) ou com cortes curtos de silêncio. Adaptativo como o Ruído na escuta.',
    needsAudio: true,
    art: () => detArt('✂️', 'pi·co·ta·do'),
    adaptive: { kind: 'filter', start: 1, min: 1, max: 8, up: 3, down: 2, warmup: 1, label: l => `Filtro ${l}` },
    build(ctx, n) {
      const trials = buildTrials('which', ctx.pairs, n);
      const kinds = balancedPositions(n, 2);
      return trials.map((t, i) => ({ ...t, kind: kinds[i] ? 'gate' : 'lowpass' }));
    },
    run(trial, g) {
      const l = g.adapt.level;
      const fx = trial.kind === 'gate' ? { gate: { rate: 8, duty: GATE_DUTY[l] } } : { lowpass: LOWPASS_HZ[l] };
      return runIdentify(trial, g, { fx, extra: { filter: trial.kind === 'gate' ? `cortes ${Math.round(GATE_DUTY[l] * 100)}%` : `passa-baixa ${LOWPASS_HZ[l]} Hz` } });
    },
  },

  /* 6. CÓDIGO SECRETO: sequência de sílabas do par (ta–da–ta); reproduz tocando nos dois botões. */
  code: {
    id: 'code',
    name: 'Código secreto',
    icon: '🔐',
    desc: 'Ordenação temporal: ouve uma sequência de sílabas do par (ta–da–ta) e reproduz na ordem. Começa com 3 e vai até 5 (sobe com 2 acertos seguidos).',
    art: () => detArt('🔐', 'TA·DA·TA'),
    adaptive: { kind: 'seq', start: 3, min: 3, max: 5, up: 2, down: 2, label: l => `Código de ${l}` },
    build(ctx, n) {
      const cs = Object.keys(byContrast(ctx.pairs)).filter(c => SYLLABLES[c]);
      return cycle(cs.length ? cs : ['td'], n).map(contrast => ({ contrast }));
    },
    async run(trial, g) {
      const c = trial.contrast;
      const len = g.adapt.level;
      let seq;
      do { seq = Array.from({ length: len }, () => rand(2)); } while (seq.every(x => x === seq[0]));
      const lights = seq.map(() => h('span', { class: 'code-light' }));
      const slots = seq.map(() => h('span', { class: 'code-slot' }));
      const btns = [0, 1].map(i => h('button', { class: 'answer syl-btn', type: 'button' }, SYLLABLES[c][i][0].toUpperCase()));
      const undo = h('button', { class: 'answer btn-undo', type: 'button', 'aria-label': 'Apagar' }, '⌫');
      g.stage.replaceChildren(
        h('div', { class: 'code-lights' }, lights),
        h('div', { class: 'code-slots' }, slots),
        h('div', { class: 'word-row2' }, btns[0], undo, btns[1]));
      const steps = () => seq.map((i, k) => ({ ...sylItem(c, i), el: lights[k] }));
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play(steps(), 'listen', 380); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const answer = [];
      undo.onclick = () => {
        if (!answer.length || g.stage.dataset.lock) return;
        answer.pop();
        const s = slots[answer.length];
        s.textContent = '';
        s.classList.remove('full');
      };
      while (answer.length < len) {
        const i = await g.choose(btns.map((b, k) => [b, k]));
        if (i == null) return null;
        Sound.chime('tap');
        const s = slots[answer.length];
        s.textContent = SYLLABLES[c][i][0].toUpperCase();
        s.classList.add('full');
        answer.push(i);
      }
      g.endInput([...btns, undo]);
      const correct = answer.every((x, k) => x === seq[k]);
      const txt = arr => arr.map(i => SYLLABLES[c][i][0]).join('-');
      if (correct) await quickWin(slots[0].parentNode);
      else {
        await sleep(500);
        slots.forEach((s, k) => { s.textContent = SYLLABLES[c][seq[k]][0].toUpperCase(); s.classList.toggle('fixed', answer[k] !== seq[k]); });
        await g.play(seq.map((i, k) => ({ ...sylItem(c, i), el: slots[k] })), 'busy', 380);
        await sleep(1100);
      }
      return {
        pairId: null, contrast: c, words: `${SYLLABLES[c].map(x => x[0]).join(' × ')} · ${len} sílabas`,
        item: `${len} sílabas`, itemKey: `code:${c}:${len}`, expected: txt(seq), answer: txt(answer),
        correct, seqLen: len, replays: Math.max(0, replays),
      };
    },
  },

  /* 7. CAÇA AO INTRUSO: 4 palavras, 3 com o mesmo som-alvo e 1 com o par; acha o intruso. */
  intruder: {
    id: 'intruder',
    name: 'Caça ao intruso',
    icon: '👀',
    desc: 'Discriminação em sequência: ouve 4 palavras (3 com o mesmo som, ex.: /v/, e 1 com o par /f/) e acha a diferente.',
    art: () => detArt('👀', '1 2 3 4'),
    check(ctx) {
      if (!Object.values(byContrast(ctx.pairs)).some(l => l.length >= 3)) return 'O Caça ao intruso precisa de pelo menos 3 pares do mesmo contraste. Em “Rodada”, escolha mais pares de um contraste.';
      return null;
    },
    build(ctx, n) {
      const groups = Object.values(byContrast(ctx.pairs)).filter(l => l.length >= 3);
      const pos = balancedPositions(n, 4);
      const majA = balancedPositions(n, 2);
      return cycle(groups, n).map((list, i) => {
        const pick = shuffle(list);
        const major = majA[i] ? 'a' : 'b';
        const three = pick.slice(0, 3);
        const odd = pick.length >= 4 ? pick[3] : three[rand(3)];
        const words = three.map(p => ({ pair: p, side: major }));
        words.splice(pos[i], 0, { pair: odd, side: other(major) });
        return { words, odd: pos[i] };
      });
    },
    async run(trial, g) {
      const { words, odd } = trial;
      const bubbles = words.map((w, i) => h('button', { class: 'answer num-bubble', type: 'button', 'aria-label': 'palavra ' + (i + 1) },
        h('span', { class: 'num' }, String(i + 1)), h('span', { class: 'num-word' })));
      g.stage.replaceChildren(h('p', { class: 'det-prompt' }, '🕵️ Qual é o intruso?'), h('div', { class: 'num-row' }, bubbles));
      let replays = -1;
      const listen = async () => { replays++; const r = await g.play(words.map((w, i) => ({ ...w, el: bubbles[i] })), 'listen', 650); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = listen;
      listen();
      const idx = await g.choose(bubbles.map((b, i) => [b, i]));
      g.endInput(bubbles);
      words.forEach((w, i) => { bubbles[i].querySelector('.num-word').textContent = w.pair[w.side].text; });
      const correct = idx === odd;
      const op = words[odd];
      if (correct) await quickWin(bubbles[idx]);
      else {
        bubbles[odd].classList.add('hint-correct');
        await showCompare(g, op.pair, op.side, `O intruso era “${op.pair[op.side].text}”.`);
      }
      return {
        ...baseResult(op.pair), stim: op.side, item: words.map(w => w.pair[w.side].text).join(', '),
        expected: op.pair[op.side].text, answer: words[idx].pair[words[idx].side].text, correct, replays: Math.max(0, replays),
      };
    },
  },

  /* 8. MISSÃO RELÂMPAGO (opcional): 60 s de palavras do par; recorde pessoal. */
  blitz: {
    id: 'blitz',
    name: 'Missão relâmpago',
    icon: '⚡',
    desc: 'Automatização (opcional): 60 segundos identificando palavras do par, para quem já domina. Recorde pessoal, sem ranking.',
    timed: 60,
    art: () => detArt('⚡', '60 s'),
    build: (ctx, n) => buildTrials('which', ctx.pairs, n),
    run: (trial, g) => runIdentify(trial, g, { quick: true }),
  },

  /* 9. FONE DE OUVIDO (opcional): escuta dicótica, uma palavra em cada ouvido. */
  dichotic: {
    id: 'dichotic',
    name: 'Fone de ouvido',
    icon: '🎧',
    desc: 'Escuta dicótica (opcional): uma palavra do par em cada ouvido ao mesmo tempo; responde o que ouviu à esquerda, à direita ou nos dois. Precisa de fone.',
    needsAudio: true,
    art: () => detArt('🎧', 'E | D'),
    async intro(g) {
      const test = (label, pan) => h('button', {
        class: 'btn', type: 'button',
        onclick: async () => {
          const p = g.ctx.pairs[0];
          const buf = await Sound.buffer(p.id + ':a');
          if (buf) Sound.playBuffer(buf, { pan });
        },
      }, label);
      const go_ = h('button', { class: 'btn primary big', type: 'button' }, 'Começar ▶');
      g.stage.replaceChildren(h('div', { class: 'headphones' },
        h('div', { class: 'hp-icon', 'aria-hidden': 'true' }, '🎧'),
        h('h2', null, 'Use fone de ouvido'),
        h('p', null, 'Confira se o lado está certo:'),
        h('div', { class: 'row wrap center' }, test('⬅️ Ouvir na esquerda', -1), test('Ouvir na direita ➡️', 1)),
        go_));
      await waitChoice([[go_, true]]);
    },
    build(ctx, n) {
      const trials = buildTrials('which', ctx.pairs, n);
      const asks = cycle(['left', 'right', 'both'], n);
      return trials.map((t, i) => ({ pair: t.pair, leftSide: t.target, ask: asks[i] }));
    },
    async run(trial, g) {
      const { pair, leftSide, ask } = trial;
      const rightSide = other(leftSide);
      const ears = ask === 'both' ? ['left', 'right'] : [ask];
      const rows = ears.map(ear => {
        const order = shuffle(['a', 'b']);
        const btns = order.map(s => wordBtn(pair, s));
        return { ear, order, btns, el: h('div', { class: 'ear-row' }, h('span', { class: 'ear-label' }, ear === 'left' ? '⬅️ Esquerda' : 'Direita ➡️'), btns) };
      });
      const head = h('div', { class: 'hp-head' }, h('span', { class: 'ear l' + (ears.includes('left') ? ' ask' : '') }, 'E'), h('span', { class: 'hp-mid' }, '🎧'), h('span', { class: 'ear r' + (ears.includes('right') ? ' ask' : '') }, 'D'));
      g.stage.replaceChildren(head, h('p', { class: 'det-prompt' }, ask === 'both' ? 'O que você ouviu em cada ouvido?' : `O que você ouviu no ouvido ${ask === 'left' ? 'ESQUERDO' : 'DIREITO'}?`), ...rows.map(r => r.el));
      let replays = -1;
      const listen = async () => {
        replays++;
        g.lock('listen');
        head.classList.add('speaking');
        const tts = await Sound.dual({ key: pair.id + ':' + leftSide }, { key: pair.id + ':' + rightSide });
        head.classList.remove('speaking');
        g.noteTts(tts);
        if (g.alive()) g.lock('');
      };
      g.replayBtn.onclick = listen;
      listen();
      const answers = {};
      for (const r of rows) {
        const i = await g.choose(r.btns.map((b, k) => [b, k]));
        r.btns.forEach(b => { b.onclick = null; b.disabled = true; });
        r.btns[i].classList.add('chosen');
        answers[r.ear] = r.order[i];
      }
      g.endInput([]);
      const want = { left: leftSide, right: rightSide };
      const correct = ears.every(e => answers[e] === want[e]);
      if (correct) await quickWin(head);
      else {
        rows.forEach(r => r.btns[r.order.indexOf(want[r.ear])].classList.add('hint-correct'));
        await sleep(1400);
      }
      const txt = o => ears.map(e => `${e === 'left' ? 'E' : 'D'}:${pair[o[e]].text}`).join(' ');
      return {
        ...baseResult(pair), ask, expected: txt(want), answer: txt(answers), correct,
        correctLeft: ears.includes('left') ? answers.left === want.left : null,
        correctRight: ears.includes('right') ? answers.right === want.right : null,
        replays: Math.max(0, replays),
      };
    },
  },
});

/* ---------- missões: pontos, patentes e insígnias ---------- */
const RANKS = [
  { min: 0, name: 'Detetive Júnior', icon: '🔎' },
  { min: 400, name: 'Agente', icon: '🕶️' },
  { min: 1200, name: 'Mestre do Som', icon: '🏆' },
];
const rankOf = xp => RANKS.reduce((r, x) => (xp >= x.min ? x : r), RANKS[0]);
const nextRank = xp => RANKS.find(x => x.min > xp) || null;
const BADGE_CONTRASTS = ['td', 'kg', 'fv', 'pb', 'sz', 'chj'];
const starsFor = acc => (acc >= 0.9 ? 3 : acc >= 0.6 ? 2 : 1);

async function getAgent(childId) {
  const a = await DB.kv('agent:' + childId, null);
  return { xp: 0, badges: {}, best: {}, ...(a || {}) };
}
/** Insígnia de um contraste: 90% ou mais em 2 sessões seguidas (com pelo menos 4 tentativas dele em cada). */
async function earnedBadges(childId) {
  const ss = await sessionsOf(childId, 'detetives');
  const out = {};
  for (const c of BADGE_CONTRASTS) {
    const rates = ss.map(s => s.trials.filter(t => t.contrast === c)).filter(t => t.length >= 4).map(t => t.filter(x => x.correct).length / t.length);
    for (let i = 1; i < rates.length; i++) if (rates[i] >= 0.9 && rates[i - 1] >= 0.9) { out[c] = true; break; }
  }
  return out;
}

Rewards.missions = async (child, session, def) => {
  const hits = session.trials.filter(t => t.correct).length;
  const acc = session.trials.length ? hits / session.trials.length : 0;
  const stars = starsFor(acc);
  const prof = await getAgent(child.id);
  const prevXp = prof.xp;
  const xp = hits * 10 + (session.trials.length ? 20 : 0);
  prof.xp += xp;
  prof.best[def.id] = Math.max(prof.best[def.id] || 0, stars);
  const earned = await earnedBadges(child.id);
  const newBadges = Object.keys(earned).filter(c => !prof.badges[c]);
  newBadges.forEach(c => { prof.badges[c] = new Date().toISOString(); });
  let record = null;
  if (def.timed) {
    const key = `record:${child.id}:${def.id}`;
    const old = await DB.kv(key, 0);
    record = { score: hits, best: Math.max(old, hits), isNew: hits > old && hits > 0 };
    if (record.isNew) await DB.setKv(key, hits);
  }
  await DB.setKv('agent:' + child.id, prof);
  return { screen: 'debrief', params: { mode: def.id, stars, xp, prevXp, newBadges, record, adaptive: session.adaptive || null, hits, total: session.trials.length } };
};

function xpBar(xp) {
  const r = rankOf(xp);
  const nx = nextRank(xp);
  const f = nx ? (xp - r.min) / (nx.min - r.min) : 1;
  return h('div', { class: 'xp' },
    h('span', { class: 'xp-rank' }, r.icon, ' ', r.name),
    h('span', { class: 'xp-bar' }, h('span', { class: 'xp-fill', style: `transform:scaleX(${f.toFixed(3)})` })),
    h('span', { class: 'xp-num' }, nx ? `${xp} / ${nx.min} XP` : `${xp} XP`));
}
function badgeShelf(badges) {
  return h('div', { class: 'badges' }, BADGE_CONTRASTS.map(c => h('span', {
    class: 'badge-det' + (badges[c] ? ' got' : ''), style: `--c:${CONTRASTS[c].color}`,
    title: badges[c] ? `Insígnia ${CONTRASTS[c].short}: conquistada` : `Insígnia ${CONTRASTS[c].short}: 90% em 2 sessões seguidas`,
  }, h('span', { class: 'badge-ico' }, badges[c] ? '🏅' : '🔒'), CONTRASTS[c].short)));
}

/* Mapa de fases (menu dos Detetives). */
MenuStyles.map = async (app, { child, acts, top, alive }) => {
  const prof = await getAgent(child.id);
  if (!alive()) return;
  top.append(xpBar(prof.xp));
  app.append(
    acts.length
      ? h('div', { class: 'mission-map' }, acts.map((m, i) => {
        const best = prof.best[m.id] || 0;
        return h('button', { class: 'mission-node' + (best ? ' done' : ''), type: 'button', onclick: () => go('game', { mode: m.id }) },
          h('span', { class: 'mission-num' }, String(i + 1).padStart(2, '0')),
          h('span', { class: 'mission-ico', 'aria-hidden': 'true' }, m.icon),
          h('span', { class: 'mission-name' }, m.name),
          h('span', { class: 'mission-stars', 'aria-label': `${best} estrelas` }, [1, 2, 3].map(k => h('span', { class: k <= best ? 'on' : '' }, '★'))));
      }))
      : h('p', { class: 'empty' }, 'Nenhuma missão ativa para esta criança.'),
    badgeShelf(prof.badges));
};

/* Fim da missão: estrelas, pontos, patente e insígnias novas. */
Screens.debrief = {
  themed: true,
  async render(app, p, alive) {
    const def = ACTIVITIES[p.mode] || {};
    const prevRank = rankOf(p.prevXp);
    const newRank = rankOf(p.prevXp + p.xp);
    const starEls = [1, 2, 3].map(i => h('span', { class: 'rstar' + (i <= p.stars ? ' earned' : '') }, '★'));
    const xpEl = h('div', { class: 'debrief-xp' }, xpBar(p.prevXp));
    const lines = [];
    lines.push(h('p', { class: 'debrief-score' }, `${p.hits} de ${p.total} ${def.timed ? 'acertos em 60 s' : 'acertos'}`));
    if (p.record) lines.push(h('p', { class: 'debrief-line' + (p.record.isNew ? ' gold' : '') }, p.record.isNew ? `⚡ Novo recorde: ${p.record.score}!` : `Seu recorde: ${p.record.best}`));
    if (p.adaptive) {
      const A = ADAPT_INFO[p.adaptive.kind];
      lines.push(h('p', { class: 'debrief-line' }, `Nível máximo: ${def.adaptive ? def.adaptive.label(p.adaptive.max) : p.adaptive.max}`));
      if (A && p.adaptive.kind !== 'word') lines.push(h('p', { class: 'debrief-sub' }, A.detail(p.adaptive.max)));
    }
    const badgeLine = p.newBadges && p.newBadges.length
      ? h('div', { class: 'debrief-badges' }, p.newBadges.map(c => h('span', { class: 'badge-det got big', style: `--c:${CONTRASTS[c].color}` }, h('span', { class: 'badge-ico' }, '🏅'), 'Insígnia ', CONTRASTS[c].short)))
      : null;
    const rankUp = newRank !== prevRank ? h('div', { class: 'rank-up' }, `Nova patente: ${newRank.icon} ${newRank.name}!`) : null;
    const actions = h('div', { class: 'reward-actions' },
      iconBtn('🗺️', 'Voltar ao mapa', () => go('menu')),
      iconBtn('🔁', 'Jogar de novo', () => go('game', { mode: p.mode })));
    add(app, h('div', { class: 'debrief' },
      h('h1', { class: 'debrief-title' }, 'Missão cumprida!'),
      h('p', { class: 'debrief-name' }, `${def.icon || ''} ${def.name || ''}`),
      h('div', { class: 'reward-stars' }, starEls),
      lines,
      xpEl,
      h('p', { class: 'debrief-gain' }, `+${p.xp} XP`),
      rankUp,
      badgeLine,
      actions));
    for (const [i, el] of starEls.entries()) {
      await sleep(i === 0 ? 300 : 400);
      if (!alive()) return;
      el.classList.add('show');
      if (i < p.stars) Sound.chime('star');
    }
    await sleep(300);
    if (!alive()) return;
    xpEl.replaceChildren(xpBar(p.prevXp + p.xp));
    if (rankUp || badgeLine) { Sound.chime('open'); burst(rankUp || badgeLine, ['🏅', '⭐', '✨', '⚡']); }
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

/* =========================================================================
 * 4. ÁREA DA FONO: RODADA, CRIANÇAS, EVOLUÇÃO, BACKUP E AJUSTES
 * ========================================================================= */

const AVATARS = ['🦁', '🐯', '🐻', '🐼', '🐨', '🐸', '🐵', '🦊', '🐰', '🐱', '🐶', '🦄',
  '🐙', '🐢', '🦖', '🐧', '🐝', '🦋', '🐳', '🦉', '🐞', '🦒', '🐘', '🦕'];
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const CONTRAST_ORDER = Object.keys(CONTRASTS);

function statsBy(trials, key) {
  const out = {};
  for (const t of trials) {
    const s = out[t[key]] || (out[t[key]] = { hit: 0, tot: 0 });
    s.tot++;
    if (t.correct) s.hit++;
  }
  return out;
}
const fmtSec = ms => (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';
function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
}
function ago(iso) {
  const d = Math.floor(daysSince(iso));
  return d < 1 ? 'hoje' : d < 2 ? 'ontem' : `há ${d} dias`;
}
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'crianca';
function pctCell(st) {
  if (!st) return '—';
  const p = pct(st.hit, st.tot);
  return h('span', { class: 'pct ' + (p >= 85 ? 'hi' : p >= 60 ? 'mid' : 'lo') }, p + '%');
}

/* ---------- salvar arquivos (CSV e backup) ---------- */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: 'display:none' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function canShareFile(file) {
  try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { return false; }
}
async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'ok';
  } catch (e) {
    return e && e.name === 'AbortError' ? 'cancel' : 'fail';
  }
}
/** No iPad, abrir o menu Compartilhar (Salvar em Arquivos, e-mail, WhatsApp…); nos outros, baixar. */
function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (IS_IOS && canShareFile(file)) {
    shareFile(file).then(r => { if (r === 'fail') downloadBlob(blob, name); });
    return;
  }
  downloadBlob(blob, name);
}

/* ---------- lembrete de backup ---------- */
async function backupDue() {
  try {
    const last = await DB.kv('lastBackup', null);
    if (last && daysSince(last) <= 14) return false;
    return Bank.recorded.size > 0 || (await DB.count('sessions')) > 0 || (await DB.count('children')) > 0;
  } catch (_) {
    return false;
  }
}
FonoBanners.push(async (el, show) => {
  if (!(await backupDue())) return;
  const last = await DB.kv('lastBackup', null);
  el.append(h('div', { class: 'banner warn backup-reminder' },
    h('span', { class: 'banner-ico', 'aria-hidden': 'true' }, '💾'),
    h('span', { class: 'banner-text' },
      h('strong', null, last ? `Seu último backup foi ${ago(last)}. ` : 'Você ainda não fez nenhum backup. '),
      'Os dados ficam só neste aparelho: faça um backup para não perder as gravações e o histórico.'),
    h('button', { class: 'btn small', type: 'button', onclick: () => show('backup') }, 'Fazer backup')));
});

/* ---------- progressão sugerida ----------
 * Começar misturando contrastes diferentes; com dados suficientes, sugerir
 * focar no contraste com menos acertos; quando tudo estiver alto, voltar a misturar. */
async function suggestFocus(childId, gid) {
  const recent = (await sessionsOf(childId, gid)).filter(s => s.trials.some(t => CONTRASTS[t.contrast])).slice(-6);
  const trials = recent.flatMap(s => s.trials).filter(t => CONTRASTS[t.contrast]);
  const list = Object.entries(statsBy(trials, 'contrast'))
    .filter(([, s]) => s.tot >= 4)
    .map(([contrast, s]) => ({ contrast, hit: s.hit, tot: s.tot, rate: s.hit / s.tot }))
    .sort((a, b) => a.rate - b.rate);
  if (trials.length < 12 || !list.length) return { type: 'none', list, sessions: recent.length };
  const worst = list[0];
  if (worst.rate >= 0.85) return { type: 'good', list, sessions: recent.length };
  if (list.length === 1 || worst.rate < 0.7 || list[1].rate - worst.rate >= 0.15) return { type: 'focus', worst, list, sessions: recent.length };
  return { type: 'mix', list, sessions: recent.length };
}
const targetsLabel = G => G.targets.map(c => CONTRASTS[c].short).join(', ');
function suggestionCard(sug, applyIds, G) {
  const idsOf = cs => Bank.inGroup(G.id).filter(p => cs.includes(p.contrast)).map(p => p.id);
  const mixBtn = () => h('button', { class: 'btn small', type: 'button', onclick: () => applyIds(idsOf(G.targets)) }, 'Misturar os pares-alvo');
  let text;
  let action = null;
  if (sug.type === 'none') {
    text = `Ainda há poucos dados desta criança nesta faixa. Sugestão: comece misturando pares de fonemas diferentes (${targetsLabel(G)}) para descobrir em qual contraste ela tem mais dificuldade.`;
    action = mixBtn();
  } else if (sug.type === 'focus') {
    const c = CONTRASTS[sug.worst.contrast] || CONTRASTS.outro;
    text = `Sugestão: focar em ${c.short} (${c.label}). Nas últimas sessões foi o contraste com menos acertos: ${pct(sug.worst.hit, sug.worst.tot)}% em ${sug.worst.tot} tentativas.`;
    action = h('button', { class: 'btn small primary', type: 'button', onclick: () => applyIds(idsOf([sug.worst.contrast])) }, `Focar em ${c.short}`);
  } else if (sug.type === 'good') {
    text = 'Acertos altos (85% ou mais) em tudo o que foi treinado nas últimas sessões. Sugestão: voltar a misturar contrastes ou incluir um par opcional.';
    action = mixBtn();
  } else {
    text = 'Os acertos estão parecidos entre os contrastes treinados. Sugestão: continuar misturando.';
  }
  return h('div', { class: 'suggest' },
    h('span', { class: 'banner-ico', 'aria-hidden': 'true' }, '💡'),
    h('div', { class: 'suggest-body' },
      h('p', null, text),
      sug.list.length > 0 && h('div', { class: 'row wrap' },
        h('span', { class: 'muted small' }, `Últimas ${sug.sessions} sessões:`),
        sug.list.map(x => h('span', { class: 'rate-chip' }, contrastChip(x.contrast), ` ${pct(x.hit, x.tot)}%`))),
      action));
}
async function setKidGroup(kid, gid) {
  const d = { ...kid, group: gid };
  await DB.put('children', d);
  if (State.child && State.child.id === d.id) State.child = d;
  return d;
}

/* ---------- aba "Rodada": faixa, atividades e pares de cada criança ---------- */
FonoTabs.push({ id: 'rodada', label: 'Rodada', icon: '🎯', order: 1, render: renderRoundTab });

async function renderRoundTab(el) {
  const kids = await allChildren();
  const opts = [...kids, GUEST];
  let childId = State.child && opts.some(k => k.id === State.child.id) ? State.child.id : opts[0].id;
  let guestGroup = State.group;
  const kidOf = id => opts.find(k => k.id === id);
  const sel = h('select', { class: 'input' }, opts.map(k => h('option', { value: k.id }, `${k.avatar} ${k.nick}`)));
  sel.value = childId;
  const groupSel = h('select', { class: 'input' }, GROUP_ORDER.map(id => h('option', { value: id }, `${AGE_GROUPS[id].icon} ${AGE_GROUPS[id].name} (${AGE_GROUPS[id].ages})`)));
  const groupNote = h('span', { class: 'muted small' });
  const gidNow = () => (childId === GUEST.id ? guestGroup : kidGroup(kidOf(childId)));
  sel.onchange = () => { childId = sel.value; draw(); };
  groupSel.onchange = async () => {
    if (childId === GUEST.id) guestGroup = groupSel.value;
    else {
      const k = await setKidGroup(kidOf(childId), groupSel.value);
      opts[opts.findIndex(x => x.id === k.id)] = k;
      toast(`${k.nick} agora está em ${AGE_GROUPS[k.group].name}.`);
    }
    draw();
  };
  const box = h('div');
  add(el, [
    h('h2', null, 'Próxima rodada'),
    h('p', { class: 'muted' }, 'Para cada criança: a faixa etária, quais atividades aparecem e quais pares entram no jogo. Tudo fica salvo para as próximas sessões.'),
    h('div', { class: 'row wrap filters' },
      h('label', { class: 'field inline' }, h('span', null, 'Criança'), sel),
      h('label', { class: 'field inline' }, h('span', null, 'Faixa'), groupSel)),
    groupNote,
    box,
  ]);

  async function draw() {
    const gid = gidNow();
    const G = AGE_GROUPS[gid];
    groupSel.value = gid;
    groupNote.textContent = childId === GUEST.id
      ? 'Visitante joga na faixa escolhida na tela inicial; aqui você ajusta o que aparece em cada faixa.'
      : 'A faixa fica no cadastro da criança: ela aparece na tela de escolha dessa faixa.';
    const ids = new Set(await roundPairIds(childId, gid));
    const sug = await suggestFocus(childId, gid);
    const custom = await childActs(childId, gid);
    const groupPairs = Bank.inGroup(gid);
    const save = () => saveRoundPairIds(childId, gid, groupPairs.filter(p => ids.has(p.id)).map(p => p.id));
    const setIds = list => { ids.clear(); list.forEach(id => ids.add(id)); save(); draw(); };

    /* atividades: pacote padrão da faixa ou escolha individual */
    const acts = G.activities.filter(id => ACTIVITIES[id]).map(id => ACTIVITIES[id]);
    const usePack = h('input', { type: 'radio', name: 'actmode', checked: !custom });
    const useCustom = h('input', { type: 'radio', name: 'actmode', checked: !!custom });
    const state = {};
    acts.forEach(a => { state[a.id] = custom && a.id in custom ? !!custom[a.id] : packOn(gid, a.id); });
    const saveActs = () => DB.setKv(`acts:${childId}:${gid}`, useCustom.checked ? { ...state } : null);
    const actRows = acts.map(a => {
      const cb = h('input', { type: 'checkbox', checked: state[a.id], disabled: !custom });
      cb.onchange = () => {
        if (!cb.checked && acts.filter(x => state[x.id]).length <= 1) { cb.checked = true; toast('Deixe pelo menos uma atividade ligada.'); return; }
        state[a.id] = cb.checked;
        saveActs();
      };
      return h('label', { class: 'act-check' + (custom ? '' : ' locked') }, cb,
        h('span', { class: 'act-ico', 'aria-hidden': 'true' }, a.icon || '🎲'),
        h('span', { class: 'act-text' }, h('strong', null, a.name), G.offByDefault.includes(a.id) && h('span', { class: 'badge' }, 'opcional'),
          h('span', { class: 'muted small' }, a.desc || '')));
    });
    usePack.onchange = () => { saveActs(); draw(); };
    useCustom.onchange = () => { saveActs(); draw(); };

    /* pares */
    const count = h('p', { class: 'round-count' });
    const updateCount = () => {
      const chosen = groupPairs.filter(p => ids.has(p.id));
      const fig = chosen.filter(p => p.figure).length;
      const noRec = chosen.filter(p => !Bank.hasAudio(p, 'a') || !Bank.hasAudio(p, 'b')).length;
      count.replaceChildren(
        h('strong', null, `${chosen.length} ${chosen.length === 1 ? 'par selecionado' : 'pares selecionados'}`),
        G.theme === 'kids' && ` · ${fig} com figura (usados em “Qual eu falei?” e “Ajude o bichinho”)`,
        noRec > 0 && h('span', { class: 'warn-text' }, ` · ${noRec} sem gravação completa (voz sintética)`));
    };
    const groups = CONTRAST_ORDER.map(cid => {
      const pairs = groupPairs.filter(p => p.contrast === cid);
      if (!pairs.length) return null;
      const all = h('input', { type: 'checkbox' });
      const syncGroup = () => {
        const n = pairs.filter(p => ids.has(p.id)).length;
        all.checked = n === pairs.length;
        all.indeterminate = n > 0 && n < pairs.length;
      };
      all.onchange = () => { pairs.forEach(p => (all.checked ? ids.add(p.id) : ids.delete(p.id))); save(); draw(); };
      const rows = pairs.map(p => {
        const cb = h('input', { type: 'checkbox', checked: ids.has(p.id) });
        cb.onchange = () => { if (cb.checked) ids.add(p.id); else ids.delete(p.id); save(); syncGroup(); updateCount(); };
        return h('label', { class: 'pair-check' }, cb,
          h('span', { class: 'mini-figs' }, h('span', null, figureEl(p, 'a')), h('span', null, figureEl(p, 'b'))),
          h('span', { class: 'pair-words' }, `${p.a.text} × ${p.b.text}`),
          G.theme === 'kids' && !p.figure && h('span', { class: 'badge sound' }, 'só som'),
          (!Bank.hasAudio(p, 'a') || !Bank.hasAudio(p, 'b')) && h('span', { class: 'badge warn' }, 'sem gravação'));
      });
      syncGroup();
      return h('fieldset', { class: 'round-group' },
        h('legend', null, h('label', { class: 'group-check' }, all, contrastChip(cid),
          !G.targets.includes(cid) && h('span', { class: 'muted small' }, 'opcional'))),
        rows);
    });
    box.replaceChildren(
      h('h3', null, 'Atividades'),
      h('div', { class: 'act-mode' },
        h('label', { class: 'radio' }, usePack, h('span', null, h('strong', null, 'Pacote padrão da faixa'), ' (muda em Ajustes)')),
        h('label', { class: 'radio' }, useCustom, h('span', null, h('strong', null, 'Escolher para esta criança')))),
      h('div', { class: 'act-list' }, actRows),
      h('h3', null, 'Pares de palavras'),
      suggestionCard(sug, setIds, G),
      h('div', { class: 'row wrap quick' },
        h('button', { class: 'btn small', type: 'button', onclick: () => setIds(groupPairs.filter(p => G.targets.includes(p.contrast)).map(p => p.id)) }, `Pares-alvo (${targetsLabel(G)})`),
        h('button', { class: 'btn small', type: 'button', onclick: () => setIds(groupPairs.map(p => p.id)) }, 'Todos'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => setIds([]) }, 'Nenhum')),
      count,
      ...groups.filter(Boolean));
    updateCount();
  }
  await draw();
}

/* ---------- aba "Crianças" ---------- */
FonoTabs.push({ id: 'criancas', label: 'Crianças', icon: '🧒', order: 3, render: renderKidsTab });

async function renderKidsTab(el, show) {
  const kids = await allChildren();
  const sessions = await allSessions();
  const rerender = () => show('criancas');
  add(el, [
    h('div', { class: 'tab-head' },
      h('h2', null, 'Crianças'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => kidDialog(null, rerender) }, '➕ Nova criança')),
    h('p', { class: 'muted' }, 'Só apelido, avatar e faixa: nenhum dado pessoal é guardado. Na tela inicial você escolhe a faixa e a criança toca no próprio avatar.'),
    kids.length
      ? h('div', { class: 'kid-list' }, kids.map(k => {
        const ss = sessions.filter(s => s.childId === k.id);
        const last = ss.map(s => s.date).sort().pop();
        const G = groupOf(k.group);
        return h('div', { class: 'kid-row' },
          h('span', { class: 'avatar' }, k.avatar),
          h('div', { class: 'kid-info' },
            h('strong', null, k.nick),
            h('span', { class: 'muted small' }, `${G.icon} ${G.name} · ${ss.length} ${ss.length === 1 ? 'sessão' : 'sessões'}` + (last ? ` · última em ${fmtDate(last)}` : ''))),
          h('button', { class: 'btn small', type: 'button', onclick: () => kidDialog(k, rerender) }, '✏️ Editar'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Apagar criança', title: 'Apagar criança', onclick: () => deleteKid(k, rerender) }, '🗑️'));
      }))
      : h('p', { class: 'empty' }, 'Nenhuma criança cadastrada. Enquanto isso, o jogo usa “Visitante”.'),
  ]);
}

function kidDialog(kid, onDone) {
  const d = kid ? { ...kid } : { id: uid(), nick: '', avatar: AVATARS[rand(AVATARS.length)], group: State.group, created: new Date().toISOString() };
  const nick = h('input', { class: 'input', type: 'text', value: d.nick, maxlength: 20, autocomplete: 'off', placeholder: 'Ex.: Lulu' });
  const grid = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': 'Avatar' });
  const paint = () => grid.replaceChildren(...AVATARS.map(a => h('button', {
    class: 'avatar-opt' + (a === d.avatar ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(a === d.avatar),
    onclick: () => { d.avatar = a; paint(); },
  }, a)));
  paint();
  const groupRadios = GROUP_ORDER.map(id => {
    const r = h('input', { type: 'radio', name: 'kidgroup', checked: kidGroup(d) === id });
    r.onchange = () => { if (r.checked) d.group = id; };
    const G = AGE_GROUPS[id];
    return h('label', { class: 'radio' }, r, h('span', null, h('strong', null, `${G.icon} ${G.name}`), ` — ${G.ages}`));
  });
  const save = async () => {
    d.nick = nick.value.trim();
    if (!d.nick) { toast('Escreva um apelido.'); return; }
    if (!AGE_GROUPS[d.group]) d.group = DEFAULT_GROUP;
    await DB.put('children', d);
    if (State.child && State.child.id === d.id) State.child = d;
    closeOverlay();
    onDone();
  };
  openOverlay([
    h('h2', null, kid ? 'Editar criança' : 'Nova criança'),
    h('label', { class: 'field' }, h('span', null, 'Apelido'), nick),
    h('div', { class: 'field' }, h('span', null, 'Faixa'), groupRadios),
    h('div', { class: 'field' }, h('span', null, 'Avatar'), grid),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: closeOverlay }, 'Cancelar'),
      h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Salvar')),
  ], { dismissible: false });
}

async function deleteKid(kid, onDone) {
  if (!(await confirmBox(`Apagar “${kid.nick}” e todo o histórico desta criança? Isso não pode ser desfeito.`, { ok: 'Apagar', danger: true }))) return;
  const ids = (await DB.all('sessions')).filter(s => s.childId === kid.id).map(s => s.id);
  // Chaves de ajustes desta criança: album:id, round:id[:faixa], acts:id:faixa, adapt:id:atividade, agent:id, record:id:…
  const keys = (await DB.read('kv', s => s.getAllKeys())).filter(k => String(k).split(':')[1] === kid.id);
  await DB.write(['children', 'sessions', 'kv'], t => {
    t.objectStore('children').delete(kid.id);
    ids.forEach(id => t.objectStore('sessions').delete(id));
    keys.forEach(k => t.objectStore('kv').delete(k));
  });
  if (State.child && State.child.id === kid.id) State.child = null;
  onDone();
}

function lineChart(series, labels) {
  const W = 640;
  const H = 260;
  const L = 46;
  const R = 16;
  const T = 14;
  const B = 34;
  const n = labels.length;
  const x = i => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = v => T + (1 - v) * (H - T - B);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentagem de acertos por contraste em cada sessão">`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`
      + `<text class="axis" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  }
  const step = Math.ceil(n / 8);
  labels.forEach((lab, i) => {
    if (i % step === 0) s += `<text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${lab}</text>`;
  });
  for (const se of series) {
    let d = '';
    se.values.forEach((v, i) => { if (v != null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; });
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    se.values.forEach((v, i) => {
      if (v == null) return;
      s += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5" fill="#fff" stroke="${se.color}" stroke-width="3">`
        + `<title>${se.name}: ${Math.round(v * 100)}% (${labels[i]})</title></circle>`;
    });
  }
  return s + '</svg>';
}

/* ---------- aba "Evolução": relatório por faixa, por atividade e por par ---------- */
FonoTabs.push({ id: 'evolucao', label: 'Evolução', icon: '📈', order: 4, render: renderProgressTab });

const actName = id => (ACTIVITIES[id] ? ACTIVITIES[id].name : id);
const trialKey = t => t.itemKey || t.pairId || t.item || '?';
const trialLabel = t => t.words || t.item || '?';
/** Texto do nível alcançado numa sessão adaptativa (ou do recorde da Missão relâmpago). */
function levelText(s) {
  if (s.timed) return `${s.score || 0} acertos em ${s.timed} s`;
  const a = s.adaptive;
  if (!a) return '';
  const def = ACTIVITIES[s.mode];
  const lab = l => (def && def.adaptive ? def.adaptive.label(l) : String(l));
  const info = ADAPT_INFO[a.kind];
  return `máx. ${lab(a.max)}` + (info && a.kind !== 'seq' ? ` (${info.detail(a.max)})` : '') + ` · terminou em ${lab(a.end)}`;
}
/** Resumo por atividade: sessões, tentativas, acerto e o melhor nível alcançado. */
function activitySummary(ss) {
  const by = {};
  for (const s of ss) {
    const a = by[s.mode] || (by[s.mode] = { mode: s.mode, sessions: 0, hit: 0, tot: 0, maxLevel: null, kind: null, bestScore: null, maxSeq: null });
    a.sessions++;
    a.tot += s.trials.length;
    a.hit += s.trials.filter(t => t.correct).length;
    if (s.adaptive) { a.kind = s.adaptive.kind; a.maxLevel = Math.max(a.maxLevel || 0, s.adaptive.max); }
    if (s.timed) a.bestScore = Math.max(a.bestScore || 0, s.score || 0);
    const seq = s.trials.filter(t => t.seqLen && t.correct).map(t => t.seqLen);
    if (seq.length) a.maxSeq = Math.max(a.maxSeq || 0, ...seq);
  }
  return Object.values(by);
}
function summaryDetail(a) {
  const def = ACTIVITIES[a.mode];
  if (a.bestScore != null) return `recorde: ${a.bestScore} acertos em 60 s`;
  if (a.mode === 'code' || a.mode === 'memory') return a.maxSeq ? `maior sequência certa: ${a.maxSeq}` : 'nenhuma sequência certa ainda';
  if (a.maxLevel != null && def && def.adaptive) {
    const info = ADAPT_INFO[a.kind];
    return `nível máximo: ${def.adaptive.label(a.maxLevel)}` + (info ? ` (${info.detail(a.maxLevel)})` : '');
  }
  return '';
}

function exportCsv(sessions, base, nickOf) {
  const head = ['data', 'hora', 'crianca', 'faixa', 'atividade', 'sessao_completa', 'contraste', 'par_ou_item', 'tentativas', 'acertos', 'erros',
    'percentual_acerto', 'vezes_que_ouviu_de_novo', 'voz_sintetica', 'nivel_tipo', 'nivel_inicial', 'nivel_final', 'nivel_maximo', 'sequencia_max_certa', 'acertos_em_60s'];
  const rows = [];
  for (const s of sessions.map(normSession).sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(s.date);
    const byItem = {};
    for (const t of s.trials) {
      const k = trialKey(t);
      const p = byItem[k] || (byItem[k] = { contrast: t.contrast, words: trialLabel(t), hit: 0, tot: 0, replays: 0, tts: false, seq: null });
      p.tot++;
      if (t.correct) { p.hit++; if (t.seqLen) p.seq = Math.max(p.seq || 0, t.seqLen); }
      p.replays += t.replays || 0;
      if (t.tts) p.tts = true;
    }
    const a = s.adaptive;
    const info = a && ADAPT_INFO[a.kind];
    for (const p of Object.values(byItem)) {
      rows.push([
        d.toLocaleDateString('pt-BR'), d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        nickOf(s.childId), groupOf(s.group).name, actName(s.mode), s.complete ? 'sim' : 'não',
        CONTRASTS[p.contrast] ? CONTRASTS[p.contrast].short : '', p.words, p.tot, p.hit, p.tot - p.hit, pct(p.hit, p.tot),
        p.replays, p.tts ? 'sim' : 'não',
        info ? info.name : '', a ? a.start : '', a ? a.end : '', a ? a.max : '', p.seq || '', s.timed ? s.score || 0 : '',
      ]);
    }
  }
  const escCsv = v => {
    const s = String(v == null ? '' : v);
    return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // Separador ";" e BOM: abre certinho no Excel em português.
  const csv = '﻿' + [head, ...rows].map(r => r.map(escCsv).join(';')).join('\r\n');
  saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${base}-${new Date().toISOString().slice(0, 10)}.csv`);
}

async function renderProgressTab(el) {
  const kids = await allChildren();
  const all = await allSessions();
  const opts = kids.slice();
  if (all.some(s => s.childId === GUEST.id)) opts.push(GUEST);
  const nickOf = id => (opts.find(k => k.id === id) || { nick: '(removida)' }).nick;
  add(el, h('div', { class: 'tab-head' },
    h('h2', null, 'Evolução'),
    all.length > 0 && h('button', { class: 'btn small', type: 'button', onclick: () => exportCsv(all, 'escuta-so-historico-completo', nickOf) }, '⬇️ CSV de todas as crianças')));
  if (!opts.length || !all.length) {
    el.append(h('p', { class: 'empty' }, 'Nenhuma sessão registrada ainda. Os resultados aparecem aqui depois que a criança jogar uma rodada.'));
    return;
  }
  let childId = State.child && opts.some(k => k.id === State.child.id) ? State.child.id : opts[0].id;
  let gid = null;
  let modeF = 'all';
  const childSel = h('select', { class: 'input' }, opts.map(k => h('option', { value: k.id }, `${k.avatar} ${k.nick}`)));
  childSel.value = childId;
  const groupSel = h('select', { class: 'input' });
  const modeSel = h('select', { class: 'input' });
  childSel.onchange = () => { childId = childSel.value; gid = null; modeF = 'all'; draw(); };
  groupSel.onchange = () => { gid = groupSel.value; modeF = 'all'; draw(); };
  modeSel.onchange = () => { modeF = modeSel.value; draw(); };
  const body = h('div');
  add(el, [
    h('div', { class: 'row wrap filters' },
      h('label', { class: 'field inline' }, h('span', null, 'Criança'), childSel),
      h('label', { class: 'field inline' }, h('span', null, 'Faixa'), groupSel),
      h('label', { class: 'field inline' }, h('span', null, 'Atividade'), modeSel)),
    body,
  ]);

  function draw() {
    const mine = all.filter(s => s.childId === childId);
    const groupsWithData = GROUP_ORDER.filter(g => mine.some(s => s.group === g));
    const kid = opts.find(k => k.id === childId);
    if (!gid || !groupsWithData.includes(gid)) gid = groupsWithData.includes(kidGroup(kid)) ? kidGroup(kid) : (groupsWithData[0] || kidGroup(kid));
    groupSel.replaceChildren(...GROUP_ORDER.map(g => h('option', { value: g }, `${AGE_GROUPS[g].icon} ${AGE_GROUPS[g].name}` + (groupsWithData.includes(g) ? '' : ' (sem sessões)'))));
    groupSel.value = gid;
    const inGroup = mine.filter(s => s.group === gid);
    const modes = [...new Set(inGroup.map(s => s.mode))].sort((a, b) => groupOf(gid).activities.indexOf(a) - groupOf(gid).activities.indexOf(b));
    if (modeF !== 'all' && !modes.includes(modeF)) modeF = 'all';
    modeSel.replaceChildren(h('option', { value: 'all' }, 'Todas as atividades'), ...modes.map(m => h('option', { value: m }, actName(m))));
    modeSel.value = modeF;

    const ss = inGroup.filter(s => modeF === 'all' || s.mode === modeF).sort((a, b) => a.date.localeCompare(b.date));
    body.replaceChildren();
    if (!ss.length) { body.append(h('p', { class: 'empty' }, 'Nenhuma sessão com esse filtro.')); return; }
    const trials = ss.flatMap(s => s.trials);
    const cTrials = trials.filter(t => CONTRASTS[t.contrast]);
    const byC = statsBy(cTrials, 'contrast');
    const contrasts = CONTRAST_ORDER.filter(c => byC[c]);
    const perSession = ss.map(s => statsBy(s.trials.filter(t => CONTRASTS[t.contrast]), 'contrast'));
    const lastOf = c => { for (let i = perSession.length - 1; i >= 0; i--) if (perSession[i][c]) return perSession[i][c]; return null; };

    /* por contraste */
    const cards = contrasts.length ? h('div', { class: 'stat-cards' }, contrasts.map(c => h('div', { class: 'stat-card', style: `--c:${CONTRASTS[c].color}` },
      contrastChip(c),
      h('div', { class: 'stat-big' }, pct(byC[c].hit, byC[c].tot) + '%'),
      h('div', { class: 'muted small' }, `${byC[c].hit} de ${byC[c].tot} acertos`),
      h('div', { class: 'small' }, 'última sessão: ', pctCell(lastOf(c)))))) : null;
    const series = contrasts.map(c => ({
      name: CONTRASTS[c].short, color: CONTRASTS[c].color,
      values: perSession.map(st => (st[c] ? st[c].hit / st[c].tot : null)),
    }));
    const withC = ss.map((s, i) => i).filter(i => Object.keys(perSession[i]).length);
    const chart = series.length && withC.length ? h('div', { class: 'chart-box', html: lineChart(series.map(se => ({ ...se, values: withC.map(i => se.values[i]) })), withC.map(i => fmtShortDate(ss[i].date))) }) : null;
    const legend = series.length ? h('div', { class: 'legend' }, series.map(se => h('span', { class: 'legend-item' }, h('span', { class: 'legend-dot', style: `background:${se.color}` }), se.name))) : null;

    /* por atividade */
    const sums = activitySummary(ss).sort((a, b) => groupOf(gid).activities.indexOf(a.mode) - groupOf(gid).activities.indexOf(b.mode));
    const actTable = h('table', { class: 'data' },
      h('thead', null, h('tr', null, h('th', null, 'Atividade'), h('th', { class: 'num' }, 'Sessões'), h('th', { class: 'num' }, 'Tentativas'), h('th', { class: 'num' }, 'Acerto'), h('th', null, 'Nível / sequência / recorde'))),
      h('tbody', null, sums.map(a => h('tr', null,
        h('td', null, `${ACTIVITIES[a.mode] ? ACTIVITIES[a.mode].icon : ''} ${actName(a.mode)}`), h('td', { class: 'num' }, a.sessions), h('td', { class: 'num' }, a.tot),
        h('td', { class: 'num' }, pctCell({ hit: a.hit, tot: a.tot })), h('td', { class: 'small wrap' }, summaryDetail(a))))));

    /* por par (ou item) */
    let itemTable;
    if (modeF === 'all') {
      // Matriz: cada par de palavras × cada atividade que usou pares.
      const actCols = modes.filter(m => ss.some(s => s.mode === m && s.trials.some(t => t.pairId)));
      const rows = {};
      for (const s of ss) for (const t of s.trials) {
        if (!t.pairId) continue;
        const r = rows[t.pairId] || (rows[t.pairId] = { contrast: t.contrast, words: t.words, all: { hit: 0, tot: 0 }, by: {} });
        const b = r.by[s.mode] || (r.by[s.mode] = { hit: 0, tot: 0 });
        b.tot++; r.all.tot++;
        if (t.correct) { b.hit++; r.all.hit++; }
      }
      const list = Object.values(rows).sort((a, b) => (CONTRAST_ORDER.indexOf(a.contrast) - CONTRAST_ORDER.indexOf(b.contrast)) || a.words.localeCompare(b.words, 'pt-BR'));
      itemTable = list.length ? h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Contraste'), h('th', null, 'Par'), actCols.map(m => h('th', { class: 'num' }, actName(m))), h('th', { class: 'num' }, 'Geral'))),
        h('tbody', null, list.map(r => h('tr', null,
          h('td', null, CONTRASTS[r.contrast] ? contrastChip(r.contrast) : '—'), h('td', null, r.words),
          actCols.map(m => h('td', { class: 'num' }, r.by[m] ? pctCell(r.by[m]) : '—')),
          h('td', { class: 'num' }, pctCell(r.all), h('span', { class: 'muted small' }, ` (${r.all.tot})`)))))) : null;
    } else {
      const byI = {};
      for (const t of trials) {
        const k = trialKey(t);
        const r = byI[k] || (byI[k] = { contrast: t.contrast, words: trialLabel(t), st: { hit: 0, tot: 0 } });
        r.st.tot++;
        if (t.correct) r.st.hit++;
      }
      const lastS = ss[ss.length - 1];
      const lastBy = {};
      for (const t of lastS.trials) { const k = trialKey(t); const r = lastBy[k] || (lastBy[k] = { hit: 0, tot: 0 }); r.tot++; if (t.correct) r.hit++; }
      const list = Object.entries(byI).sort(([, a], [, b]) => (CONTRAST_ORDER.indexOf(a.contrast) - CONTRAST_ORDER.indexOf(b.contrast)) || a.words.localeCompare(b.words, 'pt-BR'));
      itemTable = h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Contraste'), h('th', null, 'Par / item'), h('th', { class: 'num' }, 'Tentativas'), h('th', { class: 'num' }, 'Acerto geral'), h('th', { class: 'num' }, 'Última sessão'))),
        h('tbody', null, list.map(([k, r]) => h('tr', null,
          h('td', null, CONTRASTS[r.contrast] ? contrastChip(r.contrast) : '—'), h('td', null, r.words), h('td', { class: 'num' }, r.st.tot),
          h('td', { class: 'num' }, pctCell(r.st)), h('td', { class: 'num' }, pctCell(lastBy[k]))))));
    }

    /* sessões */
    const list = h('div', { class: 'session-list' }, ss.slice().reverse().map(s => {
      const hit = s.trials.filter(t => t.correct).length;
      const byc = statsBy(s.trials.filter(t => CONTRASTS[t.contrast]), 'contrast');
      const del = async () => {
        if (!(await confirmBox(`Apagar a sessão de ${fmtDateTime(s.date)}?`, { ok: 'Apagar', danger: true }))) return;
        await DB.del('sessions', s.id);
        all.splice(all.indexOf(s), 1);
        draw();
      };
      const lv = levelText(s);
      return h('div', { class: 'session-row' },
        h('div', { class: 'session-main' },
          h('strong', null, fmtDateTime(s.date)),
          h('span', { class: 'muted small' }, actName(s.mode) + (s.complete ? '' : ' · incompleta')),
          lv && h('span', { class: 'small level-text' }, lv)),
        h('div', { class: 'row wrap session-chips' }, CONTRAST_ORDER.filter(c => byc[c]).map(c => h('span', { class: 'rate-chip' }, contrastChip(c), ` ${byc[c].hit}/${byc[c].tot}`))),
        h('strong', { class: 'session-score' }, `${hit}/${s.trials.length}`),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Apagar sessão', title: 'Apagar sessão', onclick: del }, '🗑️'));
    }));

    add(body, [
      cards && h('h3', null, 'Acerto por contraste'),
      cards,
      chart && h('h3', null, 'Acerto por contraste ao longo das sessões'),
      chart,
      legend,
      modeF === 'all' && h('h3', null, 'Por atividade'),
      modeF === 'all' && h('div', { class: 'table-wrap' }, actTable),
      modeF !== 'all' && sums[0] && summaryDetail(sums[0]) && h('p', { class: 'level-summary' }, h('strong', null, summaryDetail(sums[0]))),
      itemTable && h('h3', null, modeF === 'all' ? 'Acerto por par em cada atividade' : 'Acerto por par / item'),
      itemTable && h('div', { class: 'table-wrap' }, itemTable),
      h('div', { class: 'tab-head section-head' },
        h('h3', null, `Sessões (${ss.length})`),
        h('button', { class: 'btn small', type: 'button', onclick: () => exportCsv(ss, `escuta-so-${slug(nickOf(childId))}-${gid}`, nickOf) }, '⬇️ CSV deste filtro')),
      list,
    ]);
  }
  draw();
}

/* ---------- aba "Backup" ---------- */
FonoTabs.push({ id: 'backup', label: 'Backup', icon: '💾', order: 5, render: renderBackupTab });

function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToAb(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
async function buildBackup() {
  const [pairs, audio, children, sessions, kv] = await Promise.all(STORES.map(s => DB.all(s)));
  const word = w => ({ ...w, img: w.img ? { mime: w.img.mime, data: abToB64(w.img.data) } : null });
  return {
    app: 'escuta-so',
    format: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    pairs: pairs.map(p => ({ ...p, a: word(p.a), b: word(p.b) })),
    audio: audio.map(r => ({ ...r, data: abToB64(r.data) })),       // gravações em base64
    children,
    sessions,
    kv: kv.filter(k => k.key !== 'lastBackup'),
  };
}
function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (_) { data = null; }
  if (!data || data.app !== 'escuta-so' || !Array.isArray(data.pairs)) throw new Error('Este arquivo não é um backup do Escuta Só!.');
  if (data.format > 2) throw new Error('Este backup foi feito por uma versão mais nova do jogo. Atualize o jogo e tente de novo.');
  for (const k of ['audio', 'children', 'sessions', 'kv']) if (!Array.isArray(data[k])) data[k] = [];
  return data;
}
async function restoreBackup(data) {
  // Converte tudo antes de apagar qualquer coisa: se o arquivo estiver estragado, nada se perde.
  const word = w => ({ ...w, img: w && w.img ? { mime: w.img.mime, data: b64ToAb(w.img.data) } : null });
  // Backups da versão 1 (sem faixas) são aceitos: os campos novos são preenchidos aqui.
  const pairs = data.pairs.map(p => normPair({ ...p, a: word(p.a), b: word(p.b) }));
  const audio = data.audio.map(r => ({ ...r, data: b64ToAb(r.data) }));
  const children = data.children.map(normKid);
  const sessions = data.sessions.map(normSession);
  await DB.write(STORES, t => {
    STORES.forEach(s => t.objectStore(s).clear());
    pairs.forEach(p => t.objectStore('pairs').put(p));
    audio.forEach(r => t.objectStore('audio').put(r));
    children.forEach(c => t.objectStore('children').put(c));
    sessions.forEach(s => t.objectStore('sessions').put(s));
    data.kv.forEach(k => t.objectStore('kv').put(k));
    t.objectStore('kv').put({ key: 'seeded', value: true });
    t.objectStore('kv').put({ key: 'lastBackup', value: data.exportedAt || new Date().toISOString() });
  });
  Sound.cache.clear();
  State.child = null;
  await Bank.seed();            // backup antigo: acrescenta o banco dos Detetives sem mexer no resto
  await Bank.load();
  await loadSettings();
}

async function renderBackupTab(el, show) {
  const last = await DB.kv('lastBackup', null);
  const counts = {
    pairs: Bank.pairs.length, audio: Bank.recorded.size,
    kids: await DB.count('children'), sessions: await DB.count('sessions'),
  };
  const lastLine = h('p', { class: last && daysSince(last) <= 14 ? 'ok-text' : 'warn-text' },
    last ? `Último backup: ${fmtDateTime(last)} (${ago(last)}).` : 'Nenhum backup feito ainda.');
  const out = h('div', { class: 'backup-out' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileInput.onchange = () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) doImport(f); };

  add(el, [
    h('h2', null, 'Backup'),
    h('p', null, 'Tudo fica guardado só neste aparelho. Se o navegador for limpo, o jogo for desinstalado ou o tablet for trocado, os dados se perdem. Por isso, faça backup com frequência e guarde o arquivo fora do tablet (e-mail, WhatsApp, Google Drive ou Arquivos do iCloud).'),
    lastLine,
    h('p', { class: 'muted small' }, `Neste aparelho: ${counts.pairs} pares de palavras, ${counts.audio} gravações, ${counts.kids} crianças e ${counts.sessions} sessões.`),
    h('h3', null, 'Exportar'),
    h('p', { class: 'muted small' }, 'O arquivo .json leva tudo: palavras, fotos, gravações, crianças, histórico e ajustes.'),
    h('button', { class: 'btn primary', type: 'button', onclick: prepare }, '📦 Criar arquivo de backup'),
    out,
    h('h3', null, 'Importar'),
    h('p', null, 'Use para levar os dados para outro aparelho ou para recuperar tudo depois de limpar o navegador. ',
      h('strong', null, 'Atenção: a importação substitui todos os dados atuais deste aparelho.')),
    h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, '📂 Escolher arquivo de backup…'),
    fileInput,
  ]);

  async function prepare() {
    out.replaceChildren(h('p', { class: 'muted' }, 'Preparando o arquivo…'));
    let blob;
    try {
      blob = new Blob([JSON.stringify(await buildBackup())], { type: 'application/json' });
    } catch (e) {
      console.error(e);
      out.replaceChildren(h('p', { class: 'warn-text' }, 'Não foi possível criar o backup: ' + (e.message || e)));
      return;
    }
    const name = `escuta-so-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    const mark = async () => {
      const now = new Date().toISOString();
      await DB.setKv('lastBackup', now);
      lastLine.className = 'ok-text';
      lastLine.textContent = `Último backup: ${fmtDateTime(now)} (hoje).`;
      document.querySelectorAll('.backup-reminder').forEach(b => b.remove());
      toast('Backup salvo! Guarde o arquivo em um lugar seguro, fora do tablet.', 4500);
    };
    const canShare = canShareFile(file);
    out.replaceChildren(
      h('p', null, `Arquivo pronto: `, h('strong', null, name), ` (${fmtSize(blob.size)})`),
      h('div', { class: 'row wrap' },
        canShare && h('button', {
          class: 'btn primary', type: 'button',
          onclick: async () => { const r = await shareFile(file); if (r === 'ok') mark(); else if (r === 'fail') { downloadBlob(blob, name); mark(); } },
        }, '📤 Compartilhar / salvar em…'),
        h('button', { class: 'btn' + (canShare ? '' : ' primary'), type: 'button', onclick: () => { downloadBlob(blob, name); mark(); } }, '⬇️ Baixar arquivo')),
      h('p', { class: 'muted small' }, IS_IOS
        ? 'No iPad: toque em “Compartilhar / salvar em…” e escolha “Salvar em Arquivos”, ou envie para você mesma por e-mail ou WhatsApp.'
        : 'O arquivo vai para a pasta Downloads. Depois, envie para você mesma por e-mail, WhatsApp ou Google Drive.'));
  }

  async function doImport(file) {
    let data;
    try { data = parseBackup(await file.text()); } catch (e) { toast(e.message, 5000); return; }
    const resumo = `${data.pairs.length} pares, ${data.audio.length} gravações, ${data.children.length} crianças e ${data.sessions.length} sessões`;
    const when = data.exportedAt ? ` de ${fmtDateTime(data.exportedAt)}` : '';
    if (!(await confirmBox(`Importar o backup${when} (${resumo})? Isso substitui TODOS os dados atuais deste aparelho.`, { ok: 'Importar e substituir', danger: true }))) return;
    try {
      await restoreBackup(data);
      toast('Backup importado com sucesso!', 4000);
      show('backup');
    } catch (e) {
      console.error(e);
      toast('Não foi possível importar: ' + (e.message || e), 6000);
    }
  }
}

/* ---------- aba "Ajustes" ---------- */
FonoTabs.push({ id: 'ajustes', label: 'Ajustes', icon: '🔧', order: 6, render: renderSettingsTab });

async function renderSettingsTab(el) {
  const s = State.settings;
  const save = () => saveSettings();

  const pauseOut = h('output', { class: 'range-out' }, fmtSec(s.pauseMs));
  const pause = h('input', { type: 'range', min: 300, max: 3000, step: 100, value: s.pauseMs, 'aria-label': 'Pausa entre as palavras' });
  pause.oninput = () => { s.pauseMs = +pause.value; pauseOut.textContent = fmtSec(s.pauseMs); };
  pause.onchange = save;

  const volOut = h('output', { class: 'range-out' }, Math.round(s.volume * 100) + '%');
  const vol = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: s.volume, 'aria-label': 'Volume' });
  vol.oninput = () => { s.volume = +vol.value; AudioEngine.setVolume(s.volume); volOut.textContent = Math.round(s.volume * 100) + '%'; };
  vol.onchange = save;

  const test = () => {
    const p = Bank.pairs.find(x => Bank.hasAudio(x, 'a') && Bank.hasAudio(x, 'b')) || Bank.pairs[0];
    if (p) Sound.sequence([{ pair: p, side: 'a' }, { pair: p, side: 'b' }], s.pauseMs);
  };

  /* Por faixa: tentativas por rodada e pacote padrão de atividades. */
  const groupBlocks = GROUP_ORDER.map(gid => {
    const G = AGE_GROUPS[gid];
    const seg = h('div', { class: 'seg-group', role: 'radiogroup', 'aria-label': 'Tentativas por rodada' });
    const paintSeg = () => seg.replaceChildren(...G.trialOptions.map(n => h('button', {
      class: 'seg' + (trialsFor(G) === n ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(trialsFor(G) === n),
      onclick: () => { s.trialsBy[gid] = n; save(); paintSeg(); },
    }, String(n))));
    paintSeg();
    const acts = G.activities.filter(id => ACTIVITIES[id]).map(id => ACTIVITIES[id]);
    const checks = acts.map(m => {
      const cb = h('input', { type: 'checkbox', checked: packOn(gid, m.id) });
      cb.onchange = () => {
        if (!cb.checked && acts.filter(x => packOn(gid, x.id)).length <= 1) { cb.checked = true; toast('Deixe pelo menos uma atividade ligada.'); return; }
        s.packs[gid] = { ...(s.packs[gid] || {}), [m.id]: cb.checked };
        save();
      };
      return h('label', { class: 'check' }, cb, h('span', null, `${m.icon || ''} ${m.name}`, G.offByDefault.includes(m.id) && h('span', { class: 'muted small' }, ' (opcional)')));
    });
    return h('section', { class: 'group-settings' },
      h('h3', null, `${G.icon} ${G.name} (${G.ages})`),
      h('div', { class: 'setting' },
        h('div', null, h('strong', null, 'Tentativas por rodada')),
        seg),
      h('div', { class: 'setting' },
        h('div', null, h('strong', null, 'Pacote padrão de atividades'),
          h('p', { class: 'muted small' }, 'Vale para as crianças desta faixa que não têm escolha individual (em Rodada). As desligadas não aparecem para a criança.')),
        h('div', { class: 'checks' }, checks)));
  });

  let persisted = null;
  let usage = null;
  try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch (_) { /* ok */ }
  try { if (navigator.storage && navigator.storage.estimate) usage = (await navigator.storage.estimate()).usage; } catch (_) { /* ok */ }

  add(el, [
    h('h2', null, 'Ajustes'),
    h('div', { class: 'setting' },
      h('div', null, h('strong', null, 'Pausa entre as palavras'),
        h('p', { class: 'muted small' }, 'Usada no modo “Igual ou diferente?” e quando o jogo repete o par depois de um erro. Padrão: 1,0 s.')),
      h('div', { class: 'range-row' }, pause, pauseOut)),
    h('div', { class: 'setting' },
      h('div', null, h('strong', null, 'Volume'),
        h('p', { class: 'muted small' }, 'Volume das palavras e dos sons do jogo (o volume do aparelho também conta).')),
      h('div', { class: 'range-row' }, vol, volOut)),
    h('button', { class: 'btn small', type: 'button', onclick: test }, '🔊 Testar pausa e volume com um par'),
    groupBlocks,
    h('h3', null, 'Sobre os dados'),
    h('p', null, 'Tudo fica guardado só neste aparelho: nada é enviado para a internet. Depois de aberto uma vez, o jogo funciona sem internet.'),
    persisted === true && h('p', { class: 'small ok-text' }, '✔ O navegador protegeu os dados contra limpeza automática.'),
    persisted === false && h('p', { class: 'small warn-text' }, '⚠ O navegador ainda não protegeu os dados contra limpeza automática. Instalar o jogo na tela inicial ajuda, e o backup garante.'),
    usage != null && h('p', { class: 'muted small' }, 'Espaço usado: ' + fmtSize(usage)),
    h('p', { class: 'muted small' }, 'Escuta Só! versão ' + APP_VERSION),
  ]);
}
