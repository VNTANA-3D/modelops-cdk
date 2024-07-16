import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";

const HTTPS = 443;
const HTTP = 80;

type ModelopsOnAwsStackPropsT = StackProps & {
  config: Readonly<ConfigPropsT>;
};

export class ModelopsOnAwsStack extends cdk.Stack {
  #name: string;
  #config: ConfigPropsT;

  constructor(scope: Construct, id: string, props?: ModelopsOnAwsStackPropsT) {
    super(scope, id, props);

    if (!props) {
      throw new Error("props is required");
    }

    this.#config = props.config;
    this.#name = props.config.stackName;

    this.init();
  }

  private init() {
    const vpc = this.getVpc();
    const s3Bucket = this.getS3Bucket();

    const ecsCluster = this.getEcsCluster(vpc);
    const securityGroup = this.getSecurityGroup(vpc);
    const ecsTaskExecutionRole = this.getEcsTaskExecutionRole();
    const ecsTaskRole = this.getEcsTaskRole(s3Bucket);
    const logGroup = this.getLogGroup();
    const containerImage = this.getContainerImage();
    const taskDefinition = this.getTaskDefinition(
      ecsTaskExecutionRole,
      ecsTaskRole,
    );
    const container = this.getContainer(
      containerImage,
      taskDefinition,
      logGroup,
    );

    new cdk.CfnOutput(this, this.#name + "SecurityGroupId", {
      value: securityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, this.#name + "EcsClusterName", {
      value: ecsCluster.clusterName,
    });
    new cdk.CfnOutput(this, this.#name + "EcsClusterArn", {
      value: ecsCluster.clusterArn,
    });
    new cdk.CfnOutput(this, this.#name + "EcsTaskRoleArn", {
      value: ecsTaskRole.roleArn,
    });
    new cdk.CfnOutput(this, this.#name + "EcsTaskExecutionRoleArn", {
      value: ecsTaskExecutionRole.roleArn,
    });
    new cdk.CfnOutput(this, this.#name + "EcsContainerName", {
      value: container.containerName,
    });
    new cdk.CfnOutput(this, this.#name + "EcsContainerImageName", {
      value: container.imageName,
    });
    new cdk.CfnOutput(this, this.#name + "EcsTaskDefinitionArn", {
      value: taskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, this.#name + "EcsTaskDefinitionFamily", {
      value: taskDefinition.family,
    });

    if (s3Bucket) {
      new cdk.CfnOutput(this, this.#name + "S3BucketName", {
        value: s3Bucket.bucketName,
      });
      new cdk.CfnOutput(this, this.#name + "S3BucketArn", {
        value: s3Bucket.bucketArn,
      });
    }
  }

  private getVpc() {
    if (this.#config.vpcId === null && !this.#config.useDefaultVpc) {
      throw new Error("VPC Id or `useDefaultVpc` flag is required");
    }

    return cdk.aws_ec2.Vpc.fromLookup(this, this.#name + "Vpc", {
      isDefault: this.#config.useDefaultVpc && !this.#config.vpcId,
    });
  }

  private getS3Bucket() {
    if (this.#config.s3BucketName === null) return null;

    return new cdk.aws_s3.Bucket(this, this.#name + "S3Bucket", {
      bucketName: this.#config.s3BucketName,
    });
  }

  private getEcsCluster(vpc: cdk.aws_ec2.IVpc) {
    const id = this.#name + "EcsCluster";

    return this.#config.ecsClusterArn
      ? cdk.aws_ecs.Cluster.fromClusterArn(this, id, this.#config.ecsClusterArn)
      : new cdk.aws_ecs.Cluster(this, id, { vpc });
  }

  private getEcsTaskExecutionRole() {
    const taskExecutionRole = new cdk.aws_iam.Role(
      this,
      this.#name + "EcsTaskExecutionRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonECSTaskExecutionRolePolicy",
          ),
        ],
      },
    );

    taskExecutionRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["*"],
      }),
    );

    return taskExecutionRole;
  }

  private getEcsTaskRole(s3Bucket: cdk.aws_s3.Bucket | null) {
    const taskRole = new cdk.aws_iam.Role(this, this.#name + "EcsTaskRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "aws-marketplace:RegisterUsage",
          "aws-marketplace:MeterUsage",
        ],
        resources: ["*"],
      }),
    );

    if (s3Bucket) {
      taskRole.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:*"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

    return taskRole;
  }

  private getLogGroup() {
    const id = this.#name + "LogGroup";
    return new cdk.aws_logs.LogGroup(this, id, {
      logGroupName: this.#config.logGroupName || id,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
    });
  }

  private getSecurityGroup(vpc: cdk.aws_ec2.IVpc) {
    const sg = new cdk.aws_ec2.SecurityGroup(
      this,
      this.#name + "SecurityGroup",
      {
        vpc,
        allowAllIpv6Outbound: true,
        allowAllOutbound: true,
      },
    );

    sg.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.tcp(HTTPS),
      "Allow IPv4 HTTPS Access",
    );
    sg.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv6(),
      cdk.aws_ec2.Port.tcp(HTTPS),
      "Allow IPv6 HTTPS Access",
    );
    sg.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.tcp(HTTP),
      "Allow IPv4 HTTP Access",
    );
    sg.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv6(),
      cdk.aws_ec2.Port.tcp(HTTP),
      "Allow IPv6 HTTP Access",
    );

    return sg;
  }

  private getContainerImage() {
    return cdk.aws_ecs.ContainerImage.fromRegistry(this.#config.repository);
  }

  private getTaskDefinition(
    executionRole: cdk.aws_iam.Role,
    taskRole: cdk.aws_iam.Role,
  ) {
    return new cdk.aws_ecs.FargateTaskDefinition(
      this,
      this.#name + "TaskDefinition",
      {
        executionRole,
        taskRole,
      },
    );
  }

  private getContainer(
    image: cdk.aws_ecs.RepositoryImage,
    taskDefinition: cdk.aws_ecs.FargateTaskDefinition,
    logGroup: cdk.aws_logs.LogGroup,
  ) {
    return new cdk.aws_ecs.ContainerDefinition(this, this.#name + "Container", {
      image,
      taskDefinition,
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: this.#config.logGroupStreamPrefix,
      }),
      memoryLimitMiB: this.#config.ecsMemoryLimitMiB,
      cpu: this.#config.ecsCpu,
    });
  }
}
