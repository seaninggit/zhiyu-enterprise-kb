/** Cloudflare Worker entry point for Zhiyu Enterprise Knowledge Hub. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

// 定时治理巡检：每天凌晨自动执行
export async function scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
  const db = env.DB;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const rid = `cron-${Date.now()}`;

  // 1. 自动作废过期文档
  const expired = await db.prepare(
    "UPDATE documents SET status='EXPIRED_VOID', update_time=? WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' AND review_due_at < date('now')"
  ).bind(now).run();

  // 2. 检测重复文档并创建治理任务
  const titles = await db.prepare(
    "SELECT id,title,dept_id,owner FROM documents WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' ORDER BY title"
  ).all<{id:number;title:string;dept_id:number;owner:string}>();
  const seen = new Set<number>();
  for (let i=0;i<titles.results.length;i++){
    if(seen.has(titles.results[i].id))continue;
    const t1=titles.results[i].title.replace(/[Vv]\d+(\.\d+)*/g,"").replace(/[（(].*[）)]/g,"").trim();
    for(let j=i+1;j<titles.results.length;j++){
      if(seen.has(titles.results[j].id))continue;
      const t2=titles.results[j].title.replace(/[Vv]\d+(\.\d+)*/g,"").replace(/[（(].*[）)]/g,"").trim();
      if(t1.length>3&&t2.length>3){
        const common=t1.split("").filter((c:string)=>t2.includes(c)).length;
        if(common/Math.max(t1.length,t2.length)>.65){
          await db.prepare("INSERT OR IGNORE INTO knowledge_governance_tasks(type,status,dept_id,source_document_id,reporter_user_id,reason,detail) VALUES('DUPLICATE','OPEN',?,?,1,?,?)").bind(titles.results[i].dept_id,titles.results[i].id,'疑似重复文档','《'+titles.results[i].title+'》与《'+titles.results[j].title+'》高度相似').run();
          seen.add(titles.results[i].id);seen.add(titles.results[j].id);
          break;
        }
      }
    }
  }

  // 3. 搜索自学习：分析零结果搜索→后续成功搜索→自动建同音纠错
  const recentZeroSearches = await db.prepare(
    "SELECT s.user_id,s.query,s.create_time FROM search_logs s WHERE s.result_count=0 AND s.create_time>date('now','-7 days') ORDER BY s.create_time"
  ).all<{user_id:number;query:string;create_time:string}>();
  for (const zero of recentZeroSearches.results) {
    const laterHit = await db.prepare(
      "SELECT query FROM search_logs WHERE user_id=? AND result_count>0 AND create_time>? AND create_time<datetime(?,'+1 day') ORDER BY create_time LIMIT 1"
    ).bind(zero.user_id, zero.create_time, zero.create_time).first<{query:string}>();
    if (laterHit) {
      // 判断是否同音：pinyin 相同且编辑距离小
      const { pinyin } = await import("pinyin-pro");
      const py1 = pinyin(zero.query, { toneType: "none", type: "array" }).join("");
      const py2 = pinyin(laterHit.query, { toneType: "none", type: "array" }).join("");
      if (py1 === py2 && zero.query !== laterHit.query) {
        await db.prepare(
          "INSERT OR IGNORE INTO search_corrections(source_term,target_term,pinyin,kind) VALUES(?,?,?,'HOMOPHONE')"
        ).bind(zero.query, laterHit.query, py1).run();
      }
    }
  }

  // 4. 临近复核提醒（30天内）- 创建通知
  const dueSoon = await db.prepare(
    "SELECT d.id,d.title,d.owner_user_id,d.owner,d.review_due_at FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.review_due_at BETWEEN date('now') AND date('now','+30 days')"
  ).all<{id:number;title:string;owner_user_id:number|null;owner:string;review_due_at:string}>();
  for (const doc of dueSoon.results) {
    const uid = doc.owner_user_id || 1;
    await db.prepare("INSERT OR IGNORE INTO notifications(user_id, type, title, content, document_id) VALUES(?,'GOVERNANCE','知识复核提醒',?,?)").bind(uid, `文档《${doc.title}》复核日期临近（${doc.review_due_at}），请安排复核。`, doc.id).run();
  }

  // 4. 审计日志
  await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(1,'CRON_GOVERNANCE',1,'系统','定时巡检：自动作废'+?+'份，复核提醒'+?+'份',?)").bind(expired.meta.changes, dueSoon.results.length, rid).run();
  console.log(`[cron] Archived ${expired.meta.changes} expired, detected duplicates, notified ${dueSoon.results.length} due-soon`);
}
