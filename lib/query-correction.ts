import { pinyin } from "pinyin-pro";

export type QueryCorrection={original:string;corrected:string;reason:string;confidence:number;applied:boolean;changes:Array<{from:string;to:string}>};
const clean=(value:string)=>value.trim().replace(/\s+/g," ");
const phonetic=(value:string)=>pinyin(value,{toneType:"none",type:"array"}).join(" ").toLowerCase();

export async function correctEnterpriseQuery(db:D1Database,query:string):Promise<QueryCorrection>{
  const original=clean(query);let corrected=original;const changes:Array<{from:string;to:string}>=[];
  const enabled=await db.prepare("SELECT value FROM system_settings WHERE key='search.correction_enabled'").first<{value:string}>().catch(()=>null);
  if(enabled?.value==="0")return{original,corrected,reason:"",confidence:0,applied:false,changes};
  const fixed=await db.prepare("SELECT source_term,target_term FROM search_corrections WHERE is_active=1 ORDER BY length(source_term) DESC").all<{source_term:string;target_term:string}>();
  for(const row of fixed.results){if(corrected.includes(row.source_term)&&row.source_term!==row.target_term){corrected=corrected.replaceAll(row.source_term,row.target_term);changes.push({from:row.source_term,to:row.target_term});}}
  if(changes.length){await Promise.all(changes.map(change=>db.prepare("UPDATE search_corrections SET usage_count=usage_count+1,update_time=CURRENT_TIMESTAMP WHERE source_term=?").bind(change.from).run()));return{original,corrected,reason:`检测到同音输入：${changes.map(x=>`${x.from}→${x.to}`).join("、")}`,confidence:.99,applied:true,changes};}
  const vocabulary=new Map<string,number>();
  const rows=await db.prepare("SELECT name term FROM tags UNION ALL SELECT name FROM knowledge_categories WHERE is_active=1 UNION ALL SELECT title FROM documents WHERE is_deleted=0 UNION ALL SELECT substr(content,1,200) FROM document_chunks WHERE is_active=1 ORDER BY term LIMIT 1200").all<{term:string}>();
  for(const row of rows.results){const compact=String(row.term||"").replace(/[^\u3400-\u9fffA-Za-z0-9]/g,"");for(let size=2;size<=Math.min(4,compact.length);size++)for(let i=0;i<=compact.length-size;i++){const term=compact.slice(i,i+size);vocabulary.set(term,(vocabulary.get(term)||0)+1);}}
  const candidates=new Map<string,{term:string;frequency:number}>();for(const [term,frequency] of vocabulary){const key=`${term.length}:${phonetic(term)}`;const current=candidates.get(key);if(!current||frequency>current.frequency)candidates.set(key,{term,frequency});}
  for(let size=Math.min(4,original.length);size>=2;size--){for(let i=0;i<=original.length-size;i++){const source=original.slice(i,i+size);if(vocabulary.has(source))continue;const candidate=candidates.get(`${source.length}:${phonetic(source)}`);if(candidate&&candidate.term!==source&&candidate.frequency>=2){corrected=corrected.replace(source,candidate.term);changes.push({from:source,to:candidate.term});break;}}if(changes.length)break;}
  // 语料自动推断只作为检索扩展，不直接改写用户意图或展示为已确认纠正。
  // 回答阶段仍保留原问题，避免高频同音词覆盖用户的真实表达。
  if(changes.length)return{original,corrected,reason:"拼音相似候选仅用于检索",confidence:.65,applied:false,changes};
  return{original,corrected:original,reason:"",confidence:0,applied:false,changes:[]};
}

export function explicitUserCorrection(question:string){
  const value=clean(question).replace(/^[“”"']|[“”"']$/g,"");
  const contrasted=value.match(/^不是.{0,30}?[，,；;]\s*(?:是|应该是)\s*(.+)$/);
  if(contrasted?.[1])return clean(contrasted[1]);
  const direct=value.match(/^(?:不是[，,：:\s]*(?:是)?|我说的是|我的意思是|应该是)\s*(.+)$/);
  return direct?.[1]?clean(direct[1]):"";
}

export function combinedRetrievalText(correction:QueryCorrection){return correction.corrected!==correction.original?`${correction.corrected}\n原始输入：${correction.original}`:correction.original;}
