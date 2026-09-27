import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { countPages } from "./page-count";

async function pdfWithPages(n: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return doc.save();
}

/**
 * A PDF with the page tree defined twice: the cross-reference table (what
 * viewers follow) points at the 3-page version, a later duplicate claims 1.
 */
function duplicatePageTreePdf() {
  const objs: [number, string][] = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"],
    [4, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"],
    [5, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
  ];
  let out = "%PDF-1.4\n";
  const offsets = new Map<number, number>();
  for (const [n, body] of objs) {
    if (!offsets.has(n)) offsets.set(n, out.length);
    out += `${n} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += "xref\n0 6\n0000000000 65535 f \n";
  for (let n = 1; n <= 5; n++) out += `${String(offsets.get(n)).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function docx(appXml: string | null) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8("<w:document/>"),
  };
  if (appXml !== null) files["docProps/app.xml"] = strToU8(appXml);
  return zipSync(files);
}

describe("countPages", () => {
  it("counts PDF pages exactly", async () => {
    const result = await countPages(await pdfWithPages(42), "pdf");
    expect(result).toMatchObject({ detection: "exact", pages: 42, encrypted: false });
  });

  it("falls back to manual entry for a broken PDF", async () => {
    const result = await countPages(new TextEncoder().encode("%PDF-1.4 this is not really a pdf"), "pdf");
    expect(result.detection).toBe("none");
    expect(result.pages).toBeNull();
    expect(result.warning).toBeTruthy();
    expect(result.rejectReason).toBeUndefined();
  });

  it("does not trust a count the parsers disagree on", async () => {
    const result = await countPages(duplicatePageTreePdf(), "pdf");
    expect(result.detection).toBe("none");
    expect(result.pages).toBeNull();
  });

  it("rejects PDFs that need a password to open", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save({ useObjectStreams: false });
    // Mark it encrypted with a user password pdf.js can't open without.
    const text = new TextDecoder("latin1").decode(bytes);
    const withEncrypt = text.replace(
      /trailer\s*<</,
      "trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O <00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff> /U <00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff> /P -4 >> /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]",
    );
    const result = await countPages(Uint8Array.from(withEncrypt, (c) => c.charCodeAt(0)), "pdf");
    expect(result.rejectReason).toMatch(/password/);
  });

  it("reads the page count Word saved, as an estimate", async () => {
    const xml = `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>12</Pages><Words>3000</Words></Properties>`;
    const result = await countPages(docx(xml), "docx");
    expect(result).toMatchObject({ detection: "estimate", pages: 12 });
  });

  it("asks for pages when the Word file has no count", async () => {
    const result = await countPages(docx(null), "docx");
    expect(result).toMatchObject({ detection: "none", pages: null });
    expect(result.rejectReason).toBeUndefined();
  });

  it("rejects a zip that is not a Word document", async () => {
    const notWord = zipSync({ "xl/workbook.xml": strToU8("<workbook/>") });
    const result = await countPages(notWord, "docx");
    expect(result.rejectReason).toBeTruthy();
  });

  it("treats a photo as one page and old .doc as manual", async () => {
    expect(await countPages(new Uint8Array([0xff, 0xd8, 0xff]), "image")).toMatchObject({ detection: "exact", pages: 1 });
    expect(await countPages(new Uint8Array(8), "doc")).toMatchObject({ detection: "none", pages: null });
  });
});
