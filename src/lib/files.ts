import type { FileKind } from "./types";

// What students may upload. The extension decides the kind (browsers report
// Word MIME types inconsistently); the server then checks the file's real
// signature before accepting it.
const TYPES: Record<string, { kind: FileKind; mime: string }> = {
  pdf: { kind: "pdf", mime: "application/pdf" },
  docx: { kind: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  doc: { kind: "doc", mime: "application/msword" },
  jpg: { kind: "image", mime: "image/jpeg" },
  jpeg: { kind: "image", mime: "image/jpeg" },
  png: { kind: "image", mime: "image/png" },
};

export const ACCEPT_ATTRIBUTE = [
  ".pdf",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
].join(",");

export const ACCEPTED_DESCRIPTION = "PDF, Word (.docx, .doc) or photos (JPG, PNG)";

export function extensionOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function classifyUpload(name: string): { kind: FileKind; mime: string; ext: string } | null {
  const ext = extensionOf(name);
  const type = TYPES[ext];
  return type ? { ...type, ext } : null;
}

/** A display-safe file name: no path parts or control characters, bounded length. */
export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  let clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  clean = clean.replace(/^\.+/, "");
  if (!clean) return "file";
  if (clean.length > 120) {
    const ext = extensionOf(clean);
    const keep = 120 - (ext ? ext.length + 1 : 0);
    clean = clean.slice(0, keep).trimEnd() + (ext ? `.${ext}` : "");
  }
  return clean;
}

export type Signature = "pdf" | "zip" | "ole" | "jpeg" | "png" | null;

/** Identifies a file from its first bytes. */
export function sniffSignature(bytes: Uint8Array): Signature {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  if (starts([0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  // "%PDF-" may be preceded by junk; readers accept it within the first 1 KB.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return "pdf";
    }
  }
  return null;
}

/** Whether the file's content matches the kind its extension claims. */
export function signatureMatches(kind: FileKind, signature: Signature) {
  switch (kind) {
    case "pdf":
      return signature === "pdf";
    case "docx":
      return signature === "zip";
    case "doc":
      return signature === "ole";
    case "image":
      return signature === "jpeg" || signature === "png";
  }
}

export function imageMime(signature: Signature) {
  return signature === "png" ? "image/png" : "image/jpeg";
}

/** RFC 6266 Content-Disposition that survives non-ASCII names (e.g. Tamil). */
export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
