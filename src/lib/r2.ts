import "server-only";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Config } from "@/lib/env";
import { contentDisposition } from "@/lib/files";

// Cloudflare R2 through its S3-compatible API. The bucket stays private:
// browsers upload and download with short-lived presigned URLs only.

let client: S3Client | null = null;

function s3() {
  if (!client) {
    const cfg = r2Config();
    client = new S3Client({
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // R2 does not support the newer default checksum headers on presigned URLs.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

const UPLOAD_URL_TTL = 10 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

/** URL the browser PUTs the file to. Size and type are part of the signature. */
export async function presignUpload(key: string, contentType: string, contentLength: number) {
  const command = new PutObjectCommand({
    Bucket: r2Config().bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3(), command, {
    expiresIn: UPLOAD_URL_TTL,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
}

export async function presignDownload(key: string, filename: string) {
  const command = new GetObjectCommand({
    Bucket: r2Config().bucket,
    Key: key,
    ResponseContentDisposition: contentDisposition(filename),
  });
  return getSignedUrl(s3(), command, { expiresIn: DOWNLOAD_URL_TTL });
}

export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: r2Config().bucket, Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw e;
  }
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: r2Config().bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty body for ${key}`);
  return res.Body.transformToByteArray();
}

/** Deletes objects in batches; missing keys count as deleted. Returns keys that failed. */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const res = await s3().send(
      new DeleteObjectsCommand({
        Bucket: r2Config().bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    for (const err of res.Errors ?? []) if (err.Key) failed.push(err.Key);
  }
  return failed;
}
