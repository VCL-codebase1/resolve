import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type StoredFile = { bytes: Buffer; mediaType: string };

function cloudinaryConfig() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) return null;
  return { cloud, key, secret };
}

function sign(params: Record<string, string>, secret: string) {
  const payload = Object.keys(params)
    .sort()
    .map((name) => `${name}=${params[name]}`)
    .join("&");
  return createHash("sha1").update(payload + secret).digest("hex");
}

export async function storeFile(id: string, bytes: Buffer, mediaType: string, filename: string, directory: string) {
  const config = cloudinaryConfig();
  if (!config) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id), bytes);
    return id;
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const publicId = `desk/${id}`;
  const signature = sign({ public_id: publicId, timestamp }, config.secret);
  const resource = mediaType === "application/pdf" ? "raw" : "image";
  const body = new FormData();
  body.set("file", new Blob([new Uint8Array(bytes)], { type: mediaType }), filename);
  body.set("api_key", config.key);
  body.set("timestamp", timestamp);
  body.set("public_id", publicId);
  body.set("signature", signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloud}/${resource}/upload`, { method: "POST", body });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail.slice(0, 300) || "Cloudinary refused the file.");
  }
  const payload = (await response.json()) as { secure_url?: string };
  if (!payload.secure_url) throw new Error("Cloudinary did not return a file URL.");
  return payload.secure_url;
}

export async function readStoredFile(storageKey: string, directory: string): Promise<StoredFile | null> {
  if (storageKey.startsWith("https://")) {
    const response = await fetch(storageKey);
    if (!response.ok) return null;
    const mediaType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
    return { bytes: Buffer.from(await response.arrayBuffer()), mediaType };
  }
  const bytes = await readFile(join(directory, storageKey)).catch(() => null);
  if (!bytes) return null;
  return { bytes, mediaType: "" };
}
