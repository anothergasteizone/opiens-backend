# API Documentation

This document describes every HTTP endpoint exposed by the service, with request
and response examples. It complements the change log in [Changes.md](Changes.md).

The server listens on **`http://localhost:3000`** by default (see `src/index.ts`).
All request and response bodies are JSON (`Content-Type: application/json`).

---

## Authentication / Client identity

Every endpoint under `/analysis` and `/workflow` requires an **`X-Client-Id`**
header. It is validated by the `requireClientId` middleware
(`src/routes/middleware/requireClientId.ts`), which attaches the value to the
request context and returns **`400 Bad Request`** when the header is missing or
empty.

The client id is also used for **ownership enforcement**: a workflow may only be
queried by the same `X-Client-Id` that created it. A mismatch returns
**`403 Forbidden`**.

```
X-Client-Id: client123
```

> There is no token/password authentication; the client id is a plain ownership
> discriminator, not a security credential.

---

## Endpoint summary

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/analysis` | Create a workflow from the configured YAML definition and queue its tasks. |
| `GET`  | `/workflow/:id/status` | Get the current status and task progress of a workflow. |
| `GET`  | `/workflow/:id/results` | Get the aggregated final result of a completed workflow. |
| `GET`  | `/` | Render this project's `README.md` as a styled HTML page. |

### Status values

**Workflow status** (`WorkflowStatus`): `initial`, `in_progress`, `completed`, `failed`. A
workflow is `initial` until its first task starts, is promoted to `in_progress` while tasks run,
and transitions to `completed`/`failed` only once every task is terminal.

**Task status** (`TaskStatus`): `queued`, `in_progress`, `completed`, `failed`. A task whose
dependency did not succeed (and whose job cannot run without it) is itself marked `failed`, with
the unsatisfied-dependency reason carried in its `progress`/`error`.

---

## 1. Create a workflow — `POST /analysis`

Reads the configured workflow definition (`src/workflows/example_workflow.yml`),
creates a `Workflow` plus one `Task` per step, persists their dependencies, and
queues them for the background worker. Returns immediately with **`202 Accepted`**;
the tasks are processed asynchronously.

### Request

| Part | Value |
|------|-------|
| **Headers** | `X-Client-Id: <string>` (required), `Content-Type: application/json` |
| **Body** | `{ "geoJson": <GeoJSON geometry object> }` |

`geoJson` is required and must be a **Polygon** geometry object — a raw `Polygon` or a `Feature`
wrapping one (not a string, and not a `Point`/`LineString`/`MultiPolygon`; the analysis job only
supports a single Polygon). The same geometry is stored on every task in the workflow and is the
input to the geospatial jobs.

#### Example

```bash
curl -X POST http://localhost:3000/analysis \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: client123" \
  -d '{
    "geoJson": {
      "type": "Polygon",
      "coordinates": [
        [
          [-63.624885020050996, -10.311050368263523],
          [-63.624885020050996, -10.367865108370523],
          [-63.61278302732815,  -10.367865108370523],
          [-63.61278302732815,  -10.311050368263523],
          [-63.624885020050996, -10.311050368263523]
        ]
      ]
    }
  }'
```

### Responses

**`202 Accepted`** — workflow created and tasks queued.

```json
{
  "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
  "message": "Workflow created and tasks queued from YAML definition."
}
```

**`400 Bad Request`** — missing `X-Client-Id` header.

```json
{ "message": "X-Client-Id header is required" }
```

**`400 Bad Request`** — missing or non-object `geoJson`.

```json
{ "message": "geoJson is required and must be a GeoJSON object" }
```

> The route only checks that `geoJson` is present and is an object. Semantic
> validity (a parseable, areal polygon) is enforced by the jobs: an invalid polygon
> makes the analysis/area job throw, and the task is recorded as `failed` (the
> workflow still returns `202` here and the failure surfaces in its results).

**`500 Internal Server Error`** — workflow creation failed (e.g. an invalid
workflow definition / dependency graph).

```json
{ "message": "Failed to create workflow" }
```

---

## 2. Get workflow status — `GET /workflow/:id/status`

Returns the current status of a workflow together with how many of its tasks have
completed. Useful for polling while the worker processes the queued tasks.

### Request

| Part | Value |
|------|-------|
| **Path param** | `id` — the `workflowId` returned by `POST /analysis` |
| **Headers** | `X-Client-Id: <string>` (required) |

#### Example

```bash
curl http://localhost:3000/workflow/3433c76d-f226-4c91-afb5-7dfc7accab24/status \
  -H "X-Client-Id: client123"
```

### Responses

**`200 OK`**

```json
{
  "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
  "status": "in_progress",
  "completedTasks": 3,
  "totalTasks": 4
}
```

| Field | Type | Description |
|-------|------|-------------|
| `workflowId` | string | The workflow's UUID. |
| `status` | string | One of the workflow status values. |
| `completedTasks` | number | Tasks in the `completed` state. |
| `totalTasks` | number | Total tasks in the workflow. |

**`400 Bad Request`** — missing `X-Client-Id` header.

```json
{ "message": "X-Client-Id header is required" }
```

**`403 Forbidden`** — the workflow belongs to a different client.

```json
{ "message": "Forbidden" }
```

**`404 Not Found`** — no workflow with that id.

```json
{ "message": "Workflow not found" }
```

---

## 3. Get workflow results — `GET /workflow/:id/results`

Returns the aggregated `finalResult` of a **completed** workflow. The final
result is built once the workflow reaches a terminal state and contains the output
of every task (failed tasks are reported with a `null` output and an error marker).

### Request

| Part | Value |
|------|-------|
| **Path param** | `id` — the `workflowId` returned by `POST /analysis` |
| **Headers** | `X-Client-Id: <string>` (required) |

#### Example

```bash
curl http://localhost:3000/workflow/3433c76d-f226-4c91-afb5-7dfc7accab24/results \
  -H "X-Client-Id: client123"
```

### Responses

**`200 OK`** — `finalResult` is the parsed (deserialized) aggregation of all task
outputs.

`finalResult` is an object `{ workflowId, status, tasks }`, where `tasks` is the
per-task summary ordered by step number.

```json
{
  "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
  "status": "completed",
  "finalResult": {
    "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
    "status": "completed",
    "tasks": [
      {
        "taskId": "a1b2c3d4-...",
        "type": "analysis",
        "stepNumber": 1,
        "status": "completed",
        "output": "Brazil"
      },
      {
        "taskId": "b2c3d4e5-...",
        "type": "notification",
        "stepNumber": 2,
        "status": "completed",
        "output": null
      },
      {
        "taskId": "c3d4e5f6-...",
        "type": "polygonArea",
        "stepNumber": 3,
        "status": "completed",
        "output": { "calculatedArea": 1083454.21, "unit": "square_meters" }
      },
      {
        "taskId": "d4e5f6a7-...",
        "type": "reportGeneration",
        "stepNumber": 4,
        "status": "completed",
        "output": {
          "workflowId": "3433c76d-f226-4c91-afb5-7dfc7accab24",
          "tasks": [
            { "taskId": "a1b2c3d4-...", "type": "analysis",     "stepNumber": 1, "status": "completed", "output": "Brazil" },
            { "taskId": "b2c3d4e5-...", "type": "notification",  "stepNumber": 2, "status": "completed", "output": null },
            { "taskId": "c3d4e5f6-...", "type": "polygonArea",   "stepNumber": 3, "status": "completed", "output": { "calculatedArea": 1083454.21, "unit": "square_meters" } }
          ],
          "finalReport": "Aggregated data and results"
        }
      }
    ]
  }
}
```

A failed task appears in the `tasks` summary as:

```json
{ "taskId": "...", "type": "polygonArea", "stepNumber": 3, "status": "failed", "output": null, "error": "Task failed" }
```

A task failed because a dependency did not succeed appears as:

```json
{ "taskId": "...", "type": "notification", "stepNumber": 2, "status": "failed", "output": null, "error": "dependencies not satisfied: <taskId>" }
```

**`400 Bad Request`** — missing `X-Client-Id` header.

```json
{ "message": "X-Client-Id header is required" }
```

**`400 Bad Request`** — the workflow exists but has not finished yet. The current
status is included so the caller can decide whether to keep polling.

```json
{ "message": "Workflow has not finished yet", "status": "in_progress" }
```

**`403 Forbidden`** — the workflow belongs to a different client.

```json
{ "message": "Forbidden" }
```

**`404 Not Found`** — no workflow with that id.

```json
{ "message": "Workflow not found" }
```

---

## 4. Home page — `GET /`

Renders this project's `README.md` as a styled (dark-mode) HTML page using
`marked`. Intended for humans browsing the running service, not for programmatic
use. Static assets are served from `/public`.

```bash
curl http://localhost:3000/
```

Returns `200 OK` with `Content-Type: text/html`.

---

## End-to-end usage example

A typical flow chains the three JSON endpoints: create the workflow, poll its
status, then fetch the results once it is `completed`.

```bash
# 1. Create the workflow and capture the returned id.
WORKFLOW_ID=$(curl -s -X POST http://localhost:3000/analysis \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: client123" \
  -d '{ "geoJson": { "type": "Polygon", "coordinates": [[[-63.62,-10.31],[-63.62,-10.36],[-63.61,-10.36],[-63.61,-10.31],[-63.62,-10.31]]] } }' \
  | grep -o '"workflowId":"[^"]*"' | cut -d'"' -f4)

# 2. Poll the status until it is "completed".
curl -s http://localhost:3000/workflow/$WORKFLOW_ID/status \
  -H "X-Client-Id: client123"

# 3. Retrieve the aggregated final result.
curl -s http://localhost:3000/workflow/$WORKFLOW_ID/results \
  -H "X-Client-Id: client123"
```

---

## Task types reference

The default workflow (`example_workflow.yml`) runs four task types. The result of
each task is what shows up under `output` in the workflow results.

| `taskType` | Job | Output shape |
|------------|-----|--------------|
| `analysis` | `DataAnalysisJob` | `string` — name of the country containing the polygon, or `"No country found"`. |
| `notification` | `EmailNotificationJob` | `null` — side-effect only (simulated email). |
| `polygonArea` | `PolygonAreaJob` | `{ "calculatedArea": <number>, "unit": "square_meters" }`. Fails on invalid GeoJSON. |
| `reportGeneration` | `ReportGenerationJob` | `{ "workflowId", "tasks": [...], "finalReport" }` aggregating all preceding tasks. Implicitly depends on every preceding step (`dependsOnPrecedingTasks`), so it runs only after they are terminal — no explicit `dependsOn` required. |

---

> Note: This document was generated with the assistance of an AI (Claude, by Anthropic).
