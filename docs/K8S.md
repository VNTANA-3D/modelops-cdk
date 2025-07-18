# Scheduling ModelOps Handler Pipelines as Kubernetes Jobs

## Understanding the Handler Architecture

### Handler Overview

VNTANA ModelOps Handler provides a cloud-native solution for 3D model processing and optimization. The handler operates as a standalone pipeline execution engine with 25+ processing modules for comprehensive asset transformation.

### Benefits of Direct Kubernetes Scheduling

You can schedule handler pipelines directly as Kubernetes Jobs. This approach provides:

- **Simplified architecture**: Single-component deployment without dependencies
- **Direct control**: Complete control over job scheduling and resource allocation
- **Transparent debugging**: Direct access to handler logs and execution
- **Cost efficiency**: On-demand execution without persistent services

### Prerequisites

Before you begin, ensure you have:

- Kubernetes cluster with kubectl access
- AWS ECR access for pulling handler images (you should have this if you subscribed to the VNTANA Marketplace offering.)
- Basic understanding of Kubernetes Jobs and YAML configuration
- Access to pipeline definition files
- Cloud storage credentials for asset operations

## Configuring the Handler Component

### Entry Point Structure

```
/home/app/apps/handler/dist/index.js
```

The handler accepts command-line arguments:

```bash
node /home/app/apps/handler/dist/index.js run -i yaml --debug -f /path/to/pipeline.yaml
```

### Available Processing Modules

| Module                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `AssetConverter`      | General-purpose asset conversion                 |
| `Curl`                | HTTP client for web requests                     |
| `Debug`               | Debug output and logging utilities               |
| `FBX2glTF`            | Converts FBX files to GLB format                 |
| `FFmpeg`              | Video/audio processing                           |
| `FindAsset`           | Asset discovery and location utilities           |
| `glTF-Validator`      | Validates glTF files                             |
| `Http`                | HTTP request handling                            |
| `ImageMagick`         | Image processing operations                      |
| `MeshOptimizer`       | Optimizes GLB assets with no visual quality loss |
| `S3`                  | AWS S3 operations                                |
| `ScreenshotGenerator` | Generates image captures using VNTANA 3D Viewer  |
| `Shell`               | Execute shell commands                           |
| `SQS`                 | AWS SQS message queue operations                 |
| `Stat`                | File and system statistics                       |
| `StdErr`              | Standard error output handling                   |
| `StdOut`              | Standard output handling                         |
| `STL2OBJ`             | Converts STL files to OBJ format                 |
| `Unzip`               | Archive extraction utilities                     |
| `usdchecker`          | USD file validation                              |
| `ViewerMigration`     | 3D viewer migration utilities                    |
| `Zip`                 | Archive creation utilities                       |

### Container Requirements

The handler requires specific dependencies:

- **NVIDIA CUDA**: For GPU-accelerated processing (only necessary for renders)
- **Optimization Tools**: MeshOptimizer, FBX2glTF, and others
- **System Libraries**: Various processing dependencies

## Creating Pipeline Configurations

### Pipeline YAML Structure

A complete pipeline definition includes:

> [!TIP] Look in the `pipelines/` directory for more examples.

```yaml
name: "Asset Optimization Pipeline"
state:
  # Variable dictionary for template rendering
  input_bucket: "my-gcp-bucket"
  output_bucket: "my-aws-bucket"
  asset_name: "model.fbx"
  workspace: "/home/workspace"

tasks:
  # Sequential task list
  - module: CloudStorage
    props:
      action: download
      bucket: "{{ input_bucket }}"
      src: "{{ asset_name }}"
      dest: "{{ workspace }}/{{ asset_name }}"

callbacks:
  # Global event handlers
  onStart: []
  onSuccess: []
  onError: []

plugins:
  # Pipeline-level modifications
  - Debug
```

### Task Configuration

Each task supports:

```yaml
- name: "Descriptive task name"
  module: "ModuleName"
  props:
    # Module-specific properties
    option1: value1
    option2: "{{ template_variable }}"
  callbacks:
    # Task-level event handlers
    onStart: []
    onStdout: []
    onStderr: []
    onSuccess: []
    onError: []
    onEnd: []
  register: "state_key" # Store output in state
  when: "condition == true" # Conditional execution
  throw: false # Continue on error (default: true)
```

### Template Rendering

The handler uses Nunjucks templating for dynamic values:

- `{{ variable_name }}`: Simple variable substitution
- `{{ state.key }}`: Access state values
- `{{ env.ENV_VAR }}`: Environment variable access

### Pipeline Deployment Pattern

Follow this pattern when deploying pipelines to Kubernetes:

1. **Create Pipeline YAML**: Define your pipeline configuration in a YAML file
2. **Create ConfigMap**: Store the pipeline definition as a ConfigMap in Kubernetes
3. **Mount as Volume**: Mount the ConfigMap as a volume in the Job specification
4. **Reference in Args**: Point the handler CLI to the mounted pipeline file using `-f /workspace/pipeline.yaml`

## Writing Kubernetes Job Specifications

### Creating the Pipeline ConfigMap

Create a ConfigMap containing your pipeline definition before creating the Job:

```bash
kubectl create configmap pipeline-my-pipeline-id \
  --from-file=pipeline.yaml=./pipelines/hello_world.yaml
```

### Complete Job Template

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: modelops-pipeline-{{ pipeline-id }}
  labels:
    app: modelops-handler
    pipeline: "{{ pipeline-name }}"
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: modelops-handler
    spec:
      restartPolicy: Never
      serviceAccountName: modelops-handler

      # Node selection for GPU nodes
      nodeSelector:
        accelerator: nvidia-tesla-t4
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: present
          effect: NoSchedule

      containers:
        - name: handler
          image: 709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543:20250611.1
          command: ["node", "/home/app/apps/handler/dist/index.js"]
          args: ["run", "-i", "yaml", "-f", "/workspace/pipeline.yaml"]

          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"

          env:
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: access-key-id
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: secret-access-key

          volumeMounts:
            - name: pipeline-config
              mountPath: /workspace/pipeline.yaml
              subPath: pipeline.yaml
            - name: workspace
              mountPath: /home/workspace

      volumes:
        - name: pipeline-config
          configMap:
            name: fbx-conversion-pipeline
        - name: workspace
          emptyDir:
            sizeLimit: 5Gi

      imagePullSecrets:
        - name: ecr-credentials
```

### Example 2: Complex Optimization Pipeline

**Pipeline Configuration:**

```yaml
name: "Advanced Asset Optimization"
state:
  gcp_bucket: "source-assets"
  aws_bucket: "optimized-assets"
  asset: "complex-model.fbx"
  workspace: "/home/workspace"

tasks:
  - name: "Download from GCP"
    module: CloudStorage
    props:
      action: download
      bucket: "{{ gcp_bucket }}"
      src: "{{ asset }}"
      dest: "{{ workspace }}/input.fbx"

  - name: "Convert to glTF"
    module: FBX2glTF
    props:
      src: "{{ workspace }}/input.fbx"
      dest: "{{ workspace }}/converted.glb"

  - name: "Optimize mesh"
    module: MeshOptimizer
    props:
      src: "{{ workspace }}/converted.glb"
      dest: "{{ workspace }}/optimized.glb"
      config:
        transform_op: 2
        reset_scaling: true
        max_tex_size: 2048
        tris: 50000
        reset_center: center
        remove_animations: true

  - name: "Generate thumbnail"
    module: ScreenshotGenerator
    props:
      src: "{{ workspace }}/optimized.glb"
      dest: "{{ workspace }}/thumbnail.png"
      config:
        width: 512
        height: 512

  - name: "Upload optimized asset"
    module: S3
    props:
      action: upload
      bucket: "{{ aws_bucket }}"
      src: "{{ workspace }}/optimized.glb"
      dest: "optimized/{{ asset | replace('.fbx', '.glb') }}"

  - name: "Upload thumbnail"
    module: S3
    props:
      action: upload
      bucket: "{{ aws_bucket }}"
      src: "{{ workspace }}/thumbnail.png"
      dest: "thumbnails/{{ asset | replace('.fbx', '.png') }}"

callbacks:
  onStart:
    - module: Debug
      props:
        message: "Starting optimization pipeline for {{ asset }}"

  onSuccess:
    - module: Http
      props:
        url: "https://api.example.com/webhook/success"
        method: POST
        data:
          asset: "{{ asset }}"
          status: "completed"

  onError:
    - module: Http
      props:
        url: "https://api.example.com/webhook/error"
        method: POST
        data:
          asset: "{{ asset }}"
          status: "failed"
```

**Create ConfigMap:**

```bash
kubectl create configmap advanced-optimization-pipeline \
  --from-file=pipeline.yaml=/path/to/advanced-optimization-pipeline.yaml
```

**Kubernetes Job:**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: advanced-optimization-job
  labels:
    app: modelops-handler
    pipeline: advanced-optimization
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: modelops-handler
    spec:
      restartPolicy: Never
      serviceAccountName: modelops-handler

      containers:
        - name: handler
          image: 709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543:20250611.1
          command: ["node", "/home/app/apps/handler/dist/index.js"]
          args: ["run", "-i", "yaml", "-f", "/workspace/pipeline.yaml"]

          resources:
            requests:
              memory: "4Gi"
              cpu: "2000m"
            limits:
              memory: "16Gi"
              cpu: "8000m"

          env:
            - name: GOOGLE_APPLICATION_CREDENTIALS
              value: "/secrets/gcp-key.json"
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: access-key-id
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: secret-access-key

          volumeMounts:
            - name: pipeline-config
              mountPath: /workspace/pipeline.yaml
              subPath: pipeline.yaml
            - name: gcp-credentials
              mountPath: /secrets
              readOnly: true
            - name: workspace
              mountPath: /home/workspace

      volumes:
        - name: pipeline-config
          configMap:
            name: advanced-optimization-pipeline
        - name: gcp-credentials
          secret:
            secretName: gcp-credentials
        - name: workspace
          emptyDir:
            sizeLimit: 20Gi

      imagePullSecrets:
        - name: ecr-credentials
```

### Example 3: GPU-Accelerated Processing

**Pipeline with NVIDIA-specific optimizations:**

```yaml
name: "GPU-Accelerated Rendering"
state:
  model: "high-poly-model.glb"
  workspace: "/home/workspace"

tasks:
  - name: "Download model"
    module: S3
    props:
      action: download
      bucket: "models"
      src: "{{ model }}"
      dest: "{{ workspace }}/{{ model }}"

  - name: "GPU-accelerated screenshot"
    module: ScreenshotGenerator
    props:
      src: "{{ workspace }}/{{ model }}"
      dest: "{{ workspace }}/render.png"
      config:
        width: 4096
        height: 4096
        use_gpu: true
        samples: 128
```

**Create ConfigMap:**

```bash
kubectl create configmap gpu-rendering-pipeline \
  --from-file=pipeline.yaml=/path/to/gpu-rendering-pipeline.yaml
```

**Kubernetes Job with GPU:**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: gpu-rendering-job
  labels:
    app: modelops-handler
    pipeline: gpu-rendering
spec:
  backoffLimit: 3
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: modelops-handler
    spec:
      restartPolicy: Never
      serviceAccountName: modelops-handler

      # Node selection for GPU nodes
      nodeSelector:
        accelerator: nvidia-tesla-t4
      tolerations:
        - key: nvidia.com/gpu
          operator: Equal
          value: present
          effect: NoSchedule

      containers:
        - name: handler
          image: 709825985650.dkr.ecr.us-east-1.amazonaws.com/vntana/vntana-v98543:20250611.1
          command: ["node", "/home/app/apps/handler/dist/index.js"]
          args: ["run", "-i", "yaml", "-f", "/workspace/pipeline.yaml"]

          resources:
            requests:
              memory: "8Gi"
              cpu: "4000m"
              nvidia.com/gpu: 1
            limits:
              memory: "32Gi"
              cpu: "16000m"
              nvidia.com/gpu: 1

          env:
            - name: NVIDIA_DRIVER_CAPABILITIES
              value: "all"
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: access-key-id
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: aws-credentials
                  key: secret-access-key

          volumeMounts:
            - name: pipeline-config
              mountPath: /workspace/pipeline.yaml
              subPath: pipeline.yaml
            - name: workspace
              mountPath: /home/workspace

      volumes:
        - name: pipeline-config
          configMap:
            name: gpu-rendering-pipeline
        - name: workspace
          emptyDir:
            sizeLimit: 10Gi

      imagePullSecrets:
        - name: ecr-credentials
```

## Using the Project CLI

### ModelOps CDK CLI Integration

This project includes a comprehensive CLI tool (`modelops-cdk`) that simplifies pipeline execution and management. While the Kubernetes Job specifications in this document provide a reference for container requirements, the CLI tool offers a more streamlined approach for running pipelines.

### Basic CLI Usage

**Run a pipeline from the pipelines/ directory:**

```bash
./index.mjs jobs run hello_world
```

**Run with custom state variables:**

```bash
./index.mjs jobs run s3_download bucket=my-bucket src=/path/to/asset.glb
```

**Watch job execution in real-time:**

```bash
./index.mjs jobs run hello_world --watch
```

**Run with debug output:**

```bash
./index.mjs jobs run other --debug --watch \
  prefix=assets \
  name=my_model \
  bucket=my-s3-bucket
```

### Available Pipeline Examples

The project includes several pre-built pipeline examples in the `pipelines/` directory:

- `hello_world` - Basic pipeline example with shell commands
- `s3_download` - Download assets from S3 with debugging
- `stl_to_glb` - Convert STL files to GLB format via OBJ
- `other` - Complex optimization pipeline with multiple outputs
- `cwd` - Debug current working directory and environment
- `curl` - HTTP request examples

### CLI Job Management

**List running jobs:**

```bash
./index.mjs jobs list
```

**Get job details:**

```bash
./index.mjs jobs describe <JOB_ID>
```

**View job logs:**

```bash
./index.mjs jobs logs <JOB_ID>
```

**Watch job logs in real-time:**

```bash
./index.mjs jobs logs <JOB_ID> --follow
```

### Pipeline State Overrides

The CLI supports JSON-encoded state overrides:

```bash
./index.mjs jobs run my_pipeline \
  string_var="hello world" \
  number_var=42 \
  boolean_var=true \
  array_var='[1, "two", true]' \
  object_var='{"key": "value"}'
```

### Integration with Kubernetes

While the CLI uses AWS Batch by default, the pipeline definitions and container specifications in this document can be used to:

1. **Understand resource requirements** for Kubernetes deployments
2. **Adapt pipeline definitions** for direct Kubernetes execution
3. **Reference container configurations** for hybrid cloud setups
4. **Plan migration strategies** from AWS Batch to Kubernetes

## Configuring Advanced Features

### Optimizing Resources

**CPU/Memory tuning based on pipeline type:**

```yaml
# Light processing (format conversion)
resources:
  requests:
    memory: "512Mi"
    cpu: "250m"
  limits:
    memory: "2Gi"
    cpu: "1000m"

# Heavy processing (mesh optimization)
resources:
  requests:
    memory: "4Gi"
    cpu: "2000m"
  limits:
    memory: "16Gi"
    cpu: "8000m"

# GPU-intensive (rendering)
resources:
  requests:
    memory: "8Gi"
    cpu: "4000m"
    nvidia.com/gpu: 1
  limits:
    memory: "32Gi"
    cpu: "16000m"
    nvidia.com/gpu: 1
```

### Custom Callbacks for External Integration

**Webhook notifications:**

```yaml
callbacks:
  onStart:
    - module: Http
      props:
        url: "https://monitoring.example.com/start"
        method: POST
        headers:
          Authorization: "Bearer {{ env.API_TOKEN }}"
        data:
          job_id: "{{ env.JOB_NAME }}"
          pipeline: "{{ name }}"
          timestamp: "{{ now() }}"

  onSuccess:
    - module: Http
      props:
        url: "https://monitoring.example.com/success"
        method: POST
        data:
          job_id: "{{ env.JOB_NAME }}"
          duration: "{{ execution_time }}"
          assets_processed: "{{ processed_count }}"

  onError:
    - module: Http
      props:
        url: "https://monitoring.example.com/error"
        method: POST
        data:
          job_id: "{{ env.JOB_NAME }}"
          error: "{{ error_message }}"
          task: "{{ current_task }}"
```

### Pipeline Templating

**Dynamic pipeline generation:**

```yaml
name: "Batch Asset Processing"
state:
  assets:
    - "model1.fbx"
    - "model2.obj"
    - "model3.dae"
  output_format: "glb"
  workspace: "/home/workspace"

tasks:
  {% for asset in assets %}
  - name: "Process {{ asset }}"
    module: AssetConverter
    props:
      src: "{{ workspace }}/{{ asset }}"
      dest: "{{ workspace }}/{{ asset | replace(asset.split('.')[-1], output_format) }}"
      format: "{{ output_format }}"
  {% endfor %}
```
