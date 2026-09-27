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

type PdfjsResult = { pages: number } | { password: true } | { failed: true };

/**
 * Page count as a PDF viewer sees it: pdf.js follows the cross-reference
 * table like Chrome, Edge and Acrobat do.
 */
async function pdfjsPageCount(bytes: Uint8Array): Promise<PdfjsResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Registers the parser on globalThis so it runs in this process, no worker thread.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const task = pdfjs.getDocument({
    // pdf.js takes ownership of the buffer it is given; keep ours intact.
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    return { pages: doc.numPages };
  } catch (e) {
    return (e as { name?: string }).name === "PasswordException" ? { password: true } : { failed: true };
  } finally {
    await task.destroy();
  }
}

/** Second opinion from a different parser; returns null if it can't read the file. */
async function pdfLibPageCount(bytes: Uint8Array): Promise<{ pages: number; encrypted: boolean } | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    return { pages: doc.getPageCount(), encrypted: doc.isEncrypted };
  } catch {
    return null;
  }
}

// Two independent parsers must agree before a count is trusted as exact. A
// crafted PDF can show one parser fewer pages than a viewer prints; when they
// disagree the student enters the count and the shop is told to check it.
async function countPdfPages(bytes: Uint8Array): Promise<PageCountResult> {
  const [viewer, second] = await Promise.all([pdfjsPageCount(bytes), pdfLibPageCount(bytes)]);
  const encrypted = second?.encrypted ?? false;

  if ("password" in viewer) {
    return {
      detection: "none",
      pages: null,
      encrypted: true,
      rejectReason: "This PDF needs a password to open, so the shop can't print it. Remove the password and upload it again.",
    };
  }
  if ("failed" in viewer || viewer.pages < 1) {
    return {
      detection: "none",
      pages: null,
      encrypted,
      warning: "We couldn't read this PDF. Check that it opens on your phone, then enter the number of pages.",
    };
  }
  if (second && second.pages !== viewer.pages) {
    return {
      detection: "none",
      pages: null,
      encrypted,
      warning: "We couldn't count the pages in this PDF reliably. Enter the number of pages — the shop will check it.",
    };
  }
  return {
    detection: "exact",
    pages: viewer.pages,
    encrypted,
    warning: encrypted ? "This PDF has copy/print restrictions. The shop will check it opens before printing." : undefined,
  };
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
