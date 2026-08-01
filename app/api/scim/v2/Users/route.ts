import { env } from "cloudflare:workers";
import { getD1 } from "../../../../../db";
import { ApiError, fail, requestId, safeText } from "../../../../../lib/api";

function authorized(request: Request) {
  const secret = (env as unknown as { SCIM_BEARER_TOKEN?: string }).SCIM_BEARER_TOKEN;
  if (!secret) throw new ApiError(503, "SCIM_NOT_CONFIGURED", "SCIM 服务令牌尚未配置");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) throw new ApiError(401, "SCIM_UNAUTHORIZED", "SCIM 服务令牌无效");
}
function scimUser(row: Record<string, unknown>) { return { schemas:["urn:ietf:params:scim:schemas:core:2.0:User"], id:String(row.id), userName:String(row.email), displayName:String(row.display_name), active:String(row.status)==="ACTIVE", meta:{ resourceType:"User", created:row.create_time, lastModified:row.update_time } }; }

export async function GET(request: Request) {
  const rid=requestId(request);try{authorized(request);const url=new URL(request.url);const start=Math.max(1,Number(url.searchParams.get("startIndex")||1)),count=Math.min(200,Math.max(1,Number(url.searchParams.get("count")||100)));const db=getD1();const filter=url.searchParams.get("filter")||"";const match=filter.match(/^userName eq "([^"]+)"$/);const where=match?"WHERE email=?":"";const binds=match?[match[1].toLowerCase()]:[];const total=await db.prepare(`SELECT COUNT(*) count FROM users ${where}`).bind(...binds).first<{count:number}>();const rows=await db.prepare(`SELECT * FROM users ${where} ORDER BY id LIMIT ? OFFSET ?`).bind(...binds,count,start-1).all<Record<string,unknown>>();return Response.json({schemas:["urn:ietf:params:scim:api:messages:2.0:ListResponse"],totalResults:Number(total?.count||0),startIndex:start,itemsPerPage:rows.results.length,Resources:rows.results.map(scimUser)},{headers:{"x-request-id":rid}});}catch(error){return fail(error,rid);}
}

export async function POST(request: Request) {
  const rid=requestId(request);try{authorized(request);const input=await request.json() as Record<string,unknown>;const email=safeText(input.userName,200).toLowerCase(),displayName=safeText(input.displayName,100);if(!/^\S+@\S+\.\S+$/.test(email)||!displayName)throw new ApiError(400,"INVALID_VALUE","userName 与 displayName 不能为空");const db=getD1();const existing=await db.prepare("SELECT * FROM users WHERE email=?").bind(email).first<Record<string,unknown>>();if(existing)throw new ApiError(409,"UNIQUENESS","用户已存在");const created=await db.prepare("INSERT INTO users(email,display_name,status,identity_provider) VALUES(?,?,?,'SCIM')").bind(email,displayName,input.active===false?"DISABLED":"PENDING").run();const row=await db.prepare("SELECT * FROM users WHERE id=?").bind(created.meta.last_row_id).first<Record<string,unknown>>();return Response.json(scimUser(row||{}),{status:201,headers:{"content-type":"application/scim+json","x-request-id":rid}});}catch(error){return fail(error,rid);}
}
