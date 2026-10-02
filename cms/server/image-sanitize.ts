import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { CmsError } from "../shared.ts";
export const IMAGE_MAX_BYTES = 40 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 120_000_000;
const fail = () => new CmsError(400, "이미지 파일을 확인할 수 없습니다.");
export function imageFormat(b: Buffer): "jpeg" | "png" | "webp" | "gif" {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "png";
  if (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  if (["GIF87a", "GIF89a"].includes(b.toString("ascii", 0, 6))) return "gif";
  throw new CmsError(
    415,
    "지원하지 않는 파일입니다. JPEG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.",
  );
}
function bounds(b: Buffer, end: number) {
  if (end > b.length) throw fail();
}
/** Retain compressed pixels/animation and colour information, drop EXIF/XMP/text. */
export function stripImageMetadata(
  b: Buffer,
  format: ReturnType<typeof imageFormat>,
): Buffer {
  const chunks: Buffer[] = [];
  if (format === "jpeg") {
    chunks.push(b.subarray(0, 2));
    let p = 2;
    while (p < b.length) {
      const start = p;
      if (b[p++] !== 255) throw fail();
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 0xd9) {
        chunks.push(b.subarray(start, p));
        break;
      }
      bounds(b, p + 2);
      const length = b.readUInt16BE(p);
      if (length < 2) throw fail();
      const end = p + length;
      bounds(b, end);
      const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
      const keep =
        (marker === 0xe0 && b.toString("ascii", p + 2, p + 7) === "JFIF\0") ||
        (marker === 0xee && b.toString("ascii", p + 2, p + 7) === "Adobe") ||
        (marker === 0xe2 &&
          b.toString("ascii", p + 2, p + 14) === "ICC_PROFILE\0");
      if (!metadata || keep) chunks.push(b.subarray(start, end));
      p = end;
      if (marker === 0xda) {
        const scanStart = p;
        while (p < b.length) {
          if (b[p] !== 255) {
            p++;
            continue;
          }
          bounds(b, p + 2);
          if (b[p + 1] === 0 || (b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7)) {
            p += 2;
            continue;
          }
          break;
        }
        chunks.push(b.subarray(scanStart, p));
      }
    }
  } else if (format === "png") {
    chunks.push(b.subarray(0, 8));
    let p = 8;
    const keep = new Set([
      "IHDR",
      "PLTE",
      "IDAT",
      "IEND",
      "tRNS",
      "gAMA",
      "cHRM",
      "sRGB",
      "iCCP",
      "acTL",
      "fcTL",
      "fdAT",
    ]);
    while (p < b.length) {
      bounds(b, p + 12);
      const size = b.readUInt32BE(p),
        end = p + 12 + size;
      bounds(b, end);
      const type = b.toString("ascii", p + 4, p + 8);
      if (keep.has(type)) chunks.push(b.subarray(p, end));
      p = end;
    }
  } else if (format === "webp") {
    let p = 12;
    while (p < b.length) {
      bounds(b, p + 8);
      const type = b.toString("ascii", p, p + 4),
        size = b.readUInt32LE(p + 4),
        end = p + 8 + size + (size % 2);
      bounds(b, end);
      if (
        ["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"].includes(type)
      ) {
        const chunk = Buffer.from(b.subarray(p, end));
        if (type === "VP8X") chunk[8] &= ~0x0c;
        chunks.push(chunk);
      }
      p = end;
    }
    const payload = Buffer.concat(chunks),
      header = Buffer.from(b.subarray(0, 12));
    header.writeUInt32LE(payload.length + 4, 4);
    return Buffer.concat([header, payload]);
  } else {
    bounds(b, 13);
    let p = 13 + (b[10] & 128 ? 3 * (1 << ((b[10] & 7) + 1)) : 0);
    bounds(b, p);
    chunks.push(b.subarray(0, p));
    const blocks = () => {
      while (true) {
        bounds(b, p + 1);
        const size = b[p++];
        bounds(b, p + size);
        p += size;
        if (!size) return;
      }
    };
    while (p < b.length) {
      const start = p,
        tag = b[p++];
      if (tag === 0x3b) {
        chunks.push(b.subarray(start, p));
        break;
      }
      if (tag === 0x21) {
        bounds(b, p + 1);
        const label = b[p++];
        const app = label === 0xff ? b.toString("ascii", p + 1, p + 12) : "";
        blocks();
        if (label === 0xf9 || app === "NETSCAPE2.0" || app === "ANIMEXTS1.0")
          chunks.push(b.subarray(start, p));
      } else if (tag === 0x2c) {
        bounds(b, p + 9);
        const packed = b[p + 8];
        p += 9;
        if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
        bounds(b, p + 1);
        p++;
        blocks();
        chunks.push(b.subarray(start, p));
      } else throw fail();
    }
  }
  return Buffer.concat(chunks);
}
export async function sanitizeImage(
  input: string,
  output: string,
  maxPixels = IMAGE_MAX_PIXELS,
) {
  try {
    const bytes = await readFile(input),
      format = imageFormat(bytes);
    const options = {
      animated: true,
      limitInputPixels: maxPixels,
      failOn: "warning" as const,
    };
    const metadata = await sharp(input, options).metadata();
    const width = metadata.width ?? 0,
      height = metadata.pageHeight ?? metadata.height ?? 0;
    if (!width || !height || width * height * (metadata.pages ?? 1) > maxPixels)
      throw new CmsError(413, "이미지의 픽셀 수가 제한을 초과합니다.");
    await sharp(input, options).stats(); // Decode all frames, not just trusted headers.
    if (metadata.orientation && metadata.orientation !== 1) {
      let image = sharp(input, options).autoOrient();
      if (format === "jpeg")
        image = image.jpeg({ quality: 100, chromaSubsampling: "4:4:4" });
      else if (format === "png") image = image.png();
      else if (format === "webp") image = image.webp({ lossless: true });
      else throw fail();
      await image.toFile(output);
    } else
      await writeFile(output, stripImageMetadata(bytes, format), {
        mode: 0o600,
      });
    const result = await sharp(output, options).metadata();
    await sharp(output, options).stats();
    if (result.exif || result.xmp || result.iptc) throw fail();
    return {
      mime: `image/${format}`,
      extension: format === "jpeg" ? "jpg" : format,
      width: result.width!,
      height: result.pageHeight ?? result.height!,
    };
  } catch (error) {
    if (error instanceof CmsError) throw error;
    if (/pixel limit/i.test((error as Error).message))
      throw new CmsError(413, "이미지의 픽셀 수가 제한을 초과합니다.");
    throw fail();
  }
}
