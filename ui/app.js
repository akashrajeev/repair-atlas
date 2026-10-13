import { compile, WorkflowError } from '../src/model.js';
import { replay } from '../src/replay.js';
import { diagnose, judgeSet, witnessFor, exportWitness, verifyWitness } from '../src/analysis.js';
import { NothingToRepairError } from '../src/search.js';
import { layout, edgePath, NODE } from './layout.js';

const $ = (s) => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElementNS(tag === 'div' ? 'http://www.w3.org/1999/xhtml' : NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k);
  return n;
};
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v); }
  for (const k of kids.flat()) n.append(k?.nodeType ? k : document.createTextNode(k));
  return n;
};
const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : typeof v === 'boolean' ? (v ? 'true' : 'false') : JSON.stringify(v));

const state = { wf: null, c: null, d: null, sel: 0, step: null, timer: null, theme: new URLSearchParams(location.search).get('theme') || 'b' };
document.documentElement.dataset.theme = state.theme;

async function boot() {
  const files = await (await fetch('/fixtures/index.json')).json();
  const list = await Promise.all(files.map(async (f) => ({ f, wf: await (await fetch(`/fixtures/${f}`)).json() })));
  state.list = list;
  $('#pick').replaceChildren(...list.map(({ f, wf }, i) => h('option', { value: i }, `${wf.name} - ${wf.pattern ?? ''}`)));
  const want = new URLSearchParams(location.search).get('f');
  const idx = Math.max(0, list.findIndex((x) => x.f.startsWith(want ?? '~')));
  $('#pick').value = idx;
  $('#pick').onchange = () => load(list[$('#pick').value].wf);
  $('#bound').onchange = () => { state.userBound = true; run(); };
  $('#play').onclick = play;
  $('#scrub').oninput = () => { stop(); state.step = Number($('#scrub').value); draw(); };
  $('#dl').onclick = download;
  $('#importBtn').onclick = () => openDialog('import');
  $('#verifyBtn').onclick = () => openDialog('verify');
  $('#tourBtn').onclick = () => tour(0);
  if (new URLSearchParams(location.search).has('tour')) tour(1);
  load(list[idx].wf);
}

function load(wf) {
  stop();
  state.wf = wf; state.userBound = false;
  $('#bound').value = String(wf.defaultMaxSize ?? 2);
  run();
}

function run() {
  stop();
  try { state.c = compile(state.wf); } catch (e) { return showError(e instanceof WorkflowError ? e.errors.join('\n') : String(e)); }
  try { state.d = diagnose(state.c, { maxSize: Number($('#bound').value) }); }
  catch (e) { return showError(e instanceof NothingToRepairError ? e.message : String(e)); }
  state.lay = layout(state.c);
  state.sel = 0; state.manual = null; state.step = state.c.order.length;
  $('#title').textContent = state.wf.name;
  $('#story').textContent = state.wf.story ?? '';
  render();
}

function showError(msg) {
  $('#families').replaceChildren(h('p', { class: 'err' }, msg));
  $('#graph').replaceChildren();
}

function selectedSet() { if (state.manual) return [...state.manual]; return state.d.family[state.sel] ?? null; }

function judge(c, d, set) {
  const j = judgeSet(c, d, set);
  const names = (ids) => ids.map(lab).join(' + ');
  if (j.kind === 'minimal') return { kind: 'minimal', text: 'Passes, and this is a minimal repair.' };
  if (j.kind === 'extra') return { kind: 'extra', text: j.extra.length ? `Passes, but ${names(j.extra)} ${j.extra.length > 1 ? 'are' : 'is'} not needed.` : 'Passes (larger than the size bound).' };
  if (j.kind === 'partial') return { kind: 'fail', text: `Still fails. ${names(j.missing)} would complete a minimal repair.` };
  return { kind: 'fail', text: 'Still fails. None of these helps alone or together.' };
}
const lab = (id) => state.c.byId.get(id).label ?? id;

function render() { renderSide(); draw(); renderCompare(); }

function renderSide() {
  const d = state.d;
  $('#formula').replaceChildren(...(d.family.length ? formulaNodes(d) : [h('span', { class: 'none' }, `No repair of size ${d.maxSize} or fewer`)]));
  $('#kind').textContent = { single: 'single root cause', 'joint-and': 'jointly necessary', 'alternative-or': 'alternatives', mixed: 'alternatives and joint repairs', none: 'outside the size bound' }[d.kind];
  $('#kind').dataset.kind = d.kind;
  $('#families').replaceChildren(...d.family.map((f, i) => h('button', { class: 'fam' + (i === state.sel && !state.manual ? ' on' : ''), onclick: () => { stop(); state.manual = null; state.sel = i; state.step = state.c.order.length; render(); } },
    h('span', { class: 'famkind' }, f.length === 1 ? 'fix alone' : `all ${f.length} together`), h('span', { class: 'famset' }, f.map((id) => state.c.byId.get(id).label ?? id).join('  +  ')))));
  if (!d.family.length) $('#families').replaceChildren(h('p', { class: 'muted' }, 'Raise the size bound to look for larger combinations.'));
  const roleText = { solo: 'fixes it alone', 'required-and': 'needed with partners', 'and-partner': 'part of a joint repair', mixed: 'in several repairs', irrelevant: 'does not matter' };
  $('#roles').replaceChildren(...Object.entries(d.roles).map(([id, r]) => h('div', { class: `role r-${r.role}` }, h('i'), h('span', {}, state.c.byId.get(id).label ?? id), h('em', {}, r.inEverySet && d.family.length > 1 ? 'in every repair' : roleText[r.role]))));
  const set = selectedSet();
  $('#wtitle').textContent = set && set.length ? `Repair ${set.map((id) => state.c.byId.get(id).label ?? id).join(' + ')}` : 'No repair to replay';
  $('#scrub').max = state.c.order.length; $('#scrub').value = state.step;
  $('#dl').disabled = !set || !set.length || !replay(state.c, set).success; $('#play').disabled = !set || !set.length;
}

function formulaNodes(d) {
  const out = [];
  d.family.forEach((f, i) => {
    if (i) out.push(h('span', { class: 'op or' }, 'OR'));
    const grp = h('span', { class: 'grp' });
    f.forEach((id, j) => { if (j) grp.append(h('span', { class: 'op and' }, 'AND')); grp.append(h('span', { class: 'tok' }, state.c.byId.get(id).label ?? id)); });
    out.push(grp);
  });
  return out;
}

function draw() {
  const { c, lay, d } = state;
  const set = selectedSet() ?? [];
  const base = replay(c, []);
  const rep = replay(c, set);
  const cur = set.length ? rep : base;
  const visibleIdx = new Map(c.order.map((id, i) => [id, i]));
  const changed = new Set(c.order.filter((id) => JSON.stringify(base.values[id]) !== JSON.stringify(rep.values[id])));
  const svg = $('#graph');
  svg.setAttribute('viewBox', `0 0 ${lay.width} ${lay.height}`);
  svg.replaceChildren();
  for (const l of lay.lanes) {
    svg.append(el('rect', { x: 8, y: l.y, width: lay.width - 16, height: l.h + 14, rx: 10, class: 'lane' }));
    const t = el('text', { x: 22, y: l.y + 24, class: 'lanename' }); t.textContent = l.agent; svg.append(t);
  }
  const showStep = state.step ?? c.order.length;
  const edgeLayer = el('g', {}); const nodeLayer = el('g', {});
  svg.append(edgeLayer, nodeLayer);
  for (const e of c.events) for (const a of e.args ?? []) {
    const on = changed.has(a) && changed.has(e.id) && set.length;
    const live = visibleIdx.get(e.id) < showStep;
    edgeLayer.append(el('path', { d: edgePath(lay.pos.get(a), lay.pos.get(e.id)), class: `edge${on ? ' flow' : ''}${live ? '' : ' dim'}` }));
  }
  const checked = new Map(c.wf.checks.map((k) => [k.event, k]));
  for (const id of c.order) {
    const e = c.byId.get(id), p = lay.pos.get(id);
    const isCand = 'clean' in e, repaired = set.includes(id), live = visibleIdx.get(id) < showStep;
    const role = d.roles[id]?.role;
    const cls = ['node', isCand ? 'cand' : '', repaired ? 'repaired' : '', changed.has(id) && !repaired && set.length ? 'changed' : '', role ? `r-${role}` : '', live ? '' : 'dim', checked.has(id) ? 'sink' : ''].join(' ');
    const g = el('g', { class: cls, transform: `translate(${p.x},${p.y})` });
    g.append(el('rect', { width: NODE.w, height: NODE.h, rx: 9 }));
    const lab = el('text', { x: 12, y: 21, class: 'nlabel' }); lab.textContent = clip(e.label ?? id, checked.has(id) ? 16 : 22); g.append(lab);
    const val = el('text', { x: 12, y: 42, class: 'nval' });
    const was = fmt(base.values[id]), now = fmt(cur.values[id]);
    val.textContent = repaired ? `${was}  →  ${now}` : (changed.has(id) && set.length && live ? `${was}  →  ${now}` : now);
    g.append(val);
    if (checked.has(id)) {
      const k = cur.checks.find((x) => x.event === id);
      const badge = el('g', { transform: `translate(${NODE.w - 26},${NODE.h - 26})`, class: k.pass ? 'ok' : 'bad' });
      badge.append(el('circle', { cx: 8, cy: 8, r: 9 }), el('path', { d: k.pass ? 'M3.5 8.5l3 3 6-6.5' : 'M4.5 4.5l7 7M11.5 4.5l-7 7', fill: 'none', 'stroke-width': 2, class: 'glyph' }));
      g.append(badge);
    }
    if (isCand) { g.classList.add('clickable'); g.addEventListener('click', () => toggle(id)); }
    const title = el('title'); title.textContent = `${e.label ?? id} (${e.agent})${isCand ? ` - observed ${fmt(e.observed)}, clean ${fmt(e.clean)}` : ''}`; g.append(title);
    nodeLayer.append(g);
  }
  renderProof(set, base, rep);
  $('#scrub').value = showStep;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function renderProof(set, base, rep) {
  const box = $('#proof');
  const hint = $('#hint');
  if (state.manual) {
    const j = judge(state.c, state.d, set);
    hint.className = 'hint ' + j.kind; hint.replaceChildren(h('b', {}, 'Your repairs: '), set.length ? set.map(lab).join(' + ') : 'none', ' - ', j.text, ' ', h('button', { class: 'ghost small', onclick: clearManual }, 'Back to the answer'));
  } else { hint.className = 'hint'; hint.replaceChildren('Tip: click any dashed event to try your own repair and see if the run passes.'); }
  if (!set.length) { box.replaceChildren(h('p', { class: 'muted' }, 'Nothing to prove within this size bound.')); return; }
  const w = witnessFor(state.c, set);
  if (!w.success) { box.replaceChildren(h('p', { class: 'muted' }, 'This combination does not pass, so there is nothing to prove. Clear your picks to see the real repairs.')); return; }
  const name = (ids) => (ids.length ? ids.map((i) => state.c.byId.get(i).label ?? i).join(' + ') : 'no repairs');
  const rows = [
    h('div', { class: 'prow fail' }, h('i'), h('b', {}, 'No repairs'), h('span', {}, 'checks fail: ' + failing(base))),
    ...w.subsets.filter((s) => s.repairs.length).map((s) => h('div', { class: 'prow fail' }, h('i'), h('b', {}, `Only ${name(s.repairs)}`), h('span', {}, 'still fails: ' + failing(replay(state.c, s.repairs))))),
    h('div', { class: 'prow pass' }, h('i'), h('b', {}, `${name(set)}`), h('span', {}, w.success ? 'all checks pass' : 'FAILED')),
  ];
  box.replaceChildren(h('div', { class: 'proofgrid' }, rows), h('p', { class: 'qed' }, w.minimal ? `Minimal: the repaired run passes and all ${w.subsets.length} strict subsets fail.` : 'Not minimal.'));
}
const failing = (r) => r.checks.filter((k) => !k.pass).map((k) => `${state.c.wf.checks.find((x) => x.id === k.id)?.label ?? k.id} (${fmt(k.value)})`).join(', ') || 'none';

function renderCompare() {
  const cm = state.d.comparison;
  const max = Math.max(cm.exhaustive.replayCalls, cm.complete.replayCalls, cm.paper.replayCalls, cm.singleOnly.replayCalls);
  const row = (label, o, note, ok) => h('div', { class: 'crow' }, h('span', { class: 'clabel' }, label), h('span', { class: 'bar' }, h('i', { style: `width:${(o.replayCalls / max) * 100}%`, class: ok ? 'good' : 'warn' })), h('b', {}, `${o.replayCalls} replays`), h('em', {}, note));
  $('#compare').replaceChildren(
    row('Replay everything', cm.exhaustive, 'accuracy baseline', true),
    row('Atlas search', cm.complete, cm.completeMatchesExhaustive ? 'same family as baseline' : 'MISMATCH', cm.completeMatchesExhaustive),
    row('Published pair rule', cm.paper, cm.paper.matchesExhaustive ? 'same family' : `outside its declared domain, misses ${cm.paper.missed.join(', ')}`, cm.paper.matchesExhaustive),
    row('One event at a time', cm.singleOnly, cm.singleOnly.matchesExhaustive ? 'same family' : `misses ${cm.singleOnly.missed.join(', ')}`, cm.singleOnly.matchesExhaustive),
  );
}

function toggle(id) {
  stop();
  const cur = new Set(state.manual ?? selectedSet() ?? []);
  if (!state.manual) { cur.clear(); }
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  state.manual = cur; state.step = state.c.order.length;
  render();
}
function clearManual() { state.manual = null; render(); }

function play() {
  if (state.timer) return stop();
  state.step = 0; $('#play').textContent = 'Stop'; draw();
  state.timer = setInterval(() => {
    state.step++; draw();
    if (state.step >= state.c.order.length) stop();
  }, 420);
}
function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; const b = $('#play'); if (b) b.textContent = 'Play replay'; }

function download() {
  const f = exportWitness(state.c, selectedSet());
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' })), download: `witness-${selectedSet().join('+')}.json` });
  a.click();
}

function openDialog(kind) {
  const dlg = $('#dlg');
  $('#dlgTitle').textContent = kind === 'import' ? 'Load a workflow (JSON)' : 'Verify a witness file';
  $('#dlgText').value = kind === 'import' ? JSON.stringify(state.wf, null, 2) : '';
  $('#dlgText').placeholder = kind === 'verify' ? 'Paste a downloaded witness-*.json here' : '';
  $('#dlgMsg').textContent = kind === 'import' ? 'Workflows are data. Only the built-in operations run; nothing from this file executes as code.' : 'Re-runs the witness from scratch and checks nothing was edited.';
  $('#dlgMsg').className = 'msg';
  $('#dlgGo').onclick = (ev) => {
    ev.preventDefault();
    try {
      const obj = JSON.parse($('#dlgText').value);
      if (kind === 'import') { compile(obj); load(obj); dlg.close(); }
      else { const r = verifyWitness(obj, compile); $('#dlgMsg').textContent = (r.ok ? 'VERIFIED: ' : 'REJECTED: ') + r.reason; $('#dlgMsg').className = 'msg ' + (r.ok ? 'ok' : 'bad'); }
    } catch (e) { $('#dlgMsg').textContent = e instanceof WorkflowError ? e.errors.join('\n') : `Could not read that: ${e.message}`; $('#dlgMsg').className = 'msg bad'; }
  };
  dlg.showModal();
}

boot();

const TOUR = [
  ['The failure', 'A run failed. Each box is an event. Dashed boxes have a clean replacement available.'],
  ['The answer', 'The formula lists every smallest set of replacements that makes the run pass. AND means needed together, OR means alternatives.'],
  ['The proof', 'Pick a family on the right, then press Play replay. The repaired run passes, and every smaller subset still fails.'],
  ['Try your own', 'Click dashed events to build your own repair. The page says whether it passes, what is missing, or what is extra.'],
  ['The cost', 'The comparison at the bottom shows how many replays each search needed, and where one-at-a-time search misses a joint repair.'],
];
function tour(i) {
  const t = $('#tour');
  if (i >= TOUR.length) { t.hidden = true; return; }
  t.hidden = false;
  t.replaceChildren(h('b', {}, `${i + 1}/${TOUR.length} ${TOUR[i][0]}: `), TOUR[i][1],
    h('button', { class: 'small ghost', onclick: () => tour(i + 1) }, i + 1 < TOUR.length ? 'Next' : 'Done'),
    h('button', { class: 'small ghost', onclick: () => tour(TOUR.length) }, 'Skip'));
}
