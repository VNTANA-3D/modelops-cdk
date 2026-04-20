import { readFileSync } from "fs";
import { join } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetBucketPolicyCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";

import { contentTypeFor } from "./content-type.mjs";
import { walkAssets } from "./assets-walk.mjs";
import { mergeStatement, publicAssetsStatement } from "./bucket-policy.mjs";

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const KEY_PREFIX = "assets";

/**
 * Uploads every file under `assetsDir` to `s3://<bucket>/assets/<relative-path>`
 * and merges a public-read bucket-policy statement scoped to `/assets/*`.
 *
 * @param {{ bucket: string, region: string, assetsDir: string }} args
 * @returns {Promise<string[]>} list of uploaded object URLs (path-style).
 */
export async function syncAssets({ bucket, region, assetsDir }) {
  const client = new S3Client({ region });
  const files = walkAssets(assetsDir);
  const urls = [];

  for (const rel of files) {
    const body = readFileSync(join(assetsDir, rel));
    const key = `${KEY_PREFIX}/${rel}`;
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(rel),
      CacheControl: CACHE_CONTROL,
    }));
    urls.push(`https://s3.${region}.amazonaws.com/${bucket}/${key}`);
  }

  const current = await readBucketPolicy(client, bucket);
  const next = mergeStatement(current, publicAssetsStatement(bucket));
  try {
    await client.send(new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify(next),
    }));
  } catch (err) {
    if (err.name === "AccessDenied") {
      throw new Error(
        "PutBucketPolicy denied. The bucket likely has Public Access Block " +
        "with BlockPublicPolicy: true. An operator must relax that setting " +
        "once, out-of-band, before assets-sync can grant public read."
      );
    }
    throw err;
  }

  return urls;
}

async function readBucketPolicy(client, bucket) {
  try {
    const res = await client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
    return JSON.parse(res.Policy);
  } catch (err) {
    if (err.name === "NoSuchBucketPolicy") return null;
    throw err;
  }
}
