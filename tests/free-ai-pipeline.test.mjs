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
  assert.match(ask, /hasComparableVector \? vector \* vectorWeight \+ keyword \* keywordWeight : keyword/);
  assert.match(ask, /item\.hasComparableVector \? \.18 : \.15/);
  assert.match(ask, /rag_keyword_fallback/);
  assert.match(ask, /LOW_SIGNAL_TERMS/);
  assert.match(ask, /NOT EXISTS\(SELECT 1 FROM document_chunks/);
  assert.match(ask, /assistant_identity/);
  assert.match(ask, /assistant_capabilities/);
  assert.match(ask, /assistant_account/);
  assert.match(ask, /assistant_farewell/);
  assert.match(ask, /退下\|下去\|休息/);
  assert.match(ask, /source_document_ids,request_id[\s\S]*VALUES\(\?,\?,\?,\?,\?,'\[\]'/);
  assert.match(migration, /extraction_method/);
  assert.match(migration, /ocr_status/);
  assert.match(page, /重建本地语义索引/);
  assert.match(page, /本地语义检索 · DeepSeek RAG/);
  assert.match(page, /平台助手 · 无需知识检索/);
  assert.match(page, /returnToAi=\{documentReturnTarget==="ai"\}/);
  assert.match(page, /← 返回问答/);
});

test("AI conversation preserves ordered context and returns from cited documents", async()=>{
  const [ask,conversations,migration,page]=await Promise.all([read("app/api/ai/ask/route.ts"),read("app/api/ai/conversations/route.ts"),read("drizzle/0011_ai_conversation_sequence.sql"),read("app/page.tsx")]);
  assert.match(migration,/sequence_no/);
  assert.match(ask,/ORDER BY sequence_no DESC,id DESC LIMIT 8/);
  assert.match(ask,/retrievalQuestion/);
  assert.match(ask,/contextDocumentIds\.has\(Number\(row\.document_id\)\)/);
  assert.match(conversations,/ORDER BY m\.sequence_no ASC,m\.id ASC/);
  assert.match(conversations,/ORDER BY m\.sequence_no DESC,m\.id DESC LIMIT 1/);
  assert.doesNotMatch(page,/await openDocument\(documentId\); setAiOpen\(false\)/);
  assert.match(page,/embeddingText=isContextFollowUp/);
  assert.match(page,/message\.sources\.length>0&&<button onClick=\{\(\) => ask/);
});

test("AI conversation follows new messages without stealing manual history scroll", async()=>{
  const [page,css]=await Promise.all([read("app/page.tsx"),read("app/globals.css")]);
  assert.match(page,/conversationScrollRef/);
  assert.match(page,/keepAtBottomRef/);
  assert.match(page,/node\.scrollTo\(\{top:node\.scrollHeight/);
  assert.match(page,/node\.scrollHeight-node\.scrollTop-node\.clientHeight<96/);
  assert.match(page,/keepAtBottomRef\.current=true;const userText/);
  assert.match(page,/chat-scroll-anchor/);
  assert.match(css,/scroll-padding-block-end:44px/);
  assert.match(css,/\.ai-compose \{ position:relative; z-index:2;/);
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
