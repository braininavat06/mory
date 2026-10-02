// Explicit manual smoke test. Never called by build, tests, CMS startup or CI.
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ulid } from "ulid";
import sharp from "sharp";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { root } from "../server/config.ts";
import { R2Storage } from "../server/r2.ts";
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const required = [
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
];
if (!required.every((k) => !!process.env[k]))
  throw new Error("R2 smoke test: 설정이 없습니다.");
const key = `_cms-test/${ulid()}.png`,
  temporary = mkdtempSync(join(tmpdir(), "mory-r2-smoke-")),
  file = join(temporary, "test.png");
const storage = new R2Storage();
let success = false,
  deleted = false;
try {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#889977" },
  })
    .png()
    .toBuffer();
  writeFileSync(file, bytes, { mode: 0o600 });
  const image = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    mime: "image/png",
    width: 2,
    height: 2,
  };
  await storage.put(key, file, image);
  const head = await storage.head(key);
  if (
    head?.sha256 !== image.sha256 ||
    head.size !== image.size ||
    head.mime !== image.mime
  )
    throw new Error("HEAD 검증 실패");
  let response: Response | undefined;
  for (let i = 0; i < 5; i++) {
    response = await fetch(
      `${process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "")}/${key}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (response.ok) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (
    !response?.ok ||
    response.headers.get("content-type") !== "image/png" ||
    !response.headers.get("cache-control")?.includes("immutable")
  )
    throw new Error("공개 이미지/헤더 검증 실패");
  if (
    createHash("sha256")
      .update(Buffer.from(await response.arrayBuffer()))
      .digest("hex") !== image.sha256
  )
    throw new Error("공개 이미지 무결성 검증 실패");
  success = true;
} catch (error) {
  console.error(
    "R2 smoke test failed:",
    error instanceof Error && /^[가-힣A-Z /]+검증 실패$/.test(error.message)
      ? error.message
      : "이미지 저장소 또는 공개 URL 검증에 실패했습니다.",
  );
} finally {
  try {
    const client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    await client.send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    client.destroy();
    deleted = (await storage.head(key)) === null;
  } catch {
    console.error(
      "R2 smoke test cleanup failed; server-side test object cleanup needed.",
    );
  }
  rmSync(temporary, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    test: "R2 smoke",
    uploadHeadPublicGet: success,
    objectDeleted: deleted,
  }),
);
if (!success || !deleted) process.exitCode = 1;
