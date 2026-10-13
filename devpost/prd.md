---
doc: prd
status: draft
---
# Repair Atlas - Product Requirements

> Draft. Needs Akash's read and approval.

## The Core Journey
1. Open the app. A failed example workflow is already loaded.
2. Read the headline: the recovery formula and whether the repairs are single, joint, or alternatives.
3. Click a repair family. The graph shows what changes downstream.
4. Press Play replay or drag the slider to watch values flow to the check.
5. Read the proof: no repairs fails, each smaller subset fails, the full set passes.
6. Compare how many replays each search strategy needed.
7. Optionally paste your own workflow, change the size bound, download a witness file, or verify one.

## Screens and Layout
One page. Top bar: workflow picker, size bound, load JSON, verify witness. Left: swimlane graph by agent. Right: formula, repair families, event roles. Below: replay proof, then the replay-count comparison.

## Look and Feel
Hand-built, three visual directions offered (A Cartographer, B Lab bench, C Circuit). Dashed outline = repair candidate, green = repaired, animated dashes = what the repair changes.

## Features and Behavior
### Workflow loading
Six built-in workflows covering: single fault, joint AND, alternative OR, three-way AND, OR of AND, chained AND. JSON import with specific error messages.
### Repair search
Finds all inclusion-minimal repair sets up to the bound. Also runs a replay-everything baseline, the published pair rule, and a one-event-at-a-time search for comparison.
### Replay proof
Shows the failing run, every strict subset, and the passing run. Exports a witness file and re-verifies it.
### Event roles
Solo fix, part of a joint repair, alternative, or irrelevant.

## States and Boundaries
- Run already passes: say so, nothing to repair.
- No repair within the bound: say so and suggest raising the bound.
- Invalid JSON or unknown operation: list the problems, run nothing.

## Product Decisions
Repairs are supplied, not invented. Replay is deterministic. Everything runs locally.

## What We're Building
The above, tested.

## Deferred From the POC
Real LLM backends, trace import, hosted version.

## Possible Later Enhancements
Probabilistic replay, more operations, exporting a report.

## Non-Goals
Automatic fixes, debugging arbitrary programs.

## Open Questions
Which visual direction (A, B or C). Akash to choose.
