import { OPS, arityOk } from './ops.js';

/**
 * Workflow format (plain JSON):
 * {
 *   name, story,
 *   agents: ["Planner", ...],
 *   events: [{ id, agent, label, op, args:[ids], value? ,
 *              observed?, clean? }],          // observed+clean make an event a repair candidate
 *   checks: [{ id, label, event, expect:{ eq|gte|lte|gt|lt|truthy|falsy: ... } }]
 * }
 * observed: the (faulty) payload the event carried in the failed run.
 * clean:    the paired clean payload a repair swaps in.
 * Replacing an event with its clean payload is a "repair"; everything downstream is recomputed.
 */

/** Input caps: workflows are untrusted data, so size and shape are bounded before anything is replayed. */
export const LIMITS = { events: 300, checks: 50, args: 64, shortText: 200, longText: 2000, stringValue: 2000, listValue: 200, fileBytes: 500000 };
const scalar = (x) => x === null || ['string', 'number', 'boolean'].includes(typeof x);
function payloadProblem(v) {
  if (typeof v === 'string') return v.length > LIMITS.stringValue ? `string longer than ${LIMITS.stringValue} characters` : null;
  if (scalar(v)) return null;
  if (Array.isArray(v)) return v.length > LIMITS.listValue ? `list longer than ${LIMITS.listValue} items` : v.every((x) => scalar(x) && payloadProblem(x) === null) ? null : 'lists may only hold plain numbers, strings, booleans or null';
  return 'values must be a number, string, boolean, null, or a flat list of those';
}

export function validate(wf) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!wf || typeof wf !== 'object') return ['workflow must be an object'];
  if (!Array.isArray(wf.events) || wf.events.length === 0) return ['workflow.events must be a non-empty array'];
  if (!Array.isArray(wf.checks) || wf.checks.length === 0) err('workflow.checks must be a non-empty array (the success oracle)');
  if (wf.events.length > LIMITS.events) return [`too many events (${wf.events.length}); the limit is ${LIMITS.events}`];
  if ((wf.checks?.length ?? 0) > LIMITS.checks) return [`too many checks (${wf.checks.length}); the limit is ${LIMITS.checks}`];
  for (const k of ['name', 'story']) if (wf[k] !== undefined && (typeof wf[k] !== 'string' || wf[k].length > (k === 'name' ? LIMITS.shortText : LIMITS.longText))) err(`workflow.${k} must be text of at most ${k === 'name' ? LIMITS.shortText : LIMITS.longText} characters`);
  const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!wf.events.every(plain)) return ['every event must be an object'];
  if (Array.isArray(wf.checks) && !wf.checks.every(plain)) return ['every check must be an object'];
  const ids = new Set();
  for (const e of wf.events) {
    for (const k of ['id', 'agent', 'label']) if (typeof e[k] === 'string' && e[k].length > LIMITS.shortText) err(`event ${String(e.id).slice(0, 30)}: ${k} is longer than ${LIMITS.shortText} characters`);
    for (const k of ['value', 'observed', 'clean']) if (k in e) { const pr = payloadProblem(e[k]); if (pr) err(`event ${String(e.id).slice(0, 30)}: ${k}: ${pr}`); }
    if (Array.isArray(e.args) && e.args.length > LIMITS.args) err(`event ${String(e.id).slice(0, 30)}: more than ${LIMITS.args} args`);
  }
  for (const e of wf.events) {
    if (typeof e.id !== 'string' || !e.id) { err('every event needs a string id'); continue; }
    if (ids.has(e.id)) err(`duplicate event id "${e.id}"`);
    ids.add(e.id);
    if (typeof e.agent !== 'string' || !e.agent) err(`event ${e.id}: agent is required`);
    if (!Object.hasOwn(OPS, e.op)) { err(`event ${e.id}: unknown op "${e.op}" (allowed: ${Object.keys(OPS).join(', ')})`); continue; }
    const args = e.args ?? [];
    if (!Array.isArray(args)) { err(`event ${e.id}: args must be an array`); continue; }
    if (!arityOk(e.op, args.length)) err(`event ${e.id}: op ${e.op} cannot take ${args.length} args`);
    if (e.op === 'const' && !('value' in e)) err(`event ${e.id}: const events need a value`);
    if ('cost' in e && !(typeof e.cost === 'number' && e.cost > 0 && Number.isFinite(e.cost))) err(`event ${e.id}: cost must be a positive number`);
    if ('cost' in e && !('clean' in e)) err(`event ${e.id}: cost only applies to repair candidates`);
    if (('observed' in e) !== ('clean' in e)) err(`event ${e.id}: observed and clean must be given together`);
  }
  if (errors.length) return errors;
  for (const e of wf.events) for (const a of e.args ?? []) if (!ids.has(a)) err(`event ${e.id}: unknown arg "${a}"`);
  if (errors.length) return errors;
  if (hasCycle(wf)) err('workflow has a cycle; replay needs a DAG');
  for (const c of wf.checks ?? []) {
    if (!ids.has(c.event)) err(`check ${c.id ?? '?'}: unknown event "${c.event}"`);
    if (!c.expect || typeof c.expect !== 'object' || !CHECKERS.some((k) => k in c.expect)) err(`check ${c.id ?? '?'}: expect needs one of ${CHECKERS.join(', ')}`);
  }
  return errors;
}

export const CHECKERS = ['eq', 'gte', 'lte', 'gt', 'lt', 'truthy', 'falsy'];

export function checkPasses(expect, v) {
  if ('eq' in expect) return JSON.stringify(v) === JSON.stringify(expect.eq);
  if ('gte' in expect) return typeof v === 'number' && v >= expect.gte;
  if ('lte' in expect) return typeof v === 'number' && v <= expect.lte;
  if ('gt' in expect) return typeof v === 'number' && v > expect.gt;
  if ('lt' in expect) return typeof v === 'number' && v < expect.lt;
  if ('truthy' in expect) return Boolean(v);
  if ('falsy' in expect) return !v;
  return false;
}

function hasCycle(wf) {
  const byId = new Map(wf.events.map((e) => [e.id, e]));
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const a of byId.get(id).args ?? []) if (visit(a)) return true;
    state.set(id, 2);
    return false;
  };
  return wf.events.some((e) => visit(e.id));
}

/** Compiled, immutable view with topology helpers. */
export function compile(wf) {
  const errors = validate(wf);
  if (errors.length) throw new WorkflowError(errors);
  const events = wf.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const order = topoOrder(events);
  const children = new Map(events.map((e) => [e.id, []]));
  for (const e of events) for (const a of e.args ?? []) children.get(a).push(e.id);
  const ancestors = new Map();
  for (const id of order) {
    const s = new Set();
    for (const a of byId.get(id).args ?? []) { s.add(a); for (const x of ancestors.get(a)) s.add(x); }
    ancestors.set(id, s);
  }
  const candidates = events.filter((e) => 'clean' in e).map((e) => e.id);
  return { wf, events, byId, order, children, ancestors, candidates };
}

export class WorkflowError extends Error {
  constructor(errors) { super(errors.join('; ')); this.errors = errors; this.name = 'WorkflowError'; }
}

/** Kahn order, ties broken by declaration order unless `rng` shuffles ready nodes. */
export function topoOrder(events, rng = null) {
  const indeg = new Map(events.map((e) => [e.id, (e.args ?? []).length]));
  const kids = new Map(events.map((e) => [e.id, []]));
  for (const e of events) for (const a of e.args ?? []) kids.get(a).push(e.id);
  let ready = events.filter((e) => indeg.get(e.id) === 0).map((e) => e.id);
  const out = [];
  while (ready.length) {
    const i = rng ? Math.floor(rng() * ready.length) : 0;
    const [id] = ready.splice(i, 1);
    out.push(id);
    for (const k of kids.get(id)) {
      indeg.set(k, indeg.get(k) - 1);
      if (indeg.get(k) === 0) ready.push(k);
    }
  }
  return out;
}

/**
 * Returns a copy of the workflow with edited clean replacements and costs.
 * edits: { [eventId]: { clean?: string, cost?: string } } - strings as typed in a form.
 * Clean text is read as JSON (5, true, "abc", null); text that is not JSON is kept as a string.
 * Empty cost removes the cost. Unknown or non-candidate ids are rejected.
 */
/**
 * How the edit dialog reads a typed replacement. Valid JSON keeps its type (5, true, null, "text", [1,2]);
 * a bare word like weather is taken as text on purpose. Anything that looks like JSON but does not parse
 * (starts with a bracket, quote or digit, or is a miscased true/false/null) is an error, never silently text.
 */
export function parseValue(raw) {
  const t = String(raw).trim();
  try {
    const v = JSON.parse(t);
    const type = v === null ? 'null' : Array.isArray(v) ? 'list' : typeof v === 'object' ? 'object' : typeof v === 'string' ? 'text' : typeof v;
    return { value: v, type };
  } catch { /* not JSON: decide whether it was meant to be */ }
  if (/^[\[{"]/.test(t)) return { error: 'looks like JSON but does not parse; fix it, or write plain text without quotes or brackets' };
  if (/^-?\d/.test(t)) return { error: 'starts like a number but is not a valid number; use digits only, or put text in quotes' };
  if (/^(true|false|null)$/i.test(t)) return { error: `did you mean ${t.toLowerCase()} (lowercase)? Use quotes for the word as text` };
  return { value: t, type: 'text' };
}

export function applyEdits(wf, edits) {
  const w = structuredClone(wf);
  for (const [id, ed] of Object.entries(edits)) {
    const e = w.events.find((x) => x.id === id);
    if (!e || !('clean' in e)) throw new WorkflowError([`${id} is not a repair candidate`]);
    if (ed.clean !== undefined) { const pv = parseValue(ed.clean); if (pv.error) throw new WorkflowError([`${id}: replacement ${pv.error}`]); e.clean = pv.value; }
    if (ed.cost !== undefined) { if (String(ed.cost).trim() === '') delete e.cost; else e.cost = Number(ed.cost); }
  }
  return w;
}
