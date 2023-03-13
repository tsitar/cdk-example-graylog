import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {readFileSync} from 'fs';

interface MongoProps extends cdk.StackProps {
  projectRssPrefix: string;
  vpc: ec2.Vpc;
  externalAccessIP: string;
  sshKeyName: string;
  cidr: string;
  clusterSize: number

}

export class MongoStack extends cdk.Stack {
  public mongoRole: iam.Role
  public mongoSG: ec2.SecurityGroup
  public mongoClusterGraylogConnectionString: string

  constructor(scope: Construct, id: string, props: MongoProps) {
    super(scope, id, props);

    /** Create security group and add necessary rules */
    const mongoSG = new ec2.SecurityGroup(this, props.projectRssPrefix+'mongo-sg', {
      vpc: props.vpc,
      allowAllOutbound: true,
    });
    mongoSG.addIngressRule(ec2.Peer.ipv4(props.cidr), ec2.Port.tcp(27017), 'allow access to mongoDB EC2 from internal ip range');
    
    /** For testing purposes, opened only from specified IP */
    //mongoSG.addIngressRule(ec2.Peer.ipv4(props.externalAccessIP), ec2.Port.tcp(22), 'allow SSH access from external IP');

    /** Create role with permissions to operate ec2 */
    const mongoRole = new iam.Role(this, props.projectRssPrefix+'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });

    /** Allows connection from the AWS Console, works as an safer, but less convenient, alternative to direct SSH connection */
    // mongoRole.addManagedPolicy(
    //   iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    // )

    /** Read init script to variable */
    const initScript = readFileSync('./data//mongo-init.sh', 'utf8');

    /** Instantiate array of secondary nodes */
    let instanceSecondaryArray: Array<ec2.Instance> = [];
    for(let i=1; i <= props.clusterSize-1; i++) {

      const mongoInstance = new ec2.Instance(this, props.projectRssPrefix+id+'Id'+i, {
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        role: mongoRole,
        securityGroup: mongoSG,
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T2,
          ec2.InstanceSize.NANO,
        ),
        keyName: props.sshKeyName,
        machineImage: new ec2.AmazonLinuxImage({
          generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        })
      });
      /** Pass init script to every instance */
      mongoInstance.addUserData(initScript);

      instanceSecondaryArray.push(mongoInstance)
    }

    /** Compose IP addresses in a form of bash array and insert them into script file */
    let clusterIpArrForBashScript:string = "";
    for(let i=0; i < instanceSecondaryArray.length; i++) {
      clusterIpArrForBashScript += ' "'+instanceSecondaryArray[i].instancePrivateIp+'" '
    }
    let replicaInitScript = readFileSync('./data//mongo-replica-init.sh', 'utf8'
    ).replace('{{CLUSTER_IPS_ARRAY}}', clusterIpArrForBashScript);
  
    /** Instantiate primary node */
    const mongoPrimaryInstance = new ec2.Instance(this, props.projectRssPrefix+id+'Id'+props.clusterSize, {
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      role: mongoRole,
      securityGroup: mongoSG,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.NANO,
      ),
      keyName: props.sshKeyName,
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      })
    });
    /** Pass init script and replica set configuring script to the primary instance */
    mongoPrimaryInstance.addUserData(initScript);
    mongoPrimaryInstance.addUserData(replicaInitScript);

    /** 
     * Variable has to be initialized otherwise the concatenation below adds undefined string
     * Compose connection string from both secondaries and primary node for graylog
     */
    this.mongoClusterGraylogConnectionString=""
    for(let i=0; i < instanceSecondaryArray.length; i++) {
      this.mongoClusterGraylogConnectionString += instanceSecondaryArray[i].instancePrivateIp+":27017,"
    }
    this.mongoClusterGraylogConnectionString += mongoPrimaryInstance.instancePrivateIp+":27017"
  }
}