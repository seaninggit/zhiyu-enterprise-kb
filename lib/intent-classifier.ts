/**
 * 知域 · 语义意图分类器
 *
 * 用 DashScope embedding 做向量相似度匹配，替代硬编码正则。
 * 意图模板向量预计算缓存在 D1，启动后内存命中，单次分类 ~150ms。
 */
import { env } from "cloudflare:workers";
import { getD1 } from "../db";

// ---- 意图模板库（7 类 64 条） ----

const TEMPLATES: Record<string, string[]> = {
  identity: [
    "你是谁", "你是", "你叫什么", "你的名字是什么", "你是谁啊", "你是哪位",
    "你是什么", "你干嘛的", "你是做什么的", "你是干什么的", "你是AI吗",
    "你是机器人吗", "你是人工智能吗", "who are you", "你叫啥",
  ],
  capability: [
    "你能做什么", "你会什么", "你能干什么", "你有什么功能", "你能帮我做什么",
    "你会干啥", "怎么用你", "怎么使用你", "使用帮助", "help",
    "你能查什么", "你能回答什么", "有什么能力",
  ],
  greeting: [
    "你好", "你好啊", "您好", "hi", "hello", "嗨", "哈喽", "在吗", "在不在",
    "早上好", "下午好", "晚上好", "hi there", "hey", "你好呀",
  ],
  farewell: [
    "再见", "拜拜", "bye", "回头见", "下次见", "先这样", "先这样吧",
    "结束", "不聊了", "下了", "晚安", "明天见", "退下", "下去", "休息吧",
  ],
  gratitude: [
    "谢谢", "多谢", "感谢", "十分感谢", "非常感谢", "谢谢了", "辛苦了",
    "thank you", "thanks", "thx",
  ],
  acknowledge: [
    "好的", "好吧", "行吧", "知道了", "明白了", "了解了", "懂了", "收到", "了解", "行", "可以",
    "没问题", "got it", "OK", "好的谢谢", "好",
  ],
  account: [
    "我是谁", "我的身份", "我的账号", "查看我的权限", "我的角色",
    "当前什么身份", "我是什么角色",
  ],
  chat: [
    "聊聊天", "聊八卦", "讲个笑话", "你几岁了", "你有男朋友吗",
    "今天天气怎么样", "天气不错", "吃了吗", "你在干嘛", "陪我聊聊",
    "你无聊吗", "你喜欢什么", "你有什么爱好", "讲个故事", "唱首歌",
    "你聪明吗", "你是真人吗", "你有感情吗",
  ],
  insult: [
    "你是弱智", "你是智障", "傻逼", "垃圾", "废物", "去死",
    "你是白痴", "脑残", "你是sb", "fuck you", "滚",
    "你傻逼", "你垃圾", "你是不是傻", "你有病吧",
  ],
};

// ---- 向量缓存（内存） ----

let intentVectors: { label: string; vector: number[] }[] | null = null;
let loading = false;

async function loadCacheFromD1() {
  const db = getD1();
  const rows = await db.prepare("SELECT label, vector FROM intent_embeddings").all<{ label: string; vector: string }>();
  if (rows.results.length > 0) {
    intentVectors = rows.results.map(r => ({ label: r.label, vector: JSON.parse(r.vector) }));
  }
}

async function saveCacheToD1(entries: { label: string; vector: number[] }[]) {
  const db = getD1();
  await db.prepare("DELETE FROM intent_embeddings").run();
  for (const e of entries) {
    await db.prepare("INSERT INTO intent_embeddings(label, vector) VALUES(?, ?)")
      .bind(e.label, JSON.stringify(e.vector)).run();
  }
}

async function ensureCache(): Promise<void> {
  if (intentVectors) return;
  if (loading) { while (loading) await new Promise(r => setTimeout(r, 50)); return; }
  loading = true;
  try {
    await loadCacheFromD1();
    if (intentVectors && intentVectors.length > 0) return;

    // 首次启动：调 DashScope 预计算所有模板向量
    const apiKey = (env as unknown as Record<string, string>).DASHSCOPE_API_KEY;
    if (!apiKey) return;
    const allTemplates: { label: string; text: string }[] = [];
    for (const [label, texts] of Object.entries(TEMPLATES)) {
      for (const t of texts) allTemplates.push({ label, text: t });
    }
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "qwen3.7-text-embedding", input: allTemplates.map(t => t.text), dimensions: 1024 }),
    });
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    if (!data.data) return;
    intentVectors = data.data.map((d, i) => ({ label: allTemplates[i].label, vector: d.embedding }));
    await saveCacheToD1(intentVectors!);
  } catch { /* 降级：无缓存时语义分类不可用 */ }
  finally { loading = false; }
}

// ---- 余弦相似度 ----

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---- 语义分类入口 ----

export type IntentLabel = "identity" | "capability" | "greeting" | "farewell" | "gratitude" | "acknowledge" | "account" | "chat" | "insult" | null;

const THRESHOLD = 0.68;

export async function classifyIntent(question: string): Promise<{ label: IntentLabel; score: number }> {
  // 快速跳过：长于 15 字的基本是知识查询，不浪费 API 调用
  if (question.length > 15) return { label: null, score: 0 };
  // 含明显业务关键词的跳过
  const bizHints = ["报销", "差旅", "入职", "离职", "审批", "合同", "制度", "流程", "规范", "标准", "管理", "培训", "考核", "绩效", "申请", "假期", "加班", "调休", "出差", "采购", "付款", "发票", "税务", "合规", "安全", "保密", "资产", "档案", "会议", "预算", "工资", "薪酬", "福利", "招聘", "转正", "职级", "版本", "代码", "数据库", "项目", "需求", "发布"];
  if (bizHints.some(w => question.includes(w))) return { label: null, score: 0 };

  await ensureCache();
  if (!intentVectors || intentVectors.length === 0) return { label: null, score: 0 };

  // 嵌入用户输入
  const apiKey = (env as unknown as Record<string, string>).DASHSCOPE_API_KEY;
  if (!apiKey) return { label: null, score: 0 };
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "qwen3.7-text-embedding", input: [question], dimensions: 1024 }),
  });
  const data = await res.json() as { data?: Array<{ embedding: number[] }> };
  const qEmb = data.data?.[0]?.embedding;
  if (!qEmb) return { label: null, score: 0 };

  // 找最近邻意图
  let bestLabel = ""; let bestScore = 0;
  for (const item of intentVectors) {
    const score = cosineSim(qEmb, item.vector);
    if (score > bestScore) { bestScore = score; bestLabel = item.label; }
  }
  return bestScore >= THRESHOLD ? { label: bestLabel as IntentLabel, score: bestScore } : { label: null, score: bestScore };
}
