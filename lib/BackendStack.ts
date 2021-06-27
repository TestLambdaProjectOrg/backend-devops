import { CorsHttpMethod, HttpApi, HttpMethod } from '@aws-cdk/aws-apigatewayv2';
import { LambdaProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { CfnParametersCode, Code, Function, Runtime } from '@aws-cdk/aws-lambda';
import * as cdk from '@aws-cdk/core';
import Environment from './Environment';

interface BackendStackProps extends cdk.StackProps {
  appEnv: Environment;
}

class BackendStack extends cdk.Stack {
  public static readonly STACK_NAME = 'BackendStack';

  public readonly cfnOutputAPI: cdk.CfnOutput;

  private readonly appEnv: Environment;

  public httpApi: HttpApi;

  public testBackendHandlerCode: CfnParametersCode;

  constructor(
    scope: cdk.Construct,
    id: string,
    props: BackendStackProps
  ) {
    super(scope, id, props);

    this.appEnv = props.appEnv;

    this.testBackendHandlerCode = Code.fromCfnParameters();

    const testBackend = new Function(
      this,
      `TestBackendHandler${this.appEnv}`,
      {
        runtime: Runtime.GO_1_X,
        handler: 'testbackend',
        code: this.testBackendHandlerCode,
        environment: {
          APP_ENV: this.appEnv,
        },
      },
    );

    const testBackendIntegration = new LambdaProxyIntegration({
      handler: testBackend,
    });

    this.httpApi = new HttpApi(this, `BackendHttpAPI${this.appEnv}`, {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.GET],
      },
      apiName: 'test-backend-api',
      createDefaultStage: true,
    });

    this.httpApi.addRoutes({
      path: '/',
      methods: [
        HttpMethod.GET,
      ],
      integration: testBackendIntegration,
    });

    this.cfnOutputAPI = new cdk.CfnOutput(
      this,
      `TestBackendAPI${this.appEnv}`, {
      value: this.httpApi.url!,
      exportName: `TestBackendAPIEndpoint${this.appEnv}`,
    },
    );
  }
}

export default BackendStack;
