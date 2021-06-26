#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import Environment from '../lib/Environment';
import BackendStack from '../lib/BackendStack';
import BackendCICD from '../lib/BackendCICD';

const app = new cdk.App();

const ppdStack = new BackendStack(
  app,
  `${BackendStack.STACK_NAME}${Environment.PPD}`,
  {
  //   env: { region: 'us-east-1' },
    appEnv: Environment.PPD,
  },
);

const prdStack = new BackendStack(
  app,
  `${BackendStack.STACK_NAME}${Environment.PRD}`,
  {
  //   env: { region: 'us-east-1' },
    appEnv: Environment.PRD,
  },
);

// eslint-disable-next-line no-new
new BackendCICD(
  app,
  'BackendCICDStack',
  {
    ppdStack: {
      lambdaCode: ppdStack.testBackendHandlerCode,
      apiURL: ppdStack.httpApi.url!,
    },
    prdStack: {
      lambdaCode: prdStack.testBackendHandlerCode,
      apiURL: prdStack.httpApi.url!,
    },
  },
);

app.synth();