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
function swapNote(expected, answer) {
  const sw = classifyAnswer(expected, answer);
  if (!sw || !sw.length) return '';
  return sw.map((x, i) => `${i ? 'E ' : 'Você '}trocou ${VOICE_TXT(x.from)} (${PHONEMES[x.from].ipa}) por ${VOICE_TXT(x.to).replace('um som', 'um')} (${PHONEMES[x.to].ipa}), ${POS_TXT[x.pos]}.`).join(' ');
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

/* @@PART3@@ */

