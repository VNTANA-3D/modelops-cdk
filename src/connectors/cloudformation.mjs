/**
 * Shell module: CloudFormation stack output fetcher.
 *
 * Imperative Shell side of Functional Core / Imperative Shell.
 * All AWS I/O is contained here. The core modules receive a typed
 * StackOutputs record and never touch raw CFN data.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

import { z } from "zod";

// ---------------------------------------------------------------------------
// StackOutputs schema — Parse Don't Validate at the shell boundary.
//
// CFN exports every output key with a logical-id prefix, so we match by
// suffix (OutputKey.endsWith(suffix)) when building the raw record.
// The schema then validates the resulting plain object and transforms
// the comma-joined Subnets string into an array.
// ---------------------------------------------------------------------------

/**
 * Required output key suffixes that must be present in the CFN stack.
 * The stack prepends a logical-id prefix to each name, so we match by endsWith.
 */
const REQUIRED_SUFFIXES = /** @type {const} */ ([
  "QueueId",
  "ProxyRoleArn",
  "ClusterArn",
  "TaskDefArn",
  "Subnets",
  "SecurityGroupId",
  "EcsLogGroupName",
  "StagingBucket",
]);

export const StackOutputs = z.object({
  QueueId: z.string().min(1, { message: "QueueId must not be empty" }),
  ProxyRoleArn: z.string().min(1, { message: "ProxyRoleArn must not be empty" }),
  ClusterArn: z.string().min(1, { message: "ClusterArn must not be empty" }),
  TaskDefArn: z.string().min(1, { message: "TaskDefArn must not be empty" }),
  Subnets: z
    .string()
    .min(1, { message: "Subnets must not be empty" })
    .transform((val) => val.split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(
      z
        .array(z.string().min(1))
        .min(1, { message: "Subnets must contain at least one entry" })
    ),
  SecurityGroupId: z.string().min(1, { message: "SecurityGroupId must not be empty" }),
  EcsLogGroupName: z.string().min(1, { message: "EcsLogGroupName must not be empty" }),
  StagingBucket: z.string().min(1, { message: "StagingBucket must not be empty" }),
});

// ---------------------------------------------------------------------------
// Shell function
// ---------------------------------------------------------------------------

/**
 * Fetch and parse CloudFormation stack outputs into a typed StackOutputs record.
 *
 * Matches each required output suffix against the OutputKey of every stack
 * output, then validates and transforms the result through the StackOutputs
 * Zod schema. Throws with a readable message if any required keys are absent.
 *
 * @param {{ stackName: string; region: string }} opts
 * @returns {Promise<z.infer<typeof StackOutputs>>}
 */
export async function fetchStackOutputs({ stackName, region }) {
  const client = new CloudFormationClient({ region });

  const command = new DescribeStacksCommand({ StackName: stackName });
  const response = await client.send(command);

  const stacks = response.Stacks;
  if (!stacks || stacks.length === 0) {
    throw new Error(`CloudFormation stack "${stackName}" not found in region ${region}`);
  }

  const outputs = stacks[0].Outputs ?? [];

  // Build a map of suffix → value by scanning each output key with endsWith.
  // If two keys share the same suffix, the last one wins — CFN logical-id
  // prefixes make collisions extremely unlikely in practice.
  /** @type {Record<string, string>} */
  const raw = {};
  for (const output of outputs) {
    const key = output.OutputKey ?? "";
    const value = output.OutputValue ?? "";
    for (const suffix of REQUIRED_SUFFIXES) {
      if (key.endsWith(suffix)) {
        raw[suffix] = value;
      }
    }
  }

  // Pre-check: list every missing suffix so the error message is actionable.
  const missing = REQUIRED_SUFFIXES.filter((s) => !(s in raw));
  if (missing.length > 0) {
    throw new Error(
      `Stack "${stackName}" is missing required output key(s): ${missing.join(", ")}. ` +
        `Available output keys: ${outputs.map((o) => o.OutputKey).join(", ")}`
    );
  }

  // Parse through the Zod schema — transforms Subnets into string[].
  return StackOutputs.parse(raw);
}
