import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import type { FileKind } from "./types";

export interface PageCountResult {
  detection: "exact" | "estimate" | "none";
  pages: number | null;
  encrypted: boolean;
  /** Shown to the student; the file is still accepted. */
  warning?: string;
  /** The file is unusable and should be rejected. */
  rejectReason?: string;
}

export async function countPages(bytes: Uint8Array, kind: FileKind): Promise<PageCountResult> {
  switch (kind) {
    case "image":
      return { detection: "exact", pages: 1, encrypted: false };
    case "pdf":
      return countPdfPages(bytes);
    case "docx":
      return countDocxPages(bytes);
    case "doc":
      return {
        detection: "none",
        pages: null,
        encrypted: false,
        warning: "Old Word files (.doc) can't be counted. Enter the number of pages, or save it as PDF for an exact count.",
      };
  }
}

async function countPdfPages(bytes: Uint8Array): Promise<PageCountResult> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
    const pages = doc.getPageCount();
    const encrypted = doc.isEncrypted;
    const warning = encrypted
      ? "This PDF is protected. If it asks for a password when opened, the shop can't print it — remove the password and upload again."
      : undefined;
    if (pages > 0) return { detection: "exact", pages, encrypted, warning };
    return {
      detection: "none",
      pages: null,
      encrypted,
      warning: "We couldn't count the pages in this PDF. Enter the number of pages.",
    };
  } catch {
    return {
      detection: "none",
      pages: null,
      encrypted: false,
      warning: "We couldn't read this PDF. Check that it opens on your phone, then enter the number of pages.",
    };
  }
}

const PAGES_TAG = /<(?:\w+:)?Pages>\s*(\d+)\s*<\/(?:\w+:)?Pages>/;

// Word stores the page count it last saw in docProps/app.xml. It's usually
// right, but the shop's computer may lay the document out differently, so it
// is treated as an estimate the student can correct.
function countDocxPages(bytes: Uint8Array): PageCountResult {
  let names: string[] = [];
  let appXml: string | null = null;
  try {
    const files = unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return f.name === "docProps/app.xml" && f.originalSize < 1024 * 1024;
      },
    });
    if (files["docProps/app.xml"]) appXml = strFromU8(files["docProps/app.xml"]);
  } catch {
    names = [];
  }

  if (!names.includes("word/document.xml")) {
    return {
      detection: "none",
      pages: null,
      encrypted: false,
      rejectReason: "This doesn't look like a Word document. Save it again as .docx or PDF and upload that.",
    };
  }

  const match = appXml ? PAGES_TAG.exec(appXml) : null;
  const pages = match ? Number(match[1]) : 0;
  if (pages > 0 && pages <= 5000) {
    return {
      detection: "estimate",
      pages,
      encrypted: false,
      warning: "Page count read from the Word file. Check it — for an exact print, upload a PDF.",
    };
  }
  return {
    detection: "none",
    pages: null,
    encrypted: false,
    warning: "This Word file doesn't record its page count. Enter the number of pages.",
  };
}
