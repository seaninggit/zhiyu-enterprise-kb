"use client";

import { useEffect, useState } from "react";

type AgentRun = {
  id: number; definition_code: string; definition_name: string; trigger_type: string; trigger_key: string;
  goal: string; status: string; summary: string; stop_reason: string; model: string;
  input_tokens: number; output_tokens: number; estimated_cost: number;
  started_at: string | null; finished_at: string | null; create_time: string; scope_json?: string;
  step_count: number; pending_confirmations: number;
};
type AgentStep = { id: number; sequence_no: number; kind: string; tool_name: string | null; risk_level: string; input_json: string; output_json: string; evidence_json: string; status: string; duration_ms: number; create_time: string };
type AgentConfirmation = {
  id: number; run_id: number; action_type: string; target_type: string; target_id: number | null;
  proposal_json: string; status: string; decision_note: string; decided_at: string | null; executed_at: string | null; create_time: string;
  run_status: string; trigger_key: string; target_title: string | null;
};

const RUN_STATUS_LABELS: Record<string,string> = { PENDING:"排队中",RUNNING:"运行中",WAITING_CONFIRMATION:"等待确认",WAITING_EVENT:"等待人工执行",SUCCEEDED:"成功",PARTIAL:"部分完成",FAILED:"失败",CANCELLED:"已取消" };
const RISK_LABELS: Record<string,string> = { READ:"只读",LOW:"低风险",HIGH:"高风险" };
const ACTION_LABELS: Record<string,string> = { PUBLISH:"发布",APPROVE:"审批",VOID:"作废",DELETE:"删除",TRANSFER_OWNER:"责任转交",CHANGE_PERMISSION:"权限变更" };
const fmt = (value: string | null | undefined) => value ? String(value).slice(0, 16).replace("T", " ") : "";
const truncate = (value: unknown, max = 400) => { const text = String(value ?? ""); return text.length > max ? `${text.slice(0, max)}…` : text; };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.error?.message || "请求失败");
  return payload.data as T;
}

export default function AgentRunsPanel() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [detail, setDetail] = useState<{ run: AgentRun; steps: AgentStep[]; confirmations: AgentConfirmation[] } | null>(null);
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [runsData, confirmationsData] = await Promise.all([
        api<{ runs: AgentRun[] }>("/api/admin/agent-runs"),
        api<{ confirmations: AgentConfirmation[] }>("/api/admin/agent-confirmations"),
      ]);
      setRuns(runsData.runs); setConfirmations(confirmationsData.confirmations); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "加载失败"); }
    finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, []);

  const openDetail = async (runId: number) => {
    setBusy(runId);
    try {
      const data = await api<{ run: AgentRun; steps: AgentStep[]; confirmations: AgentConfirmation[] }>(`/api/admin/agent-runs/${runId}`);
      setDetail(data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "详情加载失败"); }
    finally { setBusy(null); }
  };

  const decide = async (confirmationId: number, decision: "APPROVE" | "REJECT") => {
    setBusy(confirmationId);
    try {
      const data = await api<{ decision: string; executed?: boolean }>(`/api/admin/agent-confirmations/${confirmationId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "DECIDE", decision, note: note[confirmationId] || "" }) });
      setMessage(decision === "APPROVE" ? (data.executed ? "已批准并通过正式业务服务执行完成" : "已批准；请在资料管理界面执行正式动作后回来复核") : "已拒绝，运行关闭");
      void refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(null); }
  };

  const verify = async (confirmationId: number) => {
    setBusy(confirmationId);
    try {
      const data = await api<{ verified: boolean; formalState?: string }>(`/api/admin/agent-confirmations/${confirmationId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "VERIFY" }) });
      setMessage(data.verified ? "复核通过，运行已关闭" : `尚未检测到正式动作完成${data.formalState ? `（${data.formalState}）` : ""}`);
      void refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "复核失败"); }
    finally { setBusy(null); }
  };

  const statusClass = (status: string) => status === "SUCCEEDED" ? "agent-ok" : status === "FAILED" ? "agent-bad" : status.includes("WAITING") ? "agent-wait" : "agent-neutral";
  const pendingCount = confirmations.filter(c => c.status === "PENDING").length;

  return <div className="agent-panel">
    <header>
      <div><span>制度到期治理 Agent</span><h3>自主规划运行中心</h3><p>定时信号只提交目标；Agent 自主决定调用哪些工具。低风险动作自动执行，高风险动作必须在此人工确认。</p></div>
      <button onClick={refresh} disabled={loading}>{loading ? "加载中…" : "刷新"}</button>
    </header>
    {message && <div className="agent-message">{message}</div>}

    <section>
      <h4>待人工确认（{pendingCount}）</h4>
      {confirmations.length === 0 ? <div className="empty-state">暂无确认记录</div> : confirmations.map(c => {
        const proposal = JSON.parse(c.proposal_json || "{}") as { action_type?: string; target_type?: string; target_id?: number; reason?: string; evidence?: string[] };
        const actionLabel = ACTION_LABELS[proposal.action_type || ""] || proposal.action_type || "未知动作";
        const waitingVerify = c.status === "APPROVED" && c.run_status === "WAITING_EVENT";
        return <div key={c.id} className="agent-confirmation">
          <div>
            <b>{actionLabel}{c.target_title ? `：《${c.target_title}》` : ""}{c.target_id ? `（对象 #${c.target_id}）` : ""}</b>
            <small>运行 #{c.run_id} · 触发 {c.trigger_key} · {fmt(c.create_time)} · 确认状态 {c.status}</small>
            <small className="agent-reason">原因：{proposal.reason || "未提供"}</small>
            {Array.isArray(proposal.evidence) && proposal.evidence.length > 0 && <small className="agent-evidence">证据：{proposal.evidence.join("；")}</small>}
          </div>
          {c.status === "PENDING" && <div className="agent-decide">
            <input placeholder="审批意见（拒绝时建议填写）" value={note[c.id] || ""} onChange={e => setNote(current => ({ ...current, [c.id]: e.target.value }))} />
            <button className="agent-approve" disabled={busy === c.id} onClick={() => decide(c.id, "APPROVE")}>批准</button>
            <button className="agent-reject" disabled={busy === c.id} onClick={() => decide(c.id, "REJECT")}>拒绝</button>
          </div>}
          {waitingVerify && <div className="agent-decide"><button className="agent-approve" disabled={busy === c.id} onClick={() => verify(c.id)}>复核正式动作</button><small>请在资料管理界面执行后点击复核</small></div>}
          {c.status === "EXECUTED" && <span className="agent-done">已执行{c.executed_at ? ` · ${fmt(c.executed_at)}` : ""}</span>}
          {c.status === "REJECTED" && <span className="agent-done">已拒绝{c.decision_note ? ` · ${c.decision_note}` : ""}</span>}
        </div>;
      })}
    </section>

    <section>
      <h4>运行记录（{runs.length}）</h4>
      {runs.length === 0 ? <div className="empty-state">暂无运行记录。定时触发后，运行会出现在这里。</div> : <table className="agent-table">
        <thead><tr><th>#</th><th>状态</th><th>触发</th><th>模型</th><th>Token/成本</th><th>停止原因 / 摘要</th><th>时间</th><th></th></tr></thead>
        <tbody>{runs.map(r => <tr key={r.id}>
          <td>{r.id}</td>
          <td><span className={statusClass(r.status)}>{RUN_STATUS_LABELS[r.status] || r.status}{r.pending_confirmations > 0 ? ` · ${r.pending_confirmations}待确认` : ""}</span></td>
          <td>{r.trigger_type} · {r.trigger_key}</td>
          <td>{r.model || "未调用"}</td>
          <td>{r.input_tokens}/{r.output_tokens} · ¥{Number(r.estimated_cost || 0).toFixed(4)}</td>
          <td className="agent-stop-reason">{r.stop_reason || truncate(r.summary, 60)}</td>
          <td>{fmt(r.create_time)}</td>
          <td><button onClick={() => openDetail(r.id)} disabled={busy === r.id}>{busy === r.id ? "加载中…" : "详情"}</button></td>
        </tr>)}</tbody>
      </table>}
      {detail && <div className="agent-detail">
        <div className="agent-detail-header">
          <div><b>运行 #{detail.run.id} · {detail.run.definition_name}</b><small>{detail.run.goal}</small><small>范围快照：{truncate(detail.run.scope_json, 200)}</small></div>
          <button onClick={() => setDetail(null)}>关闭</button>
        </div>
        {detail.steps.length === 0 ? <div className="empty-state">暂无步骤记录</div> : detail.steps.map(s => <div key={s.id} className="agent-step">
          <div><b>#{s.sequence_no} {s.kind}{s.tool_name ? ` · ${s.tool_name}` : ""}</b><span className={s.risk_level === "HIGH" ? "agent-bad" : s.risk_level === "LOW" ? "agent-wait" : "agent-neutral"}>{RISK_LABELS[s.risk_level] || s.risk_level}</span><small>{s.status} · {s.duration_ms}ms · {fmt(s.create_time)}</small></div>
          <div className="agent-step-body"><small>输入：{truncate(s.input_json)}</small><small>输出：{truncate(s.output_json)}</small>{s.evidence_json && s.evidence_json !== "[]" && <small>证据：{truncate(s.evidence_json)}</small>}</div>
        </div>)}
        <small className="agent-cot-note">按产品边界，这里不展示模型思维链，只保留工具调用、结果摘要、业务证据与错误。</small>
      </div>}
    </section>
  </div>;
}
