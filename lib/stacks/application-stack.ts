import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam
} from 'aws-cdk-lib';
import { Subnet } from 'aws-cdk-lib/aws-ec2';
import { ProductStack } from 'aws-cdk-lib/aws-servicecatalog';


interface ApplicationStackProps extends cdk.StackProps {
  projectRssPrefix: string
  vpc: ec2.Vpc
  ecsCluster: ecs.Cluster
  ecsServiceSG: ec2.SecurityGroup
  ecsServiceRole: iam.Role
  ecsServiceAlbSG: ec2.SecurityGroup
  externalAccessIP: string
  cidr: string
  image: string
  containerPortsMap: Array<number>
  internalIngressPorts: Array<number>
  publicIngressPorts: Array<number>
  autoScalingMaxCap: number
  autoScalingMinCap: number
  targetGroupPort: number
  listenerPort: number
  grayALBAddress: string
  gelfUDPPort: string
  assignPublicIP: boolean
  entrypoint?: string[]
  command?: string[]
  cpu?: number
  memoryLimitMiB?: number
  envVars?: {}
}


export class ApplicationStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const ecsTaskDefinition = new ecs.TaskDefinition(this, props.projectRssPrefix+id+"AppTD", {
      compatibility: ecs.Compatibility.FARGATE,
      cpu: "1024",
      memoryMiB: "2048",
      networkMode: ecs.NetworkMode.AWS_VPC,
      taskRole: props.ecsServiceRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const ecsAppContainer = ecsTaskDefinition.addContainer(props.projectRssPrefix+id+"AppContainer", {
      image: ecs.ContainerImage.fromRegistry(props.image),
      cpu: props.cpu ?? 256,
      memoryLimitMiB: props.memoryLimitMiB ?? 512,
      environment: props.envVars ?? "",
      entryPoint: props.entrypoint ?? ["/.docker-entrypoint.sh"],
      command: props.command ?? [],
      logging: ecs.LogDrivers.firelens({
        options: {
          Port: props.gelfUDPPort,
          Host: props.grayALBAddress,
          Name: "Gelf",
          Mode: "udp",
          Gelf_Timestamp_Key: "timestamp",
          Gelf_Short_Message_Key: "log",
          Gelf_Host_Key: "host",
          Gelf_Full_Message_Key: "full_message"
        },
      }),
    });


    for(let i=0; i < props.containerPortsMap.length; i++) {
      ecsAppContainer.addPortMappings({containerPort:props.containerPortsMap[i], hostPort:props.containerPortsMap[i]})
    }

    /** Allow all traffic or limit the traffic to the selected external IP and internal range */
    // props.ecsServiceSG.addIngressRule(ec2.Peer.anyIpv4(),ec2.Port.allTraffic());
    for(let i=0; i< props.internalIngressPorts.length; i++){
      props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.cidr),ec2.Port.tcp(props.internalIngressPorts[i]));
      props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.cidr),ec2.Port.udp(props.internalIngressPorts[i]));
    }
    for(let i=0; i< props.publicIngressPorts.length; i++){
      props.ecsServiceSG.addIngressRule(ec2.Peer.ipv4(props.externalAccessIP),ec2.Port.tcp(props.publicIngressPorts[i]));
    }

    /** Allows routing logs to Fluent-bit sidecar which parses the log and forwards it to graylog */
    ecsTaskDefinition.addFirelensLogRouter(props.projectRssPrefix+id+'FireLensLogRouter',  {
      firelensConfig: {
        type: ecs.FirelensLogRouterType.FLUENTBIT,
        options: {
          // configFileType: ecs.FirelensConfigFileType.S3,
          // configFileValue: 'configFileValue',
          enableECSLogMetadata: true,
        },
      },
      portMappings: [{containerPort: 443, hostPort:443},{containerPort: 24224, hostPort:24224}],
      essential: true,
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/aws-observability/aws-for-fluent-bit:latest'),
      logging: new ecs.AwsLogDriver({ streamPrefix: 'gray-firelens' }),
    });

    const ecsAppService = new ecs.FargateService(this, props.projectRssPrefix+id+"AppService", {
      cluster: props.ecsCluster,
      taskDefinition: ecsTaskDefinition,
      desiredCount: 1,
      securityGroups: [props.ecsServiceSG],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      assignPublicIp: props.assignPublicIP,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      enableExecuteCommand: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }
    });
    ecsAppService.autoScaleTaskCount({
      maxCapacity: props.autoScalingMaxCap ?? 2,
      minCapacity: props.autoScalingMinCap ?? 1,
    });

    const ecsAppTargetGroup = new elbv2.ApplicationTargetGroup(this, props.projectRssPrefix+id+"AppTG", {
      targets: [ecsAppService.loadBalancerTarget({
        containerName: ecsAppContainer.containerName,
        containerPort: 80,
      })],
      protocol: elbv2.ApplicationProtocol.HTTP,
      vpc: props.vpc,
      port: props.targetGroupPort,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: "/",
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: "200",
      },

    });

    /** 
     * Allow selected ports to be accessed from the public internet.
     * This option is generally redundant for loadbalanced services as opened listener does automatically create an ingress rule.
    */
    // props.ecsServiceAlbSG.addIngressRule(ec2.Peer.anyIpv4(),ec2.Port.allTraffic());
    // for(let i=0; i< props.publicIngressPorts.length; i++){
    //   props.ecsServiceAlbSG.addIngressRule(ec2.Peer.ipv4(props.externalAccessIP),ec2.Port.tcp(props.publicIngressPorts[i]));
    // }

    const ecsAppAlb = new elbv2.ApplicationLoadBalancer(this, props.projectRssPrefix+id+"AppAlb", {
      vpc: props.vpc,
      vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC
      },
      internetFacing: true,
      deletionProtection: false,
      ipAddressType: elbv2.IpAddressType.IPV4,
      securityGroup: props.ecsServiceAlbSG 
    });
   
    ecsAppAlb.addListener(props.projectRssPrefix+id+"AppListener", {
      defaultTargetGroups: [ecsAppTargetGroup],
      port: props.listenerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });
  }
}
