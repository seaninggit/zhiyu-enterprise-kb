import { getD1 } from "../db";
import { ApiError } from "./api";

export async function assertPublishReady(doc:Record<string,unknown>){
  const failures:string[]=[];
  if(String(doc.parse_status)!=="COMPLETED")failures.push("正文尚未解析完成");
  if(String(doc.scan_status)!=="CLEAN")failures.push(String(doc.scan_status)==="EXTERNAL_SCAN_REQUIRED"?"大文件尚未完成企业安全扫描":"文件安全扫描尚未通过");
  if(!String(doc.extracted_text||doc.content||"").trim())failures.push("正文为空");
  const indexed=await getD1().prepare("SELECT COUNT(*) count FROM document_chunks WHERE document_id=? AND document_version=?").bind(doc.id,doc.version).first<{count:number}>();
  if(!Number(indexed?.count||0)||!["INDEXED","INDEXED_LOCAL","KEYWORD_READY"].includes(String(doc.ai_index_status)))failures.push("检索索引尚未生成");
  if(failures.length)throw new ApiError(409,"DOCUMENT_NOT_READY",`暂不能提交或发布：${failures.join("；")}。请先在维护工作台重试解析。`);
}
