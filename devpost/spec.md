---
doc: spec
status: approved
---
# Repair Atlas - Technical Spec


## How This Works, In Plain Language
A workflow is a list of events. Each event has an agent, an operation, and inputs. Some events are faulty and carry both the faulty payload and a clean one. A repair swaps in the clean payload. Replay recomputes everything downstream and checks the result. The search tries repair sets from smallest to largest and keeps only those that pass while all their smaller subsets fail.

## The Core Journey Through the System
UI loads a workflow, compiles it, runs the search, and renders the diagnosis. Selecting a family replays it and draws the proof.

## Stack
Plain JavaScript (ES modules), Node 20+ for tests and a tiny static server, browser SVG for the graph. No runtime dependencies, no build step.

## Where It Runs and How Someone Tries It
`npm start`, then open http://127.0.0.1:5173. `npm test` runs the tests. `node src/cli.js analyze fixtures/refund-desk.json` runs the engine from the terminal.

## Look and Feel
Three CSS themes on one layout, chosen with `?theme=a|b|c`.

## Components
### Model (`src/model.js`)
Validation, topological order, ancestors.
### Operations (`src/ops.js`)
The fixed table of allowed operations. Nothing else can run.
### Replay (`src/replay.js`)
Deterministic recompute with a counting, memoising backend.
### Search (`src/search.js`)
Modes: exhaustive, complete (slice plus level-wise pruning), published pair rule.
### Analysis (`src/analysis.js`)
Roles, recovery formula, comparison, witnesses, verification.
### UI (`ui/`)
Layout, SVG rendering, replay controls, dialogs.

## Data Model
Workflow JSON: events, checks, agents. Witness JSON: workflow, repairs, hash, evidence.

## File Structure
`src/` engine, `ui/` page, `fixtures/` example workflows, `test/` tests, `scripts/serve.js` static server, `devpost/` planning docs.

## External Services and Dependencies
None.

## Important Failure Modes
Cyclic or malformed workflows are rejected. Unknown operations are rejected. A passing baseline is reported, not "fixed". Edited witness files fail verification.

## What Was Simplified and Why
Replay is a deterministic executor, not a live LLM re-run, so results are exact and the demo needs no keys. The witness hash detects accidental edits and is not a cryptographic signature.

## Decisions and Open Issues
Public repo, license and demo video pending Akash's go-ahead.
