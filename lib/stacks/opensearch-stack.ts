import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs'
import {
    CfnResource,
    aws_iam as iam,
    aws_ec2 as ec2,
    aws_opensearchservice as opensearch
} from 'aws-cdk-lib';

interface opensearchProps extends cdk.StackProps {
  projectRssPrefix: string,
  vpc: ec2.Vpc,
  ecsServiceSG: ec2.SecurityGroup
  nodeInstanceType?: string
  masterInstanceType?: string
  masterNodes?: number
  dataNodes?: number
  availabilityZoneCount?: number
  ebsVolumeSize?: number
}

export class OpensearchStack extends cdk.Stack {
  openSearch: opensearch.Domain
  
    constructor(scope: Construct, id: string, props: opensearchProps) {
    super(scope,id,props)

    const opensearchSG = new ec2.SecurityGroup(this, props.projectRssPrefix+'sg', {
        vpc: props.vpc,
        allowAllOutbound: true,
    });
    
    opensearchSG.connections.allowFrom(props.ecsServiceSG, ec2.Port.allTcp())

    /**
     * Cretion of service linked role is needed only once. This option is kinda unreliable and done easier via AWS CLI
     * >> aws iam create-service-linked-role --aws-service-name es.amazonaws.com
     * 
     * If you decide to go the CDK way, do not forget to also uncomment the line 85
     */
    // const slr = new iam.CfnServiceLinkedRole(this, 'ServiceLinkedRole', {
    //   awsServiceName: 'es.amazonaws.com',
    // });

    this.openSearch = new opensearch.Domain(this, props.projectRssPrefix+"-"+id+"-"+'opensearch', {
      version: opensearch.EngineVersion.ELASTICSEARCH_7_10,
      domainName: `graylog-opensearch`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // By default Opensearch does not get deleted, which is basically wanted behaviour, except for testing.
      vpc: props.vpc,
      vpcSubnets: [{
        subnets: [
          props.vpc.privateSubnets[0]
        ]}
      ],
      securityGroups: [opensearchSG],
      enableVersionUpgrade: false,
      enforceHttps: true,
      nodeToNodeEncryption: true,
      useUnsignedBasicAuth: true,
      capacity: {
          masterNodes: props.masterNodes ?? 2,
          dataNodes: props.dataNodes ?? 1,
          masterNodeInstanceType: props.masterInstanceType ?? 't3.small.search',
          dataNodeInstanceType: props.nodeInstanceType ?? 't3.small.search',
      },
      fineGrainedAccessControl: {
        masterUserName: "graylogusr",
        masterUserPassword: cdk.SecretValue.unsafePlainText("graylog-PWD1")
      },
      accessPolicies: [
        new iam.PolicyStatement({
          actions: ['es:*'],
          principals: [new iam.AnyPrincipal()],
          effect: iam.Effect.ALLOW,
          resources: ['*'],
        }),
      ],
    });

    this.openSearch.masterUserPassword

    /**
     * Dependency for Service Linked Role
     */
    // this.openSearch.node.addDependency(slr)

  }
}

