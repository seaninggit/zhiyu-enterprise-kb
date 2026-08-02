export function validatedGroundedAnswer(generated:string|undefined,sources:Array<{citation:number;excerpt:string}>){
  if(!generated?.trim()||!sources.length)return null;
  const citations=[...generated.matchAll(/\[(\d+)\]/g)].map(match=>Number(match[1]));
  if(!citations.length||citations.some(value=>value<1||value>sources.length))return null;
  return generated.trim();
}

export function deterministicGroundedSummary(sources:Array<{citation:number;title:string;version:number;excerpt:string}>){
  return `${sources.map(source=>`[${source.citation}] 《${source.title}》V${source.version}.0：${source.excerpt}`).join("\n\n")}\n\n以上结论来自当前有权访问的已生效知识，请以引用原文为准。`;
}
