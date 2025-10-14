import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { safeSpawn } from "../utils/shell-safe.js";
import { createChildLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/sanitize.js";

export interface UploadResult {
  bucket: string;
  key: string;
  url: string; // presigned URL
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
  constructor(private profile: string) {}

  private logger = createChildLogger("s3-service");

  private async aws(args: string[], opts?: { timeout?: number }) {
    // Use validatePaths: false to allow s3:// URIs
    try {
      return await safeSpawn("aws", args, { timeout: opts?.timeout ?? 120000, validatePaths: false });
    } catch (err) {
      const msg = String((err as any)?.message || err || "");
      const ssoExpired = /Token has expired and refresh failed|SSO.+expired|sso login required/i.test(msg);
      if (!ssoExpired) throw err;
      // Attempt interactive SSO login (opens browser) then retry once
      this.logger.info({ profile: this.profile }, "AWS SSO token expired; attempting 'aws sso login'");
      try {
        await safeSpawn("aws", ["sso", "login", "--profile", this.profile], { timeout: 10 * 60 * 1000, validatePaths: false });
      } catch (e1) {
        // As a fallback, try device code flow (no-browser)
        this.logger.warn({ profile: this.profile }, "Interactive SSO login failed; attempting device code (--no-browser)");
        await safeSpawn("aws", ["sso", "login", "--no-browser", "--profile", this.profile], { timeout: 10 * 60 * 1000, validatePaths: false });
      }
      // Retry original command once
      return await safeSpawn("aws", args, { timeout: opts?.timeout ?? 120000, validatePaths: false });
    }
  }

  private async getRegion(): Promise<string> {
    try {
      const { stdout } = await this.aws(["configure", "get", "region", "--profile", this.profile], { timeout: 10000 });
      const region = stdout.trim() || "us-east-1";
      return region;
    } catch {
      return "us-east-1";
    }
  }

  private async getAccountId(): Promise<string | null> {
    try {
      const { stdout } = await this.aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text", "--profile", this.profile], { timeout: 10000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async bucketExists(bucket: string): Promise<boolean> {
    try {
      await this.aws(["s3api", "head-bucket", "--bucket", bucket, "--profile", this.profile], { timeout: 15000 });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureCors(bucket: string): Promise<void> {
    // Try to read CORS; if missing, apply a permissive read CORS suitable for presigned GET
    try {
      await this.aws(["s3api", "get-bucket-cors", "--bucket", bucket, "--profile", this.profile], { timeout: 10000 });
      // If the command succeeds, leave existing CORS as-is
      return;
    } catch {
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
      const json = JSON.stringify(corsConfig);
      try {
        await this.aws([
          "s3api", "put-bucket-cors",
          "--bucket", bucket,
          "--cors-configuration", json,
          "--profile", this.profile
        ], { timeout: 10000 });
        this.logger.info({ bucket }, "Applied default S3 CORS configuration");
      } catch (err) {
        const e = sanitizeError(err);
        this.logger.warn({ err: e, bucket }, "Failed to set CORS (continuing)");
      }
    }
  }

  async ensureBucket(explicitBucket?: string): Promise<{ bucket: string; region: string }> {
    const region = await this.getRegion();
    let bucket = (explicitBucket || "").trim();

    if (!bucket) {
      const acct = await this.getAccountId();
      const base = "pip-agent-autonomous-audio";
      const suffix = acct ? `${acct}-${region}` : `${region}-${randomUUID().slice(0, 8)}`;
      bucket = `${base}-${suffix}`.toLowerCase();
    }

    const exists = await this.bucketExists(bucket);
    if (!exists) {
      try {
        if (region === "us-east-1") {
          await this.aws(["s3api", "create-bucket", "--bucket", bucket, "--region", region, "--profile", this.profile]);
        } else {
          await this.aws([
            "s3api", "create-bucket",
            "--bucket", bucket,
            "--region", region,
            "--create-bucket-configuration", `LocationConstraint=${region}`,
            "--profile", this.profile
          ]);
        }
        this.logger.info({ bucket, region }, "Created S3 bucket");
        await this.ensureCors(bucket);
      } catch (err) {
        const e = sanitizeError(err);
        this.logger.error({ err: e, bucket, region }, "Failed to create bucket");
        throw new Error(`Failed to create S3 bucket '${bucket}' in ${region}: ${e.message || e}`);
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

    // Upload
    await this.aws([
      "s3", "cp",
      filePath,
      `s3://${bucket}/${key}`,
      "--content-type", mimeType,
      "--only-show-errors",
      "--profile", this.profile
    ], { timeout: 10 * 60 * 1000 });

    // Presign
    const { stdout } = await this.aws([
      "s3", "presign",
      `s3://${bucket}/${key}`,
      "--expires-in", String(Math.max(60, expiresInSeconds)),
      "--profile", this.profile
    ], { timeout: 15000 });

    const url = stdout.trim();
    if (!url.startsWith("http")) {
      throw new Error("Failed to generate presigned URL");
    }

    this.logger.info({ bucket, key, region, expiresInSeconds }, "Uploaded and presigned S3 object");
    return { bucket, key, url, region };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    try {
      await this.aws(["s3", "rm", `s3://${bucket}/${key}`, "--only-show-errors", "--profile", this.profile], { timeout: 20000 });
      this.logger.info({ bucket, key }, "Deleted S3 object");
    } catch (err) {
      const e = sanitizeError(err);
      this.logger.warn({ err: e, bucket, key }, "Failed to delete S3 object (continuing)");
    }
  }
}

export function createS3Service(profile: string): IS3Service {
  return new S3Service(profile);
}
