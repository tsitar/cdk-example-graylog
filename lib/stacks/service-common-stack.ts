import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";

interface ServiceCommonProps extends cdk.StackProps {
    projectRssPrefix: string
    vpc: ec2.Vpc
}
  
  
export class ServiceCommonStack extends cdk.Stack {
    ecsCluster: ecs.Cluster
    ecsServiceSG: ec2.SecurityGroup
    ecsServiceRole: iam.Role
    ecsServiceAlbSG: ec2.SecurityGroup

    constructor(scope: Construct, id: string, props: ServiceCommonProps) {
    super(scope, id, props);

        this.ecsCluster = new ecs.Cluster(this, props.projectRssPrefix+"Cluster", {
            vpc: props.vpc,
            containerInsights: false
        });

        this.ecsServiceRole = new iam.Role(this, props.projectRssPrefix+id+"TaskRole", {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonECSTaskExecutionRolePolicy"
                ),
            ],
        });

        this.ecsServiceSG = new ec2.SecurityGroup(this, props.projectRssPrefix+id+"SG", {
            vpc: props.vpc,
            allowAllOutbound: true,
        });

        this.ecsServiceAlbSG = new ec2.SecurityGroup(this, props.projectRssPrefix+id+"AlbSG", {
            vpc: props.vpc,
            allowAllOutbound: true,
        });

    }
}