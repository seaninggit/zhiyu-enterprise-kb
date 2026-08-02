export const LOCAL_EMBEDDING_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

export function documentIndexText(doc: Record<string, unknown>, attachmentText = "") {
  const sections = [
    `标题：${String(doc.title || "")}`,
    doc.summary ? `摘要：${String(doc.summary)}` : "",
    String(doc.content || ""),
    String(doc.extracted_text || ""),
    attachmentText,
  ].map(value => value.trim()).filter(Boolean);
  return [...new Set(sections)].join("\n\n");
}

export function chunkText(text: string, size = 900, overlap = 120) {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const end = Math.min(clean.length, start + size);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
  }
  return chunks.slice(0, 120);
}

export function isValidEmbedding(value: unknown, dimensions = LOCAL_EMBEDDING_DIMENSIONS): value is number[] {
  return Array.isArray(value)
    && value.length === dimensions
    && value.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 2);
}
