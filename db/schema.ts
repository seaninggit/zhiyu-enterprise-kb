import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  content: text("content").notNull().default(""),
  category: text("category").notNull(),
  tags: text("tags").notNull().default(""),
  status: text("status").notNull().default("draft"),
  securityLevel: text("security_level").notNull().default("内部公开"),
  owner: text("owner").notNull(),
  uploader: text("uploader").notNull(),
  sourceName: text("source_name"),
  sourceKey: text("source_key"),
  mimeType: text("mime_type"),
  size: integer("size").notNull().default(0),
  version: integer("version").notNull().default(1),
  reviewDueAt: text("review_due_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const documentVersions = sqliteTable("document_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull(),
  version: integer("version").notNull(),
  changeNote: text("change_note").notNull(),
  operator: text("operator").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id"),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  reporter: text("reporter").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
