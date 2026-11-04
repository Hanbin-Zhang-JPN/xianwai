import {replyCopyProblem,normalizeReplyOptions,normalizeRecommendation} from './reply-options.js';
export function replyContextCheck(message,time=0){let a=2166136261,b=2246822507;const data=JSON.stringify([message.role,message.text.trim(),time]);for(let i=0;i<data.length;i++){const n=data.charCodeAt(i);a=Math.imul(a^n,16777619);b=Math.imul(b^n,3266489909);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
export function normalizeReplyVerification(value,analysis,input){
 if(value===undefined||value===null)return null;
 const originalRecommendation=value.originalRecommendation?normalizeRecommendation(value.originalRecommendation):null;
 const texts=[analysis.title,analysis.feeling,analysis.need,analysis.question,analysis.avoid,...analysis.hypotheses.map(h=>h.text),analysis.recommendation?.reason||'',analysis.recommendation?.check||'',originalRecommendation?.reason||'',originalRecommendation?.check||'',...analysis.replies.map(r=>r.reason)].join('\n');
 const item=(row,source,statuses)=>{if(!row||!statuses.includes(row.status)||typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>400||!Array.isArray(row.issues)||row.issues.length>4)throw new Error('回复核对结果格式不正确。');const issues=row.issues.map(issue=>{if(!issue||typeof issue.quote!=='string'||!issue.quote||issue.quote.length>400||!source.includes(issue.quote)||typeof issue.reason!=='string'||!issue.reason.trim()||issue.reason.length>400)throw new Error('回复核对引用的文字不正确。');return {quote:issue.quote,reason:issue.reason};});if((row.status==='review')!==!!issues.length)throw new Error('回复核对结论与问题列表不一致。');return {status:row.status,reason:row.reason,issues};};
 if(!['reply','pause'].includes(value.action)||typeof value.actionReason!=='string'||!value.actionReason.trim()||value.actionReason.length>250)throw new Error('回复核对的行动建议不正确。');
 if(value.version!==1||!Array.isArray(value.replies)||value.replies.length!==3)throw new Error('回复核对版本不正确。');
 if(!Array.isArray(value.contextChecks)||value.contextChecks.length!==analysis.contextCount||value.contextChecks.some(check=>typeof check!=='string'||!/^[a-f0-9]{16}$/.test(check)))throw new Error('回复核对缺少原文校验。');
 const checkedOptions=normalizeReplyOptions(value.checkedOptions);if(input){const context=input.messages.slice(0,input.targetIndex+1);if(context.some((m,i)=>replyContextCheck(m,input.contextInfo?.sentAt[i]||0)!==value.contextChecks[i])||JSON.stringify(normalizeReplyOptions(input.replyOptions))!==JSON.stringify(checkedOptions))throw new Error('回复核对的原文或实际情况已经变更。');}
 const replies=value.replies.map((row,i)=>{const reply=analysis.replies[i];if(row.tone!==reply.tone||row.checkedText!==reply.text)throw new Error('回复核对不对应当前草稿。');return {tone:reply.tone,checkedText:reply.text,...item(row,reply.text,['ready','review'])};});
 return {version:1,action:value.action,actionReason:value.actionReason,...(originalRecommendation?{originalRecommendation}:{}),contextChecks:[...value.contextChecks],checkedOptions,replies,interpretation:item(value.interpretation,texts,['tentative','review'])};
}
export function replyReviewStatus(analysis,tone,text,options,sourceCurrent=true){
 const problem=replyCopyProblem(text);if(problem)return {status:'blocked',reason:problem,issues:[]};
 if(analysis?.verification&&options&&JSON.stringify(normalizeReplyOptions(options))!==JSON.stringify(analysis.verification.checkedOptions))return {status:'review',reason:'本次实际情况或回复方向已修改，原核对结果不覆盖这次变化。请重新起草，或自行确认这句符合实际。',issues:[]};
 if(analysis&&!sourceCurrent)return {status:'review',reason:'这份建议回应的是较早消息，或核对已过期。请先看最新对话，并确认这句仍符合当前事实。',issues:[]};
 const checked=analysis?.verification?.replies?.find(item=>item.tone===tone&&item.checkedText.trim()===text.trim());
 if(checked)return checked;
 return {status:'review',reason:analysis?.verification?'草稿已修改，这次核对不覆盖改动后的内容。请确认事实、时间和承诺符合你的实际情况。':'这段文字尚未经过回复核对，请确认事实、时间和承诺符合当前实际情况。',issues:[]};
}
export function preferredVerifiedTone(analysis,fallback='warm'){
 const preferred=analysis.recommendation?.tone||fallback;
 if(!analysis.verification||analysis.verification.replies.find(item=>item.tone===preferred)?.status==='ready')return preferred;
 return analysis.verification.replies.find(item=>item.status==='ready')?.tone||preferred;
}

export function isReplySourceCurrent(record,chat,now=Date.now()){if(!record)return false;const age=now-record.createdAt;return record.targetId===chat.messages.at(-1)?.id&&age>=0&&age<=86400000&&new Date(now).toDateString()===new Date(record.createdAt).toDateString()&&(record.note||'')===(chat.note||'')&&(record.style||'')===(chat.style||'');}
