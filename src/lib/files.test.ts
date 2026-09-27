import { describe, expect, it } from "vitest";
import { classifyUpload, contentDisposition, sanitizeFileName, signatureMatches, sniffSignature } from "./files";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("classifyUpload", () => {
  it("accepts the supported types by extension, case-insensitively", () => {
    expect(classifyUpload("DSP_Lab_Record.PDF")?.kind).toBe("pdf");
    expect(classifyUpload("Assignment_2.docx")?.kind).toBe("docx");
    expect(classifyUpload("old.doc")?.kind).toBe("doc");
    expect(classifyUpload("Project_Poster.jpg")?.kind).toBe("image");
    expect(classifyUpload("board.jpeg")?.mime).toBe("image/jpeg");
    expect(classifyUpload("scan.png")?.mime).toBe("image/png");
  });

  it("rejects everything else", () => {
    for (const name of ["slides.pptx", "photo.heic", "virus.exe", "noextension", "archive.pdf.zip", "sheet.xlsx"]) {
      expect(classifyUpload(name)).toBeNull();
    }
  });
});

describe("sanitizeFileName", () => {
  it("strips paths and characters Windows can't save", () => {
    expect(sanitizeFileName("C:\\Users\\me\\notes.pdf")).toBe("notes.pdf");
    expect(sanitizeFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName('a<b>c:"d|e?f*.pdf')).toBe("abcdef.pdf");
    expect(sanitizeFileName("  lots   of   space .pdf ")).toBe("lots of space .pdf");
    expect(sanitizeFileName("\u0000\u0007bell.pdf")).toBe("bell.pdf");
    expect(sanitizeFileName("...hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("keeps non-English names and the extension when shortening", () => {
    expect(sanitizeFileName("குறிப்புகள்.pdf")).toBe("குறிப்புகள்.pdf");
    const long = sanitizeFileName(`${"x".repeat(300)}.docx`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".docx")).toBe(true);
  });
});

describe("sniffSignature", () => {
  it("recognises real file headers", () => {
    expect(sniffSignature(new TextEncoder().encode("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffSignature(new TextEncoder().encode("\r\njunk%PDF-1.4"))).toBe("pdf");
    expect(sniffSignature(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("zip");
    expect(sniffSignature(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe("ole");
    expect(sniffSignature(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffSignature(new TextEncoder().encode("<html>not a pdf</html>"))).toBeNull();
  });

  it("matches kinds, allowing a PNG saved as .jpg", () => {
    expect(signatureMatches("pdf", "pdf")).toBe(true);
    expect(signatureMatches("pdf", "zip")).toBe(false);
    expect(signatureMatches("docx", "zip")).toBe(true);
    expect(signatureMatches("doc", "ole")).toBe(true);
    expect(signatureMatches("image", "png")).toBe(true);
    expect(signatureMatches("image", "pdf")).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII fallback and a UTF-8 name", () => {
    const h = contentDisposition('4821-1-குறிப்பு "final".pdf');
    expect(h).toMatch(/^attachment; filename="4821-1-[_ ]+_final_\.pdf"; filename\*=UTF-8''/);
    expect(h).toContain(encodeURIComponent("குறிப்பு"));
  });
});
