# SPDA Deadline-to-ECS Bridge

## Why a Bridge

The VNTANA Marketplace container calls `RegisterUsage` at startup, which
requires ECS (not EC2 Docker). SPDA's shared Deadline fleet is Docker-on-EC2,
so we can't run the Marketplace image directly on workers. Instead, the fleet
worker runs a *bridge script* that launches an ECS Fargate task, streams the
container output, and relays results back to Deadline.

## End-to-End Flow

```
SDMA upload
    │
    ▼
EventBridge trigger ─► SDMA Connector Lambda
                          │
                          │  submits job with dataFlow IN/OUT attachments
                          ▼
                      Deadline queue (jobAttachmentSettings → SPDA bucket)
                          │
                          │  worker picks up job, VFS-mounts input from SPDA
                          ▼
                      Bridge script on worker
                          │
                          ├─ stages input to s3://staging/deadline/<job>/inputs/
                          ├─ downloads pipeline JSON from s3://staging/pipelines/
                          ├─ enriches state with staging context
                          ├─ ecs run-task with container overrides
                          ▼
                      ECS Fargate task (MeshOptimizer etc.)
                          │
                          │  downloads input, optimizes, uploads output
                          ▼
                      s3://staging/deadline/<job>/outputs/
                          │
                          │  bridge downloads to WorkspacePath
                          ▼
                      Deadline job attachment upload
                          │
                          ▼
                      SPDA bucket (Data/<hash>.xxh128 + output manifest)
                          │
                          ▼
                      SDMA AssetWatcher Lambda → derived file
```

## Infrastructure (lib/modelops-spda-stack.ts)

The SPDA stack creates:

| Resource | Purpose |
|----------|---------|
| `CfnQueue` (with `jobAttachmentSettings`) | Points at the SPDA asset bucket so Deadline can sync input/output files |
| `CfnQueueFleetAssociation` | Attaches our queue to the shared SPDA fleet |
| Queue IAM role | S3 + ECS RunTask/DescribeTasks/StopTask + PassRole on task and execution roles |
| Proxy IAM role | Assumed by SDMA Lambda to submit jobs; S3 `GetObject` so SDMA can load the template |
| ECS Cluster | Fargate cluster targeted by the bridge script |
| Fargate Task Definition | Container spec with CPU, memory, image, log config |
| ECS Task role | Runtime permissions: S3 read/write, `aws-marketplace:RegisterUsage`/`MeterUsage` |
| ECS Execution role | ECR pull (our repo + Marketplace `709825985650`) and CloudWatch log writes |
| Security group | Egress-only for Fargate tasks |
| VPC interface endpoints | `logs` and `metering-marketplace` (required when `assignPublicIp=DISABLED`) |
| CloudWatch Log Group | `/deadline-ecs-bridge/tasks` with one-week retention |

### Task Definition ARN: family-only

The `TaskDefArn` CfnOutput emits the **family-level** ARN
(`arn:aws:ecs:...:task-definition/<family>`), not a pinned `:revision`.
ECS resolves a family-only ARN to `LATEST` at `RunTask` time, so the
connector item keeps working after CDK deregisters the previous revision
on a stack roll. The `ecs:RunTask` IAM statement mirrors this by scoping
to `<family-arn>:*` (any revision).

Before this change, CDK's default `taskDefinitionArn` included the
current revision; a subsequent `cdk deploy` would deregister that
revision while the DynamoDB connector item still pointed at it, and the
next job would exit with code 5 before even starting.

## Bridge Script (deadline/spda-ecs-bridge-template.yaml)

An OpenJD template whose `onRun` action runs a bash script that:

1. Validates required infrastructure parameters.
2. Uploads the Deadline-synced input directory to `s3://<staging>/deadline/<jobId>/inputs/`.
3. Downloads the pipeline JSON from `s3://<staging>/<PipelineJsonS3Key>` (kept in S3 to avoid OpenJD `{{ }}` parsing conflicts and the 1024-char Deadline `STRING` parameter limit).
4. Enriches the pipeline's `state` with `stagingBucket`, `stagingInputPrefix`, `stagingOutputPrefix`, `inputFilename`.
5. Builds an ECS `run-task` override (Python, to avoid OpenJD parsing of literal `{`) that feeds the enriched pipeline JSON (base64) to the handler.
6. Calls `aws ecs run-task` with retry + exponential backoff.
7. Polls `ecs describe-tasks` until the task reaches `STOPPED` (with a `TaskTimeoutSeconds` safeguard).
8. Downloads `s3://<staging>/deadline/<jobId>/outputs/` into `WorkspacePath` so Deadline returns the files to SPDA as derived files.
9. Deletes the staging prefix on exit (trap).

### OpenJD template gotchas

- The embedded script data block cannot contain `{{ }}` at all — OpenJD parses it as a template variable. Comments and pipeline-state placeholders are reworded or kept out of the embedded data.
- `STRING` parameters are capped at 1024 characters. The pipeline JSON lives in S3 and is referenced via `PipelineJsonS3Key` to stay under the limit.
- Literal `{` in Python/JSON payloads is escaped by generating the JSON inside a separate `python3 - << 'PYTHON_SCRIPT_END'` heredoc.

## Staging Bucket Layout

```
s3://<staging-bucket>/
├─ pipelines/                         ← pipeline JSON files (uploaded out-of-band)
│   └─ staging_hello_world.json
└─ deadline/
    └─ <jobId>/
        ├─ inputs/                     ← bridge stages Deadline-synced inputs
        │   └─ <InputFilename>
        └─ outputs/                    ← container writes processed files
            └─ optimized_<InputFilename>
```

The bridge cleans up `deadline/<jobId>/` on exit regardless of success.

## SDMA Integration Notes

These are non-obvious behaviors discovered during integration. Keep them in mind when configuring the SDMA connector or debugging derivation failures.

### 1. Queue must have `jobAttachmentSettings`

The queue must declare:
```ts
jobAttachmentSettings: {
  s3BucketName: "<SPDA asset bucket>",
  rootPrefix: "SpatialDataManagementAssets",
}
```
Without it, `syncInputJobAttachments` fails immediately with
`"Job attachment settings were not contained in JOB_DETAILS entity"` and the
bridge script never runs.

### 2. `fileExtensionFilter` must be a single extension

SDMA's `_validate_manifest_interest` uses `file_path.endswith(ext_filter)`
with the *entire* filter string. `"file.glb".endswith(".glb,.obj,.fbx")` is
`False`, so **comma-separated lists silently reject every file**. Use one
extension per filter (`.glb`). This applies to both:

- `triggers[].filter.fileExtensionFilter` (trigger matching)
- `triggers[].deadlineJob.output.derivedFiles[].filter.fileExtensionFilter` (derived file acceptance)

### 3. Output filename should differ from input filename

Derived files are stored under the hidden path
`.spatial_data_mgmt_derived/<original-hash>/<filename>`. They show up in the
Asset Details → Derived Content panel, not in the main file list, and the
parent file gets a "Suggestions available" badge. SDMA rejects output files
whose basename matches the original when the hashes collide, so the
pipeline uses a prefix (e.g. `optimized_<inputFilename>`).

### 4. Connector must be routed via asset template

SDMA's `derive()` step fires connectors that are either listed in
`assetTemplate.permittedConnectorIds` OR marked `Default: true` for the
connector type. Custom connectors must be added to the template's permitted
list.

### 5. Connector config lives in DynamoDB

SDMA does not expose a UI to create DeadlineCloud connectors — write the item
directly to `SpatialDataManagement-ConnectorsTable` via `aws dynamodb put-item`.
Use `./index.mjs -c .env.spda connectors generate <profile>` to produce the
JSON (see Connector Profiles below).

## Connector Profiles

A connector profile is a closed record in `src/connectors/profiles.mjs` that
describes one SDMA connector shape: which pipeline to run, which input file
extensions trigger it, which output extensions it produces, and the connector
name. Adding a new connector is a data addition, not a code branch.

Profiles exist because SDMA's `fileExtensionFilter` rejects comma-joined
strings (see SDMA Integration Note 2 above). Each profile stores extensions
as an array and the Node CLI emits one trigger per extension, making the
comma-joined regression structurally unrepresentable.

### The `cad` profile

| Field | Value |
|-------|-------|
| Pipeline | `stl_cad_to_glb` |
| Inputs | `.stl`, `.stp` |
| Outputs | `.glb`, `.usdz`, `.fbx`, `.zip`, `.png`, `.html` |

### The `cad_zip` profile

| Field | Value |
|-------|-------|
| Pipeline | `zip_cad_to_glb` |
| Inputs | `.zip` |
| Outputs | `.glb`, `.usdz`, `.fbx`, `.zip`, `.png`, `.html` |

Targets `.zip`-packaged CAD assemblies. Optimizer settings: `tris: 75000`, `tex_opt_compression: 80`, `draco_encode: true`, `bake_small_features: false`. The Thumbnail task uses `viewerConfig.environmentSrc` pointing at `Studio_A_dim.hdr` instead of a transparent background.

### CLI

```bash
./index.mjs -c .env.spda connectors stage    cad   # upload pipeline JSON to staging bucket
./index.mjs -c .env.spda connectors generate cad   # write DynamoDB item JSON to stdout
./index.mjs -c .env.spda connectors deploy   cad   # stage then generate
```

See the Connectors section of `README.md` for the full command reference.

## Public Asset Hosting

The local `assets/` directory is uploaded to `s3://<SPDA_STAGING_BUCKET>/assets/` by running:

```bash
./index.mjs -c .env.spda connectors assets-sync
```

Every file under the local `assets/` tree lands at the matching key under the bucket's `assets/` prefix — the relative path is preserved. For example, `assets/env_maps/Studio_A_dim.hdr` becomes `s3://<bucket>/assets/env_maps/Studio_A_dim.hdr`.

Public GET access is granted by a bucket-policy statement with Sid `ModelopsPublicAssets`. The statement allows `s3:GetObject` on `arn:aws:s3:::<bucket>/assets/*` for `Principal: "*"`. The CLI merges this statement idempotently — if a statement with that Sid already exists, it is replaced in-place rather than appended, so re-running `assets-sync` never duplicates the entry.

Asset URLs use path-style addressing:

```
https://s3.<region>.amazonaws.com/<bucket>/assets/<key>
```

The staging bucket name (`development.modelops.vntana.com`) contains dots — virtual-hosted-style SSL would require a CN of `development.modelops.vntana.com.s3.amazonaws.com`, which no CA issues. The `cad_zip` pipeline's `viewerConfig.environmentSrc` references one of these URLs for `Studio_A_dim.hdr` — the region is hardcoded to `us-east-1` in `pipelines/zip_cad_to_glb.yaml`, so the URL must be edited if the staging bucket ever moves regions.

**`BlockPublicPolicy` escape hatch:** S3 rejects `PutBucketPolicy` with `AccessDenied` if `BlockPublicPolicy: true` is set. An operator must disable it once, out-of-band (via the S3 console or `aws s3api put-public-access-block`), before the first `assets-sync` succeeds. The CLI surfaces a clear error if this is forgotten.

## Required VPC Endpoints

Fargate tasks run with `assignPublicIp=DISABLED`, so outbound traffic to AWS
service endpoints must go through VPC interface endpoints. The stack creates:

- `com.amazonaws.<region>.logs` — CloudWatch Logs writes from the container
- `com.amazonaws.<region>.metering-marketplace` — `RegisterUsage` and `MeterUsage`

Without these, the task fails early with `ResourceInitializationError` or
`RegisterUsage call timeout`.

## Configuration

See `lib/config.ts` for the full schema. SPDA-specific variables:

| Variable | Purpose |
|----------|---------|
| `DEADLINE_FARM_ID` | Existing SPDA farm |
| `DEADLINE_FLEET_ID` | Existing SPDA fleet |
| `SPDA_S3_BUCKET_ARNS` | SPDA asset bucket ARN(s) — used for IAM scoping and queue `jobAttachmentSettings` |
| `SPDA_ROLE_ARN` | SDMA Lambda role (optional — defaults to account root) |
| `SPDA_STAGING_BUCKET` | S3 bucket for bridge inputs/outputs and pipeline JSON files |
| `VPC_ID` / `USE_DEFAULT_VPC` | VPC for Fargate tasks (required) |

## Observability

- **Bridge logs** — stream to the Deadline queue session log group:
  `/aws/deadline/<farmId>/<queueId>/session-<sessionId>`
- **ECS container logs** — stream to `/deadline-ecs-bridge/tasks` with stream
  prefix `bridge/modelops-handler/<taskId>`
- The CLI's `jobs logs` command merges both sources with `[brg]`/`[ecs]`
  prefixes. See `.claude/context/cli-job-tracking.md`.
