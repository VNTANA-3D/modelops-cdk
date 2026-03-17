import * as cdk from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import type { ConfigPropsT } from "./config";

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
    const queueRole = this.getQueueRole();
    const queueId = this.getQueueId(farmId, queueRole);
    const fleetId = this.getFleetId();
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

    new cdk.CfnOutput(this, this.#name + "ProxyRoleArn", {
      value: proxyRole.roleArn,
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
   * Returns the existing SPDA fleet ID from config.
   *
   * WORKAROUND: The SPDA fleet (spatial-data-management-main-fleet) is managed
   * by SPDA, not by this stack. We reference it by ID and update its host
   * configuration script separately via the AWS CLI. See
   * scripts/update-spda-fleet-host-config.sh for details.
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
