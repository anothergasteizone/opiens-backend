# Tests

The suite is written with **Jest** + **ts-jest** (and **supertest** for the HTTP layer).

> **A note on AI assistance.** I wrote these tests with the help of an AI assistant
> (Claude), as a deliberate experiment. This is my first time writing automated tests in
> Node.js/TypeScript — I have written tests before with **PHPUnit**, so the underlying
> ideas (fixtures, fakes/mocks, assertions, arrange–act–assert) carried over, but the
> Node tooling (Jest, ts-jest, supertest) was new to me and I wanted to try pairing with
> AI to learn it quickly. I reviewed every test and understand what each one asserts and
> why. The rest of the documents in this folder were also AI-assisted; this note is
> specifically about the test code.

## Running

```bash
yarn test           # run the whole suite once
yarn test:watch     # re-run on change
```

No setup is required: unit tests use hand-written fakes and the integration tests spin
up an **in-memory SQLite** database, so nothing touches disk or the real `data/` file.

## Approach

The architecture is built around small, consumer-owned interfaces and dependency
injection, which is exactly what makes it testable:

- **Pure functions** (`assertValidDag`, `summarizeTaskOutputs`) are tested directly, no doubles.
- **Services and the runner** are tested against **hand-written fakes** of their
  repository interfaces (`IWorkflowRepository`, `ITaskRepository`,
  `IWorkflowCompletionRepository`) — no database, no mocking framework needed.
- **Jobs** receive their collaborators by injection and are tested directly:
  `PolygonAreaJob` against valid and invalid GeoJSON, and `ReportGenerationJob` against a
  set of preceding task outputs.
- **The engine** is tested end-to-end against an **in-memory `DataSource`**, driving the
  real `WorkflowFactory`, `TaskRepository`, `TaskRunner`, and services together.
- **HTTP validation** is tested with **supertest** over the real Express router.

## Layout

```
tests/
├─ helpers/fixtures.ts              # in-memory DataSource, in-memory loader, sample polygon
├─ setup.ts                         # reflect-metadata + console silencing
├─ unit/
│   ├─ assertValidDag.test.ts
│   ├─ summarizeTaskOutputs.test.ts
│   ├─ WorkflowService.test.ts
│   ├─ WorkflowCompletionService.test.ts
│   ├─ TaskRunner.test.ts
│   └─ jobs/
│       ├─ PolygonAreaJob.test.ts
│       └─ ReportGenerationJob.test.ts
├─ integration/
│   ├─ workflowEngine.test.ts        # full workflow against in-memory SQLite
│   └─ workflowFactory.test.ts       # atomic creation + aggregator dependency expansion
└─ e2e/
    └─ analysisValidation.test.ts    # POST /analysis validation over HTTP
```

## What is covered

### Requested functionality (the six challenge tasks)

| Task | Where it is covered |
|------|---------------------|
| **A.1** Polygon area job (+ invalid GeoJSON handling) | `jobs/PolygonAreaJob.test.ts`, asserted in `workflowEngine.test.ts` |
| **A.2** Report generation aggregating preceding outputs | `jobs/ReportGenerationJob.test.ts`, `workflowEngine.test.ts` |
| **A.3** Interdependent tasks (scheduling + dependency inputs) | `TaskRunner.test.ts`, `workflowEngine.test.ts` (report runs last; dependents wait) |
| **A.4** `finalResult` aggregation (incl. failures) | `WorkflowCompletionService.test.ts` |
| **A.5** `GET /workflow/:id/status` | `WorkflowService.test.ts`, `workflowEngine.test.ts` |
| **A.6** `GET /workflow/:id/results` | `WorkflowService.test.ts`, `workflowEngine.test.ts` |

### General functioning

`integration/workflowEngine.test.ts` exercises the whole pipeline: create a workflow
from a definition, drain the queue exactly as the worker would, and then read both
status and aggregated results back through the service layer.

A further unit test pins the completion design:

- **`finalResult` completeness on failure** — `WorkflowCompletionService.test.ts` asserts
  that the result is built only once no task is pending, and includes the outputs of tasks
  that completed *after* an earlier failure (not just those done before it).

### Error detection / corrected bugs

These tests pin the error-handling and bug fixes (not the refactors):

- **Workflow stuck after a failed task** — `TaskRunner.test.ts` proves the workflow is
  re-evaluated even when the job throws (the fix that moved the call into a `finally`).
- **Unknown `taskType` no longer strands the workflow** — `TaskRunner.test.ts` proves an unknown
  `taskType` (the factory throws) is caught like any other failure: the task is marked `failed` and
  the workflow is still re-evaluated, instead of being left `in_progress` with the workflow hung.
- **Cascade-fail finalization** — `WorkflowCompletionService.test.ts` proves a workflow whose tasks
  cascade-fail after a failure (each dependent task failed because its dependency was not satisfied)
  still finalizes and resolves to `failed`.
- **Invalid workflow definitions (graph)** — `assertValidDag.test.ts` covers duplicate steps,
  dependencies on unknown steps, and direct/indirect cycles (rejected before any DB write).
- **Invalid GeoJSON** — `jobs/PolygonAreaJob.test.ts` asserts the job throws so the task
  is marked failed instead of crashing the worker.
- **Input validation on `POST /analysis`** — `e2e/analysisValidation.test.ts` asserts a
  clear `400` for a missing `X-Client-Id` header and for missing/non-object `geoJson`,
  instead of an opaque `500`.
- **Ownership / not-found / not-completed contracts** — `WorkflowService.test.ts` covers
  the `404`, `403`, and `400` paths of the read endpoints.

