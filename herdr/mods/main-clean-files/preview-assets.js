import * as fs from "fs/promises";
import { appHome, exec } from "herdr";
import { collectMarkdownImages, imageRequest, rewriteMarkdownImages } from "./markdown-model.js";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
const TOTAL_LIMIT = 24 * 1024 * 1024;

export async function prepareMarkdownImages(source, target) {
  const images = collectMarkdownImages(source);
  if (!images.length) return { source, assets: [] };

  const requests = images.map((image, index) => imageRequest(target, image, `image-${index}`));
  const cache = `${appHome()}/cache/main-clean-files-markdown`;
  const requestFile = `${cache}/request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await fs.mkdir(cache, { recursive: true });
  try {
    await fs.writeFile(requestFile, JSON.stringify({ items: requests, force: false }), { mode: 384 });
    const result = await exec("node", [`${appHome()}/mods/main-clean-files/.markdown-runtime/asset-worker.mjs`, requestFile]);
    if (result.code !== 0) throw Error(result.stderr || "Image loader failed");
    const response = JSON.parse(result.stdout);
    const returned = new Map((response.images ?? []).map(item => [item.id, item]));
    const assets = [];
    let total = 0;
    for (const request of requests) {
      const item = returned.get(request.id) ?? { id:request.id, error:"Image loader returned no result" };
      const original = request.original ?? "";
      if (item.error || !item.path) {
        assets.push({ original, error: item.error || "Image unavailable" });
        continue;
      }
      const bytes = await fs.readFile(item.path);
      total += bytes.length;
      if (total > TOTAL_LIMIT) {
        assets.push({ original, error: "Document images exceed 24 MiB" });
        continue;
      }
      const mime = MIME[item.ext] ?? "application/octet-stream";
      assets.push({ original, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` });
    }
    return { source: rewriteMarkdownImages(source, assets), assets };
  } finally {
    await fs.unlink(requestFile).catch(() => {});
  }
}
