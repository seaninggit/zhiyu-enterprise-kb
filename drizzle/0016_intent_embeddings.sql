-- 语义意图向量缓存表
CREATE TABLE IF NOT EXISTS intent_embeddings (
  label TEXT PRIMARY KEY,
  vector TEXT NOT NULL
);
