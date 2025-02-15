#!/usr/bin/env node

import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { ModelopsOnAwsStack } from "../lib/modelops-handler";
import { getConfig } from "../lib/config";

const config = getConfig(process.env.MODELOPS_CONFIG);

const app = new cdk.App();

new ModelopsOnAwsStack(app, config.stackName, {
  env: {
    account: config.account,
    region: config.region,
  },

  config,
});
