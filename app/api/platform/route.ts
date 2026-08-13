import { getD1 } from "../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../lib/api";
import { canManageDepartment, requireApiUser } from "../../../lib/authz";
import { processDocument } from "../../../lib/ingestion";
import { runGovernanceMaintenance } from "../../../lib/governance";
import { notifyUser } from "../../../lib/notifications";
import { resolvePublishedFeedback } from "../../../lib/governance-feedback";
import { chatRuntime, generateChat } from "../../../lib/ai-provider";
import { env } from "cloudflare:workers";
function placeholders(values: number[]) {
  return values.map(() => "?").join(",");
}
export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (ctx.role === "EMPLOYEE")
      throw new ApiError(
        403,
        "ADMIN_REQUIRED",
        "仅知识管理员可访问企业治理中心",
      );
    await runGovernanceMaintenance().catch(() => undefined);
    const db = getD1();
    const scope =
      ctx.role === "SUPER_ADMIN"
        ? "1=1"
        : `d.dept_id IN (${placeholders(ctx.deptIds)})`;
    const binds = ctx.role === "SUPER_ADMIN" ? [] : ctx.deptIds;
    const [
      metrics,
      searches,
      content,
      quality,
      jobs,
      spaces,
      approvals,
      settings,
      modelServices,
      modelRoutes,
    ] = await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) documents,SUM(CASE WHEN d.status='ARCHIVED_ACTIVE' THEN 1 ELSE 0 END) published,SUM(CASE WHEN d.status='PENDING_DEPT_REVIEW' THEN 1 ELSE 0 END) pending,SUM(CASE WHEN d.parse_status IN ('FAILED','OCR_FAILED','NEEDS_CONTENT') THEN 1 ELSE 0 END) parse_failed,SUM(CASE WHEN d.review_due_at<=date('now','+30 day') AND d.status='ARCHIVED_ACTIVE' THEN 1 ELSE 0 END) due_soon,SUM(CASE WHEN d.verification_status='VERIFIED' THEN 1 ELSE 0 END) verified FROM documents d WHERE d.is_deleted=0 AND ${scope}`,
        )
        .bind(...binds)
        .first(),
      db
        .prepare(
          `SELECT COUNT(*) searches,SUM(CASE WHEN result_count=0 THEN 1 ELSE 0 END) zero_results,COUNT(DISTINCT user_id) users FROM search_logs WHERE create_time>=datetime('now','-30 day')`,
        )
        .first(),
      db
        .prepare(
          `SELECT action,COUNT(*) count FROM audit_logs WHERE create_time>=datetime('now','-30 day') GROUP BY action ORDER BY count DESC`,
        )
        .all(),
      db
        .prepare(
          `SELECT question,COUNT(*) count FROM ai_query_logs WHERE mode='no_evidence' GROUP BY question ORDER BY count DESC LIMIT 10`,
        )
        .all(),
      db
        .prepare(
          `SELECT j.*,d.title FROM ingestion_jobs j JOIN documents d ON d.id=j.document_id WHERE ${scope} ORDER BY j.update_time DESC LIMIT 30`,
        )
        .bind(...binds)
        .all(),
      db
        .prepare(
          `SELECT s.*,f.id folder_id,f.name folder_name,f.parent_id,f.sort_order,COUNT(DISTINCT d.id) document_count FROM knowledge_spaces s LEFT JOIN knowledge_folders f ON f.space_id=s.id LEFT JOIN documents d ON d.folder_id=f.id AND d.is_deleted=0 WHERE s.is_active=1 AND (${ctx.role==="SUPER_ADMIN"?"1=1":`s.dept_id IS NULL OR s.dept_id IN (${placeholders(ctx.deptIds)})`}) GROUP BY s.id,f.id ORDER BY s.id,f.sort_order`,
        )
        .bind(...(ctx.role==="SUPER_ADMIN"?[]:ctx.deptIds))
        .all(),
      db
        .prepare(
          `SELECT a.*,d.title,u.display_name applicant,p.display_name approver FROM approval_records a JOIN documents d ON d.id=a.document_id JOIN users u ON u.id=a.applicant_user_id LEFT JOIN users p ON p.id=a.approver_user_id WHERE ${scope} ORDER BY a.create_time DESC LIMIT 50`,
        )
        .bind(...binds)
        .all(),
      ctx.role === "SUPER_ADMIN"
        ? db.prepare("SELECT * FROM system_settings ORDER BY key").all()
        : Promise.resolve({ results: [] }),
      ctx.role === "SUPER_ADMIN"
        ? db.prepare("SELECT s.*,COUNT(r.scene_code) route_count FROM ai_model_services s LEFT JOIN ai_scene_routes r ON r.primary_service_id=s.id OR r.fallback_service_id=s.id GROUP BY s.id ORDER BY s.status DESC,s.id").all()
        : Promise.resolve({results:[]}),
      ctx.role === "SUPER_ADMIN"
        ? db.prepare("SELECT r.*,p.name primary_service_name,p.model_code primary_model_code,f.name fallback_service_name FROM ai_scene_routes r JOIN ai_model_services p ON p.id=r.primary_service_id LEFT JOIN ai_model_services f ON f.id=r.fallback_service_id ORDER BY r.scene_code").all()
        : Promise.resolve({results:[]}),
    ]);
    const total = Number((metrics as Record<string, unknown>)?.documents || 0);
    const verified = Number(
      (metrics as Record<string, unknown>)?.verified || 0,
    );
    const failed = Number(
      (metrics as Record<string, unknown>)?.parse_failed || 0,
    );
    const due = Number((metrics as Record<string, unknown>)?.due_soon || 0);
    const health = total
      ? Math.max(
          0,
          Math.round(
            (verified / total) * 70 +
              (1 - failed / total) * 20 +
              (1 - due / total) * 10,
          ),
        )
      : 100;
    const runtimeEnv=env as unknown as Record<string,string|undefined>,registeredModels=modelServices.results as Record<string,unknown>[],deepSeek=registeredModels.find(item=>String(item.provider).toLowerCase()==="deepseek");
    const aiCapabilities=ctx.role==="SUPER_ADMIN"?[
      {code:"GENERATION",name:"企业知识生成",engine:"DeepSeek",model:String(deepSeek?.model_code||runtimeEnv.AI_CHAT_MODEL||"deepseek-v4-flash"),purpose:"智能问答、知识治理 Agent、PromptOps 评测",status:runtimeEnv.DEEPSEEK_API_KEY?"AVAILABLE":"NOT_CONFIGURED",serviceId:Number(deepSeek?.id||0)||null},
      {code:"CLOUD_EMBEDDING",name:"云端语义向量",engine:"阿里云百炼",model:"qwen3.7-text-embedding",purpose:"知识索引、语义检索、短问题意图识别",status:runtimeEnv.DASHSCOPE_API_KEY?"AVAILABLE":"NOT_CONFIGURED"},
      {code:"LOCAL_EMBEDDING",name:"本地语义向量",engine:"Transformers.js",model:"paraphrase-multilingual-MiniLM-L12-v2",purpose:"浏览器本地索引与无云端向量时的降级",status:"AVAILABLE"},
      {code:"LOCAL_OCR",name:"本地文字识别",engine:"Tesseract.js",model:"浏览器本地 OCR",purpose:"图片文字识别，不向云端发送原图",status:"AVAILABLE"},
      {code:"DOCUMENT_AI",name:"云端文档解析",engine:"OpenAI",model:String(runtimeEnv.OPENAI_CHAT_MODEL||"gpt-5.6-terra"),purpose:"仅在本地未提取到文本时解析图片或文件",status:runtimeEnv.OPENAI_API_KEY?"AVAILABLE":"NOT_CONFIGURED"},
    ]:[];
    return ok(
      {
        metrics: { ...metrics, health },
        searches,
        content: content.results,
        quality: quality.results,
        jobs: jobs.results,
        spaces: spaces.results,
        approvals: approvals.results,
        settings: settings.results,
        modelServices: modelServices.results,
        modelRoutes: modelRoutes.results,
        aiCapabilities,
      },
      rid,
    );
  } catch (error) {
    return fail(error, rid);
  }
}
export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (ctx.role === "EMPLOYEE")
      throw new ApiError(403, "ADMIN_REQUIRED", "仅知识管理员可执行治理操作");
    const payload = (await request.json()) as Record<string, unknown>;
    const action = safeText(payload.action, 40);
    const db = getD1();
    const managedDocument = async (id: number) => {
      const doc = await db
        .prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0")
        .bind(id)
        .first<Record<string, unknown>>();
      if (!doc || !canManageDepartment(ctx, Number(doc.dept_id)))
        throw new ApiError(403, "FORBIDDEN", "无权管理该资料");
      return doc;
    };
    if (action === "PROCESS") {
      const id = Number(payload.documentId);
      await managedDocument(id);
      return ok(await processDocument(id), rid);
    }
    if (action === "RESTORE_VERSION") {
      const id = Number(payload.documentId),
        version = Number(payload.version);
      const doc = await managedDocument(id);
      const old = await db
        .prepare(
          "SELECT * FROM document_versions WHERE document_id=? AND version=?",
        )
        .bind(id, version)
        .first<Record<string, unknown>>();
      if (!old) throw new ApiError(404, "VERSION_NOT_FOUND", "历史版本不存在");
      const next = Number(doc.version) + 1;
      await db.batch([
        db
          .prepare(
            "UPDATE documents SET title=?,content=?,extracted_text=?,version=?,status='DRAFT',parse_status='COMPLETED',ai_index_status='PENDING',update_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(old.title, old.content, old.content, next, ctx.userId, id),
        db
          .prepare(
            "DELETE FROM document_chunks WHERE document_id=? AND document_version=?",
          )
          .bind(id, next),
        db
          .prepare(
            "INSERT INTO document_versions(document_id,version,title,content,change_note,operator_user_id,operator) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            next,
            old.title,
            old.content,
            `从 V${version}.0 恢复`,
            ctx.userId,
            ctx.displayName,
          ),
        db
          .prepare(
            "INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'VERSION_RESTORE',?,?,?,?)",
          )
          .bind(
            id,
            doc.dept_id,
            ctx.userId,
            ctx.displayName,
            `恢复 V${version}.0 为新草稿 V${next}.0；已发布版本继续对用户生效`,
            rid,
          ),
      ]);
      return ok({ restored: true, version: next }, rid);
    }
    if (action === "VERIFY") {
      const id = Number(payload.documentId);
      await managedDocument(id);
      await db
        .prepare(
          "UPDATE documents SET verification_status='VERIFIED',verified_at=CURRENT_TIMESTAMP,review_due_at=date('now','+180 day'),update_user_id=? WHERE id=?",
        )
        .bind(ctx.userId, id)
        .run();
      return ok({ verified: true }, rid);
    }
    if (action === "START_GOVERNANCE") {
      const task = await db
        .prepare(
          "SELECT id,dept_id,reason,source_document_id FROM knowledge_governance_tasks WHERE id=? AND status='OPEN'",
        )
        .bind(Number(payload.taskId))
        .first<{ id: number; dept_id: number; reason: string; source_document_id: number | null }>();
      if (!task || !canManageDepartment(ctx, task.dept_id))
        throw new ApiError(403, "FORBIDDEN", "无权处理该治理任务");
      if(task.source_document_id)throw new ApiError(409,"OWNER_REVISION_REQUIRED","关联文档反馈已自动指派上传人修订，管理员只负责监控和后续审批");
      await db.batch([
        db
          .prepare(
            "UPDATE knowledge_governance_tasks SET status='IN_PROGRESS',workflow_stage='ADMIN_TRIAGE',assignee_user_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(ctx.userId, task.id),
        db
          .prepare(
            "INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'GOVERNANCE_STARTED',?,?,?,?)",
          )
          .bind(
            task.source_document_id,
            task.dept_id,
            ctx.userId,
            ctx.displayName,
            `认领知识治理任务 #${task.id}：${task.reason}`,
            rid,
          ),
      ]);
      return ok(
        { started: true, status: "IN_PROGRESS", assignee: ctx.displayName, taskId: task.id },
        rid,
      );
    }
    if (action === "RESOLVE_GOVERNANCE") {
      const task = await db
        .prepare(
          "SELECT * FROM knowledge_governance_tasks WHERE id=? AND status IN ('OPEN','IN_PROGRESS')",
        )
        .bind(Number(payload.taskId))
        .first<Record<string, unknown>>();
      if (!task || !canManageDepartment(ctx, Number(task.dept_id)))
        throw new ApiError(403, "FORBIDDEN", "无权处理该治理任务");
      const resolution = safeText(payload.resolution, 1000);
      if (resolution.length < 4)
        throw new ApiError(400, "RESOLUTION_REQUIRED", "请填写具体处理结果");
      const targetId =
        Number(payload.targetDocumentId || task.source_document_id) || null;
      let target: Record<string, unknown> | null = null;
      if (targetId) {
        target =
          (await db
            .prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0")
            .bind(targetId)
            .first<Record<string, unknown>>()) || null;
        if (!target || !canManageDepartment(ctx, Number(target.dept_id)))
          throw new ApiError(403, "FORBIDDEN", "无权关联该知识");
      }
    const requiresPublished =
      ["DOCUMENT_FEEDBACK","AI_UNRESOLVED"].includes(String(task.type)) ||
        /没有找到资料|内容已过期/.test(String(task.reason));
      if (
        requiresPublished &&
        (!target ||
          target.status !== "ARCHIVED_ACTIVE" ||
          String(target.update_time) <= String(task.create_time))
      )
        throw new ApiError(
          409,
          "KNOWLEDGE_UPDATE_REQUIRED",
          "该反馈需先更新或新增知识并完成审核发布，再关闭治理任务",
        );
      await db.batch([
        db
          .prepare(
            "UPDATE knowledge_governance_tasks SET status='RESOLVED',workflow_stage='RESOLVED',assignee_user_id=COALESCE(assignee_user_id,?),target_document_id=?,resolution=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(ctx.userId, targetId, resolution, ctx.userId, task.id),
        ...(task.source_document_id
          ? [
              db
                .prepare(
                  "UPDATE feedback SET status='RESOLVED' WHERE document_id=? AND reporter_user_id=? AND status='OPEN'",
                )
                .bind(task.source_document_id, task.reporter_user_id),
            ]
          : []),
        db
          .prepare(
            "INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'GOVERNANCE_RESOLVED',?,?,?,?)",
          )
          .bind(
            targetId,
            task.dept_id,
            ctx.userId,
            ctx.displayName,
            resolution,
            rid,
          ),
      ]);
      const delivery=await notifyUser({userId:Number(task.reporter_user_id),type:"GOVERNANCE_RESOLVED",title:"你的知识反馈已处理",content:resolution,documentId:targetId,requestId:rid,email:true});
      return ok(
        { resolved: true, notified: true, delivery, targetDocumentId: targetId },
        rid,
      );
    }
    if (action === "AUTO_RESOLVE_TASKS") {
      const docId = Number(payload.documentId);
      if (!docId) throw new ApiError(400, "VALIDATION_ERROR", "文档ID不能为空");
      const result=await resolvePublishedFeedback({documentId:docId,actorUserId:ctx.userId,actorName:ctx.displayName,requestId:rid});
      return ok(result, rid);
    }
    if (action === "CREATE_SPACE") {
      if (ctx.role !== "SUPER_ADMIN")
        throw new ApiError(
          403,
          "SUPER_ADMIN_REQUIRED",
          "仅超级管理员可创建知识空间",
        );
      const name = safeText(payload.name, 80),
        code = safeText(payload.code, 40).toUpperCase();
      if (!name || !code)
        throw new ApiError(400, "VALIDATION_ERROR", "空间名称和编码不能为空");
      const result = await db
        .prepare(
          "INSERT INTO knowledge_spaces(dept_id,name,code,description,owner_user_id) VALUES(?,?,?,?,?)",
        )
        .bind(
          Number(payload.deptId) || null,
          name,
          code,
          safeText(payload.description, 300),
          ctx.userId,
        )
        .run();
      return ok({ id: result.meta.last_row_id }, rid, 201);
    }
    if (action === "CREATE_FOLDER") {
      const spaceId = Number(payload.spaceId),
        name = safeText(payload.name, 80);
      const space = await db
        .prepare("SELECT dept_id FROM knowledge_spaces WHERE id=?")
        .bind(spaceId)
        .first<{ dept_id: number | null }>();
      if (
        !space ||
        !(
          ctx.role === "SUPER_ADMIN" ||
          (space.dept_id && canManageDepartment(ctx, space.dept_id))
        )
      )
        throw new ApiError(403, "FORBIDDEN", "无权管理该空间");
      if (!name)
        throw new ApiError(400, "VALIDATION_ERROR", "目录名称不能为空");
      const result = await db
        .prepare(
          "INSERT INTO knowledge_folders(space_id,parent_id,name,sort_order,owner_user_id) VALUES(?,?,?,?,?)",
        )
        .bind(
          spaceId,
          Number(payload.parentId) || null,
          name,
          Number(payload.sortOrder) || 0,
          ctx.userId,
        )
        .run();
      return ok({ id: result.meta.last_row_id }, rid, 201);
    }
    if (action === "SET_ACL") {
      const documentId = Number(payload.documentId);
      await managedDocument(documentId);
      const subjectType = safeText(payload.subjectType, 20),
        subjectId = Number(payload.subjectId),
        permission = safeText(payload.permission, 20);
      if (
        !["USER", "DEPT", "GROUP"].includes(subjectType) ||
        !["VIEW", "EDIT"].includes(permission) ||
        !subjectId
      )
        throw new ApiError(400, "VALIDATION_ERROR", "授权对象或权限无效");
      await db.batch([
        db
          .prepare(
            "INSERT INTO document_acl(document_id,subject_type,subject_id,permission,expires_at,create_user_id) VALUES(?,?,?,?,?,?) ON CONFLICT(document_id,subject_type,subject_id,permission) DO UPDATE SET expires_at=excluded.expires_at",
          )
          .bind(
            documentId,
            subjectType,
            subjectId,
            permission,
            safeText(payload.expiresAt, 40) || null,
            ctx.userId,
          ),
        db
          .prepare(
            "INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) SELECT id,dept_id,'ACL_GRANT',?,?,?,? FROM documents WHERE id=?",
          )
          .bind(
            ctx.userId,
            ctx.displayName,
            `${subjectType}#${subjectId} ${permission}`,
            rid,
            documentId,
          ),
      ]);
      return ok({ saved: true }, rid);
    }
    if (action === "REMOVE_ACL") {
      const documentId = Number(payload.documentId);
      await managedDocument(documentId);
      await db
        .prepare("DELETE FROM document_acl WHERE id=? AND document_id=?")
        .bind(Number(payload.id), documentId)
        .run();
      return ok({ removed: true }, rid);
    }
    if (action === "SET_SPACE_PERMISSION") {
      const space = await db
        .prepare("SELECT * FROM knowledge_spaces WHERE id=?")
        .bind(Number(payload.spaceId))
        .first<Record<string, unknown>>();
      if (
        !space ||
        !(
          ctx.role === "SUPER_ADMIN" ||
          (space.dept_id && canManageDepartment(ctx, Number(space.dept_id)))
        )
      )
        throw new ApiError(403, "FORBIDDEN", "无权管理该知识空间");
      const subjectType = safeText(payload.subjectType, 20),
        subjectId = Number(payload.subjectId),
        permission = safeText(payload.permission, 20);
      if (
        !["USER", "DEPT", "GROUP"].includes(subjectType) ||
        !["VIEW", "EDIT"].includes(permission) ||
        !subjectId
      )
        throw new ApiError(400, "VALIDATION_ERROR", "空间授权对象或权限无效");
      await db
        .prepare(
          "INSERT OR IGNORE INTO space_permissions(space_id,subject_type,subject_id,permission,create_user_id) VALUES(?,?,?,?,?)",
        )
        .bind(space.id, subjectType, subjectId, permission, ctx.userId)
        .run();
      return ok({ saved: true }, rid);
    }
    if (action === "REMOVE_SPACE_PERMISSION") {
      const space = await db
        .prepare("SELECT * FROM knowledge_spaces WHERE id=?")
        .bind(Number(payload.spaceId))
        .first<Record<string, unknown>>();
      if (
        !space ||
        !(
          ctx.role === "SUPER_ADMIN" ||
          (space.dept_id && canManageDepartment(ctx, Number(space.dept_id)))
        )
      )
        throw new ApiError(403, "FORBIDDEN", "无权管理该知识空间");
      await db
        .prepare(
          "DELETE FROM space_permissions WHERE space_id=? AND subject_type=? AND subject_id=? AND permission=?",
        )
        .bind(
          space.id,
          safeText(payload.subjectType, 20),
          Number(payload.subjectId),
          safeText(payload.permission, 20),
        )
        .run();
      return ok({ removed: true }, rid);
    }
    if(action==="TEST_MODEL_ROUTE"){
      if(ctx.role!=="SUPER_ADMIN")throw new ApiError(403,"SUPER_ADMIN_REQUIRED","仅超级管理员可测试模型路由");
      const serviceId=payload.serviceId?Number(payload.serviceId):undefined,route=await chatRuntime("KNOWLEDGE_QA",serviceId);
      if(!route.configured)throw new ApiError(409,"MODEL_KEY_MISSING",`服务器尚未配置凭证别名 ${route.secretKey||"对应的访问凭证"}`);
      if(route.status!=="ACTIVE")throw new ApiError(409,"MODEL_SERVICE_INACTIVE","请先启用该模型服务后再执行连接检测");
      const started=Date.now(),generated=await generateChat("你是企业模型连接检测器，只回复：连接成功。","执行一次最小连接测试。",ctx.userId,{temperature:0,maxTokens:300,serviceId});
      if(!generated)throw new ApiError(503,"MODEL_UNAVAILABLE","模型连接失败");
      await db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'MODEL_CONNECTION_TEST',?,?,?,?)").bind(ctx.primaryDeptId,ctx.userId,ctx.displayName,`${generated.provider} · ${generated.model} · ${Date.now()-started}ms`,rid).run();
      return ok({available:true,provider:generated.provider,model:generated.model,latencyMs:Date.now()-started},rid);
    }
    if (action === "UPDATE_SETTINGS") {
      if(ctx.role!=="SUPER_ADMIN")throw new ApiError(403,"SUPER_ADMIN_REQUIRED","仅超级管理员可修改系统参数");
      const values=(payload.settings??{}) as Record<string,unknown>,vector=Number(values['hybrid.vector_weight']),keyword=Number(values['hybrid.keyword_weight']),topK=Number(values['rag.top_k']);
      if(!Number.isFinite(vector)||!Number.isFinite(keyword)||vector<0||keyword<0||Math.abs(vector+keyword-1)>.001)throw new ApiError(400,"INVALID_WEIGHTS","向量权重与关键词权重必须为非负数，且合计为 1");
      if(!Number.isInteger(topK)||topK<1||topK>10)throw new ApiError(400,"INVALID_TOP_K","Top-K 必须是 1 到 10 的整数");
      await db.batch(Object.entries({'hybrid.vector_weight':String(vector),'hybrid.keyword_weight':String(keyword),'rag.top_k':String(topK)}).map(([key,value])=>db.prepare("INSERT INTO system_settings(key,value,update_user_id) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,update_user_id=excluded.update_user_id,update_time=CURRENT_TIMESTAMP").bind(key,value,ctx.userId)));
      return ok({saved:true},rid);
    }
    if (action === "UPDATE_SETTING") {
      if (ctx.role !== "SUPER_ADMIN")
        throw new ApiError(
          403,
          "SUPER_ADMIN_REQUIRED",
          "仅超级管理员可修改系统参数",
        );
      const key=safeText(payload.key,100),value=safeText(payload.value,500);if(!key)throw new ApiError(400,"VALIDATION_ERROR","参数键不能为空");
      if(key==='rag.top_k'&&(!Number.isInteger(Number(value))||Number(value)<1||Number(value)>10))throw new ApiError(400,"INVALID_TOP_K","Top-K 必须是 1 到 10 的整数");
      await db
        .prepare(
          "INSERT INTO system_settings(key,value,description,update_user_id) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,update_user_id=excluded.update_user_id,update_time=CURRENT_TIMESTAMP",
        )
        .bind(
          key,
          value,
          safeText(payload.description, 300),
          ctx.userId,
        )
        .run();
      return ok({ saved: true }, rid);
    }
    throw new ApiError(400, "UNKNOWN_ACTION", "不支持的治理操作");
  } catch (error) {
    return fail(error, rid);
  }
}
