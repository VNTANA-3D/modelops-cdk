import { existsSync, readFileSync } from "fs";
import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";
import { PolicyDocument } from "./validators";
import { renderCmfUserData, buildEcrRepoArn } from "./deadline-utils";

type ModelopsSpdaStackPropsT = StackProps & {
  config: Readonly<ConfigPropsT>;
};

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
    const logGroup = this.getLogGroup();
    const queueRole = this.getQueueRole();
    const fleetRole = this.getFleetRole(logGroup);
    const queueId = this.getQueueId(farmId, queueRole);
    const fleetId = this.getFleetId(farmId, fleetRole);
    this.createQueueFleetAssociation(farmId, queueId, fleetId);
    const proxyRole = this.getProxyRole();

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

    new cdk.CfnOutput(this, this.#name + "FleetRoleArn", {
      value: fleetRole.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "ProxyRoleArn", {
      value: proxyRole.roleArn,
    });

    new cdk.CfnOutput(this, this.#name + "LogGroupName", {
      value: logGroup.logGroupName,
    });

    new cdk.CfnOutput(this, this.#name + "LogGroupArn", {
      value: logGroup.logGroupArn,
    });
  }

  private getLogGroup() {
    const logGroupName = this.#name + "LogGroup";
    return new cdk.aws_logs.LogGroup(this, logGroupName, {
      logGroupName:
        this.#config.logGroupName || "/deadline/modelops/spda/jobs",
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  /**
   * Creates the queue — no jobAttachmentSettings since SPDA manages its own
   * asset bucket.
   */
  private getQueueId(
    farmId: string,
    queueRole: cdk.aws_iam.Role,
  ): string {
    const queue = new cdk.aws_deadline.CfnQueue(
      this,
      this.#name + "Queue",
      {
        displayName: `${this.#name}-spda-queue`,
        farmId,
        roleArn: queueRole.roleArn,
      },
    );

    return queue.attrQueueId;
  }

  /**
   * Creates a customer-managed fleet and its supporting infrastructure (ASG,
   * launch template, security group).
   */
  private getFleetId(
    farmId: string,
    fleetRole: cdk.aws_iam.Role,
  ): string {
    const fleet = new cdk.aws_deadline.CfnFleet(
      this,
      this.#name + "Fleet",
      {
        displayName: `${this.#name}-spda-fleet`,
        farmId,
        roleArn: fleetRole.roleArn,
        maxWorkerCount: this.#config.deadlineFleetMax,
        minWorkerCount: this.#config.deadlineFleetMin,
        configuration: {
          customerManaged: {
            mode: "EVENT_BASED_AUTO_SCALING",
            workerCapabilities: {
              cpuArchitectureType: "x86_64",
              osFamily: "LINUX",
              vCpuCount: { min: 4, max: 4 },
              memoryMiB: { min: this.#config.jobMemory * 1024 },
            },
          },
        },
      },
    );

    this.createCmfInfrastructure(farmId, fleet, fleetRole);

    return fleet.attrFleetId;
  }

  /**
   * Creates the VPC lookup, security group, launch template, and auto scaling
   * group that back the customer-managed fleet.
   */
  private createCmfInfrastructure(
    farmId: string,
    fleet: cdk.aws_deadline.CfnFleet,
    fleetRole: cdk.aws_iam.Role,
  ) {
    const vpc = cdk.aws_ec2.Vpc.fromLookup(this, "Vpc", {
      vpcId: this.#config.spdaVpcId!,
    });

    const sg = new cdk.aws_ec2.SecurityGroup(this, this.#name + "FleetSg", {
      vpc,
      allowAllOutbound: true,
    });

    const instanceProfile = new cdk.aws_iam.CfnInstanceProfile(
      this,
      this.#name + "FleetInstanceProfile",
      { roles: [fleetRole.roleName] },
    );

    const userData = renderCmfUserData({
      region: this.#config.region,
      accountId: this.#config.account!,
      image: this.#config.image,
      tag: this.#config.tag,
      farmId,
      fleetId: fleet.attrFleetId,
    });

    const lt = new cdk.aws_ec2.LaunchTemplate(this, this.#name + "LaunchTemplate", {
      machineImage: cdk.aws_ec2.MachineImage.latestAmazonLinux2023(),
      instanceType: new cdk.aws_ec2.InstanceType(this.#config.spdaInstanceType),
      securityGroup: sg,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: cdk.aws_ec2.BlockDeviceVolume.ebs(this.#config.jobEphemeralStorage),
        },
      ],
      userData: cdk.aws_ec2.UserData.custom(userData),
    });

    // Attach instance profile via L1 escape hatch
    const cfnLt = lt.node.defaultChild as cdk.aws_ec2.CfnLaunchTemplate;
    cfnLt.addPropertyOverride(
      "LaunchTemplateData.IamInstanceProfile.Arn",
      instanceProfile.attrArn,
    );

    const subnetIds = this.#config.spdaSubnetIds!;

    new cdk.aws_autoscaling.AutoScalingGroup(this, this.#name + "Asg", {
      vpc,
      launchTemplate: lt,
      minCapacity: 0,
      maxCapacity: this.#config.deadlineFleetMax,
      desiredCapacity: 0,
      autoScalingGroupName: cdk.Fn.join("-", [
        "deadline-ASG-autoscalable",
        fleet.attrFleetId,
      ]),
      vpcSubnets: {
        subnets: subnetIds.map((id, i) =>
          cdk.aws_ec2.Subnet.fromSubnetId(this, `Subnet${i}`, id),
        ),
      },
    });
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

    const bucketArns = this.#config.spdaS3BucketArns!;
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
   * IAM role assumed by fleet workers — grants CloudWatch logging, S3 access
   * to SPDA buckets, ECR pull, and Marketplace metering.
   */
  private getFleetRole(logGroup: cdk.aws_logs.LogGroup) {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "FleetRole",
      {
        assumedBy: new cdk.aws_iam.CompositePrincipal(
          new cdk.aws_iam.ServicePrincipal("deadline.amazonaws.com"),
          new cdk.aws_iam.ServicePrincipal("credentials.deadline.amazonaws.com"),
          new cdk.aws_iam.ServicePrincipal("ec2.amazonaws.com"),
        ),
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("AWSDeadlineCloud-FleetWorker"),
        ],
      },
    );

    // CloudWatch Logs
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
      }),
    );

    // S3 access to SPDA buckets
    const bucketArns = this.#config.spdaS3BucketArns!;
    const bucketResources = bucketArns.flatMap((arn) => [arn, `${arn}/*`]);
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        resources: bucketResources,
      }),
    );

    // ECR -- account-wide auth token
    role.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["ecr:GetAuthorizationToken"],
        resources: ["*"],
      }),
    );

    // ECR -- scoped image pull for private repo + Marketplace (account 709825985650)
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

    return role;
  }
}
