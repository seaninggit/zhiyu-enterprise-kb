import { env } from "cloudflare:workers";
import { getD1 } from "../db";

type RuntimeEnv=Record<string,string|undefined> & {AI_CHAT_MODEL?:string;AI_BASE_URL?:string;DEEPSEEK_API_KEY?:string};
export type Generation={text:string;provider:string;model:string;inputTokens:number;outputTokens:number};
function runtime(){return env as unknown as RuntimeEnv;}

export async function chatRuntimes(sceneCode="KNOWLEDGE_QA",serviceId?:number){
  const c=runtime(),db=getD1();
  try{
    const rows=await db.prepare(serviceId
      ?"SELECT s.* FROM ai_model_services s WHERE s.id=?"
      :"SELECT s.*,CASE WHEN s.id=r.primary_service_id THEN 0 ELSE 1 END route_order FROM ai_scene_routes r JOIN ai_model_services s ON s.id=r.primary_service_id OR s.id=r.fallback_service_id WHERE r.scene_code=? AND r.status='ACTIVE' ORDER BY route_order")
      .bind(serviceId||sceneCode).all<Record<string,unknown>>();
    if(rows.results.length)return rows.results.map(row=>{const secretKey=String(row.secret_env_key);const apiKey=c[secretKey];return{serviceId:Number(row.id),serviceName:String(row.name),provider:String(row.provider),model:String(row.model_code),baseUrl:String(row.base_url).replace(/\/$/,""),status:String(row.status),configured:Boolean(apiKey),apiKey,secretKey};});
    if(!serviceId){const registered=await db.prepare("SELECT status FROM ai_scene_routes WHERE scene_code=?").bind(sceneCode).first<{status:string}>();if(registered)return[{serviceId:0,serviceName:"已停用场景",provider:"",model:"",baseUrl:"",status:"INACTIVE",configured:false,apiKey:undefined,secretKey:""}];}
  }catch{}
  let saved:Record<string,string>={};try{const rows=await db.prepare("SELECT key,value FROM system_settings WHERE key IN ('ai.chat_model','ai.base_url')").all<{key:string;value:string}>();saved=Object.fromEntries(rows.results.map(item=>[item.key,item.value]));}catch{}
  return[{serviceId:0,serviceName:"DeepSeek 默认服务",provider:"deepseek",model:saved['ai.chat_model']||c.AI_CHAT_MODEL||"deepseek-v4-flash",baseUrl:(saved['ai.base_url']||c.AI_BASE_URL||"https://api.deepseek.com").replace(/\/$/,""),status:"ACTIVE",configured:Boolean(c.DEEPSEEK_API_KEY),apiKey:c.DEEPSEEK_API_KEY}];
}
export async function chatRuntime(sceneCode="KNOWLEDGE_QA",serviceId?:number){return (await chatRuntimes(sceneCode,serviceId))[0];}

async function requestWithRetry(url:string,init:RequestInit){let last:Response|null=null;for(let attempt=0;attempt<2;attempt++){last=await fetch(url,init);if(last.ok||![429,500,502,503,504].includes(last.status))return last;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}return last!;}

export async function generateChat(system:string,user:string,userId:number,options?:{temperature?:number;maxTokens?:number;sceneCode?:string;serviceId?:number}):Promise<Generation|null>{
  const candidates=await chatRuntimes(options?.sceneCode,options?.serviceId),temperature=Math.max(0,Math.min(1,Number(options?.temperature??.2))),maxTokens=Math.max(300,Math.min(4000,Number(options?.maxTokens||2200)));let lastStatus=0;
  for(const info of candidates){if(!info.configured||info.status!=="ACTIVE")continue;const response=await requestWithRetry(`${info.baseUrl}/chat/completions`,{method:"POST",headers:{authorization:`Bearer ${info.apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:info.model,messages:[{role:"system",content:system},{role:"user",content:user}],thinking:{type:"disabled"},temperature,max_tokens:maxTokens,stream:false,user:`enterprise-kb-${userId}`})});lastStatus=response.status;if(!response.ok)continue;const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>;usage?:{prompt_tokens?:number;completion_tokens?:number}};const text=payload.choices?.[0]?.message?.content?.trim();if(text)return{text,provider:info.provider,model:info.model,inputTokens:Number(payload.usage?.prompt_tokens||0),outputTokens:Number(payload.usage?.completion_tokens||0)};}
  if(lastStatus)throw new Error(`DEEPSEEK_CHAT_FAILED_${lastStatus}`);return null;
}
