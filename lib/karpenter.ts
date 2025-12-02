/**
 * Karpenter configuration helpers for NodePool and EC2NodeClass manifests
 */

export interface NodePoolConfig {
  instanceTypes?: string[];
  capacityTypes?: string[];
}

export interface EC2NodeClassConfig {
  clusterName: string;
  roleArn: string;
  roleName: string;
}

export function getKarpenterNodePoolManifest(config: NodePoolConfig) {
  // Default instance types suitable for ModelOps workloads
  const instanceTypes = config.instanceTypes || [
    "c5.large",
    "c5.xlarge",
    "c5.2xlarge",
    "c5.4xlarge",
    "m5.large",
    "m5.xlarge",
    "m5.2xlarge",
    "m5.4xlarge",
    "r5.large",
    "r5.xlarge",
    "r5.2xlarge",
  ];

  const capacityTypes = config.capacityTypes || ["on-demand"];

  return {
    apiVersion: "karpenter.sh/v1",
    kind: "NodePool",
    metadata: {
      name: "default",
    },
    spec: {
      template: {
        spec: {
          requirements: [
            {
              key: "kubernetes.io/arch",
              operator: "In",
              values: ["amd64"],
            },
            {
              key: "karpenter.sh/capacity-type",
              operator: "In",
              values: capacityTypes,
            },
            {
              key: "node.kubernetes.io/instance-type",
              operator: "In",
              values: instanceTypes,
            },
          ],
          nodeClassRef: {
            group: "karpenter.k8s.aws",
            kind: "EC2NodeClass",
            name: "default",
          },
          taints: [],
        },
      },
      limits: {
        cpu: "1000",
      },
      disruption: {
        consolidationPolicy: "WhenEmptyOrUnderutilized",
        consolidateAfter: "1m",
      },
    },
  };
}

export function getKarpenterEC2NodeClassManifest(config: EC2NodeClassConfig) {
  return {
    apiVersion: "karpenter.k8s.aws/v1",
    kind: "EC2NodeClass",
    metadata: {
      name: "default",
    },
    spec: {
      amiSelectorTerms: [
        {
          alias: "al2023@latest",
        },
      ],
      role: config.roleName,
      subnetSelectorTerms: [
        {
          tags: {
            "karpenter.sh/discovery": config.clusterName,
          },
        },
      ],
      securityGroupSelectorTerms: [
        {
          tags: {
            "karpenter.sh/discovery": config.clusterName,
          },
        },
      ],
      blockDeviceMappings: [
        {
          deviceName: "/dev/xvda",
          ebs: {
            volumeSize: "100Gi",
            volumeType: "gp3",
            deleteOnTermination: true,
          },
        },
      ],
      userData: `#!/bin/bash
echo "Karpenter-provisioned node for ModelOps jobs"
`,
    },
  };
}
