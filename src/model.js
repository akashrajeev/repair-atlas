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

export function validate(wf) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!wf || typeof wf !== 'object') return ['workflow must be an object'];
  if (!Array.isArray(wf.events) || wf.events.length === 0) return ['workflow.events must be a non-empty array'];
  if (!Array.isArray(wf.checks) || wf.checks.length === 0) err('workflow.checks must be a non-empty array (the success oracle)');
  const ids = new Set();
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
