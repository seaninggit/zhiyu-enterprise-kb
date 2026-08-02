import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("free local OCR and semantic retrieval are wired end to end", async () => {
  const [client, index, search, ask, migration, page] = await Promise.all([
    read("lib/client-knowledge.ts"), read("app/api/semantic-index/route.ts"),
    read("app/api/search/route.ts"), read("app/api/ai/ask/route.ts"),
    read("drizzle/0009_free_local_ai_pipeline.sql"), read("app/page.tsx"),
  ]);
  assert.match(client, /tesseract\.js/);
  assert.match(client, /paraphrase-multilingual-MiniLM-L12-v2|LOCAL_EMBEDDING_MODEL/);
  assert.match(client, /pdfjs-dist/);
  assert.match(index, /DOCUMENT_NOT_PARSED/);
  assert.match(index, /INDEXED_LOCAL/);
  assert.match(search, /HYBRID_LOCAL/);
  assert.match(search, /row\.relevance > \(vector \? \.08 : 0\)/);
  assert.match(search, /a\.subject_id IN \(\$\{placeholders\(ctx\.deptIds\)\}\)\)\)\)\)/);
  assert.match(ask, /rag_local_vector/);
  assert.match(migration, /extraction_method/);
  assert.match(migration, /ocr_status/);
  assert.match(page, /重建本地语义索引/);
  assert.match(page, /本地语义检索 · DeepSeek RAG/);
});

test("content changes invalidate stale vectors before rebuilding", async () => {
  const [detail, platform, rag] = await Promise.all([
    read("app/api/documents/[id]/route.ts"), read("app/api/platform/route.ts"), read("lib/rag.ts"),
  ]);
  assert.match(detail, /DELETE FROM document_chunks WHERE document_id=\?/);
  assert.match(platform, /已发布版本继续对用户生效/);
  assert.match(rag, /document_version=\?/);
  assert.match(rag, /is_active=CASE WHEN document_version=\?/);
  assert.match(rag, /extraction_method\)!=="MANUAL_EDIT"/);
});

test("client and server extraction do not duplicate identical text", async () => {
  const [ingestion,detail] = await Promise.all([read("lib/ingestion.ts"),read("app/api/documents/[id]/route.ts")]);
  assert.match(ingestion, /mergeDistinctText/);
  assert.match(ingestion, /extraction_method\)!=="MANUAL_EDIT"/);
  assert.doesNotMatch(ingestion, /extracted=\[extracted,new TextDecoder\(\)\.decode\(bytes\)\]/);
  assert.match(detail, /extracted_text=\?/);
});
