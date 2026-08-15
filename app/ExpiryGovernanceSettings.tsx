"use client";

import { ChangeEvent, FormEvent, useState } from "react";

export type ExpiryGovernanceFormValue = {
  scopeMode: "ALL_DEPARTMENTS" | "SELECTED_DEPARTMENTS";
  departmentIds: number[];
  advanceDays: number;
  citationWindowDays: number;
  mediumCitationThreshold: number;
  highCitationThreshold: number;
  highRiskDueDays: number;
  normalDueDays: number;
  maxDocumentsPerRun: number;
  maxCostCny: number;
  taskCreationMode: "AUTO_CREATE" | "REPORT_ONLY";
  assigneeStrategy: "DOCUMENT_OWNER" | "DEPARTMENT_ADMIN";
  unownedFallback: "CREATOR" | "DEPARTMENT_ADMIN";
  notifyOwner: boolean;
  notifyHighRiskAdmin: boolean;
  executionMode: "PROPOSE_ONLY";
};

type Props = {
  value: ExpiryGovernanceFormValue;
  departments: Array<{id:number;name:string}>;
  saving: boolean;
  onSave: (value: ExpiryGovernanceFormValue) => Promise<void>;
};

export default function ExpiryGovernanceSettings({ value, departments, saving, onSave }: Props) {
  const [draft,setDraft]=useState(value);
  const numberField=(key:keyof ExpiryGovernanceFormValue)=>(event:ChangeEvent<HTMLInputElement>)=>setDraft(current=>({...current,[key]:Number(event.target.value)}));
  const toggleDepartment=(id:number)=>setDraft(current=>({...current,departmentIds:current.departmentIds.includes(id)?current.departmentIds.filter(item=>item!==id):[...current.departmentIds,id]}));
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();await onSave(draft);};

  return <form className="expiry-governance-settings" onSubmit={submit}>
    <header>
      <div><span>制度到期治理工作流</span><h3>自动发现，自动建任务，人工处置</h3><p>定时触发由上方运行频率控制；这里配置治理对象、判断规则、分派方式、通知和执行边界。</p></div>
      <strong>高风险操作需人工确认</strong>
    </header>
    <section>
      <fieldset className="expiry-wide-fieldset">
        <legend>1. 治理范围</legend>
        <label>文档范围<select value={draft.scopeMode} onChange={event=>setDraft(current=>({...current,scopeMode:event.target.value as ExpiryGovernanceFormValue["scopeMode"]}))}><option value="ALL_DEPARTMENTS">全部部门的有效发布制度</option><option value="SELECTED_DEPARTMENTS">仅指定部门</option></select><small>草稿、待审批版本和已删除文档不会进入任务</small></label>
        <label>单次处理上限<input aria-label="单次处理上限" type="number" min="1" max="200" required value={draft.maxDocumentsPerRun} onChange={numberField("maxDocumentsPerRun")}/><small>限制每次运行创建任务的最大候选数</small></label>
        {draft.scopeMode==="SELECTED_DEPARTMENTS"&&<div className="expiry-department-picker"><b>选择部门</b><div>{departments.map(dept=><label key={dept.id}><input type="checkbox" checked={draft.departmentIds.includes(dept.id)} onChange={()=>toggleDepartment(dept.id)}/><span>{dept.name}</span></label>)}</div>{departments.length===0&&<small>暂无可选部门，请先维护组织数据。</small>}</div>}
      </fieldset>
      <fieldset>
        <legend>2. 触发与风险</legend>
        <label>提前触发天数<input aria-label="提前触发天数" type="number" min="1" max="365" required value={draft.advanceDays} onChange={numberField("advanceDays")}/><small>在复核日期前多少天进入治理队列</small></label>
        <label>引用统计周期<input aria-label="引用统计周期" type="number" min="1" max="365" required value={draft.citationWindowDays} onChange={numberField("citationWindowDays")}/><small>统计最近多少天的 AI 引用</small></label>
        <label>中风险引用阈值<input aria-label="中风险引用阈值" type="number" min="0" max="10000" required value={draft.mediumCitationThreshold} onChange={numberField("mediumCitationThreshold")}/><small>达到该次数标记为中风险</small></label>
        <label>高风险引用阈值<input aria-label="高风险引用阈值" type="number" min="1" max="10000" required value={draft.highCitationThreshold} onChange={numberField("highCitationThreshold")}/><small>必须高于中风险阈值</small></label>
        <label>单次运行成本上限（元）<input aria-label="单次运行成本上限" type="number" min="0.01" max="10000" step="0.01" required value={draft.maxCostCny} onChange={numberField("maxCostCny")}/><small>Agent 单次运行累计成本超过该值立即停止并留痕</small></label>
      </fieldset>
      <fieldset>
        <legend>3. 任务与分派</legend>
        <label>发现问题后<select value={draft.taskCreationMode} onChange={event=>setDraft(current=>({...current,taskCreationMode:event.target.value as ExpiryGovernanceFormValue["taskCreationMode"]}))}><option value="AUTO_CREATE">自动创建治理任务</option><option value="REPORT_ONLY">只生成运行报告</option></select><small>自动建任务属于低风险操作，不修改制度正文</small></label>
        <label>默认分派给<select value={draft.assigneeStrategy} onChange={event=>setDraft(current=>({...current,assigneeStrategy:event.target.value as ExpiryGovernanceFormValue["assigneeStrategy"]}))}><option value="DOCUMENT_OWNER">文档负责人</option><option value="DEPARTMENT_ADMIN">所属部门管理员</option></select><small>系统会检查接收人是否仍为有效账号</small></label>
        <label>没有负责人时<select value={draft.unownedFallback} onChange={event=>setDraft(current=>({...current,unownedFallback:event.target.value as ExpiryGovernanceFormValue["unownedFallback"]}))}><option value="DEPARTMENT_ADMIN">转部门管理员</option><option value="CREATOR">转文档创建人</option></select><small>找不到有效部门管理员时回退到创建人</small></label>
        <div className="expiry-safety"><b>任务去重</b><span>同一文档存在未完成的到期治理任务时，不重复创建或提醒。</span></div>
      </fieldset>
      <fieldset>
        <legend>4. 时限与通知</legend>
        <label>高风险处理时限<input aria-label="高风险处理时限" type="number" min="1" max="90" required value={draft.highRiskDueDays} onChange={numberField("highRiskDueDays")}/><small>写入治理任务建议，单位为天</small></label>
        <label>普通处理时限<input aria-label="普通处理时限" type="number" min="1" max="180" required value={draft.normalDueDays} onChange={numberField("normalDueDays")}/><small>适用于中风险和普通任务</small></label>
        <label className="expiry-notify"><input type="checkbox" checked={draft.notifyOwner} onChange={event=>setDraft(current=>({...current,notifyOwner:event.target.checked}))}/><span>通知任务接收人<small>仅发送站内通知，不发送外部邮件</small></span></label>
        <label className="expiry-notify"><input type="checkbox" checked={draft.notifyHighRiskAdmin} onChange={event=>setDraft(current=>({...current,notifyHighRiskAdmin:event.target.checked}))}/><span>高风险同步部门管理员<small>接收人与管理员相同时只通知一次</small></span></label>
      </fieldset>
      <fieldset>
        <legend>5. 自动执行边界</legend>
        <div className="expiry-action-list"><b>允许自动执行</b><span>读取授权数据</span><span>统计引用并判断风险</span><span>创建和分派治理任务</span><span>发送站内通知、写入审计</span></div>
        <div className="expiry-action-list blocked"><b>必须人工确认</b><span>修改制度正文</span><span>审批、发布或作废</span><span>负责人转交和权限变更</span><span>外部邮件及外部系统操作</span></div>
      </fieldset>
    </section>
    <footer><div><b>配置保存后从下一次定时运行生效</b><small>保存配置不代表工作流已经执行；实际处理结果以运行记录、治理任务和审计日志为准。</small></div><button className="primary-action" disabled={saving}>{saving?"保存中…":"保存完整工作流配置"}</button></footer>
  </form>;
}
