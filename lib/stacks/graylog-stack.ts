import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam,
  aws_certificatemanager as cert_mgr
} from 'aws-cdk-lib';
import {readFileSync} from 'fs';

interface GraylogStackProps extends cdk.StackProps {
  cidr: string
  projectRssPrefix: string
  mongoCluster: string
  openSearchEndpoint: string
  vpc: ec2.Vpc
  ecsCluster: ecs.Cluster
  ecsServiceSG: ec2.SecurityGroup
  ecsServiceRole: iam.Role
  ecsServiceAlbSG: ec2.SecurityGroup
  externalAccessIP: string
  autoScalingMaxCap: number
  autoScalingMinCap: number
  webGUIPort?: number  
  cpu?: number
  memoryLimitMiB?: number
}


export class GraylogStack extends cdk.Stack {
  graylogEndpointAddress: string

  constructor(scope: Construct, id: string, props: GraylogStackProps) {
    super(scope, id, props);

    const ecsGrayTaskDefinition = new ecs.TaskDefinition(this, props.projectRssPrefix+id+"TD", {
      compatibility: ecs.Compatibility.FARGATE,
      cpu: "1024",
      memoryMiB: "2048",
      networkMode: ecs.NetworkMode.AWS_VPC,
      taskRole: props.ecsServiceRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    /**
     * Graylog initial inputs configuration could be expanded to contain streams and other parameters
     * readFileSync creates new lines chars that break the json on echo command 
     */
    const graylogSettings = readFileSync('./data//graylogSettings.json', 'utf8').replace(/\n/gi,"");
    let ecsCommand:string = "mkdir -p 'data/contentpacks/' && echo '"+graylogSettings+"' > 'data/contentpacks/inputs-setup.json' && /docker-entrypoint.sh"

    const ecsGrayContainer = ecsGrayTaskDefinition.addContainer(props.projectRssPrefix+id+"Container", {
      image: ecs.ContainerImage.fromRegistry("graylog/graylog:5.0"),
      cpu: props.cpu ?? 256,
      memoryLimitMiB: props.memoryLimitMiB ?? 512,
      environment: {
        "GRAYLOG_HTTP_BIND_ADRESS":"0.0.0.0:9000",
        "GRAYLOG_PASSWORD_SECRET": "O5Y308lJ9DBO232pF7cPQTG1lbFQMIyHMvZHKhhPVTOp42HOo2egBSt1nNnUi7O9YtGaDdkahjilRbzci2Ew1BsAiOTlqHYZ",
        "GRAYLOG_ROOT_PASSWORD_SHA2":"8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
        "GRAYLOG_MONGODB_URI":"mongodb://gray:gray@"+props.mongoCluster+"/graylog",
        "GRAYLOG_HTTP_ENABLE_CORS":"true",
        "GRAYLOG_ALLOW_LEADING_WILDCARD_SEARCHES": "true",
        "GRAYLOG_ELASTICSEARCH_SHARDS":"1",
        "GRAYLOG_ELASTICSEARCH_REPLICAS":"0",
        "GRAYLOG_ELASTICSEARCH_HOSTS": 'https://graylogusr:graylog-PWD1@'+props.openSearchEndpoint+':443/',
        "GRAYLOG_CONTENT_PACKS_LOADER_ENABLED": "true",
        "GRAYLOG_CONTENT_PACKS_DIR": "data/contentpacks",
        "GRAYLOG_CONTENT_PACKS_AUTO_INSTALL": "inputs-setup.json"
      },
      entryPoint: ["/bin/sh","-c",ecsCommand],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: id+"Logs"
      })
    });


    /** Ports used by graylog for logging, management and user access */
    let graylogServicePorts:Array<number> = [9000,80,443,1514,9200,12201,27017];
    for(let i=0; i < graylogServicePorts.length; i++) {
      ecsGrayContainer.addPortMappings({containerPort:graylogServicePorts[i], hostPort:graylogServicePorts[i]})
    }

    /** Open ports in the service securitry group */
    let internalIngressPorts:Array<number> = [443,80,1514,9000,9200,12201,27017];
    for(let i=0; i< internalIngressPorts.length; i++){
      props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.cidr),ec2.Port.tcp(internalIngressPorts[i]));
      props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.cidr),ec2.Port.udp(internalIngressPorts[i]));
    }
    props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.externalAccessIP),ec2.Port.allTraffic());

    const ecsService = new ecs.FargateService(this, props.projectRssPrefix+id+"Service", {
      cluster: props.ecsCluster,
      taskDefinition: ecsGrayTaskDefinition,
      desiredCount: 1,
      securityGroups: [props.ecsServiceSG],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: false,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: true,
    });
    ecsService.autoScaleTaskCount({
      maxCapacity: props.autoScalingMaxCap ?? 2,
      minCapacity: props.autoScalingMinCap ?? 1,
    });

    /** Could be set to create one listener per necessary logging port */
    const ecsInternalLB = new elbv2.NetworkLoadBalancer(this,props.projectRssPrefix+id+"IntLB",{
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      internetFacing: false,
      deletionProtection: false,
    })

    const internalListener = ecsInternalLB.addListener(props.projectRssPrefix+id+'IntListener', {
      port: 12201,
      protocol: elbv2.Protocol.UDP,
    });

    internalListener.addTargets(props.projectRssPrefix+id+'IntTG', {
      port: 12201,
      protocol: elbv2.Protocol.UDP,
      targets: [ecsService.loadBalancerTarget({
        containerName: ecsGrayContainer.containerName,
        containerPort: 12201,
      })],
      healthCheck: {
        port: "9000",
        protocol: elbv2.Protocol.TCP,
        healthyThresholdCount: 3,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(30)
      }
    });

    /** Assign LB's DNS name to a variable and pass it to applications */
    this.graylogEndpointAddress = ecsInternalLB.loadBalancerDnsName

    /** Allow access from selected external IP address or allow global access */
    // props.ecsServiceAlbSG.addIngressRule(ec2.Peer.anyIpv4(),ec2.Port.allTraffic());
    props.ecsServiceAlbSG.addIngressRule(ec2.Peer.ipv4(props.externalAccessIP),ec2.Port.tcp(props.webGUIPort ?? 80));


    const ecsGrayTargetGroup = new elbv2.ApplicationTargetGroup(this, props.projectRssPrefix+id+"TG", {
      targets: [ecsService],
      protocol: elbv2.ApplicationProtocol.HTTP,
      vpc: props.vpc,
      port: 9000,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: "/",
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(15),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: "200",
      }
    });

    const ecsGrayAlb = new elbv2.ApplicationLoadBalancer(this, props.projectRssPrefix+id+"alb", {
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      internetFacing: true,
      deletionProtection: false,
      ipAddressType: elbv2.IpAddressType.IPV4,
      securityGroup: props.ecsServiceAlbSG 
    });

    /** You can set your own domain and provide a cert to allow secure connection */
    // const cert = new cert_mgr.Certificate(this, "MyCertificate", {
    //   domainName: 'example.com',
    //   subjectAlternativeNames: ['*.example.com'],
    //   validation: cert_mgr.CertificateValidation.fromDns(),
    // });

    ecsGrayAlb.addListener(props.projectRssPrefix+id+"listener", {
      defaultTargetGroups: [ecsGrayTargetGroup],
      port: props.webGUIPort ?? 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      // protocol: elbv2.ApplicationProtocol.HTTPS,
      // certificates: cert,
      // redirectHTTP: true,
    });
  }
}
