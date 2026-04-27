import { existsSync, readFileSync } from "fs";
import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";
import { PolicyDocument } from "./validators";
import { renderWorkerScript, buildEcrRepoArn } from "./deadline-utils";

type ModelopsDeadlineStackPropsT = StackProps & {
  config: Readonly<ConfigPropsT>;
};

export class ModelopsDeadlineStack extends cdk.Stack {
  #name: string;
  #config: ConfigPropsT;

  constructor(
    scope: Construct,
    id: string,
    props?: ModelopsDeadlineStackPropsT,
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
      throw new Error("AWS_ACCOUNT_ID is required for the Deadline Cloud backend");
    }

    const s3Bucket = this.getS3Bucket();
    const logGroup = this.getLogGroup();

    const farmId = this.getFarmId();
    const queueRole = this.getQueueRole(s3Bucket);
    const fleetRole = this.getFleetRole(s3Bucket, logGroup);
    const queueId = this.getQueueId(farmId, s3Bucket, queueRole);
    const fleetId = this.getFleetId(farmId, fleetRole);
    this.createQueueFleetAssociation(farmId, queueId, fleetId);

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
      logGroupName:
        this.#config.logGroupName || "/deadline/modelops/jobs",
      retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }

  private getS3Bucket() {
    if (this.#config.s3BucketName === null) return null;

    return new cdk.aws_s3.Bucket(this, this.#name + "S3Bucket", {
      bucketName: this.#config.s3BucketName,
    });
  }

  /**
   * Returns the farm ID -- either from config (existing farm) or by
   * creating a new CfnFarm resource.
   */
  private getFarmId(): string {
    if (this.#config.deadlineFarmId) {
      return this.#config.deadlineFarmId;
    }

    const farmName =
      this.#config.deadlineFarmName || `${this.#name}-farm`;

    const farm = new cdk.aws_deadline.CfnFarm(
      this,
      this.#name + "Farm",
      {
        displayName: farmName,
        description: `Deadline Cloud farm for ${this.#name}`,
      },
    );

    return farm.attrFarmId;
  }

  /**
   * Returns the queue ID -- either from config (existing queue) or by
   * creating a new CfnQueue resource linked to the S3 bucket.
   */
  private getQueueId(
    farmId: string,
    s3Bucket: cdk.aws_s3.Bucket | null,
    queueRole: cdk.aws_iam.Role,
  ): string {
    if (this.#config.deadlineQueueId) {
      return this.#config.deadlineQueueId;
    }

    const queueProps: cdk.aws_deadline.CfnQueueProps = {
      displayName: `${this.#name}-queue`,
      farmId,
      roleArn: queueRole.roleArn,
      ...(s3Bucket
        ? {
            jobAttachmentSettings: {
              s3BucketName: s3Bucket.bucketName,
              rootPrefix: "job-attachments",
            },
          }
        : {}),
    };

    const queue = new cdk.aws_deadline.CfnQueue(
      this,
      this.#name + "Queue",
      queueProps,
    );

    return queue.attrQueueId;
  }

  /**
   * Returns the fleet ID -- either from config (existing fleet) or by
   * creating a new service-managed CfnFleet.
   */
  private getFleetId(
    farmId: string,
    fleetRole: cdk.aws_iam.Role,
  ): string {
    if (this.#config.deadlineFleetId) {
      return this.#config.deadlineFleetId;
    }

    const workerScript = renderWorkerScript({
      region: this.#config.region,
      accountId: this.#config.account!,
      image: this.#config.image,
      tag: this.#config.tag,
    });

    const fleet = new cdk.aws_deadline.CfnFleet(
      this,
      this.#name + "Fleet",
      {
        displayName: `${this.#name}-fleet`,
        farmId,
        roleArn: fleetRole.roleArn,
        maxWorkerCount: this.#config.deadlineFleetMax,
        minWorkerCount: this.#config.deadlineFleetMin,
        configuration: {
          serviceManagedEc2: {
            instanceCapabilities: {
              cpuArchitectureType: "x86_64",
              memoryMiB: { min: 4096 },
              osFamily: "LINUX",
              vCpuCount: { min: 4 },
              rootEbsVolume: {
                sizeGiB: this.#config.jobEphemeralStorage,
              },
            },
            instanceMarketOptions: {
              type: "on-demand",
            },
          },
        },
        hostConfiguration: {
          scriptBody: workerScript,
        },
      },
    );

    return fleet.attrFleetId;
  }

  /**
   * Creates the queue-fleet association so the queue routes work to the
   * fleet.
   */
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
   * IAM role assumed by the queue -- grants S3 access for job attachments.
   */
  private getQueueRole(s3Bucket: cdk.aws_s3.Bucket | null) {
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

    if (s3Bucket) {
      role.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

    return role;
  }

  /**
   * IAM role assumed by fleet workers -- grants CloudWatch logging, S3
   * access, and ECR pull permissions (private repo + Marketplace).
   */
  private getFleetRole(
    s3Bucket: cdk.aws_s3.Bucket | null,
    logGroup: cdk.aws_logs.LogGroup,
  ) {
    const role = new cdk.aws_iam.Role(
      this,
      this.#name + "FleetRole",
      {
        assumedBy: new cdk.aws_iam.CompositePrincipal(
          new cdk.aws_iam.ServicePrincipal("deadline.amazonaws.com"),
          new cdk.aws_iam.ServicePrincipal("credentials.deadline.amazonaws.com"),
        ),
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

    // S3 access
    if (s3Bucket) {
      role.addToPolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
          resources: [s3Bucket.bucketArn, `${s3Bucket.bucketArn}/*`],
        }),
      );
    }

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

}
