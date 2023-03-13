import * as cdk from 'aws-cdk-lib';
import { GraylogStack } from './stacks/graylog-stack';
import { ApplicationStack } from './stacks/application-stack';
import { MongoStack } from './stacks/mongo-stack';
import { OpensearchStack } from './stacks/opensearch-stack';
import { VpcStack } from './stacks/vpc-stack';
import { ServiceCommonStack } from './stacks/service-common-stack';

interface envProps extends cdk.StackProps {
  region: string;
  cidr: string;
  projectRssPrefix: string;
  externalAccessIP: string;
  sshKeyName: string;
}

export class Environment extends cdk.Stack  {
  vpc: VpcStack
  graylog: GraylogStack
  nginx: ApplicationStack
  mongo: MongoStack
  opensearch: OpensearchStack
  serviceCommon: ServiceCommonStack

  constructor(scope: cdk.App, id: string, props: envProps) {
    super(scope, id, props)


    /** Create basic VPC */
    this.vpc = new VpcStack(this, 'Vpc', {
      projectRssPrefix:     props.projectRssPrefix,
      cidr: props.          cidr,
      natGateways:          1,
      maxAzs:               2
    })


    /** Prep common mongodb resources */
    this.mongo = new MongoStack(this, 'MongoDB', {
      projectRssPrefix:     props.projectRssPrefix,
      vpc:                  this.vpc.vpc,
      externalAccessIP:     props.externalAccessIP,
      sshKeyName:           props.sshKeyName,
      cidr:                 props.cidr,
      clusterSize:          3
    })
    this.mongo.addDependency(this.vpc)


    this.serviceCommon = new ServiceCommonStack(this, 'ServiceCommon', {
      projectRssPrefix:     props.projectRssPrefix,
      vpc:                  this.vpc.vpc
    })
    this.serviceCommon.addDependency(this.vpc)
  

    this.opensearch = new OpensearchStack(this, 'Opensearch', {
      projectRssPrefix:     props.projectRssPrefix,
      vpc:                  this.vpc.vpc,
      ecsServiceSG:         this.serviceCommon.ecsServiceSG,
    })


    /** 
     * Deploy Graylog to Fargate
     * After initial setup of GELF UDP input, you can send a test message below from the internal IP range, enable publicIP assignemnt and send the message to currect port directly:
     * echo '{"version": "1.1","host":"example.com","short_message":"If you see me, it works just fine!","full_message":"Backtrace here\n\nmore stuff","level":1,"_user_id":9001,"_some_info":"foo","_some_env_var":"bar"}' | gzip | nc -u -w 1 10.0.10.51 12201
     */
    this.graylog = new GraylogStack(this, 'GraylogEcsTask', {
      projectRssPrefix:     props.projectRssPrefix,
      mongoCluster:         this.mongo.mongoClusterGraylogConnectionString,
      openSearchEndpoint:   this.opensearch.openSearch.domainEndpoint,
      vpc:                  this.vpc.vpc,
      ecsCluster:           this.serviceCommon.ecsCluster,
      ecsServiceSG:         this.serviceCommon.ecsServiceSG,
      ecsServiceRole:       this.serviceCommon.ecsServiceRole,
      ecsServiceAlbSG:      this.serviceCommon.ecsServiceAlbSG,
      externalAccessIP:     props.externalAccessIP,
      cidr:                 props.cidr,
      cpu:                  512,
      memoryLimitMiB:       1024,
      autoScalingMaxCap:    3,
      autoScalingMinCap:    1,
      webGUIPort:           80
    })
    this.graylog.addDependency(this.vpc)


    /** Deploy Nginx to Fargate */
    this.nginx = new ApplicationStack(this, 'NginxEcsTask', {
      projectRssPrefix:     props.projectRssPrefix,
      vpc:                  this.vpc.vpc,
      ecsCluster:           this.serviceCommon.ecsCluster,
      ecsServiceSG:         this.serviceCommon.ecsServiceSG,
      ecsServiceRole:       this.serviceCommon.ecsServiceRole,
      ecsServiceAlbSG:      this.serviceCommon.ecsServiceAlbSG,
      externalAccessIP:     props.externalAccessIP,
      cidr:                 props.cidr,
      image:                "nginx",
      envVars:              {},
      containerPortsMap:    [80, 1514, 9200, 12201],
      internalIngressPorts: [80, 1514, 9200, 12201],
      publicIngressPorts:   [80],
      autoScalingMaxCap:    3,
      autoScalingMinCap:    1,
      targetGroupPort:      80,
      listenerPort:         80,
      entrypoint:           ["nginx", "-g", "daemon off;error_log /dev/stdout debug;"],
      grayALBAddress:       this.graylog.graylogEndpointAddress,
      gelfUDPPort:          "12201",
      assignPublicIP:       true
    })
    this.nginx.addDependency(this.vpc)
    this.nginx.addDependency(this.graylog)


  }
}
