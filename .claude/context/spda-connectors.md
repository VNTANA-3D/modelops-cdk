# SPDA Connectors CLI

> **Customer install docs:** for the step-by-step external-customer install
> flow, see [`docs/install/quickstart.md`](../../docs/install/quickstart.md).
> This doc stays focused on maintainer internals.

The `connectors` subcommand group builds and installs SDMA
`ConnectorsTable` items for the SPDA backend. This doc complements
[`spda-ecs-bridge.md`](spda-ecs-bridge.md): the bridge is the *runtime*,
this is the *control plane* you use to register pipelines with SDMA.

## Commands

```bash
./index.mjs -c .env.spda connectors generate <profile>   # prints DynamoDB item to stdout
./index.mjs -c .env.spda connectors stage    <profile>   # uploads pipeline JSON to S3
./index.mjs -c .env.spda connectors deploy   <profile>   # stage + upsert into DynamoDB
./index.mjs -c .env.spda connectors assets-sync          # upload ./assets/ and merge public read policy
```

`deploy` is the one-shot: it stages the pipeline JSON, then scans the
connectors table for a row whose `ConnectorName` matches the profile.
On a hit it reuses that `ConnectorId` (preserving `CreatedAt` and
`permittedConnectorIds` references on asset templates); on a miss it
mints a fresh UUID. Use `--connector-id <id>` to force a specific ID.

`generate` still accepts `--connector-id <id>` for the same reason but
only prints the AttributeValue-marshalled item — it does **not** write
to DynamoDB. Reach for it when you want to inspect the item or drive a
custom `put-item` flow.

## Module Layout

Functional-core / imperative-shell split:

| Module | Role | Purity |
|---|---|---|
| `src/connectors/profiles.mjs` | `ConnectorProfile` schema + `CONNECTOR_PROFILES` registry | Pure |
| `src/connectors/build.mjs` | `buildConnector()` plain item + `marshallConnectorItem()` AttributeValue wrapper | Pure |
| `src/connectors/stage.mjs` | `yamlToPipelineJson` + `pipelineS3Key` | Pure |
| `src/connectors/content-type.mjs` | MIME lookup for public assets | Pure |
| `src/connectors/assets-walk.mjs` | Local `assets/` tree walker | Pure (fs injected) |
| `src/connectors/bucket-policy.mjs` | Sid-keyed `mergeStatement` + `publicAssetsStatement` | Pure |
| `src/connectors/cloudformation.mjs` | `fetchStackOutputs` via `@aws-sdk/client-cloudformation` | Shell |
| `src/connectors/s3.mjs` | `uploadPipelineJson` via `@aws-sdk/client-s3` | Shell |
| `src/connectors/s3-assets.mjs` | `syncAssets` (walks local tree, uploads, merges policy) | Shell |
| `src/connectors/dynamodb.mjs` | `findConnectorByName` + `putConnectorItem` via `@aws-sdk/client-dynamodb` | Shell |
| `src/connectors/cli.mjs` | Commander subcommands: `generate`/`stage`/`deploy`/`assets-sync` | Shell |
| `src/connectors/index.mjs` | Subcommand registration | Shell |

## Stack Name Resolution

`bin/modelops-handler.ts` synthesises the SPDA stack as
`${STACK_NAME}Spda` when `COMPUTE_BACKEND=spda`. The CLI mirrors this
rule in `resolveStackName()` — set `STACK_NAME` to the base name (e.g.
`ModelopsHandler`) and the CLI looks up `ModelopsHandlerSpda` outputs.

## DynamoDB AttributeValue Marshalling

`connectors generate` emits DynamoDB AttributeValue-marshalled JSON
(e.g. `{"S": "..."}` / `{"N": "1"}` / `{"M": {...}}`). `deploy` uses
the same marshaller internally and pushes via `PutItemCommand`, so no
external `aws dynamodb put-item` call is needed.

`buildConnector()` still returns a plain JS object so unit tests can
assert shape directly. `marshallConnectorItem()` only wraps it at the
boundary where it leaves the CLI process.

The bash generator at `scripts/generate-spda-connector.sh` is
**deprecated** — the Node CLI replaces it.

## Avoiding Duplicate Rows

`deploy` upserts by `ConnectorName`: it scans the table for a row with
the profile's `ConnectorName`, reuses that `ConnectorId` (and original
`CreatedAt`) on hit, and mints a fresh UUID on miss. Re-running is
idempotent.

If earlier misuse left two rows with the same name, `deploy` keeps the
oldest and logs the orphan IDs to stderr so you can delete them:

```bash
aws dynamodb delete-item --table-name SpatialDataManagement-ConnectorsTable \
  --key '{"ConnectorId":{"S":"<stale-id>"}}'
```

The ConnectorId the SPDA UI fires is whichever one is listed in the
target `AssetTemplate`'s `permittedConnectorIds` list. Orphan rows do
no harm, but they clutter the "Derive content" picker in SDMA.

## Asset Template Routing

SDMA only fires a connector when the uploaded asset's template lists
the `ConnectorId` in `permittedConnectorIds`, or the connector is
marked `Default: true`. Each profile emits `Default: false`, so
per-template wiring is required.

### Gotcha: DynamoDB UpdateExpression paths

`permittedConnectorIds` is stored as a DynamoDB **List** (`L`), not a
String Set. The AttributeValue markers `.M`/`.L` are metadata, **not**
part of the document path in an UpdateExpression. Use logical names
only:

```bash
# correct
SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c)

# wrong — "The document path provided in the update expression is invalid"
SET AssetTemplateConfig.M.permittedConnectorIds.L = list_append(...)
```

Full append example:
```bash
aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.permittedConnectorIds = list_append(AssetTemplateConfig.permittedConnectorIds, :c), UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg c "$CID" --arg t "$(date +%s)" '{":c":{"L":[{"S":$c}]},":t":{"N":$t}}')"
```

### Cloning an existing template

SDMA has no API to create new asset templates, so the clone flow is:

1. `get-item` the closest existing template.
2. `jq`-rewrite `AssetTemplateId`, `AssetTemplateName`, timestamps,
   bump `Version` to `1`, reset `permittedConnectorIds` to `[]`, **and
   replace `assetNameRegex`** so the new template accepts the intended
   input extensions (clones inherit the source template's regex). Also
   review `fileTypes`, `fileMetadataConfig`, and `assetMetadataConfig`
   if the new template should accept different uploads.
3. `put-item` the new template.
4. `update-item` to append the connector id as above.

`assetNameRegex` is a plain `S` attribute under
`AssetTemplateConfig.assetNameRegex`. Example — relax the STL-inherited
regex to accept `.zip`:

```bash
aws dynamodb update-item \
  --table-name SpatialDataManagement-AssetTemplatesTable \
  --key "{\"AssetTemplateId\":{\"S\":\"$TEMPLATE_ID\"}}" \
  --update-expression "SET AssetTemplateConfig.assetNameRegex = :r, UpdatedAt = :t" \
  --expression-attribute-values "$(jq -n --arg r '.*\.(zip|ZIP|Zip)$' --arg t "$(date +%s)" '{":r":{"S":$r},":t":{"N":$t}}')"
```

Skipping this step produces a UI error at upload time:
`"Asset name does not match the template requirements: <inherited regex>"`.

See the `.local/plans/2026-04-20-zip-cad-connector-implementation-qa.md`
Scenario 5 for a runnable recipe that inline-generates a new
`AssetTemplateId`.

## Required Environment Variables

`requireEnv()` in `src/connectors/cli.mjs` defines the canonical list:

| Variable | Used by |
|---|---|
| `STACK_NAME` | `generate`, `stage`, `deploy` (stack-name resolution) |
| `AWS_REGION` | every subcommand (S3 / CFN clients) |
| `DEADLINE_FARM_ID` | `generate`, `deploy` (connector item field) |
| `SPDA_STAGING_BUCKET` | `stage`, `deploy`, `assets-sync` |
| `SDMA_LIBRARY_ID` | `generate`, `deploy` |
| `SDMA_TEMPLATE_BUCKET` | `generate`, `deploy` |
| `SDMA_CONNECTORS_TABLE` | `deploy` — optional; defaults to `SpatialDataManagement-ConnectorsTable` |

`assets-sync` explicitly opts into a narrower set (`AWS_REGION` +
`SPDA_STAGING_BUCKET`) so asset publishing works in deploy-less setups.

The caller running `deploy` needs `dynamodb:Scan` and `dynamodb:PutItem`
on the connectors table in addition to the S3 and CFN permissions the
other subcommands use.
