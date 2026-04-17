import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";
import { buildEcrRepoArn } from "./deadline-utils";

type ModelopsSpdaStackPropsT = StackProps & {
  config: Readonly<ConfigPropsT>;
};

interface EcsInfrastructure {
  cluster: cdk.aws_ecs.Cluster;
  taskDef: cdk.aws_ecs.FargateTaskDefinition;
  taskRole: cdk.aws_iam.Role;
  executionRole: cdk.aws_iam.Role;
  securityGroup: cdk.aws_ec2.SecurityGroup;
  ecsLogGroup: cdk.aws_logs.LogGroup;
  subnetIds: string[];
}

export class ModelopsSpdaStack extends cdk.Stack {
  #name: string;
  #config: ConfigPropsT;

  constructor(
    scope: Construct,
    id: string,
    props?: ModelopsSpdaStackPropsT,
  ) {
    super(scope, id, props);

    if (!props) {
      throw new Error("props is required");
    }

    this.#config = props.config;
    this.#name = props.config.stackName;

    this.init();
  }

  private init() {
    if (!this.#config.account) {
      throw new Error("AWS_ACCOUNT_ID is required for the SPDA backend");
    }

    const farmId = this.#config.deadlineFarmId!;
    const queueRole = this.getQueueRole();
    const queueId = this.getQueueId(farmId, queueRole);
    const fleetId = this.getFleetId();
    this.createQueueFleetAssociation(farmId, queueId, fleetId);
    const proxyRole = this.getProxyRole();

    // ECS infrastructure for Deadline-to-ECS bridge
    const ecs = this.getEcsInfrastructure();

    // Add ECS permissions to queue role (workers need to launch/manage ECS tasks)
    this.addEcsPermissionsToQueueRole(queueRole, ecs);

    // Stack outputs
    new cdk.CfnOutput(this, this.#name + "FarmId", {
      value: farmId,
    });

    new cdk.CfnOutput(this, this.#name + "QueueId", {
      value: queueId,
    });

    new cdk.CfnOutput(this, this.#name + "FleetId", {
      value: fleetId,
    });

    new cdk.CfnOutput(this, this.#name + "QueueRoleArn", {
      value: queueRole.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "ProxyRoleArn", {
      value: proxyRole.roleArn,
    });

    // ECS outputs
    new cdk.CfnOutput(this, this.#name + "EcsClusterArn", {
      value: ecs.cluster.clusterArn,
    });

    new cdk.CfnOutput(this, this.#name + "TaskDefArn", {
      value: ecs.taskDef.taskDefinitionArn,
    });

    new cdk.CfnOutput(this, this.#name + "Subnets", {
      value: ecs.subnetIds.join(","),
    });

    new cdk.CfnOutput(this, this.#name + "SecurityGroupId", {
      value: ecs.securityGroup.securityGroupId,
    });

    new cdk.CfnOutput(this, this.#name + "EcsLogGroupName", {
      value: ecs.ecsLogGroup.logGroupName,
    });

    new cdk.CfnOutput(this, this.#name + "StagingBucket", {
      value: this.#config.spdaStagingBucket!,
    });
  }

  /**
   * Creates the queue with jobAttachmentSettings pointing to the SPDA asset
   * bucket. Deadline uses these settings to sync input files (dataFlow: IN)
   * from SDMA to the worker and output files (dataFlow: OUT) back.
   */
  private getQueueId(
    farmId: string,
    queueRole: cdk.aws_iam.Role,
  ): string {
    // Extract bucket name from first SPDA bucket ARN (arn:aws:s3:::bucket-name)
    const spdaBucketArn = this.#config.spdaS3BucketArns![0];
    const spdaBucketName = spdaBucketArn.split(":::")[1];

    const queue = new cdk.aws_deadline.CfnQueue(
      this,
      this.#name + "Queue",
      {
        displayName: `${this.#name}-spda-queue`,
        farmId,
        roleArn: queueRole.roleArn,
        jobAttachmentSettings: {
          s3BucketName: spdaBucketName,
          rootPrefix: "SpatialDataManagementAssets",
        },
      },
    );

    return queue.attrQueueId;
  }

  /**
   * Returns the existing SPDA fleet ID from config. The fleet is managed by
   * SPDA and referenced by ID; workers run only the ECS bridge script, so no
   * host-level Docker/ECR setup is required on the fleet.
   */
  private getFleetId(): string {
    return this.#config.deadlineFleetId!;
  }

  private createQueueFleetAssociation(
    farmId: string,
    queueId: string,
    fleetId: string,
  ) {
    new cdk.aws_deadline.CfnQueueFleetAssociation(
      this,
      this.#name + "QueueFleetAssociation",
      {
        farmId,
        queueId,
        fleetId,
      },
    );
  }

  /**
   * IAM role assumed by the queue — grants S3 access to SPDA bucket ARNs.
   */
  private getQueueRole() {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "QueueRole",
      {
        assumedBy: new cdk.aws_iam.CompositePrincipal(
          new cdk.aws_iam.ServicePrincipal("deadline.amazonaws.com"),
          new cdk.aws_iam.ServicePrincipal("credentials.deadline.amazonaws.com"),
        ),
      },
    );

    // S3 access to SPDA buckets + staging bucket (workers upload inputs, download outputs)
    const stagingBucketArn = `arn:aws:s3:::${this.#config.spdaStagingBucket!}`;
    const bucketArns = [...this.#config.spdaS3BucketArns!, stagingBucketArn];
    const bucketResources = bucketArns.flatMap((arn) => [arn, `${arn}/*`]);
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
        resources: bucketResources,
      }),
    );

    return role;
  }

  /**
   * Proxy role that SPDA's Connector Lambda assumes to submit Deadline jobs
   * to this queue.
   */
  private getProxyRole() {
    const trustPrincipal = this.#config.spdaRoleArn
      ? new cdk.aws_iam.ArnPrincipal(this.#config.spdaRoleArn)
      : new cdk.aws_iam.AccountRootPrincipal();

    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "ProxyRole",
      {
        roleName: "SpatialDataManagementContentDerivation-ModelOps",
        assumedBy: trustPrincipal,
      },
    );

    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["deadline:*"],
        resources: ["*"],
      }),
    );

    // S3 read access to SPDA bucket for loading job templates
    const bucketArns = this.#config.spdaS3BucketArns!;
    const bucketResources = bucketArns.flatMap((arn) => [arn, `${arn}/*`]);
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: bucketResources,
      }),
    );

    return role;
  }

  /**
   * Creates ECS Fargate infrastructure for the Deadline-to-ECS bridge.
   * The Deadline worker launches containers via `aws ecs run-task` to
   * satisfy Marketplace RegisterUsage requirements.
   */
  private getEcsInfrastructure(): EcsInfrastructure {
    // VPC lookup
    const vpc = this.#config.vpcId
      ? cdk.aws_ec2.Vpc.fromLookup(this, "Vpc", { vpcId: this.#config.vpcId })
      : cdk.aws_ec2.Vpc.fromLookup(this, "Vpc", { isDefault: true });

    // Determine subnet IDs (same fallback as Batch stack: private then public)
    const subnetIds = this.#config.subnetIds
      ?? [...vpc.privateSubnets, ...vpc.publicSubnets].map((s) => s.subnetId);

    // Security group (egress-only for Fargate)
    const securityGroup = new cdk.aws_ec2.SecurityGroup(this, this.#name + "EcsSecurityGroup", {
      vpc,
      description: "Security group for ECS bridge Fargate tasks",
      allowAllOutbound: true,
    });

    // VPC endpoints — required for Fargate tasks in subnets without NAT
    // Gateway when assignPublicIp is DISABLED
    vpc.addInterfaceEndpoint(this.#name + "CloudWatchLogsEndpoint", {
      service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
    });

    vpc.addInterfaceEndpoint(this.#name + "MeteringMarketplaceEndpoint", {
      service: new cdk.aws_ec2.InterfaceVpcEndpointService("com.amazonaws." + this.#config.region + ".metering-marketplace"),
      privateDnsEnabled: true,
    });

    // ECS cluster
    const cluster = new cdk.aws_ecs.Cluster(this, this.#name + "EcsCluster", { vpc });

    // CloudWatch log group for ECS tasks
    const ecsLogGroup = new cdk.aws_logs.LogGroup(this, this.#name + "EcsLogGroup", {
      logGroupName: "/deadline-ecs-bridge/tasks",
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task execution role (ECR pull + CloudWatch)
    const executionRole = this.getEcsExecutionRole(ecsLogGroup);

    // Task role (S3 + Marketplace metering)
    const taskRole = this.getEcsTaskRole();

    // Fargate task definition
    const taskDef = new cdk.aws_ecs.FargateTaskDefinition(this, this.#name + "TaskDef", {
      memoryLimitMiB: this.#config.jobMemory * 1024,
      cpu: this.#config.jobCpu * 1024,
      ephemeralStorageGiB: this.#config.jobEphemeralStorage,
      taskRole,
      executionRole,
    });

    taskDef.addContainer(this.#name + "Container", {
      containerName: "modelops-handler",
      image: cdk.aws_ecs.ContainerImage.fromRegistry(`${this.#config.image}:${this.#config.tag}`),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        logGroup: ecsLogGroup,
        streamPrefix: "bridge",
      }),
    });

    return { cluster, taskDef, taskRole, executionRole, securityGroup, ecsLogGroup, subnetIds };
  }

  /**
   * ECS task execution role — allows ECS to pull images from ECR and write
   * logs to CloudWatch.
   */
  private getEcsExecutionRole(ecsLogGroup: cdk.aws_logs.LogGroup): cdk.aws_iam.Role {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "EcsExecutionRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      },
    );

    // ECR auth token
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    // ECR image pull — scoped to our repo + Marketplace
    const ecrRepoArn = buildEcrRepoArn(this.#config.image, this.#config.region, this.#config.account!);
    const marketplaceEcrArn = `arn:aws:ecr:${this.#config.region}:709825985650:repository/*`;
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ],
        resources: [ecrRepoArn, marketplaceEcrArn],
      }),
    );

    // CloudWatch logs
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [ecsLogGroup.logGroupArn, `${ecsLogGroup.logGroupArn}:*`],
      }),
    );

    return role;
  }

  /**
   * ECS task role — mirrors queue role's S3 and Marketplace permissions so
   * the container can access SPDA assets and satisfy Marketplace metering.
   */
  private getEcsTaskRole(): cdk.aws_iam.Role {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "EcsTaskRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      },
    );

    // S3 access to SPDA buckets + staging bucket
    const stagingBucketArn = `arn:aws:s3:::${this.#config.spdaStagingBucket!}`;
    const bucketArns = [...this.#config.spdaS3BucketArns!, stagingBucketArn];
    const bucketResources = bucketArns.flatMap((arn) => [arn, `${arn}/*`]);
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
        resources: bucketResources,
      }),
    );

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

    return role;
  }

  /**
   * Adds ECS management permissions to the queue role so Deadline workers
   * can launch and monitor ECS Fargate tasks via the bridge script.
   */
  private addEcsPermissionsToQueueRole(
    queueRole: cdk.aws_iam.Role,
    ecs: EcsInfrastructure,
  ) {
    // ecs:RunTask scoped to task definition
    queueRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ecs:RunTask"],
        resources: [ecs.taskDef.taskDefinitionArn],
      }),
    );

    // ecs:DescribeTasks, ecs:StopTask — these actions do not support
    // resource-level permissions in IAM
    queueRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ecs:DescribeTasks", "ecs:StopTask"],
        resources: ["*"],
      }),
    );

    // iam:PassRole on both task role and execution role
    queueRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [ecs.taskRole.roleArn, ecs.executionRole.roleArn],
      }),
    );

    // logs:GetLogEvents on ECS log group
    queueRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["logs:GetLogEvents"],
        resources: [ecs.ecsLogGroup.logGroupArn, `${ecs.ecsLogGroup.logGroupArn}:*`],
      }),
    );
  }
}
