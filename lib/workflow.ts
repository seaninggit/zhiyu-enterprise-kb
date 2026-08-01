import { ApiError } from "./api";

export type WorkflowAction="submit"|"approve"|"reject"|"archive"|"void";
export type WorkflowStatus="DRAFT"|"PENDING_DEPT_REVIEW"|"ARCHIVED_ACTIVE"|"EXPIRED_VOID";

export function resolveDocumentTransition(current:WorkflowStatus,action:WorkflowAction):WorkflowStatus{
  const allowed:Record<WorkflowStatus,Partial<Record<WorkflowAction,WorkflowStatus>>>={
    DRAFT:{submit:"PENDING_DEPT_REVIEW"},
    PENDING_DEPT_REVIEW:{approve:"ARCHIVED_ACTIVE",reject:"DRAFT"},
    ARCHIVED_ACTIVE:{archive:"EXPIRED_VOID",void:"EXPIRED_VOID"},
    EXPIRED_VOID:{},
  };
  const target=allowed[current]?.[action];
  if(!target)throw new ApiError(409,"INVALID_WORKFLOW_TRANSITION",`状态 ${current} 不允许执行 ${action}`);
  return target;
}
