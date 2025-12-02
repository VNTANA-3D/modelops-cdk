import { existsSync, readFileSync } from "fs";
import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { KubectlV30Layer } from "@aws-cdk/lambda-layer-kubectl-v30";

import type { ConfigPropsT } from "./config";
import { PolicyDocument } from "./validators";
import {
  getKarpenterNodePoolManifest,
  getKarpenterEC2NodeClassManifest,
} from "./karpenter";

type ModelopsEksStackPropsT = StackProps & {
  config: Readonly<ConfigPropsT>;
};

export class ModelopsEksStack extends cdk.Stack {
  #name: string;
  #config: ConfigPropsT;

  constructor(scope: Construct, id: string, props?: ModelopsEksStackPropsT) {
    super(scope, id, props);

    if (!props) {
      throw new Error("props is required");
    }

    this.#config = props.config;
    this.#name = props.config.stackName;

    // Acknowledge warnings that don't affect functionality
    cdk.Annotations.of(this).acknowledgeWarning(
      "@aws-cdk/aws-ec2:noSubnetRouteTableId",
      "Route table not needed for EKS subnet selection"
    );
    cdk.Annotations.of(this).acknowledgeWarning(
      "@aws-cdk/aws-eks:clusterMustManuallyTagSubnet",
      "Using explicit subnets, not public subnets for ELB"
    );

    this.init();
  }

  private init() {
    const vpc = this.getVpc();
    const s3Bucket = this.getS3Bucket();
    const logGroup = this.getLogGroup();

    // EKS Cluster
    const cluster = this.getEksCluster(vpc);

    // Karpenter setup
    const karpenterNodeRole = this.getKarpenterNodeRole(s3Bucket);
    const karpenterControllerRole = this.getKarpenterControllerRole();
    const karpenterChart = this.installKarpenter(cluster, karpenterControllerRole);
    this.createKarpenterNodePool(cluster, karpenterNodeRole, karpenterChart);
    this.addKarpenterNodeAccessEntry(cluster, karpenterNodeRole);

    // Job ServiceAccount with IRSA
    const jobServiceAccount = this.getJobServiceAccount(cluster, s3Bucket);

    // Create namespace
    this.createNamespace(cluster);

    // Stack outputs
    new cdk.CfnOutput(this, this.#name + "ClusterName", {
      value: cluster.clusterName,
    });

    new cdk.CfnOutput(this, this.#name + "ClusterEndpoint", {
      value: cluster.clusterEndpoint,
    });

    new cdk.CfnOutput(this, this.#name + "ClusterArn", {
      value: cluster.clusterArn,
    });

    new cdk.CfnOutput(this, this.#name + "KubeconfigCommand", {
      value: `aws eks update-kubeconfig --name ${cluster.clusterName} --region ${this.region}`,
    });

    new cdk.CfnOutput(this, this.#name + "JobServiceAccountRoleArn", {
      value: jobServiceAccount.role.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "Namespace", {
      value: this.#config.eksNamespace,
    });

    new cdk.CfnOutput(this, this.#name + "LogGroupName", {
      value: logGroup.logGroupName,
    });

    new cdk.CfnOutput(this, this.#name + "LogGroupArn", {
      value: logGroup.logGroupArn,
    });

    if (s3Bucket !== null) {
      new cdk.CfnOutput(this, this.#name + "S3BucketName", {
        value: s3Bucket.bucketName,
      });
      new cdk.CfnOutput(this, this.#name + "S3BucketArn", {
        value: s3Bucket.bucketArn,
      });
    }
  }

  private getLogGroup() {
    const logGroupName = this.#name + "LogGroup";
    return new cdk.aws_logs.LogGroup(this, logGroupName, {
      logGroupName: this.#config.logGroupName || "/eks/modelops/jobs",
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private getVpc() {
    if (this.#config.eksCreateVpc) {
      // Create new VPC with NAT Gateway
      return new cdk.aws_ec2.Vpc(this, this.#name + "Vpc", {
        maxAzs: 3,
        natGateways: 1,
        ipAddresses: cdk.aws_ec2.IpAddresses.cidr(this.#config.eksVpcCidr),
        subnetConfiguration: [
          {
            cidrMask: 24,
            name: "Public",
            subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          },
          {
            cidrMask: 24,
            name: "Private",
            subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
        ],
      });
    }

    // Use existing VPC
    if (this.#config.vpcId === null && !this.#config.useDefaultVpc) {
      throw new Error(
        "VPC Id, `useDefaultVpc` flag, or `eksCreateVpc` flag is required",
      );
    }

    return cdk.aws_ec2.Vpc.fromLookup(this, this.#name + "Vpc", {
      isDefault: this.#config.useDefaultVpc && !this.#config.vpcId,
      vpcId: this.#config.vpcId || undefined,
    });
  }

  private getS3Bucket() {
    if (this.#config.s3BucketName === null) return null;

    return new cdk.aws_s3.Bucket(this, this.#name + "S3Bucket", {
      bucketName: this.#config.s3BucketName,
    });
  }

  private getEksCluster(vpc: cdk.aws_ec2.IVpc) {
    const clusterName = this.#config.eksClusterName || `${this.#name}-cluster`;

    // Determine subnet selection based on configuration
    // Priority: SUBNET_IDS > EKS_SUBNET_IDS > subnet type selection
    let vpcSubnets: cdk.aws_ec2.SubnetSelection[];
    let subnetsToTag: cdk.aws_ec2.ISubnet[] = [];

    const explicitSubnetIds = this.#config.subnetIds?.length
      ? this.#config.subnetIds
      : this.#config.eksSubnetIds || [];

    if (explicitSubnetIds.length > 0) {
      // Use explicitly provided subnet IDs
      const subnets = explicitSubnetIds.map((subnetId, index) =>
        cdk.aws_ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId)
      );
      vpcSubnets = [{ subnets }];
      subnetsToTag = subnets;
    } else {
      // Fall back to subnet type selection
      const subnetType = this.#config.eksSubnetType;

      switch (subnetType) {
        case "public":
          vpcSubnets = [{ subnetType: cdk.aws_ec2.SubnetType.PUBLIC }];
          subnetsToTag = vpc.publicSubnets;
          break;
        case "both":
          vpcSubnets = [
            { subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
            { subnetType: cdk.aws_ec2.SubnetType.PUBLIC },
          ];
          subnetsToTag = [...vpc.privateSubnets, ...vpc.publicSubnets];
          break;
        case "private":
        default:
          vpcSubnets = [
            { subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS },
          ];
          subnetsToTag = vpc.privateSubnets;
          break;
      }
    }

    const cluster = new cdk.aws_eks.Cluster(this, "EksCluster", {
      vpc,
      vpcSubnets,
      version: cdk.aws_eks.KubernetesVersion.V1_30,
      kubectlLayer: new KubectlV30Layer(this, "KubectlLayer"),
      defaultCapacity: 0, // Karpenter will manage job nodes
      clusterName,
      outputClusterName: true,
      outputConfigCommand: true,
      endpointAccess: cdk.aws_eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      clusterLogging: [
        cdk.aws_eks.ClusterLoggingTypes.API,
        cdk.aws_eks.ClusterLoggingTypes.AUDIT,
        cdk.aws_eks.ClusterLoggingTypes.AUTHENTICATOR,
        cdk.aws_eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        cdk.aws_eks.ClusterLoggingTypes.SCHEDULER,
      ],
    });

    // Add bootstrap managed node group for Karpenter controller
    cluster.addNodegroupCapacity("BootstrapNodeGroup", {
      instanceTypes: [new cdk.aws_ec2.InstanceType("t3.small")],
      minSize: 1,
      maxSize: 1,
      desiredSize: 1,
      labels: {
        role: "system",
      },
      taints: [
        {
          key: "CriticalAddonsOnly",
          value: "true",
          effect: cdk.aws_eks.TaintEffect.NO_SCHEDULE,
        },
      ],
    });

    // Tag subnets for Karpenter discovery
    for (const subnet of subnetsToTag) {
      cdk.Tags.of(subnet).add("karpenter.sh/discovery", clusterName);
    }

    // Tag cluster security group for Karpenter discovery
    cdk.Tags.of(cluster.clusterSecurityGroup).add(
      "karpenter.sh/discovery",
      clusterName,
    );

    return cluster;
  }

  private getKarpenterNodeRole(s3Bucket: cdk.aws_s3.Bucket | null) {
    const role = new cdk.aws_iam.Role(this, this.#name + "KarpenterNodeRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEKSWorkerNodePolicy",
        ),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEC2ContainerRegistryReadOnly",
        ),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonEKS_CNI_Policy",
        ),
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    // AWS Marketplace metering
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "aws-marketplace:RegisterUsage",
          "aws-marketplace:MeterUsage",
        ],
        resources: ["*"],
      }),
    );

    // S3 access if bucket configured
    if (s3Bucket) {
      role.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:*"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

    // Custom policy file support
    if (this.#config.jobPolicyFile && existsSync(this.#config.jobPolicyFile)) {
      const policyDocument = PolicyDocument.parse(
        JSON.parse(readFileSync(this.#config.jobPolicyFile, "utf-8")),
      );

      for (const statement of policyDocument.Statement) {
        role.addToPolicy(
          new cdk.aws_iam.PolicyStatement({
            actions: Array.isArray(statement.Action)
              ? statement.Action
              : [statement.Action],
            resources: Array.isArray(statement.Resource)
              ? statement.Resource
              : [statement.Resource],
          }),
        );
      }
    }

    // Create instance profile
    new cdk.aws_iam.CfnInstanceProfile(this, "KarpenterNodeInstanceProfile", {
      roles: [role.roleName],
      instanceProfileName: `KarpenterNodeInstanceProfile-${this.#name}`,
    });

    return role;
  }

  private addKarpenterNodeAccessEntry(
    cluster: cdk.aws_eks.Cluster,
    nodeRole: cdk.aws_iam.Role,
  ) {
    // Add access entry for Karpenter nodes to join the cluster
    // Use EC2_LINUX type which grants the necessary permissions for nodes
    new cdk.aws_eks.CfnAccessEntry(this, "KarpenterNodeAccessEntry", {
      clusterName: cluster.clusterName,
      principalArn: nodeRole.roleArn,
      type: "EC2_LINUX",
    });
  }

  private getKarpenterControllerRole() {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "KarpenterControllerRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("eks.amazonaws.com"),
      },
    );

    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "ec2:CreateFleet",
          "ec2:CreateLaunchTemplate",
          "ec2:CreateTags",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeImages",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceTypeOfferings",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplates",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSpotPriceHistory",
          "ec2:DescribeSubnets",
          "ec2:DeleteLaunchTemplate",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "iam:PassRole",
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:GetInstanceProfile",
          "pricing:GetProducts",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
        ],
        resources: ["*"],
      }),
    );

    return role;
  }

  private installKarpenter(
    cluster: cdk.aws_eks.Cluster,
    _controllerRole: cdk.aws_iam.Role,
  ) {
    // Create karpenter namespace first
    const karpenterNamespace = cluster.addManifest("KarpenterNamespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: "karpenter",
        labels: {
          app: "karpenter",
        },
      },
    });

    // Create service account for Karpenter controller (depends on namespace)
    const karpenterSA = cluster.addServiceAccount("KarpenterServiceAccount", {
      name: "karpenter",
      namespace: "karpenter",
    });
    karpenterSA.node.addDependency(karpenterNamespace);

    // Grant Karpenter controller permissions directly
    karpenterSA.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          // EC2 permissions
          "ec2:CreateFleet",
          "ec2:CreateLaunchTemplate",
          "ec2:CreateTags",
          "ec2:DeleteLaunchTemplate",
          "ec2:DeleteTags",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeImages",
          "ec2:DescribeInstances",
          "ec2:DescribeInstanceTypeOfferings",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplates",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSpotPriceHistory",
          "ec2:DescribeSubnets",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          // IAM permissions
          "iam:PassRole",
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:GetInstanceProfile",
          "iam:TagInstanceProfile",
          // EKS permissions
          "eks:DescribeCluster",
          // SSM permissions for AMI discovery
          "ssm:GetParameter",
          // Pricing
          "pricing:GetProducts",
          // SQS for interruption handling
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
        ],
        resources: ["*"],
      }),
    );

    // Add Karpenter Helm chart (namespace already created above)
    const karpenterChart = cluster.addHelmChart("KarpenterChart", {
      repository: "oci://public.ecr.aws/karpenter/karpenter",
      chart: "karpenter",
      release: "karpenter",
      version: "1.0.0",
      namespace: "karpenter",
      createNamespace: false,
      values: {
        settings: {
          clusterName: cluster.clusterName,
          clusterEndpoint: cluster.clusterEndpoint,
        },
        serviceAccount: {
          create: false,
          name: "karpenter",
          annotations: {
            "eks.amazonaws.com/role-arn": karpenterSA.role.roleArn,
          },
        },
        tolerations: [
          {
            key: "CriticalAddonsOnly",
            operator: "Exists",
            effect: "NoSchedule",
          },
        ],
        nodeSelector: {
          role: "system",
        },
      },
    });

    // Ensure proper ordering: namespace -> service account -> helm chart
    karpenterChart.node.addDependency(karpenterSA);

    return karpenterChart;
  }

  private createKarpenterNodePool(
    cluster: cdk.aws_eks.Cluster,
    nodeRole: cdk.aws_iam.Role,
    karpenterChart: cdk.aws_eks.HelmChart,
  ) {
    const nodePoolManifest = getKarpenterNodePoolManifest({
      // Use default instance types (c5, m5, r5 families) for flexibility
      // Karpenter will choose the right size based on pod requirements
    });

    const ec2NodeClassManifest = getKarpenterEC2NodeClassManifest({
      clusterName: cluster.clusterName,
      roleArn: nodeRole.roleArn,
      roleName: nodeRole.roleName,
    });

    // Add manifests with dependency on Karpenter Helm chart (CRDs must be installed first)
    const nodePool = cluster.addManifest("KarpenterNodePool", nodePoolManifest);
    const ec2NodeClass = cluster.addManifest("KarpenterEC2NodeClass", ec2NodeClassManifest);

    // Ensure CRDs are installed before applying manifests
    nodePool.node.addDependency(karpenterChart);
    ec2NodeClass.node.addDependency(karpenterChart);
  }

  private getJobServiceAccount(
    cluster: cdk.aws_eks.Cluster,
    s3Bucket: cdk.aws_s3.Bucket | null,
  ) {
    const serviceAccount = cluster.addServiceAccount(
      "ModelOpsJobServiceAccount",
      {
        name: "modelops-job-sa",
        namespace: this.#config.eksNamespace,
      },
    );

    // AWS Marketplace metering
    serviceAccount.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "aws-marketplace:RegisterUsage",
          "aws-marketplace:MeterUsage",
        ],
        resources: ["*"],
      }),
    );

    // S3 access if bucket configured
    if (s3Bucket) {
      serviceAccount.addToPrincipalPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:*"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

    // Custom policy file support
    if (this.#config.jobPolicyFile && existsSync(this.#config.jobPolicyFile)) {
      const policyDocument = PolicyDocument.parse(
        JSON.parse(readFileSync(this.#config.jobPolicyFile, "utf-8")),
      );

      for (const statement of policyDocument.Statement) {
        serviceAccount.addToPrincipalPolicy(
          new cdk.aws_iam.PolicyStatement({
            actions: Array.isArray(statement.Action)
              ? statement.Action
              : [statement.Action],
            resources: Array.isArray(statement.Resource)
              ? statement.Resource
              : [statement.Resource],
          }),
        );
      }
    }

    return serviceAccount;
  }

  private createNamespace(cluster: cdk.aws_eks.Cluster) {
    cluster.addManifest("ModelOpsNamespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: this.#config.eksNamespace,
        labels: {
          app: "modelops",
        },
      },
    });
  }
}
