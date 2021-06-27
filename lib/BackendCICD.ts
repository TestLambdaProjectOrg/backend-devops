import * as cdk from '@aws-cdk/core';
import { Artifact, Pipeline } from '@aws-cdk/aws-codepipeline';
import {
    BuildEnvironment,
    BuildEnvironmentVariable,
    BuildEnvironmentVariableType,
    BuildSpec,
    LinuxBuildImage,
    PipelineProject,
} from '@aws-cdk/aws-codebuild';
import {
    CloudFormationCreateUpdateStackAction,
    CodeBuildAction,
    CodeStarConnectionsSourceAction,
    ManualApprovalAction,
} from '@aws-cdk/aws-codepipeline-actions';
import { CfnParametersCode } from '@aws-cdk/aws-lambda';
import BackendStack from './BackendStack';
import Environment from './Environment';

type StackInfo = {
    lambdaCode: CfnParametersCode;
    apiURL: string;
}

interface BackendCICDPipelineProps extends cdk.StackProps {
    ppdStack: StackInfo;
    prdStack: StackInfo
}

class BackendCICDPipeline extends cdk.Stack {
    constructor(
        scope: cdk.Construct,
        id: string,
        props?: BackendCICDPipelineProps,
    ) {
        super(scope, id, props);

        // const { ppdStack, prdStack } = props;

        // Source code - Github
        const lambdaSourceOutput = new Artifact();
        const codeStarAction = new CodeStarConnectionsSourceAction({
            actionName: 'CheckoutFromGithub',
            // eslint-disable-next-line max-len
            connectionArn: 'arn:aws:codestar-connections:us-east-1:502192330072:connection/8dafd691-9f69-4553-a212-735cb6810389',
            output: lambdaSourceOutput,
            owner: 'TestLambdaProjectOrg',
            repo: 'backend',
            branch: 'main',
        });

        const cdkSourceOutput = new Artifact();
        const cdkCodeStarAction = new CodeStarConnectionsSourceAction({
            actionName: 'CheckoutFromGithub',
            // eslint-disable-next-line max-len
            connectionArn: 'arn:aws:codestar-connections:us-east-1:502192330072:connection/8dafd691-9f69-4553-a212-735cb6810389',
            output: cdkSourceOutput,
            owner: 'TestLambdaProjectOrg',
            repo: 'backend-devops',
            branch: 'main',
        });

        // CDK Pipeline Stack - Preproduction
        const cdkBuildOutputPPD = new Artifact('CdkBuildOutputPPD');
        const cdkBuildProjectPPD = this.getCdkBuild(Environment.PPD);
        const cdkBuildActionPPD = new CodeBuildAction({
            actionName: 'CDKPPD_BuildAction',
            project: cdkBuildProjectPPD,
            input: cdkSourceOutput,
            outputs: [cdkBuildOutputPPD],
        });

        // CDK Pipeline Stack - Production
        const cdkBuildOutputPRD = new Artifact('CdkBuildOutputPRD');
        const cdkBuildProjectPRD = this.getCdkBuild(Environment.PRD);
        const cdkBuildActionPRD = new CodeBuildAction({
            actionName: 'CDKPRD_BuildAction',
            project: cdkBuildProjectPRD,
            input: cdkSourceOutput,
            outputs: [cdkBuildOutputPRD],
        });

        // TestBackend Lambda Stack - Preproduction
        const testBackendBuildOutputPPD = new Artifact('TestBackendBuildOutputPPD');
        const testBackendBuildProjectPPD = this.getGoLambdaBuild(
            Environment.PPD,
            'TestBackend',
            '',
            'testbackend',
        );
        const testBackendBuildActionPPD = new CodeBuildAction({
            actionName: 'TestBackendPPD_BuildAction',
            project: testBackendBuildProjectPPD,
            input: lambdaSourceOutput,
            outputs: [testBackendBuildOutputPPD],
        });

        // TestBackend Lambda Stack - Production
        const testBackendBuildOutputPRD = new Artifact('TestBackendBuildOutputPRD');
        const testBackendBuildProjectPRD = this.getGoLambdaBuild(
            Environment.PRD,
            'TestBackend',
            '',
            'testbackend',
        );
        const testBackendBuildActionPRD = new CodeBuildAction({
            actionName: 'TestBackend_BuildAction',
            project: testBackendBuildProjectPRD,
            input: lambdaSourceOutput,
            outputs: [testBackendBuildOutputPRD],
        });

        // Deployment - Preproduction
        const templateArtifactPathPPD = testBackendBuildOutputPPD.atPath(
            // eslint-disable-next-line max-len
            `${BackendStack.STACK_NAME}${Environment.PPD}.template.json`,
        );
        const deployActionPPD = new CloudFormationCreateUpdateStackAction({
            actionName: 'TestBackend_Cfn_Deploy',
            templatePath: templateArtifactPathPPD,
            parameterOverrides: {
                // ...ppdStack.lambdaCode.assign(testBackendBuildOutputPPD.s3Location),
            },
            stackName: `${BackendStack.STACK_NAME}${Environment.PPD}`,
            adminPermissions: true,
            extraInputs: [testBackendBuildOutputPPD],
        });

        // Deployment - Production
        const templateArtifactPathPRD = testBackendBuildOutputPRD.atPath(
            // eslint-disable-next-line max-len
            `${BackendStack.STACK_NAME}${Environment.PRD}.template.json`,
        );
        const deployActionPRD = new CloudFormationCreateUpdateStackAction({
            actionName: 'TestBackend_Cfn_Deploy',
            templatePath: templateArtifactPathPRD,
            parameterOverrides: {
                // ...prdStack.lambdaCode.assign(testBackendBuildOutputPRD.s3Location),
            },
            stackName: `${BackendStack.STACK_NAME}${Environment.PRD}`,
            adminPermissions: true,
            extraInputs: [testBackendBuildOutputPRD],
        });

        const pipeline = new Pipeline(this, 'BackendCICDPipeline', {
            crossAccountKeys: false,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        codeStarAction,
                        cdkCodeStarAction,
                    ],
                },
                {
                    stageName: 'Build-PPD',
                    actions: [
                        testBackendBuildActionPPD,
                        cdkBuildActionPPD,
                    ],
                },
                {
                    stageName: 'Deploy-PPD',
                    actions: [
                        deployActionPPD,
                        new ManualApprovalAction({
                            actionName: 'DeployBackendToProductionApproval',
                            additionalInformation: 'Ready to deploy to Production?',
                            // externalEntityLink: ppdStack.apiURL,
                            runOrder: 2,
                        }),
                    ],
                },
                {
                    stageName: 'Build-PRD',
                    actions: [
                        testBackendBuildActionPRD,
                        cdkBuildActionPRD,
                    ],
                },
                {
                    stageName: 'Deploy-PRD',
                    actions: [
                        deployActionPRD,
                    ],
                },
            ],
        });
    }

    private getCdkBuild(appEnv: Environment): PipelineProject {
        const buildSpec = BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    commands: 'npm install',
                },
                build: {
                    commands: [
                        'npm run build',
                        'npm run cdk synth -- -o dist',
                    ],
                },
            },
            artifacts: {
                'base-directory': 'dist',
                files: [
                    // eslint-disable-next-line max-len
                    `${BackendStack.STACK_NAME}${appEnv}.template.json`,
                ],
            },
        });

        const environment: BuildEnvironment = {
            buildImage: LinuxBuildImage.STANDARD_5_0,
            environmentVariables: {
                APP_ENV: {
                    value: appEnv,
                    type: BuildEnvironmentVariableType.PLAINTEXT,
                },
            },
        };

        return new PipelineProject(this, `CDKBuildProject${appEnv}`, {
            buildSpec,
            environment,
        });
    }

    private getGoLambdaBuild(
        appEnv: Environment,
        lambdaFnName: string,
        baseDirectory: string,
        outputFileName: string,
        variables: { [index: string]: BuildEnvironmentVariable } = {},
    ): PipelineProject {
        const buildSpec = BuildSpec.fromObject({
            version: '0.2',
            phases: {
                install: {
                    commands: [
                        `cd ${baseDirectory}`,
                        'go get ./...',
                    ],
                },
                build: {
                    commands: [
                        `go build -o ${outputFileName}`,
                    ],
                },
            },
            artifacts: {
                'base-directory': baseDirectory,
                files: [
                    outputFileName,
                ],
            },
        });

        const environmentVariables = {
            APP_ENV: {
                value: appEnv,
                type: BuildEnvironmentVariableType.PLAINTEXT,
            },
            ...variables,
        };

        return new PipelineProject(this, `${lambdaFnName}${appEnv}-LambdaBuild`, {
            buildSpec,
            environment: {
                buildImage: LinuxBuildImage.STANDARD_2_0,
                environmentVariables,
            },
        });
    }
}

export default BackendCICDPipeline;