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

// 定时治理巡检：读取 DB 配置的任务列表，按开关状态执行
function cronFieldMatches(field:string,value:number){return field==="*"||field.split(",").some(part=>Number(part)===value);}
function isCronDue(expression:string,date:Date){const [minute,hour,day,month,weekday]=expression.trim().split(/\s+/);if(!weekday)return false;return cronFieldMatches(minute,date.getUTCMinutes())&&cronFieldMatches(hour,date.getUTCHours())&&cronFieldMatches(day,date.getUTCDate())&&cronFieldMatches(month,date.getUTCMonth()+1)&&cronFieldMatches(weekday,date.getUTCDay());}

export async function scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
  const db = env.DB;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const rid = `cron-${Date.now()}`;
  const runTs = new Date().toISOString();

  const tasks = await db.prepare("SELECT code,cron_expr FROM scheduled_tasks WHERE enabled=1").all<{code:string;cron_expr:string}>();
  const beijingTime=new Date(controller.scheduledTime+8*60*60*1000);
  const enabled = new Set(tasks.results.filter(task=>isCronDue(task.cron_expr,beijingTime)).map(t => t.code));
  if(!enabled.size)return;

  let archived = 0, duplicates = 0, corrections = 0, reminded = 0;
  const alerts: string[] = [];

  if (enabled.has("archive_expired")) {
    // 查高频引用：过去30天被AI引用的文档
    const cited = await db.prepare("SELECT source_document_ids FROM ai_query_logs WHERE create_time > date('now','-30 days')").all<{source_document_ids:string}>();
    const citeCounts: Record<number,number> = {};
    for (const row of cited.results) { try { const ids=JSON.parse(row.source_document_ids||"[]") as number[]; for(const id of ids) citeCounts[id]=(citeCounts[id]||0)+1; } catch {} }
    // 作废前检查哪些是高频文档
    const expiring = await db.prepare("SELECT id,title FROM documents WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' AND review_due_at < date('now')").all<{id:number;title:string}>();
    const r = await db.prepare("UPDATE documents SET status='EXPIRED_VOID', update_time=? WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' AND review_due_at < date('now')").bind(now).run();
    archived = r.meta.changes;
    for (const doc of expiring.results) {
      const cnt = citeCounts[doc.id] || 0;
      if (cnt >= 10) alerts.push(`HIGH：《${doc.title}》已过期，过去30天被AI引用${cnt}次，建议尽快更新`);
      else if (cnt >= 3) alerts.push(`MID：《${doc.title}》已过期，被引用${cnt}次`);
    }
    await db.prepare("UPDATE scheduled_tasks SET last_run_at=? WHERE code='archive_expired'").bind(runTs).run();
  }

  if (enabled.has("detect_duplicates")) {
    const titles = await db.prepare("SELECT id,title,dept_id FROM documents WHERE is_deleted=0 AND status='ARCHIVED_ACTIVE' ORDER BY title").all<{id:number;title:string;dept_id:number}>();
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
            seen.add(titles.results[i].id);seen.add(titles.results[j].id);duplicates++;break;
          }
        }
      }
    }
    await db.prepare("UPDATE scheduled_tasks SET last_run_at=? WHERE code='detect_duplicates'").bind(runTs).run();
  }

  if (enabled.has("search_self_learn")) {
    const recentZeroSearches = await db.prepare("SELECT s.user_id,s.query,s.create_time FROM search_logs s WHERE s.result_count=0 AND s.create_time>date('now','-7 days') ORDER BY s.create_time").all<{user_id:number;query:string;create_time:string}>();
    for (const zero of recentZeroSearches.results) {
      const laterHit = await db.prepare("SELECT query FROM search_logs WHERE user_id=? AND result_count>0 AND create_time>? AND create_time<datetime(?,'+1 day') ORDER BY create_time LIMIT 1").bind(zero.user_id, zero.create_time, zero.create_time).first<{query:string}>();
      if (laterHit) {
        const { pinyin } = await import("pinyin-pro");
        const py1 = pinyin(zero.query, { toneType: "none", type: "array" }).join("");
        const py2 = pinyin(laterHit.query, { toneType: "none", type: "array" }).join("");
        if (py1 === py2 && zero.query !== laterHit.query) {
          await db.prepare("INSERT OR IGNORE INTO search_corrections(source_term,target_term,pinyin,kind) VALUES(?,?,?,'HOMOPHONE')").bind(zero.query, laterHit.query, py1).run();
          corrections++;
        }
      }
    }
    await db.prepare("UPDATE scheduled_tasks SET last_run_at=? WHERE code='search_self_learn'").bind(runTs).run();
  }

  if (enabled.has("review_reminders")) {
    const dueSoon = await db.prepare("SELECT d.id,d.title,d.owner_user_id FROM documents d WHERE d.is_deleted=0 AND d.status='ARCHIVED_ACTIVE' AND d.review_due_at BETWEEN date('now') AND date('now','+30 days')").all<{id:number;title:string;owner_user_id:number|null}>();
    for (const doc of dueSoon.results) {
      await db.prepare("INSERT OR IGNORE INTO notifications(user_id, type, title, content, document_id) VALUES(?,'GOVERNANCE','知识复核提醒',?,?)").bind(doc.owner_user_id || 1, `文档《${doc.title}》复核日期临近，请安排复核。`, doc.id).run();
      reminded++;
    }
    await db.prepare("UPDATE scheduled_tasks SET last_run_at=? WHERE code='review_reminders'").bind(runTs).run();
  }

  // 巡检完成后推送汇总通知给管理员
  if (archived > 0 || duplicates > 0 || alerts.length > 0) {
    const lines = [`本次巡检：作废${archived}份，查重${duplicates}组，纠错${corrections}条，复核提醒${reminded}份`];
    if (alerts.length > 0) { lines.push(""); lines.push("异常预警："); lines.push(...alerts); }
    await db.prepare("INSERT INTO notifications(user_id, type, title, content) VALUES(1,'GOVERNANCE','巡检报告',?)").bind(lines.join("\n")).run();
  }

  // 运营周报（每周一执行）
  if (enabled.has("agent_weekly_report")) {
    const [newDocs, searches, zeroResults, feedbacks] = await Promise.all([
      db.prepare("SELECT COUNT(*) cnt FROM documents WHERE is_deleted=0 AND create_time > date('now','-7 days')").first<{cnt:number}>(),
      db.prepare("SELECT COUNT(*) cnt FROM search_logs WHERE create_time > date('now','-7 days')").first<{cnt:number}>(),
      db.prepare("SELECT COUNT(*) cnt FROM search_logs WHERE result_count=0 AND create_time > date('now','-7 days')").first<{cnt:number}>(),
      db.prepare("SELECT COUNT(*) cnt FROM ai_answer_feedback WHERE create_time > date('now','-7 days') AND helpful=0").first<{cnt:number}>(),
    ]);
    const openTasks = await db.prepare("SELECT COUNT(*) cnt FROM knowledge_governance_tasks WHERE status='OPEN'").first<{cnt:number}>();
    const report = [
      `知识库运营周报（${new Date().toISOString().slice(0,10)}）`,
      "",
      `本周新增文档：${newDocs?.cnt||0} 份`,
      `搜索次数：${searches?.cnt||0} 次（零结果 ${zeroResults?.cnt||0} 次）`,
      `AI 回答负面反馈：${feedbacks?.cnt||0} 条`,
      `治理待办：${openTasks?.cnt||0} 项`,
      "",
      `自动处理：作废过期 ${archived} 份，查重 ${duplicates} 组，纠错 ${corrections} 条`,
    ];
    await db.prepare("INSERT INTO notifications(user_id, type, title, content) VALUES(1,'GOVERNANCE','运营周报',?)").bind(report.join("\n")).run();
    await db.prepare("UPDATE scheduled_tasks SET last_run_at=? WHERE code='agent_weekly_report'").bind(runTs).run();
  }

  await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(1,'CRON_GOVERNANCE',1,'系统',?,?)").bind(`巡检：作废${archived} 查重${duplicates} 纠错${corrections} 提醒${reminded}`, rid).run();
}
