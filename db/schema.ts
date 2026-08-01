import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  managerUserId: integer("manager_user_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`),
  updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("departments_code_uidx").on(table.code), index("departments_parent_idx").on(table.parentId)]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  identityProvider: text("identity_provider").notNull().default("CHATGPT"),
  lastLoginTime: text("last_login_time"),
  activatedBy: integer("activated_by"),
  disabledTime: text("disabled_time"),
  createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`),
  updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("users_email_uidx").on(table.email), index("users_status_idx").on(table.status), index("users_last_login_idx").on(table.lastLoginTime)]);

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
}, (table) => [uniqueIndex("roles_code_uidx").on(table.code)]);

export const userRoles = sqliteTable("user_roles", {
  userId: integer("user_id").notNull().references(() => users.id),
  roleId: integer("role_id").notNull().references(() => roles.id),
}, (table) => [primaryKey({ columns: [table.userId, table.roleId] }), index("user_roles_role_idx").on(table.roleId)]);

export const userDepartments = sqliteTable("user_departments", {
  userId: integer("user_id").notNull().references(() => users.id),
  deptId: integer("dept_id").notNull().references(() => departments.id),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  isDeptAdmin: integer("is_dept_admin", { mode: "boolean" }).notNull().default(false),
}, (table) => [primaryKey({ columns: [table.userId, table.deptId] }), index("user_departments_dept_idx").on(table.deptId)]);

export const knowledgeSpaces = sqliteTable("knowledge_spaces", { id: integer("id").primaryKey({ autoIncrement:true }), deptId:integer("dept_id").references(()=>departments.id), name:text("name").notNull(), code:text("code").notNull(), description:text("description").notNull().default(""), ownerUserId:integer("owner_user_id").references(()=>users.id), isActive:integer("is_active",{mode:"boolean"}).notNull().default(true), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime:text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, table=>[uniqueIndex("knowledge_spaces_code_uidx").on(table.code),index("knowledge_spaces_dept_idx").on(table.deptId)]);
export const knowledgeFolders = sqliteTable("knowledge_folders", { id:integer("id").primaryKey({autoIncrement:true}), spaceId:integer("space_id").notNull().references(()=>knowledgeSpaces.id), parentId:integer("parent_id"), name:text("name").notNull(), sortOrder:integer("sort_order").notNull().default(0), ownerUserId:integer("owner_user_id").references(()=>users.id), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime:text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[index("knowledge_folders_space_parent_idx").on(table.spaceId,table.parentId,table.sortOrder)]);

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  deptId: integer("dept_id").notNull().default(1).references(() => departments.id),
  createUserId: integer("create_user_id").notNull().default(1).references(() => users.id),
  updateUserId: integer("update_user_id").notNull().default(1).references(() => users.id),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  category: text("category").notNull(),
  status: text("status").notNull().default("DRAFT"),
  shareScope: text("share_scope").notNull().default("DEPT"),
  securityLevel: text("security_level").notNull().default("INTERNAL"),
  owner: text("owner").notNull(),
  uploader: text("uploader").notNull(),
  sourceName: text("source_name"),
  sourceKey: text("source_key"),
  mimeType: text("mime_type"),
  size: integer("size").notNull().default(0),
  version: integer("version").notNull().default(1),
  reviewDueAt: text("review_due_at"),
  aiIndexStatus: text("ai_index_status").notNull().default("PENDING"),
  aiIndexedAt: text("ai_indexed_at"),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  deletedBy: integer("deleted_by"),
  deletedAt: text("deleted_at"),
  createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`),
  updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`),
  spaceId: integer("space_id").references(() => knowledgeSpaces.id),
  folderId: integer("folder_id").references(() => knowledgeFolders.id),
  extractedText: text("extracted_text").notNull().default(""),
  parseStatus: text("parse_status").notNull().default("PENDING"),
  publishedVersion: integer("published_version"),
  publishedTitle: text("published_title"),
  publishedContent: text("published_content"),
  verificationStatus: text("verification_status").notNull().default("UNVERIFIED"),
  verifiedAt: text("verified_at"),
  ownerUserId: integer("owner_user_id").references(() => users.id),
  retentionUntil: text("retention_until"),
  legalHold: integer("legal_hold", { mode: "boolean" }).notNull().default(false),
  checksum: text("checksum"),
  scanStatus: text("scan_status").notNull().default("PENDING"),
  dlpFindings: text("dlp_findings").notNull().default("[]"),
  watermarkEnabled: integer("watermark_enabled", { mode: "boolean" }).notNull().default(false),
}, (table) => [
  index("documents_dept_status_idx").on(table.deptId, table.status, table.isDeleted),
  index("documents_creator_idx").on(table.createUserId),
  index("documents_share_idx").on(table.shareScope, table.status),
  check("documents_status_check", sql`${table.status} in ('DRAFT','PENDING_DEPT_REVIEW','ARCHIVED_ACTIVE','EXPIRED_VOID')`),
  check("documents_share_check", sql`${table.shareScope} in ('DEPT','CROSS_DEPT')`),
]);

export const tags = sqliteTable("tags", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), deptId: integer("dept_id") }, (table) => [uniqueIndex("tags_dept_name_uidx").on(table.deptId, table.name)]);
export const documentTags = sqliteTable("document_tags", { documentId: integer("document_id").notNull().references(() => documents.id), tagId: integer("tag_id").notNull().references(() => tags.id) }, (table) => [primaryKey({ columns: [table.documentId, table.tagId] }), index("document_tags_tag_idx").on(table.tagId)]);
export const documentVisibility = sqliteTable("document_visibility", { documentId: integer("document_id").notNull().references(() => documents.id), deptId: integer("dept_id").notNull().references(() => departments.id) }, (table) => [primaryKey({ columns: [table.documentId, table.deptId] }), index("document_visibility_dept_idx").on(table.deptId)]);

export const documentVersions = sqliteTable("document_versions", { id: integer("id").primaryKey({ autoIncrement: true }), documentId: integer("document_id").notNull().references(() => documents.id), version: integer("version").notNull(), title: text("title").notNull().default(""), content: text("content").notNull().default(""), changeNote: text("change_note").notNull(), operatorUserId: integer("operator_user_id").notNull().default(1), operator: text("operator").notNull(), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [uniqueIndex("document_versions_doc_ver_uidx").on(table.documentId, table.version)]);
export const approvalRecords = sqliteTable("approval_records", { id: integer("id").primaryKey({ autoIncrement: true }), documentId: integer("document_id").notNull().references(() => documents.id), applicantUserId: integer("applicant_user_id").notNull(), approverUserId: integer("approver_user_id"), action: text("action").notNull(), comment: text("comment").notNull().default(""), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("approval_records_doc_idx").on(table.documentId, table.createTime)]);
export const auditLogs = sqliteTable("audit_logs", { id: integer("id").primaryKey({ autoIncrement: true }), documentId: integer("document_id"), deptId: integer("dept_id"), action: text("action").notNull(), actorUserId: integer("actor_user_id").notNull().default(1), actor: text("actor").notNull(), detail: text("detail").notNull().default(""), requestId: text("request_id").notNull().default(""), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("audit_logs_doc_idx").on(table.documentId), index("audit_logs_dept_time_idx").on(table.deptId, table.createTime)]);
export const feedback = sqliteTable("feedback", { id: integer("id").primaryKey({ autoIncrement: true }), documentId: integer("document_id").notNull().references(() => documents.id), type: text("type").notNull(), content: text("content").notNull(), reporterUserId: integer("reporter_user_id").notNull().default(1), reporter: text("reporter").notNull(), status: text("status").notNull().default("OPEN"), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("feedback_doc_status_idx").on(table.documentId, table.status)]);
export const rateLimits = sqliteTable("rate_limits", { subject: text("subject").notNull(), bucket: text("bucket").notNull(), count: integer("count").notNull().default(0), resetAt: integer("reset_at").notNull() }, (table) => [primaryKey({ columns: [table.subject, table.bucket] })]);

export const documentChunks = sqliteTable("document_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }), documentId: integer("document_id").notNull().references(() => documents.id), deptId: integer("dept_id").notNull().references(() => departments.id), documentVersion: integer("document_version").notNull(), chunkIndex: integer("chunk_index").notNull(), content: text("content").notNull(), embedding: text("embedding"), embeddingModel: text("embedding_model"), isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("document_chunks_doc_ver_idx").on(table.documentId, table.documentVersion, table.chunkIndex), index("document_chunks_dept_active_idx").on(table.deptId, table.isActive)]);

export const aiQueryLogs = sqliteTable("ai_query_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }), userId: integer("user_id").notNull().references(() => users.id), deptId: integer("dept_id").notNull().references(() => departments.id), question: text("question").notNull(), answer: text("answer").notNull(), mode: text("mode").notNull(), sourceDocumentIds: text("source_document_ids").notNull().default("[]"), requestId: text("request_id").notNull(), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("ai_query_logs_user_time_idx").on(table.userId, table.createTime), index("ai_query_logs_dept_time_idx").on(table.deptId, table.createTime)]);

export const knowledgeSubscriptions = sqliteTable("knowledge_subscriptions", { documentId: integer("document_id").notNull().references(() => documents.id), userId: integer("user_id").notNull().references(() => users.id), isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [primaryKey({ columns: [table.documentId, table.userId] }), index("knowledge_subscriptions_user_idx").on(table.userId, table.isActive)]);

export const aiAnswerFeedback = sqliteTable("ai_answer_feedback", { id: integer("id").primaryKey({ autoIncrement: true }), queryLogId: integer("query_log_id").notNull().references(() => aiQueryLogs.id), userId: integer("user_id").notNull().references(() => users.id), helpful: integer("helpful", { mode: "boolean" }).notNull(), reason: text("reason").notNull().default(""), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [uniqueIndex("ai_answer_feedback_query_user_idx").on(table.queryLogId, table.userId)]);

export const aiConversations = sqliteTable("ai_conversations", { id: integer("id").primaryKey({ autoIncrement: true }), userId: integer("user_id").notNull().references(() => users.id), title: text("title").notNull(), status: text("status").notNull().default("ACTIVE"), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("ai_conversations_user_time_idx").on(table.userId, table.updateTime)]);
export const aiMessages = sqliteTable("ai_messages", { id: integer("id").primaryKey({ autoIncrement: true }), conversationId: integer("conversation_id").notNull().references(() => aiConversations.id), userId: integer("user_id").notNull().references(() => users.id), role: text("role").notNull(), content: text("content").notNull(), mode: text("mode"), sourcePayload: text("source_payload").notNull().default("[]"), queryLogId: integer("query_log_id").references(() => aiQueryLogs.id), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("ai_messages_conversation_time_idx").on(table.conversationId, table.createTime)]);
export const knowledgeGovernanceTasks = sqliteTable("knowledge_governance_tasks", { id: integer("id").primaryKey({ autoIncrement: true }), type: text("type").notNull(), status: text("status").notNull().default("OPEN"), deptId: integer("dept_id").notNull().references(() => departments.id), sourceDocumentId: integer("source_document_id").references(() => documents.id), sourceMessageId: integer("source_message_id").references(() => aiMessages.id), reporterUserId: integer("reporter_user_id").notNull().references(() => users.id), reason: text("reason").notNull(), detail: text("detail").notNull().default(""), createTime: text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime: text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) }, (table) => [index("knowledge_governance_tasks_status_time_idx").on(table.status, table.createTime), index("knowledge_governance_tasks_dept_status_idx").on(table.deptId, table.status)]);

export const documentAcl = sqliteTable("document_acl", { id:integer("id").primaryKey({autoIncrement:true}), documentId:integer("document_id").notNull().references(()=>documents.id), subjectType:text("subject_type").notNull(), subjectId:integer("subject_id").notNull(), permission:text("permission").notNull(), expiresAt:text("expires_at"), createUserId:integer("create_user_id").notNull().references(()=>users.id), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[uniqueIndex("document_acl_unique_idx").on(table.documentId,table.subjectType,table.subjectId,table.permission),index("document_acl_subject_idx").on(table.subjectType,table.subjectId,table.permission)]);
export const ingestionJobs = sqliteTable("ingestion_jobs", { id:integer("id").primaryKey({autoIncrement:true}), documentId:integer("document_id").notNull().references(()=>documents.id), documentVersion:integer("document_version").notNull(), status:text("status").notNull().default("QUEUED"), stage:text("stage").notNull().default("EXTRACT"), attempt:integer("attempt").notNull().default(0), extractedChars:integer("extracted_chars").notNull().default(0), chunkCount:integer("chunk_count").notNull().default(0), errorMessage:text("error_message").notNull().default(""), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`), updateTime:text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[index("ingestion_jobs_doc_idx").on(table.documentId,table.documentVersion),index("ingestion_jobs_status_idx").on(table.status,table.updateTime)]);
export const searchLogs = sqliteTable("search_logs", { id:integer("id").primaryKey({autoIncrement:true}), userId:integer("user_id").notNull().references(()=>users.id), deptId:integer("dept_id").notNull().references(()=>departments.id), query:text("query").notNull(), resultCount:integer("result_count").notNull().default(0), clickedDocumentId:integer("clicked_document_id"), mode:text("mode").notNull().default("HYBRID"), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[index("search_logs_time_idx").on(table.createTime),index("search_logs_zero_idx").on(table.resultCount,table.createTime)]);
export const notifications = sqliteTable("notifications", { id:integer("id").primaryKey({autoIncrement:true}), userId:integer("user_id").notNull().references(()=>users.id), type:text("type").notNull(), title:text("title").notNull(), content:text("content").notNull().default(""), documentId:integer("document_id"), isRead:integer("is_read",{mode:"boolean"}).notNull().default(false), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[index("notifications_user_read_idx").on(table.userId,table.isRead,table.createTime)]);
export const userFavorites = sqliteTable("user_favorites", { userId:integer("user_id").notNull().references(()=>users.id), documentId:integer("document_id").notNull().references(()=>documents.id), createTime:text("create_time").notNull().default(sql`CURRENT_TIMESTAMP`) },table=>[primaryKey({columns:[table.userId,table.documentId]}),index("user_favorites_user_idx").on(table.userId,table.createTime)]);
export const systemSettings = sqliteTable("system_settings", { key:text("key").primaryKey(), value:text("value").notNull(), description:text("description").notNull().default(""), updateUserId:integer("update_user_id").references(()=>users.id), updateTime:text("update_time").notNull().default(sql`CURRENT_TIMESTAMP`) });
