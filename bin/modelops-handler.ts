#!/usr/bin/env node

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { ModelopsOnAwsStack } from "../lib/modelops-handler";
import { ModelopsEksStack } from "../lib/modelops-eks-stack";
import { ModelopsDeadlineStack } from "../lib/modelops-deadline-stack";
import { getConfig } from "../lib/config";

const config = getConfig(process.env.MODELOPS_CONFIG);

const app = new cdk.App();

const env = {
  account: config.account,
  region: config.region,
};

// Support "batch", "eks", or "deadline" for compute backend
if (config.computeBackend === "deadline") {
  new ModelopsDeadlineStack(app, config.stackName + "Deadline", {
    env,
    config,
  });
} else if (config.computeBackend === "eks") {
  new ModelopsEksStack(app, config.stackName + "Eks", {
    env,
    config,
  });
} else {
  new ModelopsOnAwsStack(app, config.stackName, {
    env,
    config,
  });
}
