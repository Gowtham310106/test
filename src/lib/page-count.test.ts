import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { countPages } from "./page-count";

async function pdfWithPages(n: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return doc.save();
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
