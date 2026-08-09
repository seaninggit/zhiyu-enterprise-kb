import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("online file storage supports R2 and KV across upload, download and ingestion", () => {
  const storage = read("lib/knowledge-files.ts");
  const upload = read("app/api/uploads/route.ts");
  const detail = read("app/api/documents/[id]/route.ts");
  const ingestion = read("lib/ingestion.ts");
  const page = read("app/page.tsx");

  assert.match(storage, /R2Bucket \| KVNamespace/);
  assert.match(storage, /getWithMetadata/);
  assert.match(upload, /putKnowledgeFile/);
  assert.match(detail, /getKnowledgeFile/);
  assert.match(detail, /deleteKnowledgeFile/);
  assert.match(page, /"x-file-size": String\(file\.size\)/);
  assert.match(ingestion, /if\(!object\)\{if\(!extracted\)throw new Error\("SOURCE_FILE_NOT_FOUND"\)/);
  assert.match(ingestion, /indexPublishedDocument\(documentId\)\.catch/);
});
