/* Escuta Só! — 5. FAIXA SINTONIA (12 a 15 anos)
 * Carregado depois de app.js e usa o mesmo motor: a faixa é configuração + atividades.
 *
 *   5a. Faixa, trocas de sonoridade (surda × sonora) e correção explicada
 *   5b. XP, sequência de dias, conquistas e recordes; menu e fim de rodada
 *   5c. Banco de conteúdo (vocabulário escolar, famílias, pseudopalavras, frases e textos)
 *   5d. Atividades de leitura e escrita
 *   5e. Atividades de processamento auditivo
 *   5f. Escape room e tarefa de casa
 *   5g. Área da fono: classificação dos erros, limiares, ouvidos e questionário
 */
'use strict';

/* =========================================================================
 * 5a. FAIXA, TROCAS DE SONORIDADE E CORREÇÃO EXPLICADA
 * ========================================================================= */

AGE_GROUPS.sintonia = {
  id: 'sintonia',
  name: 'Sintonia',
  ages: '12 a 15 anos',
  icon: '🎧',
  theme: 'teen',            // limpo, de app; claro ou escuro (o adolescente escolhe)
  variant: () => (State.teenDark ? 'dark' : ''),
  menu: 'teen',             // painel com XP, sequência de dias e recordes
  reward: 'teen',
  trials: 10,
  trialOptions: [6, 8, 10, 12],
  targets: ['td', 'kg', 'fv', 'pb'],
  activities: ['reviser', 'sentdict', 'pseudo', 'anagram', 'family', 'fast', 'compnoise', 'gap', 'tones', 'wmem', 'attention', 'escape'],
  offByDefault: ['attention'],      // precisa de fone e das gravações dos números
  reads: true,
  startTop: true,                   // começa no nível mais alto e desce pela regra de sempre
  explain: true,                    // no erro, diz o tipo da troca
  noFamiliarize: true,              // sem "Conheça as palavras" (adolescente já conhece os pares)
  stopwatch: () => !!(State.teenTimer && State.teenTimer === (State.child || GUEST).id),
  startLevels: {},
  art: () => '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M22 70 V60 a38 38 0 0 1 76 0 V70" fill="none" stroke="#8b7bff" stroke-width="9" stroke-linecap="round"/>'
    + '<rect x="12" y="64" width="22" height="36" rx="10" fill="#8b7bff"/><rect x="86" y="64" width="22" height="36" rx="10" fill="#8b7bff"/>'
    + '<path d="M44 84 h6 l5 -14 l8 26 l6 -18 l4 6 h8" fill="none" stroke="#2ee6b0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
GROUP_ORDER.push('sintonia');
ACTIVITY_ORDER.push('pseudo', 'anagram', 'family', 'reviser', 'sentdict', 'wmem', 'tones', 'gap', 'fast', 'compnoise', 'attention', 'escape');
State.teenDark = false;
State.teenTimer = null;
InitHooks.push(async () => { State.teenDark = !!(await DB.kv('teenDark', false)); });

/* ---------- trocas surda × sonora, pelo SOM ----------
 * swapAt troca um som pelo par (f→v, t→d, c→g, qu→gu, ç→s entre vogais…) escrevendo do jeito
 * que se lê, e confere relendo a palavra: se o resultado não soar como a troca, devolve null. */
const VOICE_PARTNER = { p: 'b', b: 'p', t: 'd', d: 't', f: 'v', v: 'f', k: 'g', g: 'k', s: 'z', z: 's', x: 'j', j: 'x' };
const isVowel = ch => !!ch && VOWELS.includes(ch);
function graphFor(phon, prev, next) {
  const front = next === 'e' || next === 'i';
  if (phon === 'k') return front ? 'qu' : 'c';
  if (phon === 'g') return front ? 'gu' : 'g';
  if (phon === 's') return isVowel(prev) && isVowel(next) ? 'ss' : 's';
  if (phon === 'z') return isVowel(prev) && isVowel(next) ? 's' : 'z';
  if (phon === 'x') return 'ch';
  return phon;          // p b t d f v j
}
function swapAt(word, slot) {
  const to = VOICE_PARTNER[slot.phon];
  if (!to) return null;
  const chars = [...word.normalize('NFC')];
  const c = normChars(word);
  const prev = c[slot.start - 1];
  const next = c[slot.start + slot.len];
  // S/Z só antes de vogal (no fim ou antes de consoante a escrita não decide o som); X é ambíguo.
  if ((slot.phon === 's' || slot.phon === 'z') && !isVowel(next)) return null;
  const orig = chars.slice(slot.start, slot.start + slot.len).join('');
  if (orig.toLowerCase() === 'x') return null;
  let rep = graphFor(to, prev, next);
  if (orig[0] !== orig[0].toLowerCase()) rep = rep[0].toUpperCase() + rep.slice(1);
  const text = chars.slice(0, slot.start).join('') + rep + chars.slice(slot.start + slot.len).join('');
  const before = scanSounds(word);
  const after = scanSounds(text);
  const idx = before.findIndex(o => o.start === slot.start);
  if (idx < 0 || before.length !== after.length || after[idx].phon !== to) return null;
  if (before.some((o, i) => i !== idx && o.phon !== after[i].phon)) return null;
  return { text, from: slot.phon, to, start: slot.start, len: rep.length, oldLen: slot.len, pos: soundPos(word, slot.start, slot.len), graph: orig, newGraph: rep };
}
/** Todas as trocas possíveis numa palavra (só dos fonemas pedidos, se houver lista). */
function swapsOf(word, phons = null) {
  return scanSounds(word).filter(o => !phons || phons.includes(o.phon)).map(o => swapAt(word, o)).filter(Boolean);
}
const swapKind = sw => (PHONEMES[sw.from].voiced ? 'dessonorizacao' : 'sonorizacao');
const SWAP_LABEL = { sonorizacao: 'sonorização', dessonorizacao: 'dessonorização' };
/** Normaliza para comparar respostas (sem maiúsculas, pontuação e, se pedido, sem acentos). */
function normAnswer(s, noAccents = State.settings.ignoreAccents !== false) {
  let t = String(s || '').normalize('NFC').toLowerCase().replace(/[.,;:!?¿¡"“”'’()«»…]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noAccents) t = t.replace(/ç/g, '\u0001').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').replace(/\u0001/g, 'ç');   // ç não é acento
  return t;
}
/** "Esqueleto" sonoro: cada som de consoante vira um símbolo (c, qu e k → k; ç, ss → s…); o resto fica. */
function soundSkeleton(text) {
  const c = normChars(text);
  const sounds = scanSounds(text);
  const out = [];
  let i = 0;
  for (const o of sounds) {
    while (i < o.start) out.push({ ch: c[i], at: i++ });
    out.push({ ph: o.phon, at: o.start, len: o.len });
    i = o.start + o.len;
  }
  while (i < c.length) out.push({ ch: c[i], at: i++ });
  return out;
}
/** Como a resposta difere do esperado, pelo SOM: [] = igual; lista de trocas = só sonoridade
 *  (casa → caça conta como /z/ → /s/); null = outro erro (letra trocada, faltando, ortografia…). */
function classifyAnswer(expected, answer) {
  const E = normAnswer(expected);
  const A = normAnswer(answer);
  if (E === A) return [];
  if (!E || !A) return null;
  const se = soundSkeleton(E);
  const sa = soundSkeleton(A);
  if (se.length !== sa.length) return null;
  const swaps = [];
  for (let i = 0; i < se.length; i++) {
    const x = se[i];
    const y = sa[i];
    if (x.ph && y.ph) {
      if (x.ph === y.ph) continue;
      if (VOICE_PARTNER[x.ph] !== y.ph) return null;
      swaps.push({ from: x.ph, to: y.ph, start: x.at, len: x.len, pos: soundPos(E, x.at, x.len) });
    } else if (x.ch == null || x.ch !== y.ch) return null;
  }
  return swaps.length ? swaps : null;    // mesmo som com outra escrita (cassa × caça) = erro de ortografia
}
const VOICE_TXT = ph => (PHONEMES[ph].voiced ? 'um som que vibra' : 'um som sem vibração');
const POS_TXT = { inicio: 'no início da palavra', meio: 'no meio da palavra', fim: 'no fim da palavra' };
/** Frase da correção: "Você trocou um som sem vibração (/f/) por um que vibra (/v/), no início da palavra." */
function swapNote(expected, answer, who = 'Você') {
  const sw = classifyAnswer(expected, answer);
  if (!sw || !sw.length) return '';
  return sw.map((x, i) => `${i ? 'E ' : who + ' '}trocou ${VOICE_TXT(x.from)} (${PHONEMES[x.from].ipa}) por ${VOICE_TXT(x.to).replace('um som', 'um')} (${PHONEMES[x.to].ipa}), ${POS_TXT[x.pos]}.`).join(' ');
}
/** Trocas de uma tentativa errada para o relatório: { kind, from, to, pos }. */
function swapRecords(expected, answer) {
  const sw = classifyAnswer(expected, answer);
  if (!sw) return { other: true, swaps: [] };
  return { other: false, swaps: sw.map(x => ({ kind: swapKind(x), from: x.from, to: x.to, pos: x.pos, contrast: PHON_CONTRAST[x.from] })) };
}
/** Destaca o pedaço que muda entre duas escritas (a mostrada é "a"). */
function markDiffText(a, b) {
  const pa = [...a];
  const pb = [...b];
  let pre = 0;
  while (pre < pa.length && pre < pb.length && plain(pa[pre]) === plain(pb[pre])) pre++;
  let suf = 0;
  while (suf < pa.length - pre && suf < pb.length - pre && plain(pa[pa.length - 1 - suf]) === plain(pb[pb.length - 1 - suf])) suf++;
  const mid = pa.slice(pre, pa.length - suf).join('');
  return esc(pa.slice(0, pre).join('')) + (mid ? `<mark>${esc(mid)}</mark>` : '') + esc(pa.slice(pa.length - suf).join(''));
}
/** Item tocável de um texto qualquer: gravação da fono (chave dada ou "w:palavra") ou voz sintética. */
const textItem = (text, key = null) => ({ key: key || wordKey(text), text });

/** Correção explicada da Sintonia: o que ele respondeu × o certo, o tipo da troca e as duas formas tocadas. */
async function teenFix(g, expected, answer, { expectedItem = null, answerItem = null, note = null, play = true } = {}) {
  if (!g.alive()) return;
  const txt = note != null ? note : swapNote(expected, answer);
  const card = (label, word, other_, cls) => h('div', { class: 'cmp-card ' + cls },
    h('span', { class: 'cmp-label' }, label), h('span', { class: 'cmp-word', html: markDiffText(word, other_) }));
  const ca = card('você', answer || '—', expected, 'cmp-yours');
  const cb = card('o certo', expected, answer || '', 'cmp-right');
  const panel = h('div', { class: 'compare teen-compare' },
    txt && h('p', { class: 'cmp-note' }, txt),
    h('div', { class: 'cmp-row' }, ca, h('span', { class: 'cmp-vs' }, '→'), cb),
    h('button', { class: 'btn primary', type: 'button' }, 'Continuar'));
  g.stage.append(panel);
  const goOn = panel.querySelector('button');
  if (play) {
    const steps = [];
    if (answer && answerItem !== false) steps.push({ ...(answerItem || textItem(answer)), el: ca });
    steps.push({ ...(expectedItem || textItem(expected)), el: cb });
    await g.play(steps, 'busy', 650);
  }
  if (!g.alive()) return;
  cb.classList.add('hint-correct');
  g.lock('');
  await waitChoice([[goOn, true]]);
  panel.remove();
}

/* =========================================================================
 * 5b. XP, SEQUÊNCIA DE DIAS, CONQUISTAS E RECORDES
 * Sem ranking entre pacientes: só o progresso da própria pessoa.
 * kv "teen:<criança>" = { xp, streak: { last, count, best }, ach: { id: data }, rec: { atividade: {...} }, tried, timer }
 * ========================================================================= */
const ESCAPE_HINT_XP = 20;   // custo de uma dica no Escape room
const pad2 = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayBefore = key => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() - 1); return dayKey(d); };

async function getTeen(childId) {
  const p = await DB.kv('teen:' + childId, null);
  const base = { xp: 0, streak: { last: null, count: 0, best: 0 }, ach: {}, rec: {}, tried: {}, timer: false, days: {} };
  return { ...base, ...(p || {}), streak: { ...base.streak, ...((p && p.streak) || {}) } };
}
const saveTeen = (childId, prof) => DB.setKv('teen:' + childId, prof);
/** Sequência que ainda vale hoje (treinou hoje ou ontem). */
function liveStreak(prof) {
  const t = dayKey();
  return prof.streak.last === t || prof.streak.last === dayBefore(t) ? prof.streak.count : 0;
}
/** Nível pelo XP: 1 (0–99), 2 (100–299), 3 (300–599)… cada nível pede 100 XP a mais. */
function teenLevel(xp) {
  let n = 1;
  let floor = 0;
  let need = 100;
  while (xp >= floor + need) { floor += need; n++; need += 100; }
  return { n, floor, next: floor + need, f: (xp - floor) / need };
}
function teenXpBar(xp) {
  const L = teenLevel(xp);
  return h('div', { class: 'teen-xp', title: `${xp} XP` },
    h('span', { class: 'teen-lvl' }, 'Nível ' + L.n),
    h('span', { class: 'teen-bar' }, h('span', { class: 'teen-fill', style: `transform:scaleX(${L.f.toFixed(3)})` })),
    h('span', { class: 'teen-xpnum' }, `${xp} / ${L.next} XP`));
}

/* Conquistas (individuais). test recebe { prof, session, def, acc, thr }. */
const ACHIEVEMENTS = [
  { id: 'first', icon: '🎯', name: 'Primeiro treino', desc: 'Terminou a primeira rodada.', test: () => true },
  { id: 'streak3', icon: '🔥', name: '3 dias seguidos', desc: 'Treinou 3 dias seguidos.', test: x => x.prof.streak.count >= 3 },
  { id: 'streak7', icon: '⚡', name: 'Semana completa', desc: 'Treinou 7 dias seguidos.', test: x => x.prof.streak.count >= 7 },
  { id: 'perfect', icon: '💯', name: 'Rodada perfeita', desc: '100% numa rodada de 5 tentativas ou mais.', test: x => x.acc >= 0.999 && x.session.trials.length >= 5 },
  { id: 'explorer', icon: '🧭', name: 'Explorador', desc: 'Jogou 6 atividades diferentes.', test: x => Object.keys(x.prof.tried).length >= 6 },
  { id: 'clock', icon: '⏱️', name: 'Contra o relógio', desc: 'Terminou com cronômetro e 80% ou mais.', test: x => x.session.stopwatch && x.acc >= 0.8 },
  { id: 'reviser', icon: '📝', name: 'Revisor afiado', desc: 'Achou todos os erros de um texto sem marcar palavra certa.', test: x => x.session.trials.some(t => t.found === t.errors && t.errors > 0 && !t.falseAlarms) },
  { id: 'noise', icon: '🦻', name: 'Ouvido no barulho', desc: 'Entendeu um texto com o ruído tão alto quanto a fala (0 dB).', test: x => x.session.trials.some(t => t.correct && t.snr != null && t.snr <= 0 && x.def.id === 'compnoise') },
  { id: 'turbo', icon: '🚀', name: 'Modo turbo', desc: 'Acertou uma frase a 1,75× ou mais.', test: x => x.session.trials.some(t => t.correct && t.rate >= 1.75) },
  { id: 'gap5', icon: '🔬', name: 'Pausa de 5 ms', desc: 'Percebeu uma pausa de 5 milissegundos ou menos.', test: x => x.session.trials.some(t => t.correct && t.gapMs && t.gapMs <= 5) },
  { id: 'mem6', icon: '🧠', name: 'Memória de 6', desc: 'Repetiu 6 palavras na ordem e de trás para a frente.', test: x => x.session.trials.some(t => t.correct && t.seqLen >= 6 && x.def.id === 'wmem') },
  { id: 'tones5', icon: '🎼', name: 'Padrão de 5', desc: 'Reproduziu um padrão de 5 tons.', test: x => x.session.trials.some(t => t.correct && t.seqLen >= 5 && x.def.id === 'tones') },
  { id: 'escape', icon: '🔓', name: 'Fuga completa', desc: 'Abriu o cadeado do Escape room.', test: x => x.def.id === 'escape' && x.session.escaped },
  { id: 'nohint', icon: '🕵️', name: 'Sem dica', desc: 'Abriu o cadeado sem pagar dica.', test: x => x.def.id === 'escape' && x.session.escaped && !x.session.hints },
  { id: 'xp1000', icon: '💎', name: '1.000 XP', desc: 'Juntou 1.000 XP.', test: x => x.prof.xp >= 1000 },
  { id: 'homework', icon: '🏠', name: 'Tarefa entregue', desc: 'Mandou uma tarefa de casa para a fono.', test: x => !!x.prof.homeworkSent },
];
const achById = id => ACHIEVEMENTS.find(a => a.id === id);

/** Limiar alcançado numa sessão adaptativa (ruído, velocidade, pausa, sequência) — ver 5g. */
const sessionThreshold = s => (typeof thresholdOf === 'function' ? thresholdOf(s) : null);

Rewards.teen = async (child, session, def, levelUp) => {
  const prof = await getTeen(child.id);
  const acc = accOf(session);
  const hits = session.trials.filter(t => t.correct).length;
  const prevXp = prof.xp;
  let xp = Math.round(10 * session.trials.reduce((n, t) => n + trialScore(t), 0)) + (session.trials.length ? 20 : 0);
  const bonus = session.stopwatch && acc >= 0.8 ? Math.round(xp * 0.25) : 0;
  xp += bonus;
  if (session.hints) xp = Math.max(0, xp - session.hints * ESCAPE_HINT_XP);
  prof.xp += xp;
  // sequência de dias
  const today = dayKey();
  if (prof.streak.last !== today) {
    prof.streak.count = prof.streak.last === dayBefore(today) ? prof.streak.count + 1 : 1;
    prof.streak.last = today;
    prof.streak.best = Math.max(prof.streak.best || 0, prof.streak.count);
  }
  prof.days[today] = (prof.days[today] || 0) + 1;
  prof.tried[def.id] = (prof.tried[def.id] || 0) + 1;
  // recordes pessoais
  const rec = prof.rec[def.id] || {};
  const records = [];
  if (session.trials.length >= 3 && (rec.acc == null || acc > rec.acc)) {
    if (rec.acc != null) records.push(`Novo recorde de acerto: ${Math.round(acc * 100)}% (antes ${Math.round(rec.acc * 100)}%)`);
    rec.acc = acc;
  }
  const thr = sessionThreshold(session);
  if (thr) {
    const better = !rec.thr || (thr.better === 'low' ? thr.value < rec.thr.value : thr.value > rec.thr.value);
    if (better) {
      if (rec.thr) records.push(`Novo recorde: ${thr.label} (antes ${rec.thr.label})`);
      rec.thr = thr;
    }
  }
  if (session.stopwatch && acc >= 0.8 && session.seconds) {
    if (!rec.time || session.seconds < rec.time) {
      if (rec.time) records.push(`Novo recorde de tempo: ${fmtSecs(session.seconds)} (antes ${fmtSecs(rec.time)})`);
      rec.time = session.seconds;
    }
  }
  prof.rec[def.id] = rec;
  // conquistas
  const x = { prof, session, def, acc, thr };
  const newAch = ACHIEVEMENTS.filter(a => !prof.ach[a.id] && a.test(x)).map(a => a.id);
  newAch.forEach(id => { prof.ach[id] = new Date().toISOString(); });
  await saveTeen(child.id, prof);
  return {
    screen: 'teenDebrief',
    params: { mode: def.id, acc, hits, total: session.trials.length, xp, bonus, hints: session.hints || 0, prevXp, streak: prof.streak.count, newAch, records, levelUp, thr, seconds: session.stopwatch ? session.seconds : null, escaped: session.escaped, stars: starsFor(acc) },
  };
};
const fmtSecs = sec => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;

/* ---------- menu da Sintonia ---------- */
function teenToggle(icon, label, on, onChange) {
  const b = h('button', { class: 'teen-toggle' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), title: label }, h('span', { class: 'tt-ico' }, icon), h('span', { class: 'tt-txt' }, label));
  b.onclick = () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); onChange(on); };
  return b;
}
const shortDesc = d => d.teen || (d.desc || '').split(/[.:]/)[0];
MenuStyles.teen = async (app, { child, acts, top, alive }) => {
  const prof = await getTeen(child.id);
  const surveyDue = typeof surveyIsDue === 'function' && child.id !== GUEST.id ? await surveyIsDue(child.id) : false;
  if (!alive()) return;
  State.teenTimer = prof.timer ? child.id : null;
  const streak = liveStreak(prof);
  top.append(iconBtn('🏆', 'Conquistas e recordes', () => go('teenStats')));
  const hero = h('section', { class: 'teen-hero' },
    h('div', { class: 'teen-hello' },
      h('span', { class: 'teen-hi' }, `E aí, ${child.nick}!`),
      h('span', { class: 'teen-streak' + (streak ? ' live' : '') }, '🔥 ', streak ? `${streak} ${streak === 1 ? 'dia' : 'dias'} seguidos` : 'treine hoje para começar uma sequência')),
    teenXpBar(prof.xp),
    h('div', { class: 'teen-toggles' },
      teenToggle('⏱', 'Cronômetro', !!prof.timer, async on => {
        const p = await getTeen(child.id);
        p.timer = on;
        await saveTeen(child.id, p);
        State.teenTimer = on ? child.id : null;
        toast(on ? 'Cronômetro ligado: o tempo da rodada vira desafio (não corta nenhuma resposta).' : 'Cronômetro desligado.');
      }),
      teenToggle('🌙', 'Tema escuro', !!State.teenDark, on => {
        State.teenDark = on;
        DB.setKv('teenDark', on).catch(() => {});
        document.documentElement.dataset.variant = on ? 'dark' : '';
      })));
  const survey = surveyDue ? h('button', { class: 'teen-survey-cta', type: 'button', onclick: () => go('teenSurvey') },
    h('span', { class: 'tsc-ico' }, '📋'), h('span', null, h('strong', null, 'Como anda a sua escuta?'), h('span', { class: 'muted' }, ' 6 perguntas rápidas, uma vez por mês.'))) : null;
  const tiles = acts.length
    ? h('div', { class: 'teen-grid' }, acts.map(m => {
      const r = prof.rec[m.id];
      const recTxt = r ? [r.acc != null && `melhor ${Math.round(r.acc * 100)}%`, r.thr && r.thr.label, r.time && `⏱ ${fmtSecs(r.time)}`].filter(Boolean).join(' · ') : 'ainda não jogou';
      return h('button', { class: 'teen-tile tile-' + m.id, type: 'button', onclick: () => go('game', { mode: m.id }) },
        h('span', { class: 'tt-icon', 'aria-hidden': 'true' }, m.icon),
        h('span', { class: 'tt-name' }, m.name),
        h('span', { class: 'tt-desc' }, shortDesc(m)),
        h('span', { class: 'tt-rec' + (r ? ' has' : '') }, recTxt));
    }))
    : h('p', { class: 'empty' }, 'Nenhuma atividade ativa. A fono liga as atividades na área da fono, em Rodada.');
  app.append(h('div', { class: 'teen-menu' }, hero, survey, tiles));
};

/* ---------- fim da rodada ---------- */
Screens.teenDebrief = {
  themed: true,
  async render(app, p, alive) {
    const def = ACTIVITIES[p.mode] || {};
    const pctTxt = Math.round(p.acc * 100) + '%';
    const xpEl = h('div', { class: 'td-xp' }, teenXpBar(p.prevXp));
    const lines = [];
    if (p.escaped != null && def.id === 'escape') lines.push(h('p', { class: 'td-line' + (p.escaped ? ' good' : '') }, p.escaped ? '🔓 Cadeado aberto!' : '🔒 O cadeado ficou fechado desta vez.'));
    if (p.thr) lines.push(h('p', { class: 'td-line' }, `Limiar alcançado: ${p.thr.label}`));
    if (p.seconds) lines.push(h('p', { class: 'td-line' }, `⏱ Tempo da rodada: ${fmtSecs(p.seconds)}` + (p.bonus ? ` · bônus +${p.bonus} XP` : '')));
    if (p.hints) lines.push(h('p', { class: 'td-line muted' }, `💡 ${p.hints} ${p.hints === 1 ? 'dica paga' : 'dicas pagas'} (−${p.hints * ESCAPE_HINT_XP} XP)`));
    p.records.forEach(r => lines.push(h('p', { class: 'td-line good' }, '🏅 ' + r)));
    if (p.levelUp) lines.push(h('p', { class: 'td-line' + (p.levelUp.to > p.levelUp.from ? ' good' : '') }, p.levelUp.to > p.levelUp.from ? `⬆️ Nível ${p.levelUp.to} liberado: ${p.levelUp.label}` : `Próxima rodada no nível ${p.levelUp.to}: ${p.levelUp.label}`));
    const ach = p.newAch.length ? h('div', { class: 'td-ach' }, p.newAch.map(id => { const a = achById(id); return h('div', { class: 'ach-card got' }, h('span', { class: 'ach-ico' }, a.icon), h('span', null, h('strong', null, a.name), h('span', { class: 'muted small' }, a.desc))); })) : null;
    add(app, h('div', { class: 'teen-debrief' },
      h('p', { class: 'td-act' }, `${def.icon || ''} ${def.name || ''}`),
      h('div', { class: 'td-score' }, h('span', { class: 'td-pct' }, pctTxt), h('span', { class: 'td-hits muted' }, `${p.hits} de ${p.total} certas`)),
      h('div', { class: 'td-chips' }, h('span', { class: 'td-chip' }, `+${p.xp} XP`), h('span', { class: 'td-chip' }, `🔥 ${p.streak} ${p.streak === 1 ? 'dia' : 'dias'}`)),
      xpEl,
      lines,
      ach,
      h('div', { class: 'td-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => go('menu') }, '← Menu'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => go('game', { mode: p.mode }) }, '↻ Jogar de novo'))));
    Sound.chime(p.acc >= 0.8 ? 'win' : 'star');
    await sleep(350);
    if (!alive()) return;
    const before = teenLevel(p.prevXp).n;
    xpEl.replaceChildren(teenXpBar(p.prevXp + p.xp));
    if (teenLevel(p.prevXp + p.xp).n > before) { xpEl.append(h('p', { class: 'td-line good' }, `Subiu para o nível ${teenLevel(p.prevXp + p.xp).n}!`)); burst(xpEl, ['✦', '✧', '⬆', '✦']); }
    if (ach) { await sleep(300); Sound.chime('open'); burst(ach, ['✦', '✧', '★', '✦']); }
  },
};

/* ---------- conquistas e recordes ---------- */
Screens.teenStats = {
  themed: true,
  async render(app, params, alive) {
    const child = State.child || GUEST;
    const prof = await getTeen(child.id);
    if (!alive()) return;
    const recRows = Object.entries(prof.rec).filter(([id]) => ACTIVITIES[id]).map(([id, r]) => h('tr', null,
      h('td', null, `${ACTIVITIES[id].icon} ${ACTIVITIES[id].name}`),
      h('td', { class: 'num' }, r.acc != null ? Math.round(r.acc * 100) + '%' : '—'),
      h('td', null, r.thr ? r.thr.label : '—'),
      h('td', { class: 'num' }, r.time ? fmtSecs(r.time) : '—'),
      h('td', { class: 'num' }, prof.tried[id] || 0)));
    const got = ACHIEVEMENTS.filter(a => prof.ach[a.id]).length;
    add(app, [
      h('div', { class: 'topbar' }, iconBtn('←', 'Voltar', () => go('menu')), h('h1', { class: 'teen-h1' }, 'Conquistas e recordes'), h('div', { class: 'spacer' })),
      h('div', { class: 'teen-stats' },
        h('div', { class: 'teen-statline' }, teenXpBar(prof.xp), h('span', { class: 'td-chip' }, `🔥 recorde: ${prof.streak.best || 0} dias`), h('span', { class: 'td-chip' }, `🏆 ${got} de ${ACHIEVEMENTS.length}`)),
        h('div', { class: 'ach-grid' }, ACHIEVEMENTS.map(a => h('div', { class: 'ach-card' + (prof.ach[a.id] ? ' got' : '') },
          h('span', { class: 'ach-ico' }, prof.ach[a.id] ? a.icon : '🔒'),
          h('span', null, h('strong', null, a.name), h('span', { class: 'muted small' }, a.desc + (prof.ach[a.id] ? ` · ${fmtDate(prof.ach[a.id])}` : '')))))),
        h('h2', { class: 'teen-h2' }, 'Recordes pessoais'),
        recRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data teen-table' },
          h('thead', null, h('tr', null, h('th', null, 'Atividade'), h('th', { class: 'num' }, 'Melhor acerto'), h('th', null, 'Melhor limiar'), h('th', { class: 'num' }, 'Melhor tempo'), h('th', { class: 'num' }, 'Rodadas'))),
          h('tbody', null, recRows))) : h('p', { class: 'muted' }, 'Jogue uma rodada para ver seus recordes aqui.')),
    ]);
  },
};

/* =========================================================================
 * 5c. BANCO DE CONTEÚDO DA SINTONIA (listas editáveis em Área da fono → Listas)
 * Tudo em português do Brasil e conferido pelo SOM (c/qu, g/gu, ç, s entre vogais = /z/).
 * ========================================================================= */
const MAIN_PHONS = ['p', 'b', 't', 'd', 'f', 'v', 'k', 'g'];          // pares T/D, K/G, F/V, P/B
const OPT_PHONS = ['s', 'z', 'x', 'j'];                               // S/Z e CH/J (opcionais)
const SUBJECTS = [['ciencias', 'Ciências'], ['geografia', 'Geografia'], ['historia', 'História'], ['matematica', 'Matemática'], ['portugues', 'Português']];
const subjectName = id => (SUBJECTS.find(([k]) => k === id) || [id, id])[1];
const SCHOOL_WORDS = {
  ciencias: 'fotossíntese vertebrado invertebrado temperatura digestão bactéria vacina gravidade proteína vitamina vegetal ecossistema planeta fóssil tecido combustível',
  geografia: 'vegetação latitude longitude população território cartografia agricultura continente densidade planalto hidrografia fronteira tropical desmatamento',
  historia: 'independência democracia ditadura república império escravidão revolução colônia abolição batalha tratado parlamento governo constituição bandeirantes',
  matematica: 'divisão fração porcentagem diâmetro decimal potência tabuada gráfico triângulo retângulo perímetro divisor dobro metade',
  portugues: 'gramática advérbio verbo predicado adjetivo substantivo pronome vírgula parágrafo ditongo preposição artigo pontuação concordância',
};
/* Famílias de palavras: o som da raiz (phon) se mantém em todas. */
const FAMILY_SETS = [
  ['f', 'foto, fotografia, fotógrafo, fotográfico'], ['v', 'verde, verdura, esverdeado, verdejante'], ['v', 'cativo, cativeiro, cativante, cativar'],
  ['g', 'gato, gatinho, gatuno, gataria'], ['d', 'dente, dentista, dentadura, dental'], ['b', 'barco, barqueiro, embarcar, embarcação'],
  ['p', 'pedra, pedreiro, pedregulho, apedrejar'], ['k', 'casa, casinha, casarão, caseiro'], ['g', 'gosto, gostoso, gostar, desgosto'],
  ['f', 'ferro, ferreiro, ferrugem, ferradura'], ['v', 'vento, ventania, ventilador, ventilar'], ['t', 'terra, terreno, terreiro, enterrar'],
  ['d', 'doce, docinho, adoçar, doceria'], ['p', 'peixe, peixinho, peixaria, peixeiro'], ['b', 'bola, bolinha, bolada, boleiro'],
  ['t', 'tempo, temporal, temporada, passatempo'], ['v', 'vegetal, vegetação, vegetariano, vegetar'], ['d', 'divisão, dividir, divisível, dividendo'],
  ['f', 'fração, fracionar, fracionário'], ['p', 'povo, população, popular, povoado'], ['k', 'cozinha, cozinheiro, cozinhar, cozido'],
  ['j', 'jogo, jogador, jogada, jogar'], ['x', 'chuva, chuvoso, chuvisco, chuveiro'], ['j', 'gelo, gelado, geladeira, congelar'],
];
/* Pseudopalavras prontas (sílabas CV possíveis no PB, sem sentido); o jogo também gera novas pela mesma regra. */
const PSEUDO_WORDS = 'tadefo vupeca gofita dabuco fepiga bodaque catuvo gavite pafude dofega tibova vecado bugafe cotipa fagude pevico guedopa tabevo dicufa bafote cupedo voguita fuvega detiba gapodo tefuba bovite quepado digovo'.split(' ');
const PHRASES = [
  'A vaca bebeu água no balde.', 'O gato dormiu debaixo da cama.', 'Vou tomar café com pão de queijo.', 'Meu pai comprou uma bicicleta nova.',
  'Faltou luz e todo mundo ficou no escuro.', 'Depois da aula vamos treinar vôlei.', 'O resultado da prova sai na sexta-feira.', 'Guarde o celular na mochila antes da prova.',
  'A professora pediu o trabalho de geografia para terça.', 'O time de futebol ganhou o campeonato da escola.', 'Choveu tanto que a festa da turma foi adiada.',
  'A fotografia ficou desfocada porque eu tremi.', 'Precisamos dividir a pizza em oito pedaços iguais.', 'A biblioteca fecha mais cedo aos sábados.',
  'O vento forte derrubou a placa da padaria.', 'A bateria do meu fone acabou no meio da música.', 'O goleiro defendeu o pênalti no último minuto.',
  'Ela gravou um vídeo engraçado com o cachorro.', 'Dobre a folha ao meio e corte na linha pontilhada.', 'O volume da televisão estava alto demais.',
  'A gente combinou de estudar juntos na terça depois do almoço.', 'O ônibus atrasou e eu cheguei depois que o portão fechou.',
  'Amanhã tem simulado de matemática logo no primeiro horário.', 'O técnico pediu para todo mundo beber bastante água no intervalo.',
  'Vamos fazer um trabalho em grupo sobre a vegetação do cerrado.', 'A digestão começa na boca, quando a gente mastiga a comida.',
  'Na fração três quartos, o quatro é o denominador e o três é o numerador.', 'Faça o dever de casa antes de ver o próximo episódio da série.',
  'O Brasil declarou a independência em mil oitocentos e vinte e dois.', 'Minha prima vai fazer quinze anos e convidou a turma toda para a festa.',
];
const TEXT_KINDS = [['whatsapp', '💬 Mensagem'], ['post', '📱 Post'], ['legenda', '🖼️ Legenda'], ['redacao', '📝 Redação'], ['noticia', '📰 Notícia'], ['instrucao', '📋 Instrução (receita, regra)']];
const kindName = k => (TEXT_KINDS.find(([x]) => x === k) || [k, k])[1];
const TX = (kind, title, text, ...qs) => {
  const o = { kind, title, text };
  for (let i = 0; i < 3; i++) { const q = qs[i] || ['', '', '']; o['q' + (i + 1)] = q[0]; o['r' + (i + 1)] = q[1]; o['w' + (i + 1)] = q[2]; }
  return o;
};
const TEXTS = [
  TX('whatsapp', 'Mensagem no grupo da turma', 'Gente, o trabalho de geografia ficou para sexta-feira. A professora disse que pode ser em dupla. Quem vai fazer comigo? Eu topo dividir as partes: eu faço a pesquisa sobre a vegetação e você monta os slides. Depois a gente treina a apresentação no intervalo.',
    ['Para quando ficou o trabalho?', 'sexta-feira', 'segunda-feira; quarta-feira'], ['Qual é o assunto da pesquisa?', 'a vegetação', 'o clima; a população'], ['Onde vão treinar a apresentação?', 'no intervalo', 'na biblioteca; na casa de alguém']),
  TX('whatsapp', 'Mensagem para a mãe', 'Mãe, a aula de educação física acabou mais cedo porque começou a chover. Vou esperar na portaria da escola. Pode trazer meu tênis de futebol? Esqueci em cima da cadeira do quarto. Beijo!',
    ['Por que a aula acabou mais cedo?', 'porque começou a chover', 'porque o professor faltou; porque teve prova'], ['Onde vai esperar?', 'na portaria da escola', 'na quadra; no ponto de ônibus'], ['O que ficou esquecido?', 'o tênis de futebol', 'a mochila; o celular']),
  TX('post', 'Post do clube de leitura', 'Terminamos o livro do mês! A turma votou e o próximo será uma história de detetive que se passa numa cidade do interior. Quem quiser participar, o encontro é toda terça, depois da última aula, na biblioteca. Traga sua dúvida, sua opinião e, se puder, um pacote de biscoito.',
    ['Que tipo de história será o próximo livro?', 'uma história de detetive', 'uma história de terror; um livro de poesia'], ['Quando é o encontro?', 'toda terça, depois da última aula', 'todo sábado de manhã; toda sexta no recreio'], ['O que pedem para levar, se puder?', 'um pacote de biscoito', 'um caderno novo; uma garrafa de suco']),
  TX('post', 'Post da feira de ciências', 'Nossa equipe ganhou o segundo lugar na feira de ciências com um projeto sobre a digestão dos alimentos. Montamos um modelo do estômago com garrafas e tubos e mostramos como as enzimas ajudam a quebrar a comida. Valeu, professora Beatriz, pela paciência!'),
  TX('legenda', 'Legenda da trilha', 'Pôr do sol visto do alto do morro, depois de duas horas de trilha. Valeu cada gota de suor. Próximo destino: a cachoeira do vale.'),
  TX('legenda', 'Legenda do time', 'Time completo depois da vitória no campeonato da escola. Treinamos todo sábado de manhã e hoje o esforço deu resultado. Bora para a final!'),
  TX('redacao', 'Redação: o celular na escola', 'Nos dias de hoje, o celular faz parte da vida de quase todos os estudantes. Ele ajuda a pesquisar, a combinar trabalhos e a conversar com os amigos. Por outro lado, o uso exagerado atrapalha o sono e a atenção nas aulas. Por isso, é importante definir horários e combinar regras com a família.'),
  TX('redacao', 'Redação: o lixo da cidade', 'O descarte correto do lixo depende de todos. Quando separamos o plástico, o vidro e o papel, facilitamos o trabalho das cooperativas e diminuímos a poluição dos rios. A escola pode dar o exemplo com lixeiras coloridas e campanhas educativas.'),
  TX('noticia', 'Notícia: alerta de chuva forte', 'A Defesa Civil emitiu um alerta de chuva forte para a tarde desta quinta-feira. A previsão é de ventos de até sessenta quilômetros por hora e queda de granizo em alguns bairros. A recomendação é evitar áreas alagadas e não ficar debaixo de árvores durante a tempestade.',
    ['Para quando é o alerta?', 'quinta-feira à tarde', 'sábado de manhã; segunda à noite'], ['Até que velocidade pode chegar o vento?', 'sessenta quilômetros por hora', 'vinte quilômetros por hora; cem quilômetros por hora'], ['O que a Defesa Civil recomenda?', 'evitar áreas alagadas e não ficar debaixo de árvores', 'sair para ver a chuva; guardar o carro debaixo de uma árvore']),
  TX('noticia', 'Notícia: biblioteca nova no bairro', 'A cidade inaugurou nesta segunda-feira uma biblioteca pública no bairro da Vila Verde. O prédio tem sala de estudos, computadores com internet e um espaço para contação de histórias. A biblioteca funciona de terça a sábado, das nove da manhã às oito da noite, e a entrada é gratuita.',
    ['Em que bairro fica a biblioteca?', 'Vila Verde', 'Centro; Jardim das Flores'], ['Em quais dias ela funciona?', 'de terça a sábado', 'todos os dias; só no fim de semana'], ['Quanto custa a entrada?', 'é gratuita', 'dez reais; cinco reais']),
  TX('noticia', 'Notícia: final do vôlei', 'O time feminino de vôlei da escola estadual venceu o campeonato regional no último domingo. A final foi decidida no quinto set, depois de mais de duas horas de jogo. A capitã do time, de quinze anos, disse que o segredo foi treinar a defesa todos os dias.',
    ['De que esporte é a notícia?', 'vôlei', 'futebol; basquete'], ['Quando foi a final?', 'no último domingo', 'ontem à noite; no sábado passado'], ['Qual foi o segredo, segundo a capitã?', 'treinar a defesa todos os dias', 'trocar de técnico; jogar em casa']),
  TX('instrucao', 'Receita: bolo de caneca', 'Numa caneca grande, misture um ovo, quatro colheres de leite e três colheres de óleo. Depois acrescente quatro colheres de açúcar, três de farinha de trigo e duas de chocolate em pó. Mexa bem e por último coloque uma colher de chá de fermento. Leve ao micro-ondas por dois minutos e meio.',
    ['Quantos ovos vão na receita?', 'um', 'dois; três'], ['O que entra por último?', 'o fermento', 'o ovo; o chocolate'], ['Quanto tempo o bolo fica no micro-ondas?', 'dois minutos e meio', 'cinco minutos; trinta segundos']),
  TX('instrucao', 'Regra do jogo: bate-bola', 'Cada jogador começa com três vidas. Quem está com a bola pode dar no máximo três passos antes de passar. Se a bola cair no chão, quem deixou cair perde uma vida. Ganha a última pessoa que ainda tiver pelo menos uma vida.',
    ['Com quantas vidas cada jogador começa?', 'três', 'uma; cinco'], ['Quantos passos pode dar quem está com a bola?', 'no máximo três', 'quantos quiser; nenhum'], ['Quem ganha?', 'a última pessoa que ainda tiver vida', 'quem fizer mais pontos; quem der mais passos']),
];

/* ---------- conferência pelo som ---------- */
const mainSounds = word => scanSounds(word).filter(o => MAIN_PHONS.includes(o.phon));
const soundList = word => [...new Set(scanSounds(word).filter(o => MAIN_PHONS.includes(o.phon) || OPT_PHONS.includes(o.phon)).map(o => PHONEMES[o.phon].show))].join(', ');
const wordsOf = text => String(text || '').split(/\s+/).map(w => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter(Boolean);
const familyWords = r => String(r.words || '').split(',').map(x => x.trim()).filter(Boolean);
function checkFamily(r) {
  const ws = familyWords(r);
  if (ws.length < 3) return 'Escreva pelo menos 3 palavras da família, separadas por vírgula.';
  if (ws.length > 6) return 'No máximo 6 palavras.';
  for (const w of ws) {
    const o = scanSounds(w).find(x => x.phon === r.phon);
    if (!o) return `Pelo som, “${w}” não tem ${PHONEMES[r.phon].ipa}. Lembre: c/g antes de e/i mudam de som.`;
    if (!swapAt(w, o)) return `Em “${w}” não dá para trocar ${PHONEMES[r.phon].ipa} pelo par sem mudar outro som; escolha outra palavra.`;
  }
  return null;
}
const PSEUDO_RE = /^(?:(?:qu|gu|ch|[bcdfgjlmnprtvz])[aeiou]){2,4}$/;
function checkPseudo(w) {
  w = String(w || '').trim();
  if (!w) return 'Escreva a pseudopalavra.';
  if (!PSEUDO_RE.test(w)) return 'Use sílabas simples (consoante + vogal), de 2 a 4 sílabas, sem acento: ta-de-fo, vu-pe-ca. Use qu/gu antes de e/i.';
  if (mainSounds(w).length < 2) return 'Use pelo menos 2 sons dos pares (P, B, T, D, F, V, C/QU, G/GU).';
  if (realWords().has(w)) return `“${w}” é uma palavra de verdade (está nas listas do jogo).`;
  return null;
}
/* Palavras reais conhecidas (para o gerador não "inventar" uma que existe). */
const REAL_BLOCK = ('batata pipoca cabide tapete bigode pateta capote gaveta boneca tomate panela cavalo macaco peteca cadete debate pepino menino banana camelo '
  + 'tecido bodega fivela favela vadio cabana cabelo capela cadela fubica copado tapado pagode gogo cabeça babado dedada vidente dedo dado gado fado bode pote bote tubo '
  + 'cubo fogo foco faca vaca fita vida dica fada gota gado bico bife pipa tipo topo fato foto voto cabo bota pato gato tato tia dia copa cova capa cava pega toca doca').split(' ');
let realCache = null;
function realWords() {
  if (realCache) return realCache;
  const s = new Set(REAL_BLOCK);
  for (const p of Bank.pairs) if (!p.pseudo) { s.add(plain(p.a.text)); s.add(plain(p.b.text)); }
  for (const k of ['position', 'train', 'claps']) for (const r of Lists.get(k)) if (r.word) s.add(plain(r.word));
  for (const k of Object.keys(SCHOOL_WORDS)) SCHOOL_WORDS[k].split(' ').forEach(w => s.add(plain(w)));
  realCache = s;
  setTimeout(() => { realCache = null; }, 60000);
  return s;
}
/** Gera uma pseudopalavra pela regra: sílabas CV do PB, com os sons dos pares pedidos (qu/gu antes de e/i). */
function genPseudo(phons, syl = 3) {
  const P = (phons && phons.length ? phons : MAIN_PHONS).filter(x => MAIN_PHONS.includes(x));
  const FILL = ['m', 'n', 'l', 'r'];
  const V = ['a', 'e', 'i', 'o', 'u'];
  const writeSyl = (c, v) => (c === 'k' ? ((v === 'e' || v === 'i') ? 'qu' : 'c') : c === 'g' ? ((v === 'e' || v === 'i') ? 'gu' : 'g') : c) + v;
  for (let tries = 0; tries < 300; tries++) {
    const cons = Array.from({ length: syl }, (_, i) => (i > 0 && i < syl - 1 && Math.random() < 0.2 ? FILL[rand(FILL.length)] : P[rand(P.length)]));
    const vows = Array.from({ length: syl }, (_, i) => (i === syl - 1 ? ['a', 'e', 'o'][rand(3)] : V[rand(V.length)]));
    if (new Set(vows).size === 1) continue;
    const w = cons.map((c, i) => writeSyl(c, vows[i])).join('');
    if (!checkPseudo(w)) return w;
  }
  return 'tadefo';
}

/* ---------- listas ---------- */
Object.assign(LIST_DEFAULTS, {
  school: () => Object.entries(SCHOOL_WORDS).flatMap(([subject, ws]) => ws.split(' ').map(word => ({ subject, word }))),
  families: () => FAMILY_SETS.map(([phon, words]) => ({ phon, words })),
  pseudo: () => PSEUDO_WORDS.map(word => ({ word })),
  phrases: () => PHRASES.map((text, i) => ({ id: 'fr' + (i + 1), text })),
  texts: () => TEXTS.map((t, i) => ({ id: 'tx' + (i + 1), ...t })),
});
const QFIELDS = [1, 2, 3].flatMap(i => [{ k: 'q' + i, label: `Pergunta ${i}`, type: 'text', wide: true }, { k: 'r' + i, label: 'Resposta certa', type: 'text' }, { k: 'w' + i, label: 'Respostas erradas (separe com ;)', type: 'text' }]);
const textQuestions = r => [1, 2, 3].map(i => ({ q: (r['q' + i] || '').trim(), right: (r['r' + i] || '').trim(), wrong: String(r['w' + i] || '').split(';').map(x => x.trim()).filter(Boolean) })).filter(x => x.q);
const hasQuestions = r => textQuestions(r).length === 3 && textQuestions(r).every(x => x.right && x.wrong.length >= 1);
Object.assign(LIST_SCHEMAS, {
  school: {
    title: 'Vocabulário escolar', icon: '🎓',
    help: 'Sintonia (Anagrama sonoro, Revisor): palavras das matérias com T/D, K/G, F/V ou P/B (S/Z e CH/J também valem). O jogo confere pelo som: c/g antes de e/i não contam como /k/ /g/.',
    fields: [{ k: 'subject', label: 'Matéria', type: 'select', options: SUBJECTS }, wordField('word', 'Palavra')],
    blank: () => ({ subject: 'ciencias', word: '' }),
    summary: r => `${subjectName(r.subject)} · ${r.word} — sons: ${soundList(r.word) || '—'}`,
    check: r => (!r.word.trim() ? 'Escreva a palavra.' : /\s/.test(r.word.trim()) ? 'Uma palavra só.' : !mainSounds(r.word).length ? `Pelo som, “${r.word}” não tem P, B, T, D, F, V, K ou G.` : null),
    hint: r => (r.word.trim() ? `Sons dos pares: ${soundList(r.word.trim())} · ${syllables(r.word)} sílabas.` : ''),
  },
  families: {
    title: 'Famílias de palavras', icon: '🌳',
    help: 'Sintonia (Família do som): palavras da mesma família, separadas por vírgula, e o som da raiz que se mantém (foto, fotografia, fotógrafo → /f/). O jogo escreve uma delas com a troca para o adolescente achar.',
    fields: [{ k: 'phon', label: 'Som da raiz', type: 'phon' }, { k: 'words', label: 'Palavras (separe com vírgula)', type: 'text', wide: true }],
    blank: () => ({ phon: 'f', words: '' }),
    summary: r => `${PHONEMES[r.phon].ipa} · ${familyWords(r).join(', ')}`,
    check: checkFamily,
    hint: r => { const w = familyWords(r)[0]; const o = w && scanSounds(w).find(x => x.phon === r.phon); const sw = o && swapAt(w, o); return sw ? `Exemplo de troca: ${w} → ${sw.text}.` : ''; },
  },
  pseudo: {
    title: 'Pseudopalavras', icon: '👽',
    help: 'Sintonia (Palavra que não existe): palavras inventadas com sílabas possíveis no PB (consoante + vogal), para treinar a rota fonológica sem a ajuda do sentido. Além desta lista, o jogo gera novas pela mesma regra.',
    fields: [wordField('word', 'Pseudopalavra')],
    blank: () => ({ word: '' }),
    summary: r => `${r.word} — sons: ${soundList(r.word)} · ${syllables(r.word)} sílabas`,
    check: r => checkPseudo(r.word),
  },
  phrases: {
    title: 'Frases (ditado e fala acelerada)', icon: '🗣️',
    help: 'Sintonia (Ditado de frases, Fala acelerada): frases do dia a dia, de 4 a 16 palavras, com sons dos pares. Gravação opcional em “Gravar palavras”.',
    fields: [{ k: 'text', label: 'Frase', type: 'text', wide: true }],
    blank: () => ({ id: uid(), text: '' }),
    summary: r => `${r.text}   ·   ${wordsOf(r.text).length} palavras`,
    check(r) {
      const n = wordsOf(r.text).length;
      if (n < 4 || n > 16) return 'A frase precisa ter de 4 a 16 palavras.';
      if (mainSounds(r.text).length < 2) return 'Use pelo menos 2 sons dos pares (P, B, T, D, F, V, K, G).';
      return null;
    },
  },
  texts: {
    title: 'Textos curtos', icon: '📰',
    help: 'Sintonia (Revisor e Escuta no barulho): mensagem, post, legenda, redação, notícia ou instrução. O Revisor coloca as trocas sozinho. Para a Escuta no barulho, preencha as 3 perguntas (resposta certa + erradas separadas por ;).',
    fields: [{ k: 'kind', label: 'Tipo', type: 'select', options: TEXT_KINDS }, { k: 'title', label: 'Título (só para a fono)', type: 'text', wide: true }, { k: 'text', label: 'Texto', type: 'longtext' }, ...QFIELDS],
    blank: () => ({ id: uid(), kind: 'noticia', title: '', text: '', q1: '', r1: '', w1: '', q2: '', r2: '', w2: '', q3: '', r3: '', w3: '' }),
    summary: r => `${kindName(r.kind)} · ${r.title || wordsOf(r.text).slice(0, 6).join(' ') + '…'} · ${wordsOf(r.text).length} palavras` + (hasQuestions(r) ? ' · com perguntas' : ''),
    check(r) {
      const n = wordsOf(r.text).length;
      if (n < 15) return 'O texto precisa ter pelo menos 15 palavras.';
      if (n > 140) return 'Texto longo demais (máximo 140 palavras).';
      const qs = textQuestions(r);
      if (qs.length && !hasQuestions(r)) return 'Perguntas: preencha as 3, cada uma com a resposta certa e pelo menos 1 errada.';
      return null;
    },
    hint: r => `${wordsOf(r.text).length} palavras · Revisor nível ${textTier(r)}` + (hasQuestions(r) ? ' · entra na Escuta no barulho' : ''),
  },
});
const listItems = k => Lists.get(k).filter(listOk(k));
const schoolWords = () => listItems('school');
const familySets = () => listItems('families').map(r => ({ phon: r.phon, words: familyWords(r) }));
const pseudoWords = () => listItems('pseudo').map(r => r.word.trim());
const phraseList = () => listItems('phrases');
const textList = () => listItems('texts');
/** Tamanho do texto para o Revisor: 1 curto (até 30 palavras), 2 médio (até 45), 3 longo. */
const textTier = r => { const n = wordsOf(r.text).length; return n <= 30 ? 1 : n <= 45 ? 2 : 3; };
/** Tamanho da frase: 1 até 7 palavras, 2 até 10, 3 mais longas. */
const phraseTier = r => { const n = wordsOf(r.text).length; return n <= 7 ? 1 : n <= 10 ? 2 : 3; };

/* Itens para gravar (aba "Gravar palavras"), conforme as atividades ligadas. */
const DIGIT_WORDS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
function extraRecordSections(uses) {
  const out = [];
  if (uses('attention')) {
    out.push({
      id: 'digits', title: 'Números da “Atenção dirigida” (1 a 9)', count: true,
      note: 'A Atenção dirigida toca dois sons ao mesmo tempo, um em cada ouvido, e isso só funciona com gravação (a voz sintética não sai num ouvido só). Grave os números com a mesma intensidade e duração parecida.',
      items: DIGIT_WORDS.slice(1).map((w, i) => ({ key: 'dg:' + (i + 1), text: String(i + 1), sub: w, tts: w, fig: h('span', { class: 'syl-fig' }, String(i + 1)), short: true })),
    });
  }
  if (uses('sentdict', 'fast')) {
    out.push({
      id: 'phrases', title: 'Frases do “Ditado de frases” e da “Fala acelerada”', count: false, note: 'Opcional: sem gravação, o jogo usa a voz sintética do aparelho.',
      items: phraseList().map(x => ({ key: 'fr:' + x.id, text: x.text, maxMs: 9000, long: true })),
    });
  }
  if (uses('compnoise', 'reviser')) {
    out.push({
      id: 'texts', title: 'Textos do “Revisor” e da “Escuta no barulho”', count: false, note: 'Opcional: leia o texto inteiro, sem pressa (até 40 segundos). Sem gravação, o jogo usa a voz sintética.',
      items: textList().map(x => ({ key: 'tx:' + x.id, text: x.title || x.text.slice(0, 60), sub: kindName(x.kind), tts: x.text, maxMs: 40000, long: true })),
    });
  }
  return out;
}

/* =========================================================================
 * 5d. ATIVIDADES DE LEITURA E ESCRITA
 * Cada tentativa errada guarda "sw" (trocas de sonoridade ou outro erro) e o canal (ouvir, ler ou escrever)
 * para a classificação sonorização × dessonorização do relatório.
 * ========================================================================= */
/** Fonemas dos contrastes da rodada (pares escolhidos pela fono; sem pares, os alvos da faixa). */
function phonsOfCtx(ctx) {
  const cs = [...new Set(ctx.pairs.map(p => p.contrast))].filter(c => CONTRAST_PHON[c]);
  return (cs.length ? cs : ctx.G.targets).flatMap(c => CONTRAST_PHON[c]);
}
/** Informação de erro da tentativa (vazia quando acertou). */
const errInfo = (expected, answer, correct) => (correct ? {} : { sw: swapRecords(expected, answer) });
const contrastsOfWord = (word, phons) => [...new Set(scanSounds(word).filter(o => !phons || phons.includes(o.phon)).map(o => PHON_CONTRAST[o.phon]).filter(Boolean))];
const teenArt = (icon, label) => detArt(icon, label);
/** Caixa de texto para digitar (sem corretor automático, que "consertaria" a troca). */
const typeBox = (placeholder, cls = '') => h('input', {
  class: 'type-box ' + cls, type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: 'false', enterkeyhint: 'done', placeholder, 'aria-label': placeholder,
});
function typedAnswer(box, okBtn) {
  return new Promise(resolve => {
    const send = () => { const v = box.value.trim(); if (!v) { box.focus(); return; } box.blur(); resolve(v); };
    okBtn.onclick = send;
    box.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  });
}
/** Grafias erradas parecidas (trocas de sonoridade): 2 com uma troca e 1 com duas, como tadefo → dadefo, tatefo, dadevo. */
function spellingFoils(word, phons, k = 3) {
  const one = shuffle(swapsOf(word, phons)).map(s => s.text);
  const anyOne = shuffle(swapsOf(word, MAIN_PHONS)).map(s => s.text);
  const two = [];
  for (const s1 of swapsOf(word, MAIN_PHONS)) for (const s2 of swapsOf(s1.text, MAIN_PHONS)) if (s2.start !== s1.start) two.push(s2.text);
  const pick = [...new Set([...one.slice(0, k - 1), ...shuffle(two).slice(0, 1), ...one, ...anyOne, ...two])].filter(x => x !== word);
  return pick.slice(0, k);
}

/* Montar com letras (Anagrama sonoro): toque na letra para pôr no próximo espaço; toque no espaço para tirar. */
async function tileBoard(g, word, decoys, top = []) {
  const letters = [...word.normalize('NFC').toUpperCase()];
  const tiles = shuffle([...letters, ...decoys]).map(ch => h('button', { class: 'answer tile', type: 'button' }, ch));
  const slotEls = letters.map(() => h('button', { class: 'slot-letter', type: 'button', 'aria-label': 'espaço' }));
  const check = h('button', { class: 'answer btn-check', type: 'button', disabled: true }, '✔ Conferir');
  g.stage.replaceChildren(...top, h('div', { class: 'slots long-slots' }, slotEls), h('div', { class: 'tiles' }, tiles), check);
  const filled = slotEls.map(() => null);
  const paint = () => { check.disabled = filled.some(x => !x); };
  const unplace = i => { const t = filled[i]; if (!t) return; t.classList.remove('used'); filled[i] = null; slotEls[i].textContent = ''; slotEls[i].classList.remove('full'); paint(); };
  const place = (tile, i) => {
    if (i == null) i = filled.findIndex(x => !x);
    if (i < 0) return;
    if (filled[i]) unplace(i);
    filled[i] = tile; slotEls[i].textContent = tile.textContent; slotEls[i].classList.add('full'); tile.classList.add('used');
    Synth.tap('drum');
    paint();
  };
  slotEls.forEach((x, i) => { x.onclick = () => { if (!g.stage.dataset.lock) unplace(i); }; });
  tiles.forEach(tile => { tile.onclick = () => { if (!g.stage.dataset.lock && !tile.classList.contains('used')) place(tile); }; });
  if (g.escape) {
    g.escape.onHint = () => {          // dica: põe a próxima letra certa
      const i = filled.findIndex((t, k) => !t || t.textContent !== letters[k]);
      if (i < 0) return;
      if (filled[i]) unplace(i);
      const t = tiles.find(x => !x.classList.contains('used') && x.textContent === letters[i]);
      if (t) { place(t, i); slotEls[i].classList.add('ok'); }
    };
  }
  const go_ = await g.choose([[check, true]]);
  if (go_ == null) return null;
  g.endInput([check, ...slotEls]);
  tiles.forEach(t => { t.disabled = true; t.onclick = null; });
  const built = filled.map(t => t.textContent).join('');
  slotEls.forEach((x, i) => { x.textContent = letters[i]; x.classList.add(filled[i].textContent === letters[i] ? 'ok' : 'fixed'); });
  return { built, letters, slotEls };
}

/* Revisor: tokens do texto, com as trocas colocadas pelo jogo. */
const STOPWORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'que', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'com', 'por', 'para', 'pra', 'se', 'no', 'na', 'em', 'ao', 'à', 'é']);
function reviserTokens(text, phons, nErr) {
  const toks = text.split(/\s+/).filter(Boolean).map(raw => {
    const m = raw.match(/^([^\p{L}]*)([\p{L}][\p{L}-]*[\p{L}]|[\p{L}])([^\p{L}]*)$/u);
    return m ? { raw, pre: m[1], core: m[2], post: m[3] } : { raw, pre: raw, core: '', post: '' };
  });
  const cand = toks.map((t, i) => i).filter(i => {
    const c = toks[i].core;
    return c.length >= 3 && c[0] === c[0].toLowerCase() && !STOPWORDS.has(c.toLowerCase()) && swapsOf(c, phons).length;
  });
  const chosen = [];
  for (const i of shuffle(cand)) {
    if (chosen.length >= nErr) break;
    if (chosen.some(j => Math.abs(j - i) < 2)) continue;    // erros espalhados
    chosen.push(i);
  }
  for (const i of chosen) {
    const t = toks[i];
    const sw = shuffle(swapsOf(t.core, phons))[0];
    t.wrong = sw.text;
    t.sw = sw;
  }
  return toks;
}

/* Ditado de frases: alinhamento palavra a palavra (o que faltou, o que sobrou e o que mudou). */
function alignWords(exp, got) {
  const n = exp.length;
  const m = got.length;
  const same = (a, b) => normAnswer(a) === normAnswer(b);
  const subCost = (a, b) => (same(a, b) ? 0 : classifyAnswer(a, b) ? 0.6 : plain(a)[0] === plain(b)[0] ? 0.9 : 1.2);
  const dp = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + subCost(exp[i - 1], got[j - 1]));
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + subCost(exp[i - 1], got[j - 1]))) < 1e-9) { ops.push({ e: exp[i - 1], a: got[j - 1] }); i--; j--; }
    else if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + 1)) < 1e-9) { ops.push({ e: exp[i - 1], a: null }); i--; }
    else { ops.push({ e: null, a: got[j - 1] }); j--; }
  }
  return ops.reverse().map(o => {
    if (o.e == null) return { ...o, type: 'extra' };
    if (o.a == null) return { ...o, type: 'miss' };
    const c = classifyAnswer(o.e, o.a);
    return { ...o, type: c && !c.length ? 'ok' : c ? 'voice' : 'other', swaps: c && c.length ? c : null };
  });
}

Object.assign(ACTIVITIES, {
  /* PALAVRA QUE NÃO EXISTE: pseudopalavra; escolhe entre 4 grafias ou escreve. */
  pseudo: {
    id: 'pseudo',
    name: 'Palavra que não existe',
    icon: '👽',
    channel: 'escrever',
    teen: 'Ouça uma palavra inventada e escreva certo',
    desc: 'Rota fonológica: ouve uma pseudopalavra (tadefo) e escolhe entre 4 grafias (tadefo, dadefo, tatefo, dadevo) ou escreve. Sem sentido para ajudar, só o som decide.',
    art: () => teenArt('👽', 'TA·DE·FO'),
    step: 7,
    levels: ['escolher entre 4 grafias (2 sílabas)', 'escolher entre 4 grafias (3 sílabas)', 'escrever (3 sílabas)', 'escrever (4 sílabas)'],
    items(ctx) { ctx.phons = phonsOfCtx(ctx); return []; },
    build(ctx, n) {
      const syl = [2, 3, 3, 4][(ctx.level || 3) - 1];
      const listed = shuffle(pseudoWords().filter(w => syllables(w) === syl));
      const used = new Set();
      const out = [];
      for (let i = 0; i < n; i++) {
        let w = i % 2 === 0 && listed.length ? listed.pop() : genPseudo(ctx.phons, syl);
        for (let k = 0; used.has(w) && k < 20; k++) w = genPseudo(ctx.phons, syl);
        used.add(w);
        out.push({ word: w, write: (ctx.level || 3) >= 3 });
      }
      return out;
    },
    async run(trial, g) {
      const word = trial.word;
      const item = textItem(word);
      const signal = h('div', { class: 'signal', html: SPEAKER_SVG });
      let replays = -1;
      const listen = async fx => { replays++; const r = await g.play([{ ...item, fx, el: signal }]); if (!r.cancelled) g.lock(''); };
      const slow = slowBtn(() => { if (!g.stage.dataset.lock) listen(SLOW); });
      g.replayBtn.onclick = () => listen();
      let answer;
      if (!trial.write) {
        const opts = shuffle([word, ...spellingFoils(word, g.ctx.phons)]);
        const btns = opts.map(w => h('button', { class: 'answer word-btn ps-opt', type: 'button' }, h('span', { class: 'word-txt' }, w)));
        g.stage.replaceChildren(h('p', { class: 'det-prompt' }, 'Qual é a escrita da palavra que você ouviu?'), h('div', { class: 'row center' }, signal, slow), h('div', { class: 'ps-grid' }, btns));
        if (g.escape) g.escape.onHint = () => { let k = 0; btns.forEach((b, i) => { if (opts[i] !== word && k < 2 && !b.disabled) { b.disabled = true; b.classList.add('ruled-out'); k++; } }); };
        listen();
        const idx = await g.choose(btns.map((b, i) => [b, i]));
        g.endInput(btns);
        if (idx == null) return null;
        answer = opts[idx];
        if (answer === word) await quickWin(btns[idx]);
        else { btns[opts.indexOf(word)].classList.add('hint-correct'); await teenFix(g, word, answer); }
      } else {
        const box = typeBox('escreva a palavra');
        const ok = h('button', { class: 'btn primary big', type: 'button' }, 'Conferir');
        g.stage.replaceChildren(h('p', { class: 'det-prompt' }, 'Escreva a palavra inventada que você ouviu'), h('div', { class: 'row center' }, signal, slow), box, ok);
        if (g.escape) g.escape.onHint = () => { box.placeholder = word.slice(0, 2) + '…'; };
        listen().then(() => { if (g.alive()) box.focus(); });
        answer = await typedAnswer(box, ok);
        g.endInput([ok]);
        box.disabled = true;
        if (normAnswer(answer, true) === word) { box.classList.add('ok'); await quickWin(box); } else await teenFix(g, word, answer);
      }
      const correct = normAnswer(answer, true) === word;
      return {
        pairId: null, contrast: null, contrasts: contrastsOfWord(word, MAIN_PHONS), item: word, itemKey: 'pseudo:' + word,
        expected: word, answer, correct, replays: Math.max(0, replays), channel: 'escrever', ...errInfo(word, answer, correct),
      };
    },
  },

  /* ANAGRAMA SONORO: dica em áudio + letras embaralhadas com iscas do par trocado. */
  anagram: {
    id: 'anagram',
    name: 'Anagrama sonoro',
    icon: '🔀',
    channel: 'escrever',
    teen: 'Monte a palavra da matéria com as letras certas',
    desc: 'Consciência fonológica e escrita: ouve uma palavra do vocabulário escolar e monta com letras embaralhadas; as letras-isca são do par trocado (F/V, T/D…).',
    art: () => teenArt('🔀', 'D·I·V·I·S·Ã·O'),
    step: 7,
    levels: ['até 3 sílabas, 1 letra-isca', '4 sílabas ou mais, 2 letras-isca', 'palavras longas, 3 letras-isca'],
    items(ctx) { ctx.phons = phonsOfCtx(ctx); return schoolWords().filter(r => swapsOf(r.word, ctx.phons).length); },
    check: ctx => (ctx.items.length ? null : 'O Anagrama usa o Vocabulário escolar (Listas) com os sons dos pares desta rodada. Nenhuma palavra serve: acrescente palavras ou escolha outros pares em Rodada.'),
    build(ctx, n) {
      const lv = ctx.level || 3;
      const fit = ctx.items.filter(r => (lv === 1 ? syllables(r.word) <= 3 : lv === 2 ? syllables(r.word) >= 4 : [...r.word].length >= 9));
      return cycle(fit.length >= 3 ? fit : ctx.items, n).map(r => ({ word: r.word, subject: r.subject }));
    },
    async run(trial, g) {
      const word = trial.word;
      const lv = g.level || 3;
      const sws = shuffle(swapsOf(word, g.ctx.phons));
      const decoys = [...new Set(sws.map(s => s.newGraph[0].toUpperCase()))].slice(0, lv);
      while (decoys.length < lv) { const extra = [...'BDFGPTV'].filter(c => !decoys.includes(c)); decoys.push(extra[rand(extra.length)]); }
      const item = textItem(word);
      const signal = h('div', { class: 'signal', html: SPEAKER_SVG });
      let replays = -1;
      const listen = async fx => { replays++; const r = await g.play([{ ...item, fx, el: signal }]); if (!r.cancelled) g.lock(''); };
      g.replayBtn.onclick = () => listen();
      const top = [h('div', { class: 'row center' }, h('span', { class: 'subject-chip' }, '📚 ' + subjectName(trial.subject)), signal, slowBtn(() => { if (!g.stage.dataset.lock) listen(SLOW); }))];
      const p = tileBoard(g, word, decoys, top);
      listen();
      const res = await p;
      if (!res) return null;
      const correct = res.built === res.letters.join('');
      if (correct) await quickWin(res.slotEls[0].parentNode);
      else await teenFix(g, word, res.built.toLowerCase(), { answerItem: false });
      return {
        pairId: null, contrast: null, contrasts: contrastsOfWord(word, g.ctx.phons), item: word, itemKey: 'anagram:' + word, subject: trial.subject,
        expected: word, answer: res.built.toLowerCase(), correct, replays: Math.max(0, replays), channel: 'escrever', ...errInfo(word, res.built, correct),
      };
    },
  },

  /* FAMÍLIA DO SOM: acha a palavra da família escrita com a troca, corrige e explica o porquê. */
  family: {
    id: 'family',
    name: 'Família do som',
    icon: '🌳',
    channel: 'ler',
    teen: 'Ache a palavra da família escrita errado e explique',
    desc: 'Raciocínio morfológico: numa família de palavras (foto, fotografia, fotógrafo, votográfico) uma está escrita com a troca. Acha, corrige a letra e responde por quê (o som se mantém na família).',
    art: () => teenArt('🌳', 'FOTO → VOTO?'),
    step: 7,
    levels: ['3 palavras da família', 'a família inteira'],
    items(ctx) { ctx.phons = phonsOfCtx(ctx); return familySets(); },
    check: ctx => (ctx.items.length ? null : 'Cadastre famílias de palavras em Área da fono → Listas → Famílias de palavras.'),
    build(ctx, n) {
      const mine = ctx.items.filter(s => ctx.phons.includes(s.phon));
      return cycle(mine.length >= 2 ? mine : ctx.items, n).map(s => {
        const words = (ctx.level || 2) === 1 ? [s.words[0], ...shuffle(s.words.slice(1)).slice(0, 2)] : s.words.slice();
        const k = 1 + rand(words.length - 1);
        const sw = swapAt(words[k], scanSounds(words[k]).find(x => x.phon === s.phon));
        return { phon: s.phon, words, k, sw };
      });
    },
    async run(trial, g) {
      const { words, k, sw, phon } = trial;
      const right = words[k];
      const wrong = sw.text;
      const P = PHONEMES[phon];
      const prompt = h('p', { class: 'det-prompt' }, '🔍 Uma palavra desta família está escrita errado. Qual?');
      const chips = words.map((w, i) => h('button', { class: 'answer fam-word-btn', type: 'button' }, i === k ? wrong : w));
      const area = h('div', { class: 'fam-step' });
      g.stage.replaceChildren(prompt, h('div', { class: 'fam-list' }, chips), area);
      let replays = 0;
      g.replayBtn.onclick = () => { replays++; g.play(words.map((w, i) => ({ ...textItem(w), el: chips[i] })), '', 350); };
      let step = 1;
      if (g.escape) {
        g.escape.onHint = () => {
          if (step === 1) chips[k].classList.add('suspect');
          else if (step === 2) area.querySelectorAll('button').forEach(b => { if (b.dataset.v !== sw.graph.toUpperCase()) { b.disabled = true; b.classList.add('ruled-out'); } });
        };
      }
      g.lock('');
      // 1. achar
      const picked = await g.choose(chips.map((c, i) => [c, i]));
      if (picked == null) return null;
      const found = picked === k;
      chips.forEach(c => { c.onclick = null; c.disabled = true; });
      chips[k].classList.add('suspect');
      if (found) Sound.chime('star'); else { chips[picked].classList.add('miss'); await sleep(600); }
      // 2. corrigir
      step = 2;
      const letters = shuffle([sw.graph.toUpperCase(), sw.newGraph.toUpperCase()]);
      const lb = letters.map(L => h('button', { class: 'answer letter-btn small-letter', type: 'button', 'data-v': L }, L));
      prompt.textContent = `✏️ Em “${wrong}”, qual é a letra certa?`;
      area.replaceChildren(h('div', { class: 'word-row2' }, lb));
      g.lock('');
      const L = await g.choose(lb.map((b, i) => [b, letters[i]]));
      if (L == null) return null;
      const fixed = L === sw.graph.toUpperCase();
      lb.forEach(b => { b.onclick = null; b.disabled = true; });
      chips[k].textContent = right;
      chips[k].classList.add('fixed');
      if (fixed) Sound.chime('star');
      // 3. por quê
      step = 3;
      const reasons = [
        { id: 'vibra', txt: 'Porque o som vibra', ok: P.voiced },
        { id: 'naovibra', txt: 'Porque o som não vibra', ok: !P.voiced },
        { id: 'familia', txt: `Porque é da mesma família de “${words[0]}”`, ok: true },
      ];
      const rb = reasons.map(r => h('button', { class: 'answer reason-btn', type: 'button' }, r.txt));
      prompt.textContent = `🤔 Por que “${right}” se escreve com ${sw.graph.toUpperCase()}?`;
      area.replaceChildren(h('div', { class: 'reason-list' }, rb));
      g.lock('');
      const ri = await g.choose(rb.map((b, i) => [b, i]));
      if (ri == null) return null;
      g.endInput(rb);
      const reasonOk = reasons[ri].ok;
      rb[ri].classList.add(reasonOk ? 'chosen-ok' : 'miss');
      const score = ((found ? 1 : 0) + (fixed ? 1 : 0) + (reasonOk ? 1 : 0)) / 3;
      const correct = score === 1;
      const why = `“${right}” é da família de “${words[0]}”: o som ${P.ipa} (${P.voiced ? 'que vibra' : 'sem vibração'}) se mantém em todas as palavras da família, e a letra também.`;
      if (correct) { if (reasons[ri].id !== 'familia') toast('Isso! E também: ' + why, 5000); await quickWin(chips[k]); } else await teenFix(g, right, wrong, { note: why });
      return {
        pairId: null, contrast: PHON_CONTRAST[phon] || null, item: words.join(', '), itemKey: 'family:' + words[0], expected: right, answer: fixed && found ? right : wrong,
        found, fixed, reason: reasons[ri].id, reasonOk, score, correct, replays, channel: 'ler', ...(found && fixed ? {} : { sw: swapRecords(right, wrong) }),
      };
    },
  },

  /* REVISOR: texto com 3 a 6 trocas; toca nas palavras erradas e corrige a letra. */
  reviser: {
    id: 'reviser',
    name: 'Revisor',
    icon: '📝',
    channel: 'ler',
    teen: 'Ache e corrija as trocas num texto do dia a dia',
    desc: 'Leitura e revisão: um texto curto (mensagem, post, legenda, redação, notícia) com 3 a 6 trocas surda/sonora. Toca nas palavras erradas e corrige a letra; pode ouvir o texto lido. Nível = número de erros e tamanho do texto.',
    art: () => teenArt('📝', 'vaca → faca'),
    step: 6,
    noWatch: false,
    levels: ['texto curto, 3 erros', 'texto médio, 4 a 5 erros', 'texto longo, 6 erros'],
    items(ctx) { ctx.phons = phonsOfCtx(ctx); return textList(); },
    check: ctx => (ctx.items.length ? null : 'Cadastre textos em Área da fono → Listas → Textos curtos.'),
    build(ctx, n) {
      const lv = ctx.level || 3;
      const fit = ctx.items.filter(t => textTier(t) === lv);
      const pool = fit.length ? fit : ctx.items.filter(t => Math.abs(textTier(t) - lv) <= 1);
      return cycle(pool.length ? pool : ctx.items, Math.min(n, 3)).map(t => ({ t, nErr: lv === 1 ? 3 : lv === 2 ? 4 + rand(2) : 6 }));
    },
    async run(trial, g) {
      const { t } = trial;
      const toks = reviserTokens(t.text, g.ctx.phons, trial.nErr);
      const errs = toks.filter(x => x.wrong);
      const n = errs.length;
      const counter = h('span', { class: 'rev-count' });
      let found = 0;
      let fixed = 0;
      let falseAlarms = 0;
      const paintCount = () => { counter.textContent = `Erros encontrados: ${found} · Restam: ${n - found}`; };
      paintCount();
      const els = toks.map(x => {
        const b = h('button', { class: 'rev-tok', type: 'button' }, x.pre, h('span', { class: 'rev-core' }, x.wrong || x.core), x.post);
        x.el = b;
        return b;
      });
      const listenBtn = h('button', { class: 'btn', type: 'button' }, '🔊 Ouvir o texto');
      const doneBtn = h('button', { class: 'btn primary', type: 'button' }, 'Terminei');
      const fixArea = h('div', { class: 'rev-fix' }, h('span', { class: 'muted' }, 'Toque nas palavras que estão escritas errado.'));
      const textEl = h('div', { class: 'rev-text' }, els);
      g.stage.replaceChildren(
        h('div', { class: 'rev-bar' }, h('span', { class: 'rev-kind' }, kindName(t.kind)), counter, h('div', { class: 'spacer' }), listenBtn, doneBtn),
        textEl, fixArea);
      let replays = 0;
      const readItem = { key: 'tx:' + t.id, text: t.text };
      const listen = async () => { replays++; await g.play([{ ...readItem, el: textEl }], ''); };
      listenBtn.onclick = listen;
      g.replayBtn.onclick = listen;
      g.lock('');
      const sw = [];
      let busy = false;
      let finish;
      const over = new Promise(r => { finish = r; });
      if (g.escape) g.escape.onHint = () => { const x = errs.find(e => !e.found); if (x) x.el.classList.add('suspect'); };
      const fix = x => new Promise(resolve => {
        const right = x.sw.graph.toUpperCase();
        const wrongG = x.sw.newGraph.toUpperCase();
        const opts = shuffle([right, wrongG]);
        const btns = opts.map(L => h('button', { class: 'answer letter-btn small-letter', type: 'button' }, L));
        fixArea.replaceChildren(h('span', { class: 'rev-fix-word', html: markDiffText(x.wrong, x.core) }), h('span', { class: 'muted' }, 'Qual é a letra certa?'), ...btns);
        btns.forEach((b, i) => { b.onclick = () => resolve(opts[i] === right); });
      });
      els.forEach((b, i) => {
        const x = toks[i];
        b.onclick = async () => {
          if (busy || x.found || x.alarm) return;
          if (!x.wrong) {
            falseAlarms++;
            x.alarm = true;
            b.classList.add('false');
            setTimeout(() => { b.classList.remove('false'); x.alarm = false; }, 900);
            return;
          }
          busy = true;
          x.found = true;
          found++;
          paintCount();
          b.classList.add('found');
          const ok = await fix(x);
          b.querySelector('.rev-core').textContent = x.core;
          b.classList.add(ok ? 'fixed' : 'fixed-hint');
          if (ok) { fixed++; Sound.chime('tap'); fixArea.replaceChildren(h('span', { class: 'ok-text' }, `✔ “${x.core}”`)); }
          else {
            sw.push(...swapRecords(x.core, x.wrong).swaps);
            fixArea.replaceChildren(h('span', { class: 'warn-text' }, `A certa é “${x.core}”. ${swapNote(x.core, x.wrong)}`));
          }
          busy = false;
          if (found === n) setTimeout(() => finish(), 700);
        };
      });
      doneBtn.onclick = () => { if (!busy) finish(); };
      await over;
      if (!g.alive()) return null;
      g.endInput([listenBtn, doneBtn, ...els]);
      const missed = errs.filter(x => !x.found);
      missed.forEach(x => { x.el.classList.add('missed'); x.el.querySelector('.rev-core').innerHTML = markDiffText(x.core, x.wrong); sw.push(...swapRecords(x.core, x.wrong).swaps); });
      const score = n ? Math.max(0, (fixed - 0.5 * falseAlarms) / n) : 0;
      const correct = fixed === n && !falseAlarms;
      if (correct) await quickWin(textEl);
      else {
        const lines = [
          `Você achou ${found} de ${n} e corrigiu ${fixed}.` + (falseAlarms ? ` Marcou ${falseAlarms} ${falseAlarms === 1 ? 'palavra certa' : 'palavras certas'} como erro.` : ''),
          ...missed.slice(0, 2).map(x => `Passou: “${x.wrong}” (o certo é “${x.core}”). ${swapNote(x.core, x.wrong, 'O texto')}`),
        ];
        const goOn = h('button', { class: 'btn primary', type: 'button' }, 'Continuar');
        fixArea.replaceChildren(h('div', { class: 'rev-summary' }, lines.map(l => h('p', null, l)), goOn));
        await waitChoice([[goOn, true]]);
      }
      return {
        pairId: null, contrast: null, contrasts: [...new Set(errs.map(x => PHON_CONTRAST[x.sw.from]))], item: t.title || kindName(t.kind), itemKey: 'reviser:' + t.id,
        expected: errs.map(x => x.core).join(', '), answer: `${found} achados, ${fixed} corrigidos, ${falseAlarms} alarmes falsos`,
        errors: n, found, fixed, falseAlarms, score, correct, replays, channel: 'ler', ...(sw.length ? { sw: { other: false, swaps: sw } } : {}),
      };
    },
  },

  /* DITADO DE FRASES: ouve e digita; correção palavra a palavra (sonoridade × outros erros). */
  sentdict: {
    id: 'sentdict',
    name: 'Ditado de frases',
    icon: '⌨️',
    channel: 'escrever',
    teen: 'Ouça a frase e digite no teclado',
    desc: 'Escrita de frases: ouve uma frase do dia a dia e digita no teclado do aparelho. A correção é palavra a palavra e separa os erros de sonoridade (T/D, F/V…) dos outros. Acentos podem ser ignorados (Ajustes). Tem “ouvir devagar”.',
    art: () => teenArt('⌨️', 'vou tomar café'),
    step: 7,
    levels: ['frases curtas (até 7 palavras)', 'frases médias (8 a 10 palavras)', 'frases longas'],
    items(ctx) { ctx.phons = phonsOfCtx(ctx); return phraseList(); },
    check: ctx => (ctx.items.length ? null : 'Cadastre frases em Área da fono → Listas → Frases.'),
    build(ctx, n) {
      const lv = ctx.level || 3;
      const fit = ctx.items.filter(r => phraseTier(r) === lv);
      return cycle(fit.length >= 3 ? fit : ctx.items, Math.min(n, 5)).map(r => ({ r }));
    },
    async run(trial, g) {
      const { r } = trial;
      const item = { key: 'fr:' + r.id, text: r.text };
      const signal = h('div', { class: 'signal', html: SPEAKER_SVG });
      let replays = -1;
      const listen = async fx => { replays++; const x = await g.play([{ ...item, fx, el: signal }]); if (!x.cancelled) g.lock(''); };
      const box = typeBox('digite a frase', 'wide');
      const ok = h('button', { class: 'btn primary big', type: 'button' }, 'Conferir');
      const out = h('div', { class: 'sd-result' });
      g.stage.replaceChildren(h('p', { class: 'det-prompt' }, 'Ouça e digite a frase'), h('div', { class: 'row center' }, signal, slowBtn(() => { if (!g.stage.dataset.lock) listen(SLOW); })), box, ok, out);
      g.replayBtn.onclick = () => listen();
      listen().then(() => { if (g.alive()) box.focus(); });
      const answer = await typedAnswer(box, ok);
      g.endInput([ok]);
      box.disabled = true;
      const exp = wordsOf(r.text);
      const got = wordsOf(answer);
      const ops = alignWords(exp, got);
      const okWords = ops.filter(o => o.type === 'ok').length;
      const voice = ops.filter(o => o.type === 'voice');
      const otherErr = ops.filter(o => o.type === 'other' || o.type === 'miss' || o.type === 'extra');
      const correct = okWords === exp.length && !otherErr.length && !voice.length;
      out.replaceChildren();
      add(out, [h('div', { class: 'sd-words' }, ops.map(o => {
        if (o.type === 'ok') return h('span', { class: 'sd-w ok' }, o.e);
        if (o.type === 'miss') return h('span', { class: 'sd-w miss', title: 'faltou' }, '[', o.e, ']');
        if (o.type === 'extra') return h('span', { class: 'sd-w extra', title: 'sobrou' }, h('s', null, o.a));
        return h('span', { class: 'sd-w ' + o.type, title: o.type === 'voice' ? 'troca de sonoridade' : 'outro erro' }, h('s', null, o.a), ' ', h('span', { html: markDiffText(o.e, o.a) }));
      })),
      !correct && h('p', { class: 'sd-sum' }, `${voice.length} ${voice.length === 1 ? 'erro' : 'erros'} de sonoridade · ${otherErr.length} ${otherErr.length === 1 ? 'outro erro' : 'outros erros'}`),
      voice[0] && h('p', { class: 'sd-note' }, `“${voice[0].a}” → “${voice[0].e}”: ${swapNote(voice[0].e, voice[0].a)}`)]);
      if (correct) await quickWin(out);
      else {
        await sleep(300);
        await g.play([{ ...item, fx: SLOW, el: out }], 'busy');
        const goOn = h('button', { class: 'btn primary', type: 'button' }, 'Continuar');
        out.append(goOn);
        g.lock('');
        await waitChoice([[goOn, true]]);
      }
      const swaps = voice.flatMap(o => o.swaps.map(x => ({ kind: swapKind(x), from: x.from, to: x.to, pos: x.pos, contrast: PHON_CONTRAST[x.from] })));
      return {
        pairId: null, contrast: null, contrasts: [...new Set(swaps.map(x => x.contrast))], item: r.text, itemKey: 'sentdict:' + r.id,
        expected: r.text, answer, correct, score: exp.length ? okWords / exp.length : 0, nWords: exp.length, voiceErrors: voice.length, otherErrors: otherErr.length,
        replays: Math.max(0, replays), channel: 'escrever', ...(correct ? {} : { sw: { other: otherErr.length > 0, swaps } }),
      };
    },
  },
});

/* @@PART4@@ */


