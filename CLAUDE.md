# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AWS CDK TypeScript project that deploys VNTANA ModelOps infrastructure for processing 3D assets. It supports two compute backends:
- **AWS Batch with Fargate** - Original serverless container execution
- **EKS with Karpenter** - Kubernetes-based execution with autoscaling

## Commands

### Build and Development
```bash
npm run build          # Compile TypeScript
npm run watch          # Watch mode compilation
npm run test           # Run Jest tests
npm install            # Install dependencies (includes mustache for EKS)
```

### CDK Operations (via CLI wrapper)
```bash
./index.mjs deploy              # Synthesize and deploy the stack
./index.mjs deploy --bootstrap  # Bootstrap CDK (first-time setup)
./index.mjs destroy             # Tear down the stack
```

### Direct CDK (alternative)
```bash
export MODELOPS_CONFIG="./.env"
npx cdk synth --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'
npx cdk deploy --app 'npx ts-node --prefer-ts-exts bin/modelops-handler.ts'
```

### Job Management
```bash
./index.mjs jobs run <pipeline_name>           # Run a pipeline from ./pipelines/
./index.mjs jobs run <pipeline_name> --watch   # Run and wait for completion
./index.mjs jobs list                          # List running jobs
./index.mjs jobs describe <job_id>             # Get job details
./index.mjs jobs logs <job_id>                 # View job logs
```

## Architecture

### Compute Backends
The project supports two backends controlled by `COMPUTE_BACKEND` env var:

**AWS Batch (`COMPUTE_BACKEND=batch`)**
- `lib/modelops-handler.ts` - Main Batch/Fargate stack
- Uses AWS Batch job queue and job definitions
- Serverless execution via Fargate

**EKS (`COMPUTE_BACKEND=eks`)**
- `lib/modelops-eks-stack.ts` - EKS cluster with Karpenter
- `lib/karpenter.ts` - NodePool and EC2NodeClass helpers
- Uses Kubernetes Jobs for execution
- Kubernetes version: 1.31 (see `.claude/context/eks-cluster.md` for upgrade guide)
- c5.4xlarge nodes with scale-to-zero via Karpenter
- Bootstrap node group (t3.small) for system workloads

### CDK Infrastructure (TypeScript)
- `bin/modelops-handler.ts` - CDK app entry point, conditionally creates Batch or EKS stack
- `lib/config.ts` - Configuration schema using Zod, loads from `.env` files
- `lib/validators.ts` - IAM policy document validators

### CLI (JavaScript/ESM)
- `index.mjs` - Main CLI entry point using Commander.js
- `src/jobs/backends/` - Backend abstraction layer
  - `index.mjs` - Factory function `getBackend(type, config)`
  - `batch.mjs` - AWS Batch backend
  - `eks.mjs` - EKS/Kubernetes backend
- `src/jobs/` - Job management commands (run, list, describe, logs)

### Kubernetes Manifests
- `k8s/job-template.yaml` - Mustache template for Kubernetes Jobs
- `k8s/namespace.yaml` - Reference for namespace/ServiceAccount

### Pipelines
Pipeline definitions in `./pipelines/*.yaml` define task sequences for 3D processing. Both backends use the same pipeline format.

## Configuration

Configuration via `.env` file or environment variables.

### Common Settings
- `STACK_NAME` - CloudFormation stack name
- `AWS_ACCOUNT_ID`, `AWS_REGION` - Target AWS account
- `COMPUTE_BACKEND` - `batch` or `eks`
- `VPC_ID` or `USE_DEFAULT_VPC` - Network configuration
- `JOB_MEMORY`, `JOB_CPU`, `JOB_EPHEMERAL_STORAGE` - Job resources
- `JOB_POLICY_FILE` - Path to custom IAM policy

### EKS-Specific Settings
- `EKS_CREATE_VPC` - Create new VPC with NAT Gateway (true/false)
- `EKS_VPC_CIDR` - CIDR for new VPC (default: 10.0.0.0/16)
- `EKS_CLUSTER_NAME` - EKS cluster name
- `EKS_NAMESPACE` - Kubernetes namespace for jobs (default: modelops)
- `EKS_NODE_INSTANCE_TYPE` - Node instance type (default: c5.4xlarge)
- `EKS_KUBECONFIG_PATH` - Path to kubeconfig (optional)

### Example EKS Configuration
```bash
COMPUTE_BACKEND=eks
EKS_CREATE_VPC=true
EKS_CLUSTER_NAME=modelops-cluster
EKS_NAMESPACE=modelops
```

See README.md and example.env for full configuration reference.
