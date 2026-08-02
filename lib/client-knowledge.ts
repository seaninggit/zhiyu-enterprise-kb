import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { chunkText, LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL } from "./text-chunks";

export type ExtractionProgress = { stage: "READ" | "OCR" | "EMBED"; percent: number; message: string };
export type ExtractionResult = {
  text: string;
  method: "TEXT" | "PDF_TEXT" | "DOCX" | "XLSX" | "PPTX" | "OCR" | "NONE";
  ocrStatus: "NOT_REQUIRED" | "COMPLETED" | "FAILED";
  detail: string;
};

type FeatureOutput = { tolist(): unknown };
type FeatureExtractor = (input: string[], options: { pooling: "mean"; normalize: true }) => Promise<FeatureOutput>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function textFromXml(xml: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(document.querySelectorAll("t")).map(node => node.textContent || "").join(" ").trim();
}

function columnIndex(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function parseXlsx(buffer: ArrayBuffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("text");
  const shared = sharedXml ? Array.from(new DOMParser().parseFromString(sharedXml, "application/xml").querySelectorAll("si")).map(node => Array.from(node.querySelectorAll("t")).map(item => item.textContent || "").join("")) : [];
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  if (!workbookXml || !relsXml) return "";
  const workbook = new DOMParser().parseFromString(workbookXml, "application/xml");
  const rels = new DOMParser().parseFromString(relsXml, "application/xml");
  const targets = new Map(Array.from(rels.querySelectorAll("Relationship")).map(node => [node.getAttribute("Id") || "", node.getAttribute("Target") || ""]));
  const sheets: string[] = [];
  for (const sheet of Array.from(workbook.querySelectorAll("sheet"))) {
    const relationId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "";
    const target = targets.get(relationId); if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await zip.file(path)?.async("text"); if (!xml) continue;
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const rows = Array.from(document.querySelectorAll("row")).map(row => {
      const values: string[] = [];
      for (const cell of Array.from(row.querySelectorAll("c"))) {
        const index = columnIndex(cell.getAttribute("r") || "A1");
        const raw = cell.querySelector("v")?.textContent || "";
        const value = cell.getAttribute("t") === "s" ? shared[Number(raw)] || "" : cell.getAttribute("t") === "inlineStr" ? Array.from(cell.querySelectorAll("t")).map(item => item.textContent || "").join("") : raw;
        values[index] = value;
      }
      return values.map(value => value || "").join("\t").trimEnd();
    }).filter(Boolean);
    sheets.push(`[工作表：${sheet.getAttribute("name") || "未命名"}]\n${rows.join("\n")}`);
  }
  return sheets.join("\n\n");
}

async function parsePptx(buffer: ArrayBuffer) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const output: string[] = [];
  for (let index = 0; index < slides.length; index++) {
    const xml = await zip.file(slides[index])?.async("text");
    if (xml) output.push(`[第 ${index + 1} 页]\n${textFromXml(xml)}`);
  }
  return output.join("\n\n");
}

async function createOcrWorker(onProgress?: (progress: ExtractionProgress) => void) {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker("chi_sim+eng", OEM.LSTM_ONLY, {
    logger: event => {
      if (event.status === "recognizing text") onProgress?.({ stage: "OCR", percent: Math.round((event.progress || 0) * 100), message: "正在识别扫描文字" });
    },
  });
}

async function parsePdf(file: File, onProgress?: (progress: ExtractionProgress) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = []; let worker: Awaited<ReturnType<typeof createOcrWorker>> | null = null; let usedOcr = false;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.({ stage: "READ", percent: Math.round((pageNumber / pdf.numPages) * 100), message: `正在解析 PDF 第 ${pageNumber}/${pdf.numPages} 页` });
      const page = await pdf.getPage(pageNumber); const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
      if (text.length >= 30) { pages.push(`[第 ${pageNumber} 页]\n${text}`); continue; }
      worker ??= await createOcrWorker(onProgress); usedOcr = true;
      const viewport = page.getViewport({ scale: 1.7 }); const canvas = document.createElement("canvas"); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d"); if (!context) continue;
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const result = await worker.recognize(canvas); pages.push(`[第 ${pageNumber} 页]\n${result.data.text.trim()}`);
    }
  } finally { if (worker) await worker.terminate(); await pdf.destroy(); }
  return { text: pages.join("\n\n"), usedOcr };
}

export async function extractKnowledgeFile(file: File, onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const textLike = file.type.startsWith("text/") || ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log"].includes(extension);
  try {
    onProgress?.({ stage: "READ", percent: 5, message: "正在读取资料" });
    if (textLike) return { text: await file.text(), method: "TEXT", ocrStatus: "NOT_REQUIRED", detail: "浏览器本地文本解析" };
    if (extension === "pdf" || file.type === "application/pdf") {
      const result = await parsePdf(file, onProgress);
      return { text: result.text, method: result.usedOcr ? "OCR" : "PDF_TEXT", ocrStatus: result.usedOcr ? "COMPLETED" : "NOT_REQUIRED", detail: result.usedOcr ? "PDF 文本层与本地 OCR 混合解析" : "PDF 文本层解析" };
    }
    if (extension === "docx") {
      const mammoth = await import("mammoth"); const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return { text: result.value, method: "DOCX", ocrStatus: "NOT_REQUIRED", detail: result.messages.length ? `Word 解析完成，${result.messages.length} 条格式提示` : "Word 文本解析" };
    }
    if (extension === "xlsx") return { text: await parseXlsx(await file.arrayBuffer()), method: "XLSX", ocrStatus: "NOT_REQUIRED", detail: "Excel 工作表解析" };
    if (extension === "pptx") return { text: await parsePptx(await file.arrayBuffer()), method: "PPTX", ocrStatus: "NOT_REQUIRED", detail: "PowerPoint 幻灯片解析" };
    if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(extension)) {
      const worker = await createOcrWorker(onProgress);
      try { const result = await worker.recognize(file); return { text: result.data.text, method: "OCR", ocrStatus: "COMPLETED", detail: `浏览器本地中英文 OCR，识别置信度 ${Math.round(result.data.confidence)}%` }; }
      finally { await worker.terminate(); }
    }
    return { text: "", method: "NONE", ocrStatus: "NOT_REQUIRED", detail: "当前格式保留原件，需补充可检索正文" };
  } catch (error) {
    return { text: "", method: "NONE", ocrStatus: file.type.startsWith("image/") || extension === "pdf" ? "FAILED" : "NOT_REQUIRED", detail: error instanceof Error ? `本地解析失败：${error.message}` : "本地解析失败" };
  }
}

async function getExtractor(onProgress?: (progress: ExtractionProgress) => void) {
  extractorPromise ??= (async () => {
    onProgress?.({ stage: "EMBED", percent: 5, message: "首次加载本地中文语义模型" });
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", LOCAL_EMBEDDING_MODEL, { dtype: "q8", progress_callback: event => {
      const progress = "progress" in event && typeof event.progress === "number" ? Math.round(event.progress) : 30;
      onProgress?.({ stage: "EMBED", percent: Math.min(95, progress), message: "正在加载本地中文语义模型" });
    } });
    return extractor as FeatureExtractor;
  })();
  return extractorPromise;
}

export async function embedLocally(inputs: string[], onProgress?: (progress: ExtractionProgress) => void) {
  if (!inputs.length) return [];
  const extractor = await getExtractor(onProgress); const vectors: number[][] = [];
  const batchSize = 8;
  for (let start = 0; start < inputs.length; start += batchSize) {
    const batch = inputs.slice(start, start + batchSize); const output = await extractor(batch, { pooling: "mean", normalize: true }); const value = output.tolist();
    if (!Array.isArray(value)) throw new Error("本地语义模型返回格式异常");
    const rows = batch.length === 1 && value.length === LOCAL_EMBEDDING_DIMENSIONS && value.every(item => typeof item === "number") ? [value] : value;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== LOCAL_EMBEDDING_DIMENSIONS || !row.every(item => typeof item === "number" && Number.isFinite(item))) throw new Error("本地语义向量维度异常");
      vectors.push(row as number[]);
    }
    onProgress?.({ stage: "EMBED", percent: Math.round((Math.min(inputs.length, start + batchSize) / inputs.length) * 100), message: `正在生成语义索引 ${Math.min(inputs.length, start + batchSize)}/${inputs.length}` });
  }
  return vectors;
}

export async function buildLocalSemanticIndex(documentId: number, onProgress?: (progress: ExtractionProgress) => void) {
  const response = await fetch(`/api/semantic-index?documentId=${documentId}`, { cache: "no-store" }); const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "无法读取索引资料");
  const chunks = Array.isArray(payload.data?.chunks) ? payload.data.chunks.map(String) : chunkText(String(payload.data?.text || ""));
  if (!chunks.length) return { indexed: false, chunks: 0 };
  const vectors = await embedLocally(chunks, onProgress);
  const saved = await fetch("/api/semantic-index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId, version: payload.data.version, model: LOCAL_EMBEDDING_MODEL, vectors }) });
  const result = await saved.json(); if (!saved.ok) throw new Error(result.error?.message || "语义索引保存失败");
  return { indexed: true, chunks: vectors.length };
}
