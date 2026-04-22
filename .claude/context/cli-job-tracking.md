# CLI Job Tracking for Deadline / SPDA Backends

The job management commands (`describe`, `list`, `logs`, `watch`, `run --watch`)
support the `deadline` and `spda` backends with ECS task enrichment, merged
log output, and Deadline-aware status mapping.

## Commands

### `jobs describe <jobId>`

Default output is a formatted summary. Use `--json` for the raw payload.

```
Job:        job-971e56efc49046489e684bacb303654c
Name:       ModelOps ECS Bridge
Status:     SUCCEEDED
Deadline:   CREATE_COMPLETE
Created:    Tue Apr 07 2026 16:28:35 GMT-0300
Started:    Tue Apr 07 2026 16:33:26 GMT-0300
Stopped:    Tue Apr 07 2026 16:34:11 GMT-0300

ECS Task:   arn:aws:ecs:us-east-1:<acct>:task/<cluster>/<taskId>
ECS Status: STOPPED
Exit Code:  0
Stopped:    Essential container in task exited
Log Group:  /deadline-ecs-bridge/tasks
Log Stream: bridge/modelops-handler/<taskId>

Pipeline:   pipelines/staging_hello_world.json
Staging:    development.modelops.vntana.com/deadline
```

The ECS block appears only when the bridge has launched a task and the ARN
is recoverable from the worker session logs. For `FAILED` jobs the formatter
inserts an `Error:` line with `lifecycleStatusMessage`.

### `jobs list [-f <timeAgo>]`

Table includes a `deadline` column showing the raw Deadline `lifecycleStatus`
alongside the mapped common `status` (see *Status mapping* below).

### `jobs logs <jobId> [--follow]`

Fetches worker session logs from the Deadline queue log group, extracts the
ECS task ARN from the bridge's `Task launched:` marker, fetches the ECS
container logs from CloudWatch, and emits a merged timeline prefixed with
`[brg]` (bridge script output) and `[ecs]` (container output):

```
[brg] === Deadline ECS Bridge ===
[brg] [bridge] Uploading input directory to S3...
[brg] [bridge] Task launched: arn:aws:ecs:...
[ecs] info: Downloaded Hook.glb from staging
[ecs] info: MeshOptimizer output: {...}
[brg] [bridge] Task status: STOPPED
[brg] Exit code: 0
```

`--follow` polls both sources and discovers the ECS task mid-stream.

### `jobs watch <jobId>` and `jobs run --watch`

`watch` calls `logs` in follow mode, so the merged `[brg]`/`[ecs]`
stream prints live. When the follow loop exits (the job reaches a
terminal state), `watch` prints a final `Job status: <SUCCEEDED|FAILED>`
line. `run --watch` behaves the same — stream until the session ends.

Follow mode is resilient to freshly-submitted jobs: `getLogs` polls
`describeJob` every two seconds until log streams appear instead of
erroring out with "No log streams found for job" on a PENDING job. It
exits early if the job terminates before any stream shows up.

## Internals

### Pure helpers (`src/jobs/backends/deadline.mjs`)

All five are exported for unit testing and contain no I/O:

- `extractEcsTaskArn(logLines)` — scans for the `Task launched: arn:aws:ecs:...` marker
- `extractTaskId(taskArn)` — last path segment
- `extractClusterArn(taskArn)` — reconstructs the cluster ARN from the task ARN
- `mergeLogEvents(bridgeLogs, ecsLogs)` — stable sort by timestamp, bridge-first on ties, tags each event with `source: "brg" | "ecs"`
- `formatJobDescription(job)` — human-readable block; unwraps Deadline parameter objects (`{string: "..."}`, `{path: "..."}`); shows `Error:` only for `FAILED` status

Unit tests live in `test/deadline-ecs-helpers.test.mjs` and run with
`NODE_OPTIONS='--experimental-vm-modules' bun test`.

### I/O methods on `DeadlineBackend`

- `#describeEcsTask(clusterArn, taskArn)` — `ecs:DescribeTasks`, returns `{taskArn, taskId, status, exitCode, stoppedReason, logGroup, logStream}` or `null`
- `#fetchEcsContainerLogs(logGroup, logStream)` — reads `/deadline-ecs-bridge/tasks`, stream `bridge/modelops-handler/<taskId>`
- `#collectLogReferences(jobId)` — lists sessions and session actions, returns `{logGroupName, logStreamName}` pairs; falls back to the queue-level log group (`/aws/deadline/<farmId>/<queueId>`) with `session.sessionId` as the stream when session actions don't carry worker log fields (the SPDA/SDMA case)
- `#pollLogStream(ref, tokens)` — incremental CloudWatch poll with a forward-token map, used by follow mode

### Status mapping

`#mapDeadlineStatus(lifecycleStatus, taskRunStatus)` prefers `taskRunStatus`
when it's a terminal state:

- `taskRunStatus === "SUCCEEDED"` → `SUCCEEDED`
- `taskRunStatus === "FAILED"` → `FAILED`
- `taskRunStatus === "CANCELED"` → `FAILED`
- Otherwise fall back to the `DEADLINE_STATUS_MAP` lookup on `lifecycleStatus`

This matters because a succeeded Deadline job remains at
`lifecycleStatus=CREATE_COMPLETE` forever; only the `taskRunStatus` transitions
to `SUCCEEDED`. Without this precedence, `list` and `watch` would report
`PENDING` for completed jobs.

## Configuration Loading

`index.mjs` installs a Commander `preSubcommand` hook that reads a dotenv
file before any subcommand runs. Pass the path via `-c`/`--config` or
`MODELOPS_CONFIG`:

```bash
MODELOPS_CONFIG=.env.spda ./index.mjs jobs list
./index.mjs -c .env.spda jobs describe <jobId>
```

Individual subcommands no longer own a `-c` flag or call `dotenv.config()`
themselves — they read values from `process.env` directly.
