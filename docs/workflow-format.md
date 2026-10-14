# Workflow file format

A workflow is plain JSON. Repair Atlas never runs code from a file: each event uses one operation from the fixed list below.

## Fields

| Field | Where | Meaning |
|---|---|---|
| name, story | workflow | Title and a one-line description shown on the page |
| agents | workflow | Optional lane order |
| defaultMaxSize | workflow | Repair size bound the page starts with (1 to 4) |
| events | workflow | The recorded run. Each event has id, agent, op, optional label, args (ids of earlier events), and value for `const` |
| observed, clean | event | Both together make the event a repair candidate. `observed` is the faulty payload in the failed run, `clean` is the supplied replacement |
| cost | candidate | Optional positive number used to rank working repair sets |
| checks | workflow | The pass/fail oracle. Each check names an event and an `expect` of eq, gte, lte, gt, lt, truthy or falsy. The run passes only if every check passes |

## Operations

| op | arguments |
|---|---|
| const | 0 |
| add | 2 or more |
| sub | 2 |
| mul | 2 or more |
| div | 2 |
| mod | 2 |
| min | 1 or more |
| max | 1 or more |
| abs | 1 |
| neg | 1 |
| round | 1 |
| clamp | 3 |
| eq | 2 |
| gt | 2 |
| gte | 2 |
| lt | 2 |
| lte | 2 |
| and | 2 or more |
| or | 2 or more |
| not | 1 |
| if | 3 |
| concat | 2 or more |
| len | 1 |
| includes | 2 |
| list | 0 or more |
| sum | 1 |

## What the search assumes

- You supply the clean replacement for every candidate. Repair Atlas does not invent fixes.
- Replay is a deterministic executor over the recorded payloads, not a re-run of a live system.
- Results are exact within the repair size bound you choose. Applying every replacement together is not assumed to pass, and a smaller set can pass when the full set does not.

## Example

```json
{
  "name": "Order total with a tempting shortcut",
  "pattern": "joint AND, shortcut breaks a passing check",
  "story": "The order total is wrong because quantity and unit price are both wrong. Forcing the total to 36 looks like a quick fix, but it breaks the price consistency check that was passing.",
  "agents": [
    "Intake",
    "Pricing",
    "Support",
    "Auditor"
  ],
  "defaultMaxSize": 3,
  "events": [
    {
      "id": "qty",
      "agent": "Intake",
      "label": "Quantity",
      "op": "const",
      "value": 3,
      "observed": 2,
      "clean": 3
    },
    {
      "id": "unit",
      "agent": "Pricing",
      "label": "Unit price",
      "op": "const",
      "value": 12,
      "observed": 10,
      "clean": 12
    },
    {
      "id": "manual_flag",
      "agent": "Support",
      "label": "Use manual total",
      "op": "const",
      "value": true,
      "observed": false,
      "clean": true
    },
    {
      "id": "manual_total",
      "agent": "Support",
      "label": "Manual total",
      "op": "const",
      "value": 36
    },
    {
      "id": "calc_total",
      "agent": "Pricing",
      "label": "Calculated total",
      "op": "mul",
      "args": [
        "qty",
        "unit"
      ]
    },
    {
      "id": "total",
      "agent": "Pricing",
      "label": "Order total",
      "op": "if",
      "args": [
        "manual_flag",
        "manual_total",
        "calc_total"
      ]
    },
    {
      "id": "implied_unit",
      "agent": "Auditor",
      "label": "Implied unit price",
      "op": "div",
      "args": [
        "total",
        "qty"
      ]
    },
    {
      "id": "consistent",
      "agent": "Auditor",
      "label": "Price consistent?",
      "op": "eq",
      "args": [
        "implied_unit",
        "unit"
      ]
    },
    {
      "id": "total_ok",
      "agent": "Auditor",
      "label": "Total is 36?",
      "op": "eq",
      "args": [
        "total",
        "manual_total"
      ]
    }
  ],
  "checks": [
    {
      "id": "total_correct",
      "label": "Total is 36",
      "event": "total_ok",
      "expect": {
        "truthy": true
      }
    },
    {
      "id": "price_consistent",
      "label": "Price is consistent",
      "event": "consistent",
      "expect": {
        "truthy": true
      }
    }
  ]
}
```
