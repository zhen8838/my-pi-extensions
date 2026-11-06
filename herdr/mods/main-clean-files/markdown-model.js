import MarkdownIt from "./.markdown-runtime/vendor/markdown-it.js";

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

const normalizeLabel = value => value.trim().replace(/\s+/g, " ").toUpperCase();
const escapeRegExp = value => value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const escapeMarkdown = value => String(value ?? "").replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&");

function plain(tokens) {
  return (tokens ?? []).map(token => {
    if (token.type === "image") return plain(token.children);
    if (token.type === "text" || token.type === "code_inline") return token.content;
    return token.children ? plain(token.children) : "";
  }).join("");
}

export function headingSlug(text, used = new Map()) {
  const base = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s+/g, "-") || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

function definitionMarkdown(raw, env) {
  const wanted = new Set();
  for (const match of raw.matchAll(/!?\[([^\]]+)\]\s*\[([^\]]*)\]/g)) {
    wanted.add(normalizeLabel(match[2] || match[1]));
  }
  for (const match of raw.matchAll(/!?\[([^\]]+)\](?!\s*[[(])/g)) {
    wanted.add(normalizeLabel(match[1]));
  }
  return Object.entries(env.references ?? {}).filter(([label]) => wanted.has(normalizeLabel(label))).map(([label, reference]) => {
    const title = reference.title ? ` "${String(reference.title).replaceAll('"', '\\"')}"` : "";
    return `[${label}]: <${reference.href}>${title}`;
  }).join("\n");
}

export function parseMarkdownDocument(source) {
  const env = {};
  const tokens = md.parse(source, env);
  const lines = source.split("\n");
  const blocks = [];
  const toc = [];
  const used = new Map();

  for (let i = 0; i < tokens.length && blocks.length < 2000;) {
    const token = tokens[i];
    if (token.level !== 0 || token.nesting < 0) { i++; continue; }
    let end = i + 1;
    if (token.nesting === 1) {
      let depth = 1;
      while (end < tokens.length && depth) {
        depth += tokens[end].nesting;
        end++;
      }
    }
    const group = tokens.slice(i, end);
    const map = token.map ?? group.find(item => item.map)?.map;
    if (!map) { i = end; continue; }
    const inline = group.find(item => item.type === "inline");
    const raw = lines.slice(map[0], map[1]).join("\n");
    const definitions = definitionMarkdown(raw, env);
    const markdown = definitions && !/^\s{0,3}\[[^\]]+\]:/m.test(raw)
      ? `${raw}\n\n${definitions}`
      : raw;

    if (token.type === "heading_open") {
      const title = plain(inline?.children) || inline?.content || "";
      const level = Number(token.tag.slice(1));
      const slug = headingSlug(title, used);
      toc.push({ level, title, slug, index: blocks.length, line: map[0] + 1 });
      blocks.push({ kind: "heading", slug, line: map[0] + 1, markdown });
    } else if (/^\s*(?:\[toc\]|\[\[toc\]\])\s*$/i.test(raw)) {
      // The generated TOC is always at the top; legacy markers do not duplicate it.
    } else {
      blocks.push({ kind: "markdown", line: map[0] + 1, markdown });
    }
    i = end;
  }

  return { blocks, toc };
}

function htmlImages(source) {
  const found = [];
  const decode = value => value
    .replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g, (_all, decimal) => String.fromCodePoint(Number(decimal)));
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (src) {
      const original=src[1]??src[2]??src[3];
      found.push({ src:original, requestSrc:decode(original), alt:(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)??[]).slice(1).find(Boolean)??"" });
    }
  }
  return found;
}

export function collectMarkdownImages(source) {
  const env = {};
  const tokens = md.parse(source, env);
  const images = [];
  const seen = new Set();
  function visit(token) {
    if (token.type === "image") {
      const src = token.attrGet("src") ?? "";
      if (src && !seen.has(src)) {
        seen.add(src);
        images.push({ src, alt: plain(token.children) || token.attrGet("alt") || "" });
      }
    }
    for (const child of token.children ?? []) visit(child);
  }
  tokens.forEach(visit);
  for (const image of htmlImages(source)) {
    if (image.src && !seen.has(image.src)) {
      seen.add(image.src);
      images.push(image);
    }
  }
  return images.slice(0, 128);
}

export function normalizePath(input) {
  const absolute = input.startsWith("/"), parts = [];
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && parts.at(-1) !== "..") parts.pop();
      else if (!absolute) parts.push(part);
    } else parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/");
}

export function resolveDocumentPath(target, reference) {
  let value = reference.split(/[?#]/)[0];
  try { value = decodeURIComponent(value); } catch {}
  if (value.startsWith("file://")) value = value.slice(7);
  const folder = target.path.split("/").slice(0, -1).join("/");
  const path = value.startsWith("/")
    ? normalizePath(value)
    : normalizePath(`${target.root}/${folder}/${value}`);
  return { path, on: target.on ?? null };
}

export function imageRequest(target, image, id) {
  const src = image.requestSrc ?? image.src;
  if (/^https?:\/\//i.test(src) || src.startsWith("//")) {
    return { id, original: image.src, url: src.startsWith("//") ? "https:" + src : src };
  }
  if (/^data:image\//i.test(src)) return { id, original: image.src, data: src };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("file://")) {
    return { id, original: image.src, error: "Unsupported image address" };
  }
  return { id, original: image.src, ...resolveDocumentPath(target, src) };
}

function replacementFor(asset, alt) {
  if (asset?.dataUrl) return asset.dataUrl;
  const label = escapeMarkdown(alt || asset?.original || "image");
  const error = escapeMarkdown(asset?.error || "Image unavailable");
  return `**Image unavailable:** ${label} — ${error}`;
}

export function rewriteMarkdownImages(source, assets) {
  const bySource = new Map(assets.map(asset => [asset.original, asset]));
  const usedLabels = new Set();

  source.replace(/!\[([^\]]*)\]\s*\[([^\]]*)\]/g, (_all, alt, label) => {
    usedLabels.add(normalizeLabel(label || alt));
    return _all;
  });

  let output = source.replace(/!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))([^\n)]*)\)/g,
    (all, alt, angled, bare, rest) => {
      const original = angled ?? bare;
      const asset = bySource.get(original);
      if (!asset) return all;
      if (!asset.dataUrl) return replacementFor(asset, alt);
      return `![${alt}](<${asset.dataUrl}>${rest})`;
    });

  output = output.replace(/!\[([^\]]*)\]\s*\[([^\]]*)\]/g, (all, alt, label) => {
    const normalized = normalizeLabel(label || alt);
    const definition = new RegExp(`^\\s{0,3}\\[${escapeRegExp(normalized)}\\]:\\s*(?:<([^>\\n]+)>|([^\\s]+))`, "im").exec(source);
    const original = definition?.[1] ?? definition?.[2];
    const asset = original ? bySource.get(original) : null;
    return asset && !asset.dataUrl ? replacementFor(asset, alt) : all;
  });

  output = output.replace(/^(\s{0,3}\[([^\]]+)\]:\s*)(?:<([^>\n]+)>|([^\s]+))([^\n]*)$/gm,
    (all, prefix, label, angled, bare, rest) => {
      if (!usedLabels.has(normalizeLabel(label))) return all;
      const original = angled ?? bare;
      const asset = bySource.get(original);
      if (!asset?.dataUrl) return all;
      return `${prefix}<${asset.dataUrl}>${rest}`;
    });

  output = output.replace(/<img\b[^>]*>/gi, tag => {
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!srcMatch) return tag;
    const original = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3];
    const asset = bySource.get(original);
    if (!asset) return tag;
    const alt = (/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag) ?? []).slice(1).find(Boolean) ?? "";
    if (!asset.dataUrl) return replacementFor(asset, alt);
    return tag.replace(srcMatch[0], `src="${asset.dataUrl}"`);
  });

  return output;
}

export function headingOffset(toc, slug, heights, topOffset = 0) {
  const item = toc.find(heading => heading.slug === slug);
  if (!item) return null;
  let offset = topOffset;
  for (let i = 0; i < item.index; i++) offset += heights[i] ?? 0;
  return offset;
}
