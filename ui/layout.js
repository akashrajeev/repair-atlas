// Swimlane layout: one lane per agent, one column per dependency depth.
export const NODE = { w: 158, h: 54, colGap: 64, laneGap: 34, padX: 36, padTop: 18, padBottom: 20 };

export function layout(c) {
  const depth = new Map();
  for (const id of c.order) {
    const args = c.byId.get(id).args ?? [];
    depth.set(id, args.length ? 1 + Math.max(...args.map((a) => depth.get(a))) : 0);
  }
  const agents = [...new Set([...(c.wf.agents ?? []), ...c.events.map((e) => e.agent)])].filter((a) => c.events.some((e) => e.agent === a));
  const maxDepth = Math.max(...depth.values());
  // events sharing (agent, depth) are stacked inside the lane cell
  const cell = new Map();
  for (const id of c.order) {
    const e = c.byId.get(id); const k = `${e.agent}|${depth.get(id)}`;
    cell.set(k, [...(cell.get(k) ?? []), id]);
  }
  const laneRows = new Map(agents.map((a) => [a, 1]));
  for (const [k, ids] of cell) { const a = k.split('|')[0]; laneRows.set(a, Math.max(laneRows.get(a), ids.length)); }
  const laneY = new Map(); let y = NODE.padTop;
  for (const a of agents) { laneY.set(a, y); y += laneRows.get(a) * (NODE.h + 12) + NODE.laneGap - 12; }
  const pos = new Map();
  for (const [k, ids] of cell) {
    const [a, d] = k.split('|');
    ids.forEach((id, i) => pos.set(id, { x: NODE.padX + 150 + Number(d) * (NODE.w + NODE.colGap), y: laneY.get(a) + i * (NODE.h + 12), depth: Number(d), agent: a }));
  }
  const width = NODE.padX * 2 + 150 + (maxDepth + 1) * (NODE.w + NODE.colGap) - NODE.colGap;
  const height = y + NODE.padBottom;
  const lanes = agents.map((a) => ({ agent: a, y: laneY.get(a) - 10, h: laneRows.get(a) * (NODE.h + 12) + 8 }));
  return { pos, width, height, lanes, depth };
}

export function edgePath(p, q) {
  const x1 = p.x + NODE.w, y1 = p.y + NODE.h / 2, x2 = q.x, y2 = q.y + NODE.h / 2;
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
