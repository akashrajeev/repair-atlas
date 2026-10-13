---
doc: scope
status: approved
---
# Repair Atlas


## The Unique Kernel
When a multi-step AI workflow fails, one fix is often not enough, or any one of two fixes is enough. Repair Atlas finds every smallest combination of the repairs you supply that makes the run pass, and shows which repairs are jointly necessary (AND) and which are alternatives (OR), with a replay that proves each one.

## Who It's For
People who debug agent pipelines or multi-step workflows, and judges who need to see the idea work in under three minutes.

## The Core Loop
1. Load a failed run (a recorded workflow with the faulty messages and their clean replacements).
2. Repair Atlas replays combinations of repairs, smallest first.
3. It draws the recovery formula (e.g. "Manager override OR (Reason AND Amount AND Cap)") on the workflow graph.
4. Click any repair to replay it, step by step, and see that each strict subset still fails.

## Inspiration & Identity
Based on the idea of "minimal repair families" from the paper "Localizing Emergent Failures in Agentic AI" (https://arxiv.org/html/2608.29228v2). This is a practical, visual, executable tool built after reading it, not a reimplementation of its experiments. Related open-source work exists (causal-agent-replay, CausalFlow); Repair Atlas does not claim to be first.

## Why This Matters to the Learner
Not yet stated by Akash beyond wanting to win the hackathon. To be filled from his words.

## What "Working" Looks Like
Open the app, pick a failed workflow, and see the correct repair family and a passing replay. Tests run and pass. A video can show the whole thing in under three minutes.

## The POC Boundary
- Oracle-assisted: the user supplies clean replacement messages and a pass/fail check. The tool does not invent fixes.
- Exact within the declared bound (repair sets up to a chosen size) for deterministic replay.
- Six built-in example workflows plus pasted JSON workflows. Only built-in operations run; no uploaded code is executed.
- Runs locally with Node and a browser, no keys, no paid services.

## Later
Plugging in a real agent framework as the replay backend; importing traces from existing tools; probabilistic replays for LLM runs.

## Explicitly Cut
Automatic fix generation, arbitrary code debugging, accounts, cloud hosting, paid APIs.
