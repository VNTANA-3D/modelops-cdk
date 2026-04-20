/**
 * Pure module: idempotent merge of a named statement into an S3 bucket
 * policy document.
 *
 * The policy is the JSON shape S3 returns from `GetBucketPolicy`:
 * { Version: "2012-10-17", Statement: [...] }
 */

/**
 * Returns a new policy document with `statement` inserted or replaced by
 * `Sid`. Other statements keep their order. If the input policy is null
 * or has no `Statement` array, a fresh policy is returned.
 *
 * @param {object | null} policy
 * @param {{ Sid: string } & Record<string, unknown>} statement
 * @returns {{ Version: string, Statement: object[] }}
 */
export function mergeStatement(policy, statement) {
  if (!statement.Sid) {
    throw new Error("statement.Sid is required");
  }
  const current = policy?.Statement ?? [];
  const next = [];
  let replaced = false;
  for (const s of current) {
    if (s.Sid === statement.Sid) {
      next.push(statement);
      replaced = true;
    } else {
      next.push(s);
    }
  }
  if (!replaced) next.push(statement);
  return {
    Version: policy?.Version ?? "2012-10-17",
    Statement: next,
  };
}

/**
 * Returns the canonical public-read statement for the `/assets/*` prefix.
 *
 * @param {string} bucket
 * @returns {object}
 */
export function publicAssetsStatement(bucket) {
  return {
    Sid: "ModelopsPublicAssets",
    Effect: "Allow",
    Principal: "*",
    Action: "s3:GetObject",
    Resource: `arn:aws:s3:::${bucket}/assets/*`,
  };
}
