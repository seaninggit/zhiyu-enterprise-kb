export function validatedGroundedAnswer(generated:string|undefined,sources:Array<{citation:number;excerpt:string}>){
  if(!generated?.trim()||!sources.length)return null;
  const citations=[...generated.matchAll(/\[(\d+)\]/g)].map(match=>Number(match[1]));
  if(!citations.length||citations.some(value=>value<1||value>sources.length))return null;
  return generated.trim();
}

export function deterministicGroundedSummary(sources:Array<{citation:number;title:string;version:number;excerpt:string}>){
  return `公司知识依据\n\n${sources.map(source=>`[${source.citation}] 《${source.title}》V${source.version}.0：${source.excerpt}`).join("\n\n")}\n\n以上结论来自当前有权访问的已生效知识，请以引用原文为准。`;
}

/** 删除模型未实际使用的来源，并按首次出现顺序连续重排引用编号。 */
export function normalizeUsedCitations<T extends {citation:number}>(answer:string,sources:T[]){
  const used:number[]=[];
  for(const match of answer.matchAll(/\[(\d+)\]/g)){
    const citation=Number(match[1]);
    if(sources.some(source=>source.citation===citation)&&!used.includes(citation))used.push(citation);
  }
  if(!used.length)return {answer,sources:[] as T[]};
  const numberMap=new Map(used.map((citation,index)=>[citation,index+1]));
  const normalizedAnswer=answer.replace(/\[(\d+)\]/g,(whole,value)=>numberMap.has(Number(value))?`[${numberMap.get(Number(value))}]`:whole);
  const normalizedSources=used.map((citation,index)=>({...sources.find(source=>source.citation===citation)!,citation:index+1}));
  return {answer:normalizedAnswer,sources:normalizedSources};
}

/** 相关性校验：检查检索到的引用是否真的跟问题有关。
 *  提取问题的关键词，对每条引用做命中计数。如果最佳引用的命中数 < 2，
 *  说明搜出来的内容跟问题不沾边，应该拒答而非硬编。*/
export function areSourcesRelevant(question:string,sources:Array<{title:string;excerpt:string}>):boolean{
  if(!sources.length)return false;
  // 提取问题的关键词（中文二分词 + 英文词 + 排除疑问代词）
  const stopWords=new Set(["哪些","什么","怎么","如何","是否","可以","相关","信息","内容","要求","哪位","找谁","谁","吗","啊","呢","吧","请","帮我","告诉我"]);
  const q=question.toLowerCase().replace(/[\s，。！？、,.!?：:；;]+/g," ");
  const terms: string[]=[];
  for(const part of q.split(/\s+/).filter(Boolean)){
    if(stopWords.has(part))continue;
    if(part.length<=2){terms.push(part);continue;}
    for(let i=0;i<part.length-1;i++)terms.push(part.slice(i,i+2));
  }
  const keyTerms=[...new Set(terms.filter(t=>t.length>=2||/[a-z0-9]/i.test(t)))];
  if(!keyTerms.length)return true; // 太短无法判断，放行
  // 每条引用的关键词命中数
  let bestHits=0;
  for(const s of sources){
    const text=`${s.title} ${s.excerpt}`.toLowerCase();
    let hits=0;
    for(const t of keyTerms)if(text.includes(t))hits++;
    if(hits>bestHits)bestHits=hits;
  }
  // 标题命中任一关键词 → 相关；否则至少 2 个内容命中
  const titleMatch=sources.some(s=>{const t=String(s.title).toLowerCase();return keyTerms.some(k=>t.includes(k));});
  return titleMatch||bestHits>=2;
}
