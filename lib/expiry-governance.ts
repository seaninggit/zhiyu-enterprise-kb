export type ExpiryGovernanceConfig = {
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

export const DEFAULT_EXPIRY_GOVERNANCE_CONFIG: ExpiryGovernanceConfig = {
  scopeMode: "ALL_DEPARTMENTS",
  departmentIds: [],
  advanceDays: 30,
  citationWindowDays: 30,
  mediumCitationThreshold: 3,
  highCitationThreshold: 10,
  highRiskDueDays: 3,
  normalDueDays: 7,
  maxDocumentsPerRun: 50,
  maxCostCny: 0.5,
  taskCreationMode: "AUTO_CREATE",
  assigneeStrategy: "DOCUMENT_OWNER",
  unownedFallback: "DEPARTMENT_ADMIN",
  notifyOwner: true,
  notifyHighRiskAdmin: true,
  executionMode: "PROPOSE_ONLY",
};

const integer = (value: unknown, name: string, minimum: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name}必须是 ${minimum}–${maximum} 之间的整数`);
  }
  return parsed;
};

export function validateExpiryGovernanceConfig(value: unknown): ExpiryGovernanceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("制度到期治理配置格式无效");
  const input = value as Record<string, unknown>;
  const scopeMode=input.scopeMode==="SELECTED_DEPARTMENTS"?"SELECTED_DEPARTMENTS":"ALL_DEPARTMENTS";
  const departmentIds=Array.isArray(input.departmentIds)?[...new Set(input.departmentIds.map(Number).filter(id=>Number.isInteger(id)&&id>0))].slice(0,50):[];
  if(scopeMode==="SELECTED_DEPARTMENTS"&&!departmentIds.length)throw new Error("按部门治理时至少选择一个部门");
  const config: ExpiryGovernanceConfig = {
    scopeMode,
    departmentIds,
    advanceDays: integer(input.advanceDays, "提前触发天数", 1, 365),
    citationWindowDays: integer(input.citationWindowDays, "引用统计周期", 1, 365),
    mediumCitationThreshold: integer(input.mediumCitationThreshold, "中风险引用阈值", 0, 10000),
    highCitationThreshold: integer(input.highCitationThreshold, "高风险引用阈值", 1, 10000),
    highRiskDueDays: integer(input.highRiskDueDays, "高风险处理时限", 1, 90),
    normalDueDays: integer(input.normalDueDays, "普通处理时限", 1, 180),
    maxDocumentsPerRun: integer(input.maxDocumentsPerRun, "单次处理上限", 1, 200),
    maxCostCny: (()=>{const cost=Number(input.maxCostCny);if(!Number.isFinite(cost)||cost<0.01||cost>10000)throw new Error("单次运行成本上限必须是 0.01–10000 之间的数值");return cost;})(),
    taskCreationMode: input.taskCreationMode==="REPORT_ONLY"?"REPORT_ONLY":"AUTO_CREATE",
    assigneeStrategy: input.assigneeStrategy==="DEPARTMENT_ADMIN"?"DEPARTMENT_ADMIN":"DOCUMENT_OWNER",
    unownedFallback: input.unownedFallback==="CREATOR"?"CREATOR":"DEPARTMENT_ADMIN",
    notifyOwner: input.notifyOwner === true,
    notifyHighRiskAdmin: input.notifyHighRiskAdmin === true,
    executionMode: "PROPOSE_ONLY",
  };
  if (config.highCitationThreshold <= config.mediumCitationThreshold) {
    throw new Error("高风险引用阈值必须大于中风险引用阈值");
  }
  if (input.executionMode && input.executionMode !== "PROPOSE_ONLY") {
    throw new Error("制度作废必须人工确认，当前不支持自动执行");
  }
  return config;
}

export function parseExpiryGovernanceConfig(value: unknown): ExpiryGovernanceConfig {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return validateExpiryGovernanceConfig({ ...DEFAULT_EXPIRY_GOVERNANCE_CONFIG, ...(parsed as object) });
  } catch {
    return { ...DEFAULT_EXPIRY_GOVERNANCE_CONFIG };
  }
}
