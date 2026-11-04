export const REPLY_GOALS=[{id:'auto',label:'根据语境推荐'},{id:'listen',label:'先倾听、接住情绪'},{id:'clarify',label:'把实际情况说清楚'},{id:'plan',label:'商量可兑现的下一步'},{id:'boundary',label:'表达我的边界'}];
export function normalizeReplyOptions(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('回复方向格式不正确。');
 const goal=value.goal??'auto',context=value.context??'';
 if(!REPLY_GOALS.some(item=>item.id===goal)||typeof context!=='string'||context.length>500)throw new Error('请选择有效的回复方向，补充情况最多 500 字。');
 return {goal,context:context.trim()};
}
export function normalizeRecommendation(value){
 if(value===undefined)return null; // Saved analyses from older versions remain readable.
 if(!value||!['reply','pause'].includes(value.action??'reply')||!['warm','honest','brief'].includes(value.tone)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>250||typeof value.check!=='string'||value.check.length>250)throw new Error('推荐回复的理由或使用条件不正确。');
 return {action:value.action??'reply',tone:value.tone,reason:value.reason.trim(),check:value.check.trim()};
}
export function needsReplyDetails(text){return /【\s*待补充|待补充\s*[:：】]/.test(String(text));}
export function replyCopyProblem(text){
 if(typeof text!=='string'||!text.trim())return '先写好回复草稿，再复制。';
 if(needsReplyDetails(text))return '请先把“待补充”替换成你的实际信息，再复制。';
 return '';
}
