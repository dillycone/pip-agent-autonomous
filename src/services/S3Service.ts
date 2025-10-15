import fs from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type CreateBucketCommandInput,
  type BucketLocationConstraint
} from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { fromIni } from "@aws-sdk/credential-providers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createChildLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/sanitize.js";

export interface UploadResult {
  bucket: string;
  key: string;
  url: string;
  region: string;
}

export interface IS3Service {
  ensureBucket(bucket?: string): Promise<{ bucket: string; region: string }>;
  uploadAndPresign(params: {
    filePath: string;
    mimeType: string;
    bucket?: string;
    prefix?: string;
    expiresInSeconds: number;
  }): Promise<UploadResult>;
  deleteObject(bucket: string, key: string): Promise<void>;
}

export class S3Service implements IS3Service {
  private logger = createChildLogger("s3-service");
  private s3Client?: S3Client;
  private stsClient?: STSClient;

  constructor(private profile: string) {}

  private getS3Client(): S3Client {
    if (!this.s3Client) {
      this.s3Client = new S3Client({
        credentials: fromIni({ profile: this.profile })
      });
    }
    return this.s3Client;
  }

  private getStsClient(): STSClient {
    if (!this.stsClient) {
      this.stsClient = new STSClient({
        credentials: fromIni({ profile: this.profile })
      });
    }
    return this.stsClient;
  }

  private async getRegion(): Promise<string> {
    try {
      const client = this.getS3Client();
      const regionProvider = client.config.region;
      if (typeof regionProvider === "string") {
        return regionProvider || "us-east-1";
      }
      if (typeof regionProvider === "function") {
        const resolved = await regionProvider();
        return resolved || "us-east-1";
      }
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.warn({ error: sanitized }, "Failed to resolve S3 region from client config");
    }
    return "us-east-1";
  }

  private async getAccountId(): Promise<string | null> {
    try {
      const sts = this.getStsClient();
      const response = await sts.send(new GetCallerIdentityCommand({}));
      return response.Account ?? null;
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.warn({ error: sanitized }, "Failed to resolve AWS account ID");
      return null;
    }
  }

  private async bucketExists(bucket: string): Promise<boolean> {
    try {
      const s3 = this.getS3Client();
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch (error) {
      const sanitized = sanitizeError(error);
      if (sanitized.code === "NotFound" || sanitized.code === "404") {
        return false;
      }
      this.logger.debug({ bucket, error: sanitized }, "HeadBucket failed, treating as non-existent");
      return false;
    }
  }

  private async ensureCors(bucket: string): Promise<void> {
    const s3 = this.getS3Client();
    try {
      await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      const sanitized = sanitizeError(error);
      const missingConfig = ["NoSuchCORSConfiguration", "404"].includes(sanitized.code ?? "");
      if (!missingConfig) {
        this.logger.warn({ bucket, error: sanitized }, "Failed to read existing CORS configuration; attempting to overwrite");
      }
    }

    const corsConfig = {
      CORSRules: [
        {
          AllowedOrigins: ["*"],
          AllowedMethods: ["GET", "HEAD"],
          AllowedHeaders: ["*"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 300
        }
      ]
    };

    try {
      await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: corsConfig }));
      this.logger.info({ bucket }, "Applied default S3 CORS configuration");
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.warn({ bucket, error: sanitized }, "Failed to apply S3 CORS configuration");
    }
  }

  async ensureBucket(explicitBucket?: string): Promise<{ bucket: string; region: string }> {
    const region = await this.getRegion();
    let bucket = (explicitBucket || "").trim();

    if (!bucket) {
      const accountId = await this.getAccountId();
      const base = "pip-agent-autonomous-audio";
      const suffix = accountId ? `${accountId}-${region}` : `${region}-${randomUUID().slice(0, 8)}`;
      bucket = `${base}-${suffix}`.toLowerCase();
    }

    const exists = await this.bucketExists(bucket);
    if (!exists) {
      try {
        const s3 = this.getS3Client();
        const params: CreateBucketCommandInput = { Bucket: bucket };
        if (region !== "us-east-1") {
          const locationConstraint = region as BucketLocationConstraint;
          params.CreateBucketConfiguration = { LocationConstraint: locationConstraint };
        }
        await s3.send(new CreateBucketCommand(params));
        this.logger.info({ bucket, region }, "Created S3 bucket");
        await this.ensureCors(bucket);
      } catch (error) {
        const sanitized = sanitizeError(error);
        this.logger.error({ bucket, region, error: sanitized }, "Failed to create S3 bucket");
        throw new Error(`Failed to create S3 bucket '${bucket}' in ${region}: ${sanitized.message}`);
      }
    }

    return { bucket, region };
  }

  private buildKey(prefix: string | undefined, filePath: string): string {
    const date = new Date();
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const name = basename(filePath);
    const ext = extname(name) || ".bin";
    const id = randomUUID();
    const safePrefix = (prefix || "audio").replace(/^\/+|\/+$/g, "");
    return `${safePrefix}/${yyyy}-${mm}-${dd}/${id}${ext}`;
  }

  async uploadAndPresign(params: {
    filePath: string;
    mimeType: string;
    bucket?: string;
    prefix?: string;
    expiresInSeconds: number;
  }): Promise<UploadResult> {
    const { filePath, mimeType, bucket: bucketMaybe, prefix, expiresInSeconds } = params;
    const { bucket, region } = await this.ensureBucket(bucketMaybe);
    await this.ensureCors(bucket);

    const key = this.buildKey(prefix, filePath);
    const s3 = this.getS3Client();

    try {
      const fileStream = fs.createReadStream(filePath);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fileStream,
        ContentType: mimeType
      }));
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.error({ bucket, key, error: sanitized }, "Failed to upload object to S3");
      throw new Error(`Failed to upload ${filePath} to s3://${bucket}/${key}: ${sanitized.message}`);
    }

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      const url = await getSignedUrl(s3, command, {
        expiresIn: Math.max(60, expiresInSeconds)
      });

      if (!url.startsWith("http")) {
        throw new Error("Invalid presigned URL returned by AWS SDK");
      }

      this.logger.info({ bucket, key, region, expiresInSeconds }, "Uploaded and presigned S3 object");
      return { bucket, key, url, region };
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.error({ bucket, key, error: sanitized }, "Failed to presign S3 object");
      throw new Error(`Failed to presign s3://${bucket}/${key}: ${sanitized.message}`);
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      const s3 = this.getS3Client();
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      this.logger.info({ bucket, key }, "Deleted S3 object");
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.logger.warn({ bucket, key, error: sanitized }, "Failed to delete S3 object (continuing)");
    }
  }
}

export function createS3Service(profile: string): IS3Service {
  return new S3Service(profile);
}
