import { env } from "cloudflare:workers";
import { getD1 } from "../db";
import { indexPublishedDocument } from "./rag";

type PlatformEnv = { OPENAI_API_KEY?:string; OPENAI_CHAT_MODEL?:string; KNOWLEDGE_FILES?:R2Bucket };
function cfg(){ return env as unknown as PlatformEnv; }
function outputText(payload:{output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>}) { return payload.output_text || payload.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text || ""; }

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
  const job=await db.prepare("INSERT INTO ingestion_jobs(document_id,document_version,status,stage,attempt) VALUES(?,?,'RUNNING','EXTRACT',1)").bind(documentId,doc.version).run(); const jobId=Number(job.meta.last_row_id);
  try {
    let extracted=String(doc.content||"").trim(); const mime=String(doc.mime_type||"");
    if(doc.source_key) { const object=await cfg().KNOWLEDGE_FILES?.get(String(doc.source_key)); if(!object) throw new Error("SOURCE_FILE_NOT_FOUND"); if(mime.startsWith("text/")||/json|csv|xml|javascript/.test(mime)) extracted=[extracted,await object.text()].filter(Boolean).join("\n\n"); else { const parsed=await aiExtract(object,String(doc.source_name||"document"),mime); extracted=[extracted,parsed].filter(Boolean).join("\n\n"); } }
    if(!extracted) extracted=[`标题：${doc.title}`,`摘要：${doc.summary||""}`].join("\n");
    await db.prepare("UPDATE documents SET extracted_text=?,parse_status='COMPLETED',ai_index_status='PENDING',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(extracted.slice(0,500000),documentId).run();
    const indexed=await indexPublishedDocument(documentId);
    await db.prepare("UPDATE ingestion_jobs SET status='COMPLETED',stage='INDEX',extracted_chars=?,chunk_count=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(extracted.length,indexed.chunks,jobId).run();
    return {jobId,extractedChars:extracted.length,...indexed};
  } catch(error) { const message=error instanceof Error?error.message:"解析失败"; await db.batch([db.prepare("UPDATE documents SET parse_status='FAILED',ai_index_status='FAILED' WHERE id=?").bind(documentId),db.prepare("UPDATE ingestion_jobs SET status='FAILED',error_message=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(message.slice(0,500),jobId)]); throw error; }
}
