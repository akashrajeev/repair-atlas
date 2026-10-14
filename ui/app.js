import { compile, WorkflowError, applyEdits, parseValue, LIMITS } from '../src/model.js';
import { replay } from '../src/replay.js';
import { diagnose, judgeSet, witnessFor, exportWitness, verifyWitness, reportMarkdown, roleNote } from '../src/analysis.js';
import { NothingToRepairError, REPLAY_BUDGET } from '../src/search.js';
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
  $('#pick').onchange = () => { if ($('#pick').value !== 'custom') load(list[$('#pick').value].wf); };
  $('#bound').onchange = () => { state.userBound = true; run(); };
  $('#play').onclick = play;
  $('#scrub').oninput = () => { stop(); state.step = Number($('#scrub').value); draw(); };
  $('#dl').onclick = download;
  $('#rep').onclick = downloadReport;
  $('#editBtn').onclick = () => openDialog('edit');
  $('#importBtn').onclick = () => openDialog('import');
  $('#verifyBtn').onclick = () => openDialog('verify');
  $('#tourBtn').onclick = () => tour(0);
  if (new URLSearchParams(location.search).has('tour')) tour(1);
  load(list[idx].wf);
  if (new URLSearchParams(location.search).has('edit')) openDialog('edit');
}

// keep the "failed run" selector honest: an imported or edited workflow gets its own entry instead of leaving a stale name selected
function syncPicker(wf) {
  const pick = $('#pick'), idx = state.list ? state.list.findIndex((x) => x.wf === wf) : -1;
  pick.querySelector('option[value="custom"]')?.remove();
  if (idx >= 0) { pick.value = String(idx); return; }
  pick.append(h('option', { value: 'custom' }, `Loaded: ${wf?.name ?? 'workflow'}`));
  pick.value = 'custom';
}

function load(wf) {
  stop();
  state.wf = wf; state.userBound = false;
  syncPicker(wf);
  $('#bound').value = String(wf.defaultMaxSize ?? 2);
  run();
}

function run() {
  stop();
  try { state.c = compile(state.wf); } catch (e) { return showError(e instanceof WorkflowError ? e.errors.join('\n') : String(e)); }
  syncBoundOptions();
  try { state.d = diagnose(state.c, { maxSize: Number($('#bound').value) }); }
  catch (e) { return showError(e instanceof NothingToRepairError || e.name === 'SearchTooLargeError' ? e.message : String(e)); }
  state.lay = layout(state.c);
  state.sel = 0; state.manual = null; state.step = state.c.order.length;
  $('#title').textContent = state.wf.name;
  $('#story').textContent = state.wf.story ?? '';
  render();
}

const fmtN = (x) => Math.round(x).toLocaleString('en-US');
function nextBoundText(d, n) {
  const nb = d.nextBound;
  if (nb.size >= n) return `Raising the bound to ${nb.size} covers every combination (${fmtN(nb.everyCombination)} sets).`;
  const every = nb.everyCombination > 1e6 ? 'over a million' : fmtN(nb.everyCombination);
  return nb.maxSubsets > REPLAY_BUDGET
    ? `Raising the bound to ${nb.size} could need up to ${fmtN(nb.maxSubsets)} replays, over the ${fmtN(REPLAY_BUDGET)} limit, so it may stop early. Every combination would be ${every} sets.`
    : `Raising the bound to ${nb.size} means replaying at most ${fmtN(nb.maxSubsets)} sets, against ${every} for every combination.`;
}

function syncBoundOptions() {
  const n = state.c.candidates.length, sel = $('#bound'), cur = state.userBound ? sel.value : String(state.wf.defaultMaxSize ?? 2);
  const names = { 1: 'single', 2: 'pairs', 3: 'triples' };
  const max = Math.min(n, 4);
  const opts = [];
  for (let k = 1; k <= max; k++) opts.push([k, `${k}${names[k] ? ` (${names[k]})` : ''}${k === n ? ' - every combination' : ''}`]);
  if (n > 4 && n <= 10) opts.push([n, `${n} - every combination`]);
  sel.replaceChildren(...opts.map(([v, t]) => h('option', { value: String(v) }, t)));
  sel.value = opts.some(([v]) => String(v) === cur) ? cur : String(Math.min(Number(cur) || 2, max));
}

function showError(msg) {
  // clear every result panel so nothing from a previous workflow sits next to an error
  $('#families').replaceChildren(h('p', { class: 'err', id: 'load-error', role: 'alert' }, msg));
  for (const sel of ['#graph', '#formula', '#roles', '#compare', '#proof']) $(sel).replaceChildren();
  $('#kind').textContent = ''; $('#kind').removeAttribute('data-kind'); $('#kind').style.display = 'none';
  $('#title').textContent = state.wf?.name ?? ''; $('#story').textContent = ''; $('#wtitle').textContent = 'No result';
  for (const sel of ['#dl', '#rep', '#play']) $(sel).disabled = true;
}

function selectedSet() { if (state.manual) return [...state.manual]; return state.d.family[state.sel] ?? null; }

function judge(c, d, set) {
  const j = judgeSet(c, d, set);
  const names = (ids) => ids.map(lab).join(' + ');
  if (j.kind === 'minimal') return { kind: 'minimal', text: 'Passes, and this is a minimal repair.' };
  if (j.kind === 'extra') return { kind: 'extra', text: j.extra.length ? `Passes, but ${names(j.extra)} ${j.extra.length > 1 ? 'are' : 'is'} not needed.` : 'Passes (larger than the size bound).' };
  if (j.kind === 'undone') return { kind: 'fail', text: `Still fails. It contains ${names(j.contains)}, which works alone, but adding ${names(j.extra)} breaks it.` };
  if (j.kind === 'partial') return { kind: 'fail', text: `Still fails. ${names(j.missing)} would complete a minimal repair.` };
  return { kind: 'fail', text: d.searchedEverySubset ? 'Still fails. None of these is part of any minimal repair among the supplied replacements.' : `Still fails. None of these is part of a minimal repair of up to ${d.maxSize} replacements.` };
}
const lab = (id) => state.c.byId.get(id).label ?? id;

function render() { renderSide(); draw(); renderCompare(); }

function renderSide() {
  const d = state.d;
  $('#formula').replaceChildren(...(d.family.length ? formulaNodes(d) : [h('span', { class: 'none' }, d.searchedEverySubset ? 'No combination of the supplied replacements makes the run pass' : `No repair of size ${d.maxSize} or fewer`)]));
  $('#kind').textContent = { single: 'single root cause', 'joint-and': 'jointly necessary', 'alternative-or': 'alternatives', mixed: 'alternatives and joint repairs', none: 'outside the size bound' }[d.kind];
  $('#kind').dataset.kind = d.kind; $('#kind').style.display = '';
  $('#families').replaceChildren(...d.family.map((f, i) => h('button', { class: 'fam' + (i === state.sel && !state.manual ? ' on' : ''), onclick: () => { stop(); state.manual = null; state.sel = i; state.step = state.c.order.length; render(); } },
    h('span', { class: 'famkind' }, f.length === 1 ? 'fix alone' : `all ${f.length} together`, d.costs.custom ? h('b', { class: 'cost' + (d.costs.cheapest[i] ? ' cheap' : '') }, ` cost ${d.costs.perSet[i]}${d.costs.cheapest[i] ? ' - cheapest' : ''}`) : ''), h('span', { class: 'famset' }, f.map((id) => state.c.byId.get(id).label ?? id).join('  +  ')))));
  if (!d.family.length) $('#families').replaceChildren(h('p', { class: 'muted' }, d.searchedEverySubset ? 'Every combination of the supplied replacements was replayed and none passes. Another replacement would be needed.' : `Raise the size bound (up to ${state.c.candidates.length}) to look for larger combinations.${d.allCandidatesPass ? '' : ' Applying all supplied replacements together also fails, but that alone does not rule out a smaller set.'}`));
  if (d.family.length && !d.allCandidatesPass) $('#families').append(h('p', { class: 'muted', id: 'overshoot-note' }, 'Applying every supplied replacement together fails, yet a smaller set passes. More replacements are not always better.'));
  if (d.family.length) $('#families').append(h('p', { class: 'muted scope', id: 'scope-note' }, d.searchedEverySubset ? `Searched every combination of the ${state.c.candidates.length} supplied replacements.` : `Searched sets of up to ${d.maxSize} of the ${state.c.candidates.length} supplied replacements. Larger repairs were not searched. ${nextBoundText(d, state.c.candidates.length)}`));
  $('#roles').replaceChildren(...Object.entries(d.roles).map(([id, r]) => h('div', { class: `role r-${r.role}` }, h('i'), h('span', {}, state.c.byId.get(id).label ?? id), h('em', {}, roleNote(d, r)))));
  const set = selectedSet();
  $('#wtitle').textContent = set && set.length ? `Repair ${set.map((id) => state.c.byId.get(id).label ?? id).join(' + ')}` : 'No repair to replay';
  $('#scrub').max = state.c.order.length; $('#scrub').value = state.step;
  $('#rep').disabled = false;
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
    if (isCand) {
      g.classList.add('clickable'); g.setAttribute('data-id', id); g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.setAttribute('aria-pressed', String(repaired)); g.setAttribute('aria-label', `${e.label ?? id}: ${repaired ? 'repaired' : 'not repaired'}. Press Enter to toggle.`);
      g.addEventListener('click', () => toggle(id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); state.focusId = id; toggle(id); } });
    }
    const title = el('title'); title.textContent = `${e.label ?? id} (${e.agent})${isCand ? ` - observed ${fmt(e.observed)}, clean ${fmt(e.clean)}` : ''}`; g.append(title);
    nodeLayer.append(g);
  }
  renderProof(set, base, rep);
  $('#scrub').value = showStep;
  if (state.focusId) { document.querySelector(`[data-id="${state.focusId}"]`)?.focus(); state.focusId = null; }
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
  const scope = state.d.searchedEverySubset ? { label: 'Replay every combination', note: 'accuracy baseline', what: 'every combination' } : { label: `Replay every set up\u00a0to\u00a0${state.d.maxSize}`, note: `accuracy baseline for sets up to ${state.d.maxSize}`, what: `every set up to ${state.d.maxSize}` };
  const max = Math.max(cm.exhaustive ? cm.exhaustive.replayCalls : 0, cm.complete.replayCalls, cm.paper.replayCalls, cm.singleOnly.replayCalls);
  const row = (label, o, note, ok) => h('div', { class: 'crow' }, h('span', { class: 'clabel' }, label), h('span', { class: 'bar' }, h('i', { style: `width:${(o.replayCalls / max) * 100}%`, class: ok ? 'good' : 'warn' })), h('b', {}, `${o.replayCalls} replays`), h('em', {}, note));
  $('#compare').replaceChildren(
    cm.exhaustive ? row(scope.label, cm.exhaustive, scope.note, true) : h('p', { class: 'muted', id: 'baseline-skipped' }, `Replaying ${scope.what} would take about ${Math.round(cm.exhaustiveFormula).toLocaleString('en-US')} replays, so that cross-check was not run. This result comes from the pruned search alone.`),
    row('Atlas search', cm.complete, cm.completeMatchesExhaustive === null ? 'not cross-checked' : cm.completeMatchesExhaustive ? 'same family as baseline' : 'MISMATCH', cm.completeMatchesExhaustive !== false),
    row('Published pair rule', cm.paper, cm.paper.matchesExhaustive === null ? 'family not compared' : cm.paper.matchesExhaustive ? 'same family' : `outside its declared domain, misses ${cm.paper.missed.join(', ')}`, cm.paper.matchesExhaustive !== false),
    row('One event at a time', cm.singleOnly, cm.singleOnly.matchesExhaustive === null ? 'family not compared' : cm.singleOnly.matchesExhaustive ? 'same family' : `misses ${cm.singleOnly.missed.join(', ')}`, cm.singleOnly.matchesExhaustive !== false),
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

function downloadReport() {
  const a = h('a', { href: URL.createObjectURL(new Blob([reportMarkdown(state.c, state.d)], { type: 'text/markdown' })), download: `repair-report-${(state.wf.name || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md` });
  a.click();
}

function download() {
  const f = exportWitness(state.c, selectedSet());
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(f, null, 2)], { type: 'application/json' })), download: `witness-${selectedSet().join('+')}.json` });
  a.click();
}

function parsedText(raw) { const p = parseValue(raw); return p.error ? `error: ${p.error}` : `read as ${p.type}`; }
function showParsed(input) { const out = input.parentElement.querySelector('.parsed'); out.textContent = parsedText(input.value); out.classList.toggle('bad', !!parseValue(input.value).error); }

function openDialog(kind) {
  const dlg = $('#dlg');
  const form = $('#dlgForm'); form.hidden = kind !== 'edit'; $('#dlgText').hidden = kind === 'edit';
  if (kind === 'edit') {
    form.replaceChildren(h('div', { class: 'erow ehead' }, h('span', {}, 'Event'), h('span', {}, 'Faulty value'), h('span', {}, 'Replacement'), h('span', {}, 'Cost (optional)')),
      ...state.c.candidates.map((id) => { const e = state.c.byId.get(id); return h('div', { class: 'erow' }, h('span', {}, e.label ?? id), h('code', {}, fmt(e.observed)),
        h('span', { class: 'cleancell' }, h('small', { class: 'narrowonly' }, 'Replacement'), h('input', { 'data-id': id, 'data-f': 'clean', value: JSON.stringify(e.clean), 'aria-label': `Replacement for ${e.label ?? id}`, oninput: (ev) => showParsed(ev.target) }), h('small', { class: 'parsed', 'data-for': id }, parsedText(JSON.stringify(e.clean)))),
        h('span', { class: 'cleancell' }, h('small', { class: 'narrowonly' }, 'Cost (optional)'), h('input', { 'data-id': id, 'data-f': 'cost', value: e.cost ?? '', placeholder: '1', 'aria-label': `Cost of ${e.label ?? id}` }))); }));
  }
  $('#dlgTitle').textContent = kind === 'edit' ? 'Edit replacements' : kind === 'import' ? 'Load a workflow (JSON)' : 'Verify a witness file';
  $('#dlgText').value = kind === 'import' ? JSON.stringify(state.wf, null, 2) : '';
  $('#dlgText').placeholder = kind === 'verify' ? 'Paste a downloaded witness-*.json here' : '';
  $('#dlgMsg').textContent = kind === 'edit' ? 'Try a different clean value, or give each repair a cost to rank the working sets. Numbers, true/false and null keep their type; a plain word like weather is read as text. Anything that looks like JSON but does not parse is rejected. The search runs again when you apply.' : kind === 'import' ? 'Workflows are data. Only the built-in operations run; nothing from this file executes as code.' : 'Re-runs the witness from scratch and checks nothing was edited.';
  $('#dlgMsg').className = 'msg';
  $('#dlgGo').onclick = (ev) => {
    ev.preventDefault();
    try {
      if (kind === 'edit') {
        const edits = {};
        for (const i of form.querySelectorAll('input')) (edits[i.dataset.id] ??= {})[i.dataset.f] = i.value;
        const nw = applyEdits(state.wf, edits); compile(nw); load(nw); dlg.close(); return;
      }
      if ($('#dlgText').value.length > LIMITS.fileBytes) throw new Error(`file is larger than ${LIMITS.fileBytes.toLocaleString('en-US')} characters`);
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
  ['The answer', 'The formula lists every repair set, up to the size bound you chose, that passes and has no smaller passing part inside it. Larger sets are not searched unless you raise the bound. A set of 1 and a set of 3 can both appear. AND means needed together, OR means alternatives.'],
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
