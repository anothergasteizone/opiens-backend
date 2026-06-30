# Changes

Apart from the requested Coding Challenge Tasks, the following non-requested changes have been implemented.

---

## ESLint + Prettier

Installed and configured ESLint (with `typescript-eslint`) and Prettier.

- `eslint.config.mjs` — flat-config format with TypeScript rules and `eslint-plugin-prettier` so the linter enforces formatting.
- `.prettierrc` — single quotes, 4-space indent, trailing commas (`es5`), 200-char print width.
- `.prettierignore` — excludes two files that cannot be reformatted without breaking them.
- All source files were reformatted accordingly (double → single quotes, consistent indentation).

---

## Enum extraction into dedicated files

Two enums that were defined as a side-effect of their host file were moved to their own modules:

| New file | Moved from | Why |
|---|---|---|
| `src/workers/taskStatus.ts` | `src/workers/taskRunner.ts` | `TaskStatus` was imported by models and repositories that have nothing to do with running tasks, creating an awkward dependency direction. |
| `src/workflows/WorkflowStatus.ts` | `src/workflows/WorkflowFactory.ts` | Same problem: the status enum was buried in the factory, making importers depend on factory internals. |

---

## Repository layer (`src/repositories/`)

`TaskRunner` and the background worker previously called `repository.manager.getRepository(...)` directly, scattering TypeORM queries across business-logic files.

Two repositories were introduced to hide the ORM behind intent-named methods:

**`TaskRepository` / `ITaskRepository`**
- `findNextRunnable()` — fetches the next queued task whose every dependency has reached a terminal state (`completed` or `failed`). Uses a correlated subquery so the worker never starts a task prematurely. The original worker simply grabbed any queued task, which would break as soon as dependencies were added.
- `hasUnfinishedTasks(workflowId)` — cheap `COUNT` of non-terminal tasks, used to gate workflow completion so `finalResult` is built exactly once (see `WorkflowCompletionService` below).
- `getOutputsFor(tasks)` — loads stored results for a set of tasks and parses JSON, returning `DependencyOutput` records. This is how every job (including the aggregating `ReportGenerationJob`) receives its declared dependencies' outcomes.
- `save`, `saveResult`, `loadWorkflowWithTasks`, `saveWorkflow` — thin wrappers that keep the ORM away from callers.

**`WorkflowRepository` / `IWorkflowRepository`**
- `findById` / `findWithTasks` — used by the read-side service layer.

Both repositories expose an interface so callers depend on a contract, not on TypeORM, which also makes unit-testing without a live database possible.

---

## Service layer (`src/services/`)

**`WorkflowCompletionService`**

The original `TaskRunner` re-derived the workflow status and saved it inline, after the success branch only. Two problems:
1. A failed last task (including one failed because a dependency was not satisfied) left the workflow stuck in its previous status.
2. Aggregating the final result and persisting it was tangled with the task-execution logic.

`WorkflowCompletionService.updateStatus()` is now called from a `finally` block in `TaskRunner`, so every task outcome — success or failure — triggers a check. The call starts with a cheap gate (`hasUnfinishedTasks`) and returns immediately while any task is still non-terminal; only once **all** tasks are terminal does it recompute the status (`completed`/`failed`) and serialise the aggregated `finalResult`. Building it a single time, at the moment nothing is left running, is what guarantees `finalResult` contains the outputs of every completed task plus failure information — even tasks that completed *after* an earlier failure — regardless of finish order or worker count, rather than depending on the result being rebuilt on every task.

**`WorkflowService`**

Owns the read-side use cases for the two new API endpoints:
- `getStatus()` — counts completed/total tasks; throws typed errors (`WorkflowNotFoundError`) that the controller maps to HTTP status codes.
- `getResults()` — deserialises `finalResult`; throws `WorkflowNotTerminalError` (→ 400) when the workflow has not yet finished.

Placing the use cases in a service (rather than inline in the route handlers) keeps the HTTP layer as a pure translator, with no business logic.

---

## Workflow definition types and DAG validation (`src/workflows/WorkflowDefinition.ts`)

`WorkflowStep` and `WorkflowDefinition` interfaces were inlined in `WorkflowFactory`. They were extracted to their own module along with a new pure function, `assertValidDag(steps)`, which validates the dependency graph before any database writes:

- No duplicate step numbers.
- Every `dependsOn` reference points to a step that actually exists.
- No cycles (depth-first topological check).

Validation is called at the start of `WorkflowFactory.createWorkflow()` so invalid definitions fail fast with a descriptive error instead of producing corrupted data.

---

## Workflow definition loader (`src/workflows/WorkflowDefinitionLoader.ts`)

`WorkflowFactory` previously called `fs.readFileSync` and `yaml.load` directly, coupling the factory to the filesystem and to YAML. An `IWorkflowDefinitionLoader` interface was introduced:

```ts
interface IWorkflowDefinitionLoader {
    load(source: string): WorkflowDefinition;
}
```

`YamlWorkflowDefinitionLoader` is the production implementation. The factory receives a loader via constructor injection (`WorkflowFactory(dataSource, loader)`), so tests can supply an in-memory loader without touching disk.

---

## Country data abstraction (`src/jobs/CountrySource.ts`)

`DataAnalysisJob` imported `world_data.json` directly, making it impossible to test without the real data file and impossible to swap the data source. A `CountrySource` interface was extracted:

```ts
interface CountrySource {
    getCountries(): CountryFeature[];
}
```

`WorldDataCountrySource` is the production implementation. It caches the parsed result so the JSON is only iterated once per process. `DataAnalysisJob` now accepts a `CountrySource` via its constructor, injected by `JobFactory`.

---

## Task output aggregation utility (`src/workflows/taskSummary.ts`)

Both `WorkflowCompletionService` (building `finalResult`) and `ReportGenerationJob` (building the report payload) require the same reduction: turning a set of task outcomes into an ordered, human-readable summary. Rather than duplicating the logic across the two new files, it lives in `summarizeTaskOutputs(outputs)`:

- Sorts by step number.
- Maps failed tasks to `{ ..., output: null, error: 'Task failed' }`.
- Pure function, no database access — both callers use it identically.

---

## Job interface enhancements (`src/jobs/Job.ts`)

The `Job` interface gained one optional flag to support the dependency feature:

| Flag | Effect |
|---|---|
| `toleratesFailedDependencies` | When `true`, the runner still runs the job even if a dependency failed (instead of marking the task `failed` because of the unsatisfied dependency). Used by `ReportGenerationJob` so the report is always generated. |

A job always receives the outcomes of its dependencies (via `getOutputsFor`). An aggregating job such as `ReportGenerationJob` declares the capability flag `dependsOnPrecedingTasks = true`; the `WorkflowFactory` (via `resolveStepDependencies` + `jobDependsOnPrecedingTasks`) then wires it to every preceding step automatically, so the report needs no explicit `dependsOn` and there is no separate "aggregate all preceding tasks" code path — it is the same dependency machinery. Explicit `dependsOn` still composes with the implicit edges (their union is persisted).

A `DependencyOutput` interface was added to carry the parsed output of a dependency task between the repository, the runner, and the job.

---

## Bug fix: workflow status stuck after a failed task

In the original `TaskRunner.run()`, the workflow status re-evaluation block ran only on the success path — it was placed after the `try/catch`, not in a `finally`. If the last task in a workflow failed, the workflow was never marked `failed`; it stayed in whatever status it had before. The block was moved to a `finally` clause so every task outcome, successful or not, triggers the evaluation.

---


## Bug fix: atomic workflow creation (race between `queued` and dependency links)

`WorkflowFactory.createWorkflow` originally did **two** saves: it first saved the
tasks (which immediately set them to `queued`), then assigned dependencies and saved
again to write the `task_dependencies` rows. Each `save` is its own transaction, so
between the two commits the tasks were visible as `queued` with **no** dependency
rows yet. In that window the `NOT EXISTS` subquery in `findNextRunnable` considered
every task runnable, and a concurrently polling worker could start a dependent task
**before its dependencies were linked** — executing it out of order. The example
workflow masked this (the aggregator is the highest `stepNumber`, so `ORDER BY
stepNumber ASC` picked it last anyway), but it was a real hole for any workflow where
`stepNumber` order does not match dependency order (e.g. step 2 `dependsOn: [3]`).

The fix wires the dependencies **by object reference** (resolved via `stepNumber`)
*before* saving, and enables `cascade: ['insert']` on the `ManyToMany`, so a single
`save` persists the tasks and their `task_dependencies` rows together. There is no
longer any window with queued-but-unlinked tasks, so the ordering guarantee holds.
Two integration tests in `tests/integration/workflowFactory.test.ts` cover this,
using a definition whose `stepNumber` order deliberately disagrees with its dependency
order.

> Note: an earlier version additionally wrapped the workflow row and its tasks in an
> explicit `dataSource.transaction(...)`. That wrapper was removed: the system runs a
> **single background worker that executes jobs one at a time**, so the cross-process
> races a transaction would guard against do not occur, and the wiring-before-single-save
> above already closes the queued-but-unlinked window. The same reasoning applies to
> `TaskRepository.saveResultForTask`, which now persists the `Result` and the task with
> two sequential saves instead of a transaction.

---

## Persistent database, in_progress states, and startup crash recovery

The datasource originally used `dropSchema: true`, wiping the database on every boot.
That was removed so data **persists across restarts**, which in turn made a small set
of related changes necessary and worthwhile:

- **`in_progress` states restored.** Both `WorkflowStatus` and `TaskStatus` regained
  the `in_progress` value that the earlier refactor had dropped. A workflow is
  promoted `initial → in_progress` via a cheap conditional `UPDATE` on the completion
  service's gate path (no task-graph load, no `finalResult` rebuild). A task is marked
  `in_progress` at the start of `TaskRunner.run`, claiming it out of the `queued` pool
  while it executes — restoring the behaviour of the initial commit.
- **Startup crash recovery** (in `taskWorker`, before the poll loop):
  1. `requeueInterruptedTasks` returns tasks left `in_progress` by a crashed worker
     back to `queued` so they are retried.
  2. `findUnfinishedWorkflowIds` + `updateStatus` reconciles workflows that finished
     while the worker was down — including the case where every task terminated but
     the workflow status was never persisted (a crash in the finalization step), which
     with a persistent DB would otherwise leave the workflow stranded non-terminal
     forever, with no queued task left to trigger another completion check.

  Both steps are correct under the **single-worker** model: when the only worker is
  (re)starting, an `in_progress` task is necessarily orphaned. Multiple workers would
  instead need per-task leases and a reaper (see the concurrency analysis).

- **Pending follow-up: migrations.** With the DB now persistent, `synchronize: true`
  is only a stopgap (it can drop columns and lose data on an entity change). Replacing
  it with explicit, versioned migrations is documented as a known pending item in the
  [Readme](Readme.md) and is not yet implemented.

---

## Removed unused dependencies (`bcrypt`, `jsonwebtoken`)

`bcrypt` (+ `@types/bcrypt`) and `jsonwebtoken` (+ `@types/jsonwebtoken`) were present in the original `package.json` but were never imported anywhere in the source tree. They have been removed.

- `marked` was retained: it is used by `src/routes/defaultRoute.ts` to render the README as HTML at `GET /`.
- Removing dead dependencies reduces the install footprint, eliminates transitive vulnerabilities, and avoids confusion about features that were never implemented (e.g. authentication).

---

## Client ownership enforcement on workflow endpoints

**Middleware — `src/routes/middleware/requireClientId.ts`**

A shared Express middleware validates that the `X-Client-Id` header is present and attaches it to `res.locals.clientId`. It is applied at router level (`router.use(requireClientId)`) in both `analysisRoutes` and `workflowRoutes`, so every endpoint reads the caller's identity from the same place.

Keeping the extraction in middleware separates the HTTP contract (header must exist) from the business rule (does this client own the resource?), which the service layer handles.

**Service-layer ownership check**

`WorkflowService.getStatus` and `getResults` accept a `clientId` parameter and compare it against `workflow.clientId`, throwing `WorkflowForbiddenError` on mismatch. Route handlers map that to `403 Forbidden`.

---

## Bug fix: missing input validation on `POST /analysis`

`analysisRoutes.ts` previously extracted `clientId` and `geoJson` from the request body and passed them directly to `WorkflowFactory.createWorkflow` with no validation. A missing or wrong-typed field produced an opaque 500 from deep inside TypeORM or `JSON.stringify`.

The route now validates the body at the boundary and returns `400 Bad Request` with a descriptive message before any database work begins:

- `geoJson` must be present and an object (i.e. a parsed JSON body, not a raw string).

`clientId` is no longer part of the body — it is read from the `X-Client-Id` header by the `requireClientId` middleware, consistent with the workflow read endpoints.

---

> Note: This document was generated with the assistance of an AI (Claude, by Anthropic).
