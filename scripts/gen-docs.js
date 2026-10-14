// Regenerates docs/workflow-format.md from the live operation table, so the doc cannot drift.
import { writeFileSync, readFileSync } from 'node:fs';
import { OPS } from '../src/ops.js';

const arity = (a) => (Array.isArray(a) ? (a[1] === Infinity ? `${a[0]} or more` : `${a[0]} to ${a[1]}`) : String(a));
const example = JSON.parse(readFileSync(new URL('../fixtures/order-regression.json', import.meta.url), 'utf8'));
const out = `# Workflow file format

A workflow is plain JSON. Repair Atlas never runs code from a file: each event uses one operation from the fixed list below.

## Fields

| Field | Where | Meaning |
|---|---|---|
| name, story | workflow | Title and a one-line description shown on the page |
| agents | workflow | Optional lane order |
| defaultMaxSize | workflow | Repair size bound the page starts with (1 to 4) |
| events | workflow | The recorded run. Each event has id, agent, op, optional label, args (ids of earlier events), and value for \`const\` |
| observed, clean | event | Both together make the event a repair candidate. \`observed\` is the faulty payload in the failed run, \`clean\` is the supplied replacement |
| cost | candidate | Optional positive number used to rank working repair sets |
| checks | workflow | The pass/fail oracle. Each check names an event and an \`expect\` of eq, gte, lte, gt, lt, truthy or falsy. The run passes only if every check passes |

## Operations

| op | arguments |
|---|---|
${Object.entries(OPS).map(([k, v]) => `| ${k} | ${arity(v.arity)} |`).join('\n')}

## What the search assumes

- You supply the clean replacement for every candidate. Repair Atlas does not invent fixes.
- Replay is a deterministic executor over the recorded payloads, not a re-run of a live system.
- Results are exact within the repair size bound you choose. Applying every replacement together is not assumed to pass, and a smaller set can pass when the full set does not.

## Example

\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`
`;
writeFileSync(new URL('../docs/workflow-format.md', import.meta.url), out);
console.log('wrote docs/workflow-format.md');
