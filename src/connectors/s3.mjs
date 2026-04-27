import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * @param {{ bucket: string; key: string; body: string; region: string }} opts
 * @returns {Promise<string>} S3 URI of the uploaded object
 */
export async function uploadPipelineJson({ bucket, key, body, region }) {
  const client = new S3Client({ region });

  // ContentType prevents S3 from defaulting to application/octet-stream,
  // which would break downstream consumers that inspect MIME type.
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/json" })
  );

  return `s3://${bucket}/${key}`;
}
