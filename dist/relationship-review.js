import {HISTORY_LIMITS} from './history-context.js';
const reviewText=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('关系梳理文字格式不正确。');return value.trim();};
const reviewId=value=>{if(typeof value!=='string'||!value||value.length>100)throw new Error('关系梳理编号不正确。');return value;};
function evidence(value,count,allowed){if(!Array.isArray(value)||!value.length||value.length>6||new Set(value).size!==value.length||value.some(n=>!Number.isInteger(n)||n<1||n>count||(allowed&&!allowed.has(n))))throw new Error('关系梳理的原话引用不正确。');return [...value];}
export function normalizeReviewReport(value,count,allowed){
 if(!value||typeof value!=='object')throw new Error('关系梳理格式不正确。');
 const item=(row,kind)=>{if(!row)throw new Error('关系梳理条目不正确。');return {text:reviewText(row.text,300),evidence:evidence(row.evidence,count,allowed),...(kind==='observation'?{confidence:['explicit','tentative'].includes(row.confidence)?row.confidence:(()=>{throw new Error('关系梳理置信说明不正确。');})(),alternative:reviewText(row.alternative,300)}:{})};};
 const list=(rows,max,kind)=>{if(!Array.isArray(rows)||rows.length>max)throw new Error('关系梳理条目数量不正确。');return rows.map(row=>item(row,kind));};
 const recentState=item(value.recentState,'observation');if(!recentState.evidence.some(n=>n>=Math.max(1,count-79)))throw new Error('近期状态缺少近期原话依据。');
 if(!Array.isArray(value.unknowns)||value.unknowns.length>5)throw new Error('待确认问题数量不正确。');
 return {headline:reviewText(value.headline,80),summary:reviewText(value.summary,800),recentState,stages:list(value.stages,6),observations:list(value.observations,8,'observation'),openLoops:list(value.openLoops,6),nextSteps:list(value.nextSteps,5),unknowns:value.unknowns.map(text=>reviewText(text,240))};
}
export function reviewItems(report){return [{kind:'近期可能的状态',...report.recentState},...report.openLoops.map(item=>({kind:'待处理的事',...item})),...report.observations.map(item=>({kind:'沟通中的表现',...item})),...report.stages.map(item=>({kind:'关系进展',...item})),...report.nextSteps.map(item=>({kind:'沟通建议',...item}))];}
export function normalizeHistoryReview(value,pool){
 if(value==null)return null;
 if(!value||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||value.createdAt>8640000000000000||typeof value.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceHash)||!Array.isArray(value.sourceIds)||!value.sourceIds.length||value.sourceIds.length>HISTORY_LIMITS.messages||new Set(value.sourceIds).size!==value.sourceIds.length||value.sourceCount!==value.sourceIds.length||typeof value.sourceNote!=='string'||value.sourceNote.length>2000||!Number.isInteger(value.chunkCount)||value.chunkCount<1||value.chunkCount>200)throw new Error('全量历史梳理来源不正确。');
 const sourceIds=value.sourceIds.map(reviewId),report=normalizeReviewReport(value.report,sourceIds.length);
 if(pool&&reviewItems(report).some(item=>item.evidence.some(position=>!pool.has(sourceIds[position-1]))))throw new Error('关系梳理引用的原话已缺失，已停止覆盖。');
 return {id:reviewId(value.id),createdAt:value.createdAt,sourceHash:value.sourceHash,sourceCount:sourceIds.length,sourceIds,sourceNote:value.sourceNote,chunkCount:value.chunkCount,report};
}
export function reviewMatches(review,chat,index=chat.messages.length-1){return !!review&&review.sourceNote===(chat.note||'')&&review.sourceCount<=index+1&&review.sourceIds.every((id,i)=>chat.messages[i]?.id===id);}
export function reviewEvidenceIds(review){return review?new Set(reviewItems(review.report).flatMap(item=>item.evidence.map(n=>review.sourceIds[n-1]))):new Set();}
export function reviewPriorities(review,chat,index){return reviewMatches(review,chat,index)?[...reviewEvidenceIds(review)].slice(0,48):[];}
export function normalizeRelationshipContext(value,count){
 if(value==null)return null;if(!value||!Number.isInteger(value.sourceCount)||value.sourceCount<1||value.sourceCount>HISTORY_LIMITS.messages||!Array.isArray(value.items)||value.items.length>16||!Array.isArray(value.unknowns)||value.unknowns.length>5)throw new Error('本次关系背景格式不正确。');
 return {reviewId:reviewId(value.reviewId),sourceCount:value.sourceCount,items:value.items.map(item=>({kind:reviewText(item.kind,40),text:reviewText(item.text,300),alternative:typeof item.alternative==='string'?item.alternative.slice(0,300):'',evidence:evidence(item.evidence,count)})),unknowns:value.unknowns.map(text=>reviewText(text,240))};
}
export function relationshipContextFor(review,chat,index,selected){
 if(!reviewMatches(review,chat,index))return null;const mapping=new Map(selected.map((message,i)=>[message.id,i+1]));
 const items=reviewItems(review.report).filter(item=>item.evidence.every(n=>mapping.has(review.sourceIds[n-1]))).slice(0,16).map(item=>({...item,evidence:item.evidence.map(n=>mapping.get(review.sourceIds[n-1]))}));
 return items.length?normalizeRelationshipContext({reviewId:review.id,sourceCount:review.sourceCount,items,unknowns:review.report.unknowns},selected.length):null;
}
export function planHistoryReview(messages){
 const chunks=[];let rows=[],chars=0,start=0;for(let i=0;i<messages.length;i++){const m=messages[i];if(rows.length&&(rows.length>=400||chars+m.text.length>40000)){chunks.push({start,rows});rows=[];chars=0;start=i;}rows.push(m);chars+=m.text.length;}if(rows.length)chunks.push({start,rows});let calls=chunks.length,n=chunks.length;while(n>4){n=Math.ceil(n/4);calls+=n;}return {chunks,calls:calls+1};
}
