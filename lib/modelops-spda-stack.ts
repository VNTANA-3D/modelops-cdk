import { existsSync, readFileSync } from "fs";
import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";
import { PolicyDocument } from "./validators";
import { renderWorkerScript, buildEcrRepoArn } from "./deadline-utils";

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
   * Creates the fleet — always creates, no skip logic.
   */
  private getFleetId(
    farmId: string,
    fleetRole: cdk.aws_iam.Role,
  ): string {
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
        displayName: `${this.#name}-spda-fleet`,
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
