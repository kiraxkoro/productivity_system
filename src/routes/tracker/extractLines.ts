// Person B: pull one label per line out of an uploaded document.
// .docx = a zip; each <w:p> paragraph in word/document.xml is one "line".
// Anything else is treated as plain text split on newlines.

import JSZip from "jszip";

export async function extractLines(file: File): Promise<string[]> {
  const lines = file.name.toLowerCase().endsWith(".docx")
    ? await docxParagraphs(file)
    : (await file.text()).split(/\r?\n/);
  return lines.map((l) => l.trim()).filter(Boolean);
}

async function docxParagraphs(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("Not a valid Word document (.docx)");
  const xml = await entry.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"));
  return paragraphs.map((p) =>
    Array.from(p.getElementsByTagNameNS("*", "t"))
      .map((t) => t.textContent ?? "")
      .join(""),
  );
}
