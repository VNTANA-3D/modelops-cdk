# EKS Cluster Configuration

## Current Version

- **Kubernetes Version**: 1.31
- **kubectl Layer**: `@aws-cdk/lambda-layer-kubectl-v31`

## Cluster Architecture

The EKS cluster uses a two-tier node architecture:

### Bootstrap Node Group (Managed)
- **Instance Type**: t3.small
- **Size**: 1 node (fixed)
- **Label**: `role=system`
- **Purpose**: Runs critical system workloads that must always be available
- **Workloads**: Karpenter controller, CoreDNS, EBS CSI controller

### Workload Nodes (Karpenter)
- **Instance Types**: c5.4xlarge (configurable via `EKS_NODE_INSTANCE_TYPE`)
- **Scaling**: 0 to N (scale-to-zero capable)
- **Purpose**: Runs ModelOps job pods
- **Provisioner**: Karpenter with NodePool and EC2NodeClass

## Key Add-ons

| Add-on | Purpose | IAM |
|--------|---------|-----|
| aws-ebs-csi-driver | EBS volume provisioning | IRSA via `AmazonEKS_EBS_CSI_DriverRole_*` |
| vpc-cni | Pod networking | Node role |
| coredns | DNS resolution | N/A |
| kube-proxy | Service networking | N/A |

## IRSA (IAM Roles for Service Accounts)

The EBS CSI driver uses IRSA. The service account must have this annotation:
```yaml
eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/AmazonEKS_EBS_CSI_DriverRole_<cluster-name>
```

## Upgrading Kubernetes Version

When upgrading the EKS version:

1. Update `lib/modelops-eks-stack.ts`:
   - Change `KubernetesVersion.V1_XX` to new version
   - Update `KubectlVXXLayer` import and usage

2. Update dependencies:
   ```bash
   npm install @aws-cdk/lambda-layer-kubectl-vXX
   npm uninstall @aws-cdk/lambda-layer-kubectl-vOLD
   npm install aws-cdk-lib@latest  # May be required for new K8s versions
   ```

3. Deploy and upgrade existing cluster:
   ```bash
   aws eks update-cluster-version --name <cluster> --kubernetes-version X.XX
   aws eks update-nodegroup-version --cluster-name <cluster> --nodegroup-name <ng>
   ```

## Extended Support Costs

AWS charges extra for EKS clusters running Kubernetes versions in "Extended Support":
- Standard: $0.10/cluster/hour
- Extended Support: $0.50/cluster/hour

Keep clusters on supported versions to avoid the $360/month penalty.
