# Repair Atlas

When a multi-step AI workflow fails, one fix is often not enough, or any one of several fixes is enough. Repair Atlas takes the repairs you already have, tries them in combinations, fewest fixes first, and shows every set, up to a size bound you choose, that makes the run pass and has no smaller passing set inside it (inclusion-minimal, not only the fewest fixes, so a single fix and a three-fix route can both appear). It marks which repairs are needed together (AND) and which are alternatives (OR), then replays each result as proof: the repaired run passes and every strict subset still fails.

## Run it

From the zip: unzip, `cd repair-atlas`, `npm start`. From a clone (needs git and Node 20+): `git clone -b main https://github.com/akashrajeev/repair-atlas.git && cd repair-atlas && npm start`, then open http://127.0.0.1:5173. In the page, press Guide for a 5-step tour.

Needs Node 20+ and a browser. No dependencies, no keys.

```
npm start            # http://127.0.0.1:5173
npm test             # all tests
node src/cli.js all  # diagnose every example from the terminal
node src/cli.js analyze fixtures/refund-desk.json 3 --witness > witness.json
node src/cli.js verify witness.json
node src/cli.js analyze my-run.json 3 --json   # exit 0 if a repair set exists, 2 if none within the bound
node src/cli.js report my-run.json 3           # Markdown report
```

URL options: `?f=refund` picks an example, `?theme=a|b|c` picks a visual theme (default b).

## What it does

- Nine example failed workflows (single fault, joint AND, alternative OR, three-way AND, OR of AND, chained AND, shared-core joint repairs, a shortcut that breaks a passing check, and a non-monotone overshoot where applying every replacement fails but one alone passes).
- Recovery formula such as `Manager override OR (Refund reason AND Refund amount AND Auto-approve cap)`.
- Click any dashed event to try your own repair set; it tells you whether it passes, what is missing, or what is unnecessary.
- Replay proof with play/scrub, and a downloadable witness file that can be verified later from scratch.
- Optional repair costs: give a candidate a positive `cost` in the workflow JSON (effort, risk, anything you rank by) and each repair set shows its total, with the cheapest marked. Cheapest is chosen among the inclusion-minimal sets only; costs are your input, not measured.
- A comparison of how many replays each strategy needs, including one-event-at-a-time search, which misses joint repairs.

## What it does not do

- It does not invent fixes. You supply the clean replacement for each faulty event and the pass/fail check.
- Replay is a deterministic executor over recorded payloads, not a re-run of a live LLM. Results are exact up to the repair-size bound you choose (default 2, up to 4).
- Workflows are data. Only a fixed list of operations runs (`src/ops.js`); nothing in a loaded file executes as code.
- The witness hash detects accidental edits. It is not a signature and anyone can recompute it. A witness is trusted only because `verify` replays it.

## Reading the output

`analyze --json` keeps a short, stable `roles` key per replacement. What each one means is limited to what was searched (`searchedEverySubset` says whether that was every combination or only sets up to `bound`):

- `solo`, `required-and`, `and-partner`, `mixed`: the replacement appears in at least one inclusion-minimal repair that was found.
- `decoy`: alone it fixes one failing check but breaks a check that passed.
- `irrelevant`: it is in none of the repairs that were found. It does not mean the replacement is harmless or unneeded. With a bounded search (`searchedEverySubset: false`) it may belong to a larger repair that the bound did not reach. Even with every combination searched it only means "in no minimal repair".
- `breaksIfAdded` is separate: it lists working sets that stop working when that replacement is added. Workflows are not monotone, so adding a fix can undo a fix.
- `roleNotes` gives the same one-line wording the UI and the Markdown report show, for example "in no repair of up to 2".

## Where the idea comes from

The set-valued target ("all inclusion-minimal repair sets within a size bound") and the singleton and pair search are from "Localizing Emergent Failures in Agentic AI: Recovering Minimal Repair Families via Counterfactual Replay" (https://arxiv.org/html/2608.29228v2). This project is a separate, small implementation built after reading it. It does not reproduce the paper's experiments or numbers.

- The paper's pair rule only considers pairs from different agents, causally unordered, meeting at a join, and only sizes 1 and 2. Repair Atlas includes that rule as a comparison. Some examples here (a chained pair, three-way repairs) fall outside that declared domain by design.
- Atlas's own search ("complete" mode) uses the backward slice and level-wise minimality pruning for any size bound. It tests more sets than the paper's rule in some cases and fewer than replaying everything.
- Related open-source work exists, for example https://github.com/jaineet17/causal-agent-replay and https://github.com/devangb3/CausalFlow. This is not claimed to be first.

## How it was checked

- Unit tests for validation, replay, search, roles, witnesses and judging hand-picked sets.
- `node scripts/mutate.js` plants 11 deliberate engine bugs and reports how many the tests catch (10 of 11 today; the survivor is redundant while pruning already guarantees minimality).
- `node src/cli.js judge <workflow> a,b` classifies a hand-picked repair set (minimal, extra, partial, none).
- A property test compares the search to an independent brute-force over 400 random workflows (seeded), including jointly necessary repairs.
- Replays give the same result under any valid event order, and parallel worker threads agree with serial runs.
- A layout test checks no events overlap, and a headless-browser test renders every example.

## Benchmark on random workflows

`node scripts/bench.js 300 2` (or `300 3`) runs seeded random synthetic workflows (seeds from 1, up to 9 repair candidates) against an exhaustive search and writes raw per-workflow rows to `bench-results-n300-q<bound>.json`.

Results on the first 300 seeds:

| | bound 2 | bound 3 |
|---|---|---|
| repairable workflows (denominator) | 229 | 287 |
| needing a joint (2+) repair | 110 | 168 |
| complete search differs from exhaustive | 0 | 0 |
| one-at-a-time finds none / only part / all | 109 / 1 / 119 | 167 / 1 / 119 |
| replays: complete vs replay-everything | 1531 vs 2784 | 2621 vs 6228 |

The published pair rule, split by its declared domain (exact answer made only of singles and pairs from different agents, causally unordered, meeting at a join): inside the domain it matched the exact answer in 190 of 190 cases at both bounds, which agrees with the paper's claim. Outside the domain (the exact answer has a chain, a triple or a same-agent pair) it differs in every case (39 at bound 2, 97 at bound 3). That is true by construction of the split and is not a defect of the rule.

These are synthetic numbers from this generator, not a claim about real agent systems.

See [docs/workflow-format.md](docs/workflow-format.md) for the file format and the list of operations (generated from the code; a test fails if it drifts).

## Layout

`src/` engine, `ui/` page, `fixtures/` examples, `test/` tests, `scripts/serve.js` static server, `devpost/` planning documents.
