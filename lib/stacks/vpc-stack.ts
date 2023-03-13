import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs'
import * as ec2 from "aws-cdk-lib/aws-ec2";

interface vpcProps extends cdk.StackProps {
  projectRssPrefix: string
  cidr: string
  natGateways: number
  maxAzs: number
}


export class VpcStack extends cdk.Stack {
  public vpc: ec2.Vpc

  constructor(scope: Construct, id: string, props: vpcProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, props.projectRssPrefix+id+'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.cidr),
      defaultInstanceTenancy: ec2.DefaultInstanceTenancy.DEFAULT,
      maxAzs: props.maxAzs ?? 1,
      natGateways: props.natGateways ?? 0,
      subnetConfiguration: [
          {
              cidrMask: 27,
              name: 'Private - Application',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
          },
          {
              cidrMask: 27,
              name: 'public',
              subnetType: ec2.SubnetType.PUBLIC,
          }
      ]
    });

    const publicNetworkACL = new ec2.NetworkAcl(this, props.projectRssPrefix+id+'PublicNetworkACL', {
      vpc: this.vpc,
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
    })

    /**
     * Some possible NACL rules should they be necessary
     * NACL rules have worse performace the security groups so use them only the last line of defense
     */

    publicNetworkACL.addEntry('AllowIngress', {
      cidr: ec2.AclCidr.anyIpv4(),
      ruleNumber: 10,
      traffic: ec2.AclTraffic.allTraffic(),
      direction: ec2.TrafficDirection.INGRESS,
      ruleAction: ec2.Action.ALLOW,
    })

    publicNetworkACL.addEntry('AllowEgress', {
      cidr: ec2.AclCidr.anyIpv4(),
      ruleNumber: 11,
      traffic: ec2.AclTraffic.allTraffic(),
      direction: ec2.TrafficDirection.EGRESS,
      ruleAction: ec2.Action.ALLOW,
    })


    // publicNetworkACL.addEntry('AllowCIDRIngress', {
    //   cidr: ec2.AclCidr.ipv4(props.cidr),
    //   ruleNumber: 20,
    //   traffic: ec2.AclTraffic.allTraffic(),
    //   direction: ec2.TrafficDirection.INGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })

    // publicNetworkACL.addEntry('AllowCIDREgress', {
    //   cidr: ec2.AclCidr.ipv4(props.cidr),
    //   ruleNumber: 21,
    //   traffic: ec2.AclTraffic.allTraffic(),
    //   direction: ec2.TrafficDirection.EGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })


    // publicNetworkACL.addEntry('AllowIngressNonSSL', {
    //   cidr: ec2.AclCidr.anyIpv4(),
    //   ruleNumber: 30,
    //   traffic: ec2.AclTraffic.tcpPort(80),
    //   direction: ec2.TrafficDirection.INGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })

    // publicNetworkACL.addEntry('AllowIngressSSL', {
    //   cidr: ec2.AclCidr.anyIpv4(),
    //   ruleNumber: 31,
    //   traffic: ec2.AclTraffic.tcpPort(443),
    //   direction: ec2.TrafficDirection.INGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })

    // publicNetworkACL.addEntry('AllowEgressNonSSL', {
    //   cidr: ec2.AclCidr.anyIpv4(),
    //   ruleNumber: 32,
    //   traffic: ec2.AclTraffic.tcpPort(80),
    //   direction: ec2.TrafficDirection.EGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })

    // publicNetworkACL.addEntry('AllowEgressSSL', {
    //   cidr: ec2.AclCidr.anyIpv4(),
    //   ruleNumber: 33,
    //   traffic: ec2.AclTraffic.tcpPort(443),
    //   direction: ec2.TrafficDirection.EGRESS,
    //   ruleAction: ec2.Action.ALLOW,
    // })


}
}
