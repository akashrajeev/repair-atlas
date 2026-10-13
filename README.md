# Repair Atlas

When a multi-step AI workflow fails, one fix is often not enough, or any one of several fixes is enough. Repair Atlas takes the repairs you already have, tries them in combinations from smallest up, and shows every smallest set that makes the run pass. It marks which repairs are needed together (AND) and which are alternatives (OR), then replays each result as proof: the repaired run passes and every strict subset still fails.

## Run it

Needs Node 20+ and a browser. No dependencies, no keys.

```
npm start            # http://127.0.0.1:5173
npm test             # all tests
node src/cli.js all  # diagnose every example from the terminal
node src/cli.js analyze fixtures/refund-desk.json 3 --witness > witness.json
node src/cli.js verify witness.json
```

URL options: `?f=refund` picks an example, `?theme=a|b|c` picks a visual theme (default b).

## What it does

- Six-plus example failed workflows (single fault, joint AND, alternative OR, three-way AND, OR of AND, chained AND, shared-core joint repairs).
- Recovery formula such as `Manager override OR (Refund reason AND Refund amount AND Auto-approve cap)`.
- Click any dashed event to try your own repair set; it tells you whether it passes, what is missing, or what is unnecessary.
- Replay proof with play/scrub, and a downloadable witness file that can be verified later from scratch.
- A comparison of how many replays each strategy needs, including one-event-at-a-time search, which misses joint repairs.

## What it does not do

- It does not invent fixes. You supply the clean replacement for each faulty event and the pass/fail check.
- Replay is a deterministic executor over recorded payloads, not a re-run of a live LLM. Results are exact up to the repair-size bound you choose (default 2, up to 4).
- Workflows are data. Only a fixed list of operations runs (`src/ops.js`); nothing in a loaded file executes as code.
- The witness hash detects edits. It is not a cryptographic signature.

## Where the idea comes from

The set-valued target ("all inclusion-minimal repair sets within a size bound") and the singleton and pair search are from "Localizing Emergent Failures in Agentic AI: Recovering Minimal Repair Families via Counterfactual Replay" (https://arxiv.org/html/2608.29228v2). This project is a separate, small implementation built after reading it. It does not reproduce the paper's experiments or numbers.

- The paper's pair rule only considers pairs from different agents, causally unordered, meeting at a join, and only sizes 1 and 2. Repair Atlas includes that rule as a comparison. Some examples here (a chained pair, three-way repairs) fall outside that declared domain by design.
- Atlas's own search ("complete" mode) uses the backward slice and level-wise minimality pruning for any size bound. It tests more sets than the paper's rule in some cases and fewer than replaying everything.
- Related open-source work exists, for example https://github.com/jaineet17/causal-agent-replay and https://github.com/devangb3/CausalFlow. This is not claimed to be first.

## How it was checked

- Unit tests for validation, replay, search, roles, witnesses and judging hand-picked sets.
- A property test compares the search to an independent brute-force over 400 random workflows (seeded), including jointly necessary repairs.
- Replays give the same result under any valid event order, and parallel worker threads agree with serial runs.
- A layout test checks no events overlap, and a headless-browser test renders every example.

## Layout

`src/` engine, `ui/` page, `fixtures/` examples, `test/` tests, `scripts/serve.js` static server, `devpost/` planning documents.
