import { existsSync, readFileSync } from "fs";
import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";
import { PolicyDocument } from "./validators";

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
    const subnetIds = this.getSubnetIds(vpc);
    const s3Bucket = this.getS3Bucket();
    const logGroup = this.getLogGroup();

    const securityGroup = this.getSecurityGroup(vpc);
    const ecsTaskExecutionRole = this.getJobExecutionRole();
    const ecsTaskRole = this.getJobRole(s3Bucket);
    const batchServiceRole = this.getBatchServiceRole();

    const fargateComputeEnvironment = this.getFargateComputeEnvironment(
      vpc,
      subnetIds,
      securityGroup,
      batchServiceRole,
    );
    const jobQueue = this.getJobQueue(fargateComputeEnvironment);
    const container = this.getContainer(
      ecsTaskExecutionRole,
      ecsTaskRole,
      logGroup,
    );
    const jobDefinition = this.getJobDefinition(
      container,
      jobQueue,
      batchServiceRole,
    );

    new cdk.CfnOutput(this, this.#name + "SecurityGroupId", {
      value: securityGroup.securityGroupId,
    });

    new cdk.CfnOutput(this, this.#name + "JobRoleArn", {
      value: ecsTaskRole.roleArn,
    });
    new cdk.CfnOutput(this, this.#name + "JobExecutionRoleArn", {
      value: ecsTaskExecutionRole.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "JobQueueArn", {
      value: jobQueue.jobQueueArn,
    });
    new cdk.CfnOutput(this, this.#name + "JobQueueName", {
      value: jobQueue.jobQueueName,
    });

    new cdk.CfnOutput(this, this.#name + "JobDefinitionArn", {
      value: jobDefinition.jobDefinitionArn,
    });
    new cdk.CfnOutput(this, this.#name + "JobDefinitionName", {
      value: jobDefinition.jobDefinitionName,
    });

    new cdk.CfnOutput(this, this.#name + "LogGroupArn", {
      value: logGroup.logGroupArn,
    });
    new cdk.CfnOutput(this, this.#name + "LogGroupName", {
      value: logGroup.logGroupName,
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
      logGroupName: "/custom/log/group",
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private getVpc() {
    if (this.#config.vpcId === null && !this.#config.useDefaultVpc) {
      throw new Error("VPC Id or `useDefaultVpc` flag is required");
    }

    return cdk.aws_ec2.Vpc.fromLookup(this, this.#name + "Vpc", {
      isDefault: this.#config.useDefaultVpc && !this.#config.vpcId,
    });
  }

  private getSubnetIds(vpc: cdk.aws_ec2.IVpc) {
    const vpcSubnets = [...vpc.privateSubnets, ...vpc.publicSubnets];
    const subnetIds = this.#config.subnetIds || [];

    const subnets =
      subnetIds.length > 0
        ? vpcSubnets.filter((subnet) => subnetIds.includes(subnet.subnetId))
        : vpcSubnets;

    if (subnets.length === 0) {
      throw new Error("No subnets found");
    }

    return subnets as cdk.aws_ec2.ISubnet[];
  }

  private getS3Bucket() {
    if (this.#config.s3BucketName === null) return null;

    return new cdk.aws_s3.Bucket(this, this.#name + "S3Bucket", {
      bucketName: this.#config.s3BucketName,
    });
  }

  private getJobExecutionRole() {
    const taskExecutionRole = new cdk.aws_iam.Role(
      this,
      this.#name + "JobExecutionRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonECSTaskExecutionRolePolicy",
          ),
        ],
      },
    );

    return taskExecutionRole;
  }

  private getJobRole(s3Bucket: cdk.aws_s3.Bucket | null) {
    const jobRole = new cdk.aws_iam.Role(this, this.#name + "JobRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    jobRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "aws-marketplace:RegisterUsage",
          "aws-marketplace:MeterUsage",
        ],
        resources: ["*"],
      }),
    );

    if (s3Bucket) {
      jobRole.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:*"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

    if (this.#config.jobPolicyFile && existsSync(this.#config.jobPolicyFile)) {
      const policyDocument = PolicyDocument.parse(
        JSON.parse(readFileSync(this.#config.jobPolicyFile, "utf-8")),
      );

      for (const statement of policyDocument.Statement) {
        jobRole.addToPolicy(
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
    return jobRole;
  }

  private getBatchServiceRole() {
    const name = this.#name + "BatchServiceRole";
    const batchServiceRole = new cdk.aws_iam.Role(this, name, {
      assumedBy: new cdk.aws_iam.ServicePrincipal("batch.amazonaws.com"),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSBatchServiceRole",
        ),
      ],
    });

    batchServiceRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "batch:SubmitJob",
          "batch:DescribeComputeEnvironments",
          "batch:DescribeJobDefinitions",
          "batch:DescribeJobQueues",
          "batch:DescribeJobs",
          "batch:ListJobs",
          "batch:TerminateJob",
          "ecs:CreateCluster",
          "ecs:DescribeClusters",
          "ecs:DescribeContainerInstances",
          "ecs:DescribeTasks",
          "ecs:ListClusters",
          "ecs:ListContainerInstances",
          "ecs:ListTasks",
          "ecs:RunTask",
          "ecs:StartTask",
          "ecs:StopTask",
          "ecs:UpdateContainerInstancesState",
          "ecs:RegisterTaskDefinition",
          "application-autoscaling:DeleteScalingPolicy",
          "application-autoscaling:DeregisterScalableTarget",
          "application-autoscaling:DescribeScalableTargets",
          "application-autoscaling:DescribeScalingActivities",
          "application-autoscaling:DescribeScalingPolicies",
          "application-autoscaling:PutScalingPolicy",
          "application-autoscaling:RegisterScalableTarget",
          "elasticloadbalancing:DeregisterInstancesFromLoadBalancer",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:RegisterInstancesWithLoadBalancer",
          "elasticloadbalancing:RegisterTargets",
          "cloudwatch:PutMetricAlarm",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:DeleteAlarms",
          "iam:PassRole",
        ],
        resources: ["*"],
      }),
    );

    return batchServiceRole;
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

  private getFargateComputeEnvironment(
    vpc: cdk.aws_ec2.IVpc,
    subnets: cdk.aws_ec2.ISubnet[],
    securityGroup: cdk.aws_ec2.SecurityGroup,
    serviceRole: cdk.aws_iam.Role,
  ) {
    const name = this.#name + "FargateComputeEnvironment";

    return new cdk.aws_batch.FargateComputeEnvironment(this, name, {
      vpc,
      computeEnvironmentName: name,
      enabled: true,
      securityGroups: [securityGroup],
      serviceRole,
      spot: !!this.#config.useSpotInstances,
      vpcSubnets: {
        subnets,
      },
    });
  }

  private getJobQueue(
    fargateComputeEnvironment: cdk.aws_batch.FargateComputeEnvironment,
  ) {
    const jobQueueName = this.#name + "JobQueue";
    return new cdk.aws_batch.JobQueue(this, jobQueueName, {
      computeEnvironments: [
        {
          computeEnvironment: fargateComputeEnvironment,
          order: 1,
        },
      ],
      enabled: true,
      jobQueueName,
      priority: 10,
    });
  }

  private getContainer(
    executionRole: cdk.aws_iam.Role,
    jobRole: cdk.aws_iam.Role,
    logGroup: cdk.aws_logs.LogGroup,
  ) {
    return new cdk.aws_batch.EcsFargateContainerDefinition(
      this,
      this.#name + "EcsFargateContainerDefinition",
      {
        cpu: this.#config.jobCpu,
        image: cdk.aws_ecs.ContainerImage.fromRegistry(
          `${this.#config.image}:${this.#config.tag}`,
        ),
        memory: cdk.Size.gibibytes(this.#config.jobMemory),
        assignPublicIp: false,
        command: ["${{Entrypoint}}"],
        ephemeralStorageSize: cdk.Size.gibibytes(
          this.#config.jobEphemeralStorage,
        ),
        executionRole,
        jobRole,
        logging: cdk.aws_ecs.LogDriver.awsLogs({
          streamPrefix: this.#config.logGroupStreamPrefix,
          mode: cdk.aws_ecs.AwsLogDriverMode.NON_BLOCKING,
          logGroup,
        }),
      },
    );
  }

  private getJobDefinition(
    container: cdk.aws_batch.IEcsContainerDefinition,
    jobQueue: cdk.aws_batch.JobQueue,
    serviceRole: cdk.aws_iam.Role,
  ) {
    const jobDefinitionName = this.#name + "JobDefinition";
    const jobDefinition = new cdk.aws_batch.EcsJobDefinition(
      this,
      jobDefinitionName,
      {
        container,
        parameters: {
          Entrypoint: "/home/app/apps/handler/dist/index.js",
        },
        jobDefinitionName,
        propagateTags: true,
        retryAttempts: this.#config.jobRetryAttempts,
      },
    );

    jobDefinition.grantSubmitJob(serviceRole, jobQueue);

    return jobDefinition;
  }
}
