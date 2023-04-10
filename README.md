# Graylog example project 

This project provides fully-automated deployment of all the necessary resources to run Graylog as the main logging solution in an AWS environment.

There are only two things intentionally left out:
- domain and related DNS records which are not in scope of this project
- certificates for access encryption, which mostly requres the domain name available

There are 3 folders containing project files:
- bin/  => contains project's entry point and global config variables
- data/ => contains scripts and configuration files used by AWS resources directly, which can be modified to extend desired functionality
- lib/  => contains the core of the project, all the classes and methods to construct the AWS environment

The "lib/" folder contains another folder called "stacks", where all project classes are defined and then there is a file "environmnet.ts", where these classes are instantiated 


# 1 | Environment setup and requirements
- Node.js 16+
- aws credentials configured:
    -> https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html
- CDK globally installed
    -> npm install -g aws-cdk
- Downloaded project dependencies:
    -> run "npm install" in the project folder

# 2 | Project environment configuration
Open file bin/gray.ts and configure Environment variables

Open /lib/environment.ts and change the application-stack instance's image if you want to. Default is Nginx, which works well as a basic log generator.

Deployment will take somewhere from 20 to 40 minutes depending on the mood of the AWS workers

Two application loadbalancers will be created:
- First one leads to the Graylog WebGUI (default credentials are admin:admin)
- the other one to the Nginx Welcome Page.

Aside to those, there will be also one internal internet loadbalancer, which can be used to directly send messages to graylog on configured ports via Netcat or similar tool from the internal IP range, for example from EC2 instances with MongoDB.

# 3 | Synthesize and deploy graylog
Try to run "cdk synth" command, which should create new "cdk.out" folder on the project root, containing all the stacks templates

Run "cdk deploy" to deploy the project

additional useful deploy params are:
- --all                             => deploys all stacks 
- --require-approval never          => auto-confirm security and networking related resources
- --profile <credentials_profile>   => aws credentials profile if configured, default credentials will be looked up otherwise

# 4 | Troubleshooting
Missing Service Linked role:
- if service-linked-role is missing in the account simply run "aws iam create-service-linked-role --aws-service-name es.amazonaws.com" in the AWS CLI
Error: Is account ############ bootstrapped?
- if this is the first time, you are using CDK, then you will need to bootstrap your account, simply run "cdk bootstrap" and it will prepare all necessary resources in the AWS for you
- if you already have bootstrapped your account, try deleting the CDKToolkit stack and delete s3 bucket starting with CDK. This should fix it. Warning: This will break existing stacks, so use it only in sandbox accounts or accounts where you can afford loosing your data

