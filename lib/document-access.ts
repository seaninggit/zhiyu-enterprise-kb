import { getD1 } from "../db";
import type { AuthContext } from "./authz";
import { hasPermission, hasScope } from "./authz";

function placeholders(values:number[]){return values.map(()=>"?").join(",");}
function published(alias:string){return `(${alias}.status='ARCHIVED_ACTIVE' OR (${alias}.status IN ('DRAFT','PENDING_DEPT_REVIEW') AND ${alias}.published_version IS NOT NULL))`;}
function principal(alias:string,ctx:AuthContext){
  return {
    sql:`((${alias}.subject_type='USER' AND ${alias}.subject_id=?) OR (${alias}.subject_type='DEPT' AND ${alias}.subject_id IN (${placeholders(ctx.deptIds)})) OR (${alias}.subject_type='GROUP' AND EXISTS(SELECT 1 FROM user_groups ug WHERE ug.group_id=${alias}.subject_id AND ug.user_id=?)))`,
    binds:[ctx.userId,...ctx.deptIds,ctx.userId] as unknown[],
  };
}
function grantedAccess(ctx:AuthContext,alias:string,permission:"VIEW"|"EDIT"){
  const documentPrincipal=principal("acl",ctx),spacePrincipal=principal("sp",ctx);
  const permissionSql=permission==="VIEW"?"IN ('VIEW','EDIT')":"='EDIT'";
  return {
    sql:`(${alias}.dept_id IN (${placeholders(ctx.deptIds)}) OR (${alias}.share_scope='CROSS_DEPT' AND '${permission}'='VIEW') OR EXISTS(SELECT 1 FROM document_acl acl WHERE acl.document_id=${alias}.id AND acl.permission ${permissionSql} AND (acl.expires_at IS NULL OR acl.expires_at>CURRENT_TIMESTAMP) AND ${documentPrincipal.sql}) OR EXISTS(SELECT 1 FROM space_permissions sp WHERE sp.space_id=${alias}.space_id AND sp.permission ${permissionSql} AND ${spacePrincipal.sql}))`,
    binds:[...ctx.deptIds,...documentPrincipal.binds,...spacePrincipal.binds],
  };
}

export function publishedDocumentScope(ctx:AuthContext,alias="d"){
  const lifecycle=`${alias}.is_deleted=0 AND ${published(alias)}`;
  if(hasScope(ctx,"global"))return{sql:lifecycle,binds:[] as unknown[]};
  const access=grantedAccess(ctx,alias,"VIEW");
  return{sql:`${lifecycle} AND ${access.sql}`,binds:access.binds};
}

export function documentListScope(ctx:AuthContext,alias="d"){
  if(hasScope(ctx,"global"))return{sql:`${alias}.is_deleted=0`,binds:[] as unknown[]};
  const access=grantedAccess(ctx,alias,"VIEW");
  if(ctx.role==="DEPT_ADMIN"||ctx.permissions.includes("governance:admin"))return{sql:`${alias}.is_deleted=0 AND (${alias}.dept_id IN (${placeholders(ctx.deptIds)}) OR (${published(alias)} AND ${access.sql}))`,binds:[...ctx.deptIds,...access.binds]};
  return{sql:`${alias}.is_deleted=0 AND ((((${alias}.create_user_id=? OR COALESCE(${alias}.owner_user_id,${alias}.create_user_id)=?) AND ${alias}.dept_id IN (${placeholders(ctx.deptIds)}))) OR EXISTS(SELECT 1 FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id WHERE ai.document_id=${alias}.id AND aps.assignee_user_id=?) OR (${published(alias)} AND ${access.sql}))`,binds:[ctx.userId,ctx.userId,...ctx.deptIds,ctx.userId,...access.binds]};
}

async function explicitPermission(documentId:number,spaceId:number|null,permission:"VIEW"|"EDIT",ctx:AuthContext){
  const d=principal("a",ctx),s=principal("p",ctx);
  const accepted=permission==="VIEW"?["VIEW","EDIT"]:["EDIT"];
  const marks=accepted.map(()=>"?").join(",");
  const row=await getD1().prepare(`SELECT 1 allowed WHERE EXISTS(SELECT 1 FROM document_acl a WHERE a.document_id=? AND a.permission IN (${marks}) AND (a.expires_at IS NULL OR a.expires_at>CURRENT_TIMESTAMP) AND ${d.sql}) OR (? IS NOT NULL AND EXISTS(SELECT 1 FROM space_permissions p WHERE p.space_id=? AND p.permission IN (${marks}) AND ${s.sql}))`).bind(documentId,...accepted,...d.binds,spaceId,spaceId,...accepted,...s.binds).first();
  return Boolean(row);
}

export async function canReadDocument(doc:Record<string,unknown>,ctx:AuthContext){
  if(hasScope(ctx,"global"))return true;
  const ownDept=ctx.deptIds.includes(Number(doc.dept_id)),creator=Number(doc.create_user_id)===ctx.userId;
  if(((ctx.role==="DEPT_ADMIN"||ctx.permissions.includes("governance:admin"))&&ownDept)||(creator&&ownDept))return true;
  const assigned=await getD1().prepare("SELECT 1 allowed FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id WHERE ai.document_id=? AND aps.assignee_user_id=? LIMIT 1").bind(Number(doc.id),ctx.userId).first();
  if(assigned)return true;
  const hasPublished=String(doc.status)==="ARCHIVED_ACTIVE"||(Number(doc.published_version||0)>0&&["DRAFT","PENDING_DEPT_REVIEW"].includes(String(doc.status)));
  if(!hasPublished)return false;
  if(ownDept||doc.share_scope==="CROSS_DEPT")return true;
  return explicitPermission(Number(doc.id),doc.space_id?Number(doc.space_id):null,"VIEW",ctx);
}

export async function canEditDocument(doc:Record<string,unknown>,ctx:AuthContext){
  if(!hasPermission(ctx,"knowledge:edit"))return false;
  const ownDept=ctx.deptIds.includes(Number(doc.dept_id)),ownerId=Number(doc.owner_user_id||doc.create_user_id),responsible=ownerId===ctx.userId;
  if((hasScope(ctx,"global")||ownDept)&&responsible)return true;
  return explicitPermission(Number(doc.id),doc.space_id?Number(doc.space_id):null,"EDIT",ctx);
}
