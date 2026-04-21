# VNTANA Connector Install — Reference

This document is for customers who have completed the `cad_zip` Quickstart and are extending
the install to additional connectors, authoring custom pipelines, or diagnosing failures not
covered by the Quickstart's expected-output checks. It describes every knob rather than
prescribing a single path. For a copy-pasteable first-install walkthrough, see
[`docs/install/quickstart.md`](quickstart.md).

---

## Environment variable inventory

The table below covers the union of `REQUIRED_ENV` in `src/connectors/cli.mjs:18` and the
CDK-time variables enforced by `lib/config.ts` in the `superRefine` block at line 219 for
`COMPUTE_BACKEND=spda`.

| Variable | Source | Meaning | Consumed by |
|---|---|---|---|
| `STACK_NAME` | Operator's choice — must be unique in account + region | Base name for the CDK stack. The SPDA stack is synthesised as `${STACK_NAME}Spda` (`src/connectors/cli.mjs:38`). | `cdk deploy`, `connectors generate`, `connectors stage`, `connectors deploy` |
| `AWS_ACCOUNT_ID` | `aws sts get-caller-identity --query Account --output text` | 12-digit AWS account number | `cdk deploy` |
| `AWS_REGION` | Region where SDMA is deployed | AWS region for all SDK and CLI calls | `cdk deploy`, `connectors generate`, `connectors stage`, `connectors deploy`, `connectors assets-sync` |
| `COMPUTE_BACKEND` | Literal `spda` | Selects the SPDA backend. `lib/config.ts:14` enumerates `batch`, `eks`, `deadline`, `spda`. | `cdk deploy` (stack selection), `connectors generate` (stack-name resolution) |
| `VPC_ID` | SDMA CloudFormation stack output (e.g. `VpcId`) | VPC for ECS Fargate tasks. Either this variable or `USE_DEFAULT_VPC=true` is required; `lib/config.ts:249` rejects the absence of both. | `cdk deploy` |
| `USE_DEFAULT_VPC` | Literal `true` | Instructs CDK to use the account's default VPC instead of a named one. Mutually exclusive with `VPC_ID` in practice. | `cdk deploy` |
| `DEADLINE_FARM_ID` | SDMA CloudFormation stack output (e.g. `DeadlineFarmId`) | ID of the existing SPDA-managed Deadline Cloud farm. `lib/config.ts:221` rejects its absence when `COMPUTE_BACKEND=spda`. | `cdk deploy`, `connectors generate`, `connectors deploy` |
| `DEADLINE_FLEET_ID` | SDMA CloudFormation stack output (e.g. `DeadlineFleetId`) | ID of the existing SPDA-managed Deadline Cloud fleet. `lib/config.ts:228` rejects its absence when `COMPUTE_BACKEND=spda`. | `cdk deploy` |
| `SPDA_S3_BUCKET_ARNS` | SDMA CloudFormation stack output (e.g. `AssetEncryptedS3BucketArn`) | Comma-separated ARN(s) of the SPDA asset bucket. Used for IAM scoping and queue `jobAttachmentSettings`. `lib/config.ts:235` rejects the absence of at least one entry. | `cdk deploy` |
| `SPDA_STAGING_BUCKET` | SDMA CloudFormation stack output (e.g. `StagingBucketName`) | S3 bucket name for staging pipeline inputs/outputs and pipeline JSON files. `lib/config.ts:242` rejects its absence. | `cdk deploy`, `connectors stage`, `connectors deploy`, `connectors assets-sync` |
| `SDMA_LIBRARY_ID` | SDMA admin UI → Libraries → select library → copy the ID from the URL or detail pane | Library that owns asset templates and connectors. Embedded directly in the DynamoDB `LibraryId` field of the connector item. | `connectors generate`, `connectors deploy` |
| `SDMA_TEMPLATE_BUCKET` | SDMA CloudFormation stack output (e.g. `TemplateBucketName`) | S3 bucket where SDMA reads Deadline job template files. The connector item points SDMA here via `deadlineConfig.templateS3Bucket` (`src/connectors/build.mjs:88`). | `connectors generate`, `connectors deploy` |
| `UNSAFE_ECR_IMAGE` | Default: `709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543`. AWS Marketplace subscribers use the URI from their subscription. | VNTANA handler container image repository URI. `lib/config.ts:19` declares the `image` field with this default. | `cdk deploy` |
| `UNSAFE_ECR_IMAGE_TAG` | Default: `20260417.1` (`lib/config.ts:24`). AWS Marketplace subscribers use the tag from their subscription. | Handler image tag. | `cdk deploy` |
| `SPDA_ROLE_ARN` | ARN of the SDMA Lambda execution role; retrieve from the SDMA CloudFormation stack resources or IAM console | Optional. ARN of the SDMA role that assumes the proxy role for cross-account assume-role configuration (`lib/config.ts:205`). When absent, the proxy role trust policy falls back to the account root principal (`lib/modelops-spda-stack.ts:199`). | `cdk deploy` |
| `SUBNET_IDS` | Comma-separated subnet IDs from the VPC | Optional. Restricts ECS Fargate tasks to specific subnets. When absent, the SPDA stack falls back to the VPC's private and public subnets (`lib/modelops-spda-stack.ts:242`). | `cdk deploy` |

`connectors assets-sync` opts into a narrower required set (`AWS_REGION` + `SPDA_STAGING_BUCKET`) so asset publishing works independently of a full CDK deployment (`src/connectors/cli.mjs:105`).

---

## SPDA stack outputs

After `cdk deploy` completes, the CDK stack named `${STACK_NAME}Spda` exports these outputs.
They are fetched at connector-generation time by `fetchStackOutputs()` in
`src/connectors/cloudformation.mjs:73`, which matches each entry by suffix against the full
CloudFormation `OutputKey`. The authoritative suffix list is `REQUIRED_SUFFIXES` at
`src/connectors/cloudformation.mjs:29`.

| Output name | Meaning | Consumer |
|---|---|---|
| `QueueId` | Deadline Cloud queue ID created by the SPDA stack. Embedded in `deadlineConfig.queueId` of the connector item. | `buildConnector()` (`src/connectors/build.mjs:83`) |
| `ProxyRoleArn` | ARN of the IAM role that SDMA Lambda assumes to submit Deadline jobs. Embedded in `deadlineConfig.securityConfig.assumeRoleArn`. | `buildConnector()` (`src/connectors/build.mjs:85`) |
| `ClusterArn` | ARN of the ECS Fargate cluster that runs the handler container. Passed to the bridge script as the `ClusterArn` job parameter. | `buildConnector()` (`src/connectors/build.mjs:62`) |
| `TaskDefArn` | ARN of the ECS Fargate task definition. Passed to the bridge script as `TaskDefArn`. | `buildConnector()` (`src/connectors/build.mjs:63`) |
| `Subnets` | Comma-separated subnet IDs for Fargate task placement. Joined and passed to the bridge script as `Subnets`. | `buildConnector()` (`src/connectors/build.mjs:64`) |
| `SecurityGroupId` | ID of the security group attached to Fargate tasks. Passed to the bridge script as `SecurityGroups`. | `buildConnector()` (`src/connectors/build.mjs:65`) |
| `EcsLogGroupName` | CloudWatch Logs group name for ECS container output. Passed to the bridge script as `LogGroup`. | `buildConnector()` (`src/connectors/build.mjs:68`) |
| `StagingBucket` | S3 bucket name for bridge inputs/outputs at runtime. Passed to the bridge script as `StagingBucket`. | `buildConnector()` (`src/connectors/build.mjs:71`) |

---

## Profile anatomy

A connector profile is a closed record in `src/connectors/profiles.mjs` that drives the
entire shape of the DynamoDB connector item. Adding a new connector type requires adding an
entry to `CONNECTOR_PROFILES` in `src/connectors/profiles.mjs:41` and then running
`connectors deploy <new-profile>`. No code change is required elsewhere.

The `ConnectorProfile` Zod schema is defined at `src/connectors/profiles.mjs:18`.

### `pipeline`

Type: non-empty string (`src/connectors/profiles.mjs:19`).

The value must match a filename under `pipelines/` without the `.yaml` extension. The CLI
reads `pipelines/${profile.pipeline}.yaml` verbatim at `connectors stage` time
(`src/connectors/cli.mjs:77`). If the file is absent, the stage step throws immediately.
The same key becomes the S3 path `pipelines/${profile.pipeline}.json` that the bridge script
downloads at job runtime (`src/connectors/build.mjs:45`).

### `inputExtensions`

Type: non-empty array of dot-prefixed lowercase alphanumeric strings, no duplicates
(`src/connectors/profiles.mjs:20`). Each extension must match `/^\.[a-z0-9]+$/`
(`src/connectors/profiles.mjs:10`).

`buildConnector()` maps over `inputExtensions` at `src/connectors/build.mjs:47` and emits
one Deadline job trigger per extension. SDMA's manifest-interest validator calls
`file_path.endswith(ext_filter)` with the literal filter string, so a comma-joined value
would silently reject every file. Storing extensions as an array and fanning them out to
individual triggers makes that regression structurally impossible.

### `outputExtensions`

Type: non-empty array of dot-prefixed lowercase alphanumeric strings, no duplicates
(`src/connectors/profiles.mjs:27`).

Each entry becomes a `derivedFiles` filter inside every trigger at
`src/connectors/build.mjs:53`. SDMA uses these to recognise which output files to ingest
as derived content. The same single-extension constraint applies: one entry per item, not
comma-joined.

### `connectorName`

Type: non-empty string (`src/connectors/profiles.mjs:34`).

The value becomes the `ConnectorName` field of the DynamoDB item
(`src/connectors/build.mjs:93`). SDMA displays this string in the "Derive content" picker
in the asset detail panel. Re-running `deploy` without `--connector-id` mints a fresh UUID
each time, producing two indistinguishable picker entries.

### The `cad_zip` entry as a template

The existing `cad_zip` profile from `src/connectors/profiles.mjs:48` illustrates the
complete shape:

```js
cad_zip: ConnectorProfile.parse({
  pipeline: "zip_cad_to_glb",
  inputExtensions: [".zip"],
  outputExtensions: [".glb", ".usdz", ".fbx", ".zip", ".png", ".html"],
  connectorName: "ZIP CAD → GLB via ECS",
}),
```

A new profile for `.step` files, for example, would add a sibling key with a different
`pipeline`, `inputExtensions`, and `connectorName`, then re-run
`connectors deploy <new-key>` to stage the pipeline and write the connector item.

---

## Pipeline YAML format

The authoritative schema for pipeline files is [`pipelines/README.md`](../../pipelines/README.md).
That document describes the `name`, `description`, `state`, and `tasks` top-level keys, the
`{{ key }}` substitution syntax, and the `register` mechanism that exposes one task's output
to later tasks. A new pipeline must be a `.yaml` file under `pipelines/` whose name matches
the `pipeline` field in the corresponding `ConnectorProfile`.

When the SPDA backend runs a pipeline, the bridge script enriches the pipeline's `state`
before passing the JSON to the ECS container. The four injected keys are
(`pipelines/README.md` → "SPDA Bridge: Injected Staging Variables"):

| Key | Value |
|---|---|
| `stagingBucket` | The `SPDA_STAGING_BUCKET` configured on the CDK stack |
| `stagingInputPrefix` | `deadline/<jobId>/inputs` |
| `stagingOutputPrefix` | `deadline/<jobId>/outputs` |
| `inputFilename` | The basename of the file delivered by Deadline |

Pipeline tasks reference these keys with `{{ stagingBucket }}`, `{{ inputFilename }}`, and
so on. See `.claude/context/spda-ecs-bridge.md` for the full bridge runtime, including how
the bridge stages inputs, enriches state, calls `ecs run-task`, and downloads outputs.

---

## Connector item shape

`buildConnector()` in `src/connectors/build.mjs:30` returns a plain JavaScript object with
the following top-level keys:

| Key | Type | Value |
|---|---|---|
| `ConnectorId` | string | The `connector-<hex>` ID passed in (or minted by the CLI — see below) |
| `ConnectorConfig` | object | Contains `deadlineConfig` (queue wiring and template location) and `triggers` (one per input extension) |
| `ConnectorName` | string | From `profile.connectorName` |
| `ConnectorType` | string | Always `"DeadlineCloud"` |
| `CreatedAt` | number | Unix timestamp (seconds) |
| `Default` | boolean | Always `false` — SDMA fires connectors either from `permittedConnectorIds` or from `Default: true`; custom connectors require explicit template wiring |
| `Direction` | string | Always `"derive"` |
| `Enabled` | boolean | Always `true` |
| `LibraryId` | string | From `SDMA_LIBRARY_ID` |
| `Status` | string | Always `"READY"` |
| `UpdatedAt` | number | Same Unix timestamp as `CreatedAt` |
| `Version` | number | Always `1` |

`marshallConnectorItem()` at `src/connectors/build.mjs:130` wraps each field recursively
into DynamoDB AttributeValue form: strings become `{"S": "..."}`, numbers become
`{"N": "1"}`, booleans become `{"BOOL": true}`, arrays become `{"L": [...]}`, and objects
become `{"M": {...}}`. The output flows directly into `aws dynamodb put-item --item file://...`.

### `--connector-id` idempotency

Without `--connector-id`, `connectors generate` mints a fresh ID of the form
`connector-<32-hex-chars>` on every run (`src/connectors/cli.mjs:62`), creating a distinct
DynamoDB row each time because the hash key is `ConnectorId`. Passing
`--connector-id <existing-id>` on every subsequent `generate` call causes `put-item` to
overwrite the same row, updating all fields while keeping the key stable. The flag is
accepted only by `generate`, not by `deploy`; to reuse an ID through the combined `deploy`
command, run `connectors stage` and `connectors generate --connector-id <id>` separately.

---

## Asset template wiring

SDMA fires a connector only when the uploaded asset's template lists the `ConnectorId`
in `permittedConnectorIds`, because every profile emits `Default: false`
(`src/connectors/build.mjs:96`). Two patterns apply depending on whether an existing
template already accepts the target input extensions.

**Path expression rule: use logical names only in UpdateExpression paths. The `.M` and `.L`
markers are metadata in AttributeValue JSON, not part of the document path.**

### Append to an existing template

Used when an existing asset template already accepts the input extensions (e.g., a template
that already matches `.zip` uploads). A single `update-item` with `list_append` adds the
new `ConnectorId` to `permittedConnectorIds` without disturbing the rest of the template.

```bash
aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c), UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg c "$CID" --arg t "$(date +%s)" '{":c":{"L":[{"S":$c}]},":t":{"N":$t}}')"
```

The path `AssetTemplateConfig.permittedConnectorIds` uses logical names only. Inserting `.M`
or `.L` into the path produces `ValidationException: The document path provided in the update
expression is invalid.` (see `.claude/context/spda-connectors.md` → "Gotcha: DynamoDB
UpdateExpression paths").

The Quickstart's Phase 5 contains an executable version of this recipe against the `cad_zip`
connector.

### Clone and rewrite a template

> The recipe below is illustrative. The executable version lives in `docs/install/quickstart.md` Phase 5 CLI fallback.

Used when no existing template accepts the input extensions. SDMA provides no API to create
templates, so the clone flow is: `get-item` the nearest template, rewrite it with `jq`, then
`put-item` the result.

Fields that must change in every clone:

- `AssetTemplateId` — assign a new unique ID (e.g. `template-<uuid4-hex>`).
- `AssetTemplateName` — assign a new display name.
- `Version` — reset to `{"N": "1"}`.
- `CreatedAt` / `UpdatedAt` — set to the current Unix timestamp.
- `permittedConnectorIds` — reset to `{"L": []}` so the clone starts with no connectors.
- `assetNameRegex` — rewrite to a regex that matches the new input extensions; clones inherit the source template's regex, so skipping this step causes SDMA to reject uploads with `"Asset name does not match the template requirements: <inherited regex>"`.

Fields to review but not necessarily change:

- `fileTypes` — if the new template accepts different MIME types, update accordingly.
- `fileMetadataConfig` — metadata fields the SDMA UI collects at upload time.
- `assetMetadataConfig` — metadata fields attached to each asset.

`assetNameRegex` is stored as a plain `S` attribute under `AssetTemplateConfig.assetNameRegex`.
The `jq` rewrite path is `.AssetTemplateConfig.M.assetNameRegex` when addressing the raw
AttributeValue document returned by `get-item`; the `.M` notation is used only inside `jq`
to navigate the AttributeValue JSON structure, not inside DynamoDB UpdateExpression paths.

```bash
aws dynamodb get-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"<source-template-id>\"}}" \
  > /tmp/source.json

NEW_TEMPLATE_ID=$(python3 -c "import uuid; print('template-' + uuid.uuid4().hex)")
NOW=$(date +%s)
jq \
  --arg id "$NEW_TEMPLATE_ID" \
  --arg name "<new-name>" \
  --arg now "$NOW" \
  '.Item |
   .AssetTemplateId = {"S": $id} |
   .AssetTemplateName = {"S": $name} |
   .CreatedAt = {"N": $now} |
   .UpdatedAt = {"N": $now} |
   .Version = {"N": "1"} |
   .AssetTemplateConfig.M.permittedConnectorIds = {"L": []} |
   .AssetTemplateConfig.M.assetNameRegex = {"S": ".*\\.(zip|ZIP|Zip)$"}' \
  /tmp/source.json > /tmp/clone.json

aws dynamodb put-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --item file:///tmp/clone.json
```

After `put-item`, run the append recipe above to wire the new connector ID into the cloned
template's `permittedConnectorIds`. See `.claude/context/spda-connectors.md` →
"Cloning an existing template" for additional field-level notes.

---

## Troubleshooting appendix

### "No job runs after upload."

**Symptom:** A `.zip` file is uploaded through the SDMA UI and the "Derive content" badge
appears, but no Deadline job is created and `jobs list` shows no new entry.

**Cause:** The connector's `ConnectorId` is not listed in the target asset template's
`permittedConnectorIds`, or the asset template does not match the uploaded file's extension
(`assetNameRegex` mismatch).

**Fix:** Verify that `ConnectorId` appears in the template's `permittedConnectorIds` list via
the SDMA admin UI, or by running `aws dynamodb get-item` on the template and inspecting
`.Item.AssetTemplateConfig.M.permittedConnectorIds.L`. When the ID is absent, the append
recipe in the "Append to an existing template" section above adds it. When `assetNameRegex`
does not match the upload filename, `update-item SET AssetTemplateConfig.assetNameRegex = :r`
with the corrected regex resolves the mismatch.

---

### "Two connectors with the same name."

**Symptom:** The SDMA "Derive content" picker shows two entries with the same display name,
or `aws dynamodb scan` on `SpatialDataManagement-ConnectorsTable` returns two rows with the
same `ConnectorName` but different `ConnectorId` values.

**Cause:** `connectors deploy` (or `connectors generate`) was run more than once without
`--connector-id`, minting a fresh UUID each time and creating a distinct row per run.
See `.claude/context/spda-connectors.md` → "Avoiding Duplicate Rows".

**Fix:** Identify and delete the stale row via the commands below. Pass
`--connector-id <surviving-id>` on every subsequent `connectors generate` call to prevent
recurrence.

```bash
aws dynamodb scan \
  --table-name SpatialDataManagement-ConnectorsTable \
  --filter-expression "ConnectorName = :n" \
  --expression-attribute-values '{":n":{"S":"<connector-display-name>"}}' \
  --projection-expression "ConnectorId, CreatedAt"

aws dynamodb delete-item \
  --table-name SpatialDataManagement-ConnectorsTable \
  --key '{"ConnectorId":{"S":"<stale-connector-id>"}}'
```

---

### "`ValidationException`: the document path provided in the update expression is invalid."

**Symptom:** `aws dynamodb update-item` returns
`ValidationException: The document path provided in the update expression is invalid.`

**Cause:** The UpdateExpression path contains `.M` or `.L` — the AttributeValue type
markers that appear in the JSON representation of a DynamoDB item. These markers are metadata
for serialisation; they are not part of the logical document path that DynamoDB UpdateExpression
evaluates. See `.claude/context/spda-connectors.md` → "Gotcha: DynamoDB UpdateExpression paths".

**Fix:** Use logical names only in the UpdateExpression. A path like
`AssetTemplateConfig.M.permittedConnectorIds.L` is rewritten as
`AssetTemplateConfig.permittedConnectorIds`.

---

### "`Asset name does not match the template requirements`."

**Symptom:** Uploading a file through the SDMA UI produces the error
`"Asset name does not match the template requirements: <some regex>"`.

**Cause:** The asset template's `assetNameRegex` does not match the uploaded filename.
Cloned templates inherit the source regex, which may accept `.stl` or `.stp` but not `.zip`.
See `.claude/context/spda-connectors.md` → "Cloning an existing template".

**Fix:** Update `assetNameRegex` on the target template to a regex that accepts the intended
extension.

```bash
TEMPLATE_ID=<template-id>

aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.assetNameRegex = :r, UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg r '.*\.(zip|ZIP|Zip)$' --arg t "$(date +%s)" '{":r":{"S":$r},":t":{"N":$t}}')"
```

---

### "`AccessDenied` on Deadline queue submission."

**Symptom:** After a file is uploaded and SDMA triggers a connector, the Deadline job fails
immediately with `AccessDenied` during queue submission, or the SDMA connector Lambda logs
show a permission error when assuming the proxy role.

**Cause:** The `ProxyRoleArn` trust policy does not include the SDMA connector Lambda's
execution role as a trusted principal. SDMA Lambda must be able to `sts:AssumeRole` on
`ProxyRoleArn` to submit Deadline jobs.

**Fix:** Update the trust policy of the role identified by `ProxyRoleArn` (the CloudFormation
output from the `${STACK_NAME}Spda` stack) in the IAM console to include the SDMA Lambda
execution role ARN (`SPDA_ROLE_ARN`) as a principal. Alternatively, redeploy the CDK stack
with `SPDA_ROLE_ARN` set so that `lib/modelops-spda-stack.ts` injects the correct trust policy
automatically.

---

### "ECS task launches but the handler exits immediately."

**Symptom:** `jobs watch <job-id>` shows the ECS task reaching `RUNNING` and then `STOPPED`
within seconds, with a non-zero exit code in the `[ecs]` log lines. The handler produces no
output assets.

**Cause:** One of three root causes: (1) the pipeline JSON has not been staged to S3 and the
bridge cannot download it from `PipelineJsonS3Key`; (2) the ECS task role lacks `s3:GetObject`
on the staging bucket, so the handler cannot read the input; or (3) the pipeline YAML
references a state variable that was not injected or is missing from the `state` block.

**Fix:** Run `connectors stage <profile>` again to ensure the pipeline JSON is present at
`s3://<SPDA_STAGING_BUCKET>/pipelines/<pipeline>.json`. The ECS task role (the `TaskRole`
output of the CDK stack) requires `s3:GetObject` on the staging bucket prefix `deadline/*`.
The `[ecs]` log lines, accessible via `jobs logs <job-id>`, identify the specific error the
handler reported.
