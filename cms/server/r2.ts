import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { CmsError } from "../shared.ts";
export interface RemoteImage {
  sha256: string;
  size: number;
  mime: string;
  width: number;
  height: number;
}
export interface ImageStorage {
  head(key: string): Promise<RemoteImage | null>;
  put(key: string, file: string, image: RemoteImage): Promise<void>;
}
export class R2Storage implements ImageStorage {
  private client?: S3Client;
  private bucket = "";
  private connect() {
    if (this.client) return this.client;
    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET } =
      process.env;
    if (
      !R2_ACCESS_KEY_ID ||
      !R2_SECRET_ACCESS_KEY ||
      !R2_ENDPOINT ||
      !R2_BUCKET
    )
      throw new CmsError(
        503,
        "R2 설정이 없습니다. 서버의 이미지 저장소 설정을 확인해 주세요.",
      );
    try {
      const endpoint = new URL(R2_ENDPOINT);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error();
    } catch {
      throw new CmsError(503, "R2 서버 주소 설정을 확인해 주세요.");
    }
    this.bucket = R2_BUCKET;
    return (this.client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
      maxAttempts: 2,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }));
  }
  private failure(error: any, operation: string): never {
    const status = error?.$metadata?.httpStatusCode;
    // Never log raw AWS exceptions: they can include headers/endpoints/secrets.
    console.error("R2 request failed", {
      operation,
      status: typeof status === "number" ? status : null,
      code: new Set([
        "AccessDenied",
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
        "NotFound",
        "NoSuchKey",
        "TimeoutError",
        "AbortError",
        "PreconditionFailed",
        "InternalError",
        "SlowDown",
        "ServiceUnavailable",
      ]).has(error?.name)
        ? error.name
        : "Unknown",
    });
    throw new CmsError(
      502,
      status === 401 || status === 403
        ? "R2 인증에 실패했습니다. 서버의 이미지 저장소 권한을 확인해 주세요."
        : "이미지 저장소에 연결하지 못했습니다. 잠시 후 다시 게시해 주세요.",
    );
  }
  async head(key: string) {
    const client = this.connect();
    try {
      const value = await client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
      return {
        sha256: value.Metadata?.sha256 ?? "",
        size: value.ContentLength ?? 0,
        mime: value.ContentType ?? "",
        width: Number(value.Metadata?.width ?? 0),
        height: Number(value.Metadata?.height ?? 0),
      };
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404) return null;
      return this.failure(error, "HEAD");
    }
  }
  async put(key: string, file: string, image: RemoteImage) {
    const client = this.connect();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: createReadStream(file),
          ContentLength: image.size,
          ContentType: image.mime,
          CacheControl: "public, max-age=31536000, immutable",
          Metadata: {
            sha256: image.sha256,
            width: String(image.width),
            height: String(image.height),
          },
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 412) {
        const object = await this.head(key);
        if (
          object &&
          object.sha256 === image.sha256 &&
          object.size === image.size &&
          object.mime === image.mime
        )
          return;
        throw new CmsError(
          400,
          "같은 이미지 주소에 다른 파일이 있습니다. 덮어쓰지 않았습니다.",
        );
      }
      this.failure(error, "PUT");
    }
  }
}
