# Pipelines

Pipeline YAML files describe a sequence of handler tasks that process a
3D asset. The same format is consumed by every backend (Batch, EKS,
Deadline, SPDA) — the backend is only responsible for transporting the
pipeline JSON to the running container.

## Structure

```yaml
name: <pipeline name>
description: <optional description>
state:
  <key>: <value>   # variables referenced by tasks as {{ key }}
tasks:
  - name: <optional task name>
    module: <handler module, e.g. S3, MeshOptimizer, Shell>
    props:
      <module-specific props>
    register: <optional name — exposes this task's output as {{ name }} to later tasks>
```

Values support `{{ key }}` template substitution that the handler resolves
at runtime using the `state` object and any `register`ed task outputs.

## Running a Pipeline

```bash
./index.mjs jobs run <name>              # uses pipelines/<name>.yaml
./index.mjs jobs run <name> --watch      # watches until completion
./index.mjs jobs run file:///path/to.yaml
./index.mjs jobs run -                   # reads from stdin
```

Pass state overrides as trailing key/value pairs:

```bash
./index.mjs jobs run s3glb2glb bucket=my-bucket name=MyAsset
```

## SPDA Bridge: Injected Staging Variables

When the SPDA backend runs a pipeline, the bridge script injects these
keys into the pipeline's `state` before passing the JSON to the ECS
container:

| Key | Value |
|---|---|
| `stagingBucket` | The `SPDA_STAGING_BUCKET` configured on the CDK stack |
| `stagingInputPrefix` | `deadline/<jobId>/inputs` |
| `stagingOutputPrefix` | `deadline/<jobId>/outputs` |
| `inputFilename` | The basename of the file delivered by Deadline (e.g. `asset.glb`) |

Tasks in the pipeline can reference these to download the input and write
the output back through the staging bucket. See
`pipelines/staging_hello_world.yaml` for a concrete example and
`.claude/context/spda-ecs-bridge.md` for the full data flow.

### Output filename convention

SDMA stores derived files under a hash-addressed CAS. When the output
filename matches the input filename, SDMA treats the result as the same
content and hides it from the default file view. Prefix output filenames
(`optimized_<inputFilename>`) to keep the derivation visible as a distinct
derived file.

## Available Pipelines

| File | Description |
|---|---|
| `stl_cad_to_glb.yaml` | CAD profile reference pipeline. Accepts `.stl` or `.stp` input and emits GLB, USDZ, FBX, OBJ (zip), PNG, and an HTML viewer. Relies on the bridge-injected state variables described above. |
| `zip_cad_to_glb.yaml` | Industrial-CAD variant. Accepts a `.zip` archive containing CAD files and emits the same six outputs (GLB, USDZ, FBX, OBJ zip, PNG, HTML viewer) with a tuned optimizer and HDR-lit thumbnail. Relies on the bridge-injected state variables described above. |

See [`../README.md#connectors`](../README.md#connectors) for how to stage
the input file and generate the connector item before submitting this
pipeline.
