#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Environment } from '../lib/environment';

const app = new cdk.App();

new Environment(app, 'Gray', {
    cidr: "10.0.10.0/23",                       // Specify CIRD range that can contain two /27 cidr blocks
    region: "eu-west-1",                        // Specify AWS region
    projectRssPrefix: "Gray",                   // Main identifier of resources belonging to this project
    externalAccessIP: "<your_ip>/32",           // Internet-facing services will be accessible exclusively from this IP
    sshKeyName: "<your_key>"                    // Select an existing key; used to access EC2 instances with MongoDB
});