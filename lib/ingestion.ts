import { env } from "cloudflare:workers";
import { getD1 } from "../db";
import { indexPublishedDocument } from "./rag";

type PlatformEnv = { OPENAI_API_KEY?:string; OPENAI_CHAT_MODEL?:string; KNOWLEDGE_FILES?:R2Bucket };
function cfg(){ return env as unknown as PlatformEnv; }
function outputText(payload:{output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>}) { return payload.output_text || payload.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text || ""; }
function dlp(text:string){const findings:string[]=[];if(/\b\d{17}[\dXx]\b/.test(text))findings.push("身份证号");if(/\b(?:\d[ -]*?){13,19}\b/.test(text))findings.push("银行卡号");if(/1[3-9]\d{9}/.test(text))findings.push("手机号");if(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text))findings.push("邮箱地址");return findings;}
async function sha256(bytes:ArrayBuffer){const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");}

async function aiExtract(object:R2ObjectBody,name:string,mime:string) {
  const key=cfg().OPENAI_API_KEY; if(!key || object.size>20_000_000) return "";
  const bytes=await object.arrayBuffer();
  if(mime.startsWith("image/")) {
    let binary=""; const view=new Uint8Array(bytes); for(let i=0;i<view.length;i+=8192) binary+=String.fromCharCode(...view.subarray(i,i+8192));
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model:cfg().OPENAI_CHAT_MODEL||"gpt-5.6-terra",input:[{role:"user",content:[{type:"input_image",image_url:`data:${mime};base64,${btoa(binary)}`},{type:"input_text",text:"对这份企业资料执行OCR并提取全部可读文字。保留标题、段落和表格行列语义，只输出提取后的正文。"}]}]})});
    if(!response.ok) throw new Error(`OCR_FAILED_${response.status}`); return outputText(await response.json());
  }
  const form=new FormData(); form.set("purpose","user_data"); form.set("file",new File([bytes],name,{type:mime}));
  const uploaded=await fetch("https://api.openai.com/v1/files",{method:"POST",headers:{authorization:`Bearer ${key}`},body:form}); if(!uploaded.ok) throw new Error(`FILE_PARSE_UPLOAD_FAILED_${uploaded.status}`); const file=await uploaded.json() as {id:string};
  try { const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify({model:cfg().OPENAI_CHAT_MODEL||"gpt-5.6-terra",input:[{role:"user",content:[{type:"input_file",file_id:file.id},{type:"input_text",text:"提取这份企业资料的完整可检索文字。保留标题层级、段落、表格语义和关键编号，只输出正文，不总结。"}]}]})}); if(!response.ok) throw new Error(`FILE_PARSE_FAILED_${response.status}`); return outputText(await response.json()); }
  finally { await fetch(`https://api.openai.com/v1/files/${file.id}`,{method:"DELETE",headers:{authorization:`Bearer ${key}`}}).catch(()=>undefined); }
}

export async function processDocument(documentId:number) {
  const db=getD1(); const doc=await db.prepare("SELECT * FROM documents WHERE id=? AND is_deleted=0").bind(documentId).first<Record<string,unknown>>(); if(!doc) throw new Error("DOCUMENT_NOT_FOUND");
  const queued=await db.prepare("SELECT id,attempt FROM ingestion_jobs WHERE document_id=? AND document_version=? AND status='QUEUED' ORDER BY id DESC LIMIT 1").bind(documentId,doc.version).first<{id:number;attempt:number}>();
  const job=queued?await db.prepare("UPDATE ingestion_jobs SET status='RUNNING',stage='EXTRACT',attempt=attempt+1,error_message='',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(queued.id).run():await db.prepare("INSERT INTO ingestion_jobs(document_id,document_version,status,stage,attempt) VALUES(?,?,'RUNNING','EXTRACT',1)").bind(documentId,doc.version).run(); const jobId=queued?queued.id:Number(job.meta.last_row_id);
  try {
    let extracted=String(doc.content||"").trim(); const mime=String(doc.mime_type||"");let checksum:string|null=null;
    if(doc.source_key) { const object=await cfg().KNOWLEDGE_FILES?.get(String(doc.source_key)); if(!object) throw new Error("SOURCE_FILE_NOT_FOUND");if(object.size>20_000_000){await db.batch([db.prepare("UPDATE documents SET scan_status='EXTERNAL_SCAN_REQUIRED' WHERE id=?").bind(documentId),db.prepare("INSERT INTO security_events(document_id,type,severity,detail) VALUES(?,'LARGE_FILE_SCAN','MEDIUM',?)").bind(documentId,`文件 ${object.size} 字节已保存；需接入企业杀毒网关完成深度扫描与解析`) ]);}else{const bytes=await object.arrayBuffer();checksum=await sha256(bytes);const probe=new TextDecoder().decode(bytes.slice(0,8192));if(probe.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")){await db.prepare("INSERT INTO security_events(document_id,type,severity,detail) VALUES(?,'MALWARE','CRITICAL','检测到恶意文件特征，已阻止解析')").bind(documentId).run();throw new Error("MALWARE_DETECTED");}const replay={...object,arrayBuffer:async()=>bytes,text:async()=>new TextDecoder().decode(bytes)} as R2ObjectBody;if(mime.startsWith("text/")||/json|csv|xml|javascript/.test(mime)) extracted=[extracted,new TextDecoder().decode(bytes)].filter(Boolean).join("\n\n"); else { const parsed=await aiExtract(replay,String(doc.source_name||"document"),mime); extracted=[extracted,parsed].filter(Boolean).join("\n\n"); } } }
    if(!extracted) extracted=[`标题：${doc.title}`,`摘要：${doc.summary||""}`].join("\n");
    const findings=dlp(extracted);await db.prepare("UPDATE documents SET extracted_text=?,content=CASE WHEN content='' THEN ? ELSE content END,summary=CASE WHEN summary='' THEN ? ELSE summary END,parse_status='COMPLETED',scan_status=CASE WHEN scan_status='EXTERNAL_SCAN_REQUIRED' THEN scan_status ELSE 'CLEAN' END,checksum=?,dlp_findings=?,security_level=CASE WHEN ?<>'' AND security_level='INTERNAL' THEN 'SENSITIVE' ELSE security_level END,ai_index_status='PENDING',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(extracted.slice(0,500000),extracted.slice(0,50000),extracted.replace(/\s+/g," ").slice(0,180),checksum,JSON.stringify(findings),findings.join(","),documentId).run();if(findings.length)await db.prepare("INSERT INTO security_events(document_id,type,severity,detail) VALUES(?,'DLP','HIGH',?)").bind(documentId,`检测到：${findings.join("、")}`).run();
    const indexed=await indexPublishedDocument(documentId);
    await db.prepare("UPDATE ingestion_jobs SET status='COMPLETED',stage='INDEX',extracted_chars=?,chunk_count=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(extracted.length,indexed.chunks,jobId).run();
    return {jobId,extractedChars:extracted.length,...indexed};
  } catch(error) { const message=error instanceof Error?error.message:"解析失败"; await db.batch([db.prepare("UPDATE documents SET parse_status='FAILED',scan_status=CASE WHEN ?='MALWARE_DETECTED' THEN 'BLOCKED' ELSE scan_status END,ai_index_status='FAILED' WHERE id=?").bind(message,documentId),db.prepare("UPDATE ingestion_jobs SET status='FAILED',error_message=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0,500),jobId)]); throw error; }
}
