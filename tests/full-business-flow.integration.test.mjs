import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;

function sqlite(database, sql) {
  const result = spawnSync("sqlite3", [database], { input: sql, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || "sqlite execution failed");
  return result.stdout.trim();
}

test("real business flow persists upload, readiness, review, publish, ACL and governance closure", () => {
  const directory = mkdtempSync(join(tmpdir(), "zhiyu-flow-"));
  const database = join(directory, "knowledge.db");
  const migrations = readdirSync(join(root, "drizzle"))
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const migration of migrations) sqlite(database, readFileSync(join(root, "drizzle", migration), "utf8"));

  const result = sqlite(database, `
    PRAGMA foreign_keys=ON;
    BEGIN;
    INSERT INTO documents(id,dept_id,create_user_id,update_user_id,owner_user_id,title,summary,content,category,status,share_scope,security_level,owner,uploader,version,space_id,folder_id,extracted_text,parse_status,scan_status,ai_index_status,review_due_at)
      VALUES(99001,2,9002,9002,9002,'集成测试需求规范','验证完整流程','需求评审必须包含目标、范围、验收标准。','产品研发','DRAFT','DEPT','INTERNAL','Sean','Sean',1,2,2,'需求评审必须包含目标、范围、验收标准。','COMPLETED','CLEAN','INDEXED_LOCAL',date('now','+180 day'));
    INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(99001,1,'集成测试需求规范','需求评审必须包含目标、范围、验收标准。','首次上传',9002,'Sean');
    INSERT INTO document_chunks(document_id,dept_id,document_version,chunk_index,content,embedding,is_active) VALUES(99001,2,1,0,'需求评审必须包含目标、范围、验收标准。','[0.1,0.2]',1);
    UPDATE documents SET status='PENDING_DEPT_REVIEW' WHERE id=99001 AND parse_status='COMPLETED' AND scan_status='CLEAN' AND ai_index_status IN ('INDEXED','INDEXED_LOCAL','KEYWORD_READY') AND EXISTS(SELECT 1 FROM document_chunks WHERE document_id=99001 AND document_version=1);
    INSERT INTO approval_records(document_id,applicant_user_id,approver_user_id,action,comment) VALUES(99001,9002,9002,'APPROVE','内容、权限和索引校验通过');
    UPDATE documents SET status='ARCHIVED_ACTIVE',published_version=version,published_title=title,published_summary=summary,published_content=content,verification_status='VERIFIED',verified_at=CURRENT_TIMESTAMP WHERE id=99001 AND status='PENDING_DEPT_REVIEW';
    INSERT INTO enterprise_groups(id,name,code,dept_id) VALUES(99001,'需求评审委员会','PRD_REVIEW',2);
    INSERT INTO user_groups(user_id,group_id) VALUES(9003,99001);
    INSERT INTO document_acl(document_id,subject_type,subject_id,permission,create_user_id) VALUES(99001,'GROUP',99001,'VIEW',9002);
    INSERT INTO knowledge_governance_tasks(type,status,dept_id,source_document_id,reporter_user_id,assignee_user_id,reason,detail) VALUES('AI_UNRESOLVED','OPEN',2,99001,9003,9002,'答案不准确','缺少验收标准说明');
    UPDATE documents SET content=content||' 验收标准需量化。',published_content=content||' 验收标准需量化。',version=2,published_version=2,update_time=datetime('now','+2 second') WHERE id=99001;
    UPDATE knowledge_governance_tasks SET status='RESOLVED',target_document_id=99001,resolution='已补充量化验收标准并发布 V2.0',resolved_by=9002,resolved_at=datetime('now','+3 second') WHERE source_document_id=99001 AND status='OPEN';
    COMMIT;
    SELECT status||'|'||published_version||'|'||verification_status FROM documents WHERE id=99001;
    SELECT target_term FROM search_corrections WHERE source_term='虚球';
    SELECT COUNT(*) FROM document_acl a JOIN user_groups ug ON ug.group_id=a.subject_id WHERE a.document_id=99001 AND a.subject_type='GROUP' AND ug.user_id=9003;
    SELECT status||'|'||resolution FROM knowledge_governance_tasks WHERE source_document_id=99001;
    PRAGMA foreign_key_check;
  `).split("\n");

  assert.deepEqual(result, [
    "ARCHIVED_ACTIVE|2|VERIFIED",
    "需求",
    "1",
    "RESOLVED|已补充量化验收标准并发布 V2.0",
  ]);
});
