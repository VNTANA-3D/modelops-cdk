#!/usr/bin/env node

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { ModelopsOnAwsStack } from "../lib/modelops-on-aws-stack";
import { getConfig } from "../lib/config";

const config = getConfig(process.env.MODELOPS_CONFIG);

const app = new cdk.App();

new ModelopsOnAwsStack(app, "ModelopsOnAwsStack", {
  env: {
    account: config.account,
    region: config.region,
  },

  config,
});
