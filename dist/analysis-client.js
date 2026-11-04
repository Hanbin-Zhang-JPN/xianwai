import {normalizeReplyVerification} from './reply-verification.js';
import {normalizeRelationshipContext} from './relationship-review.js';
import {normalizeContextInfo} from './history-context.js';
import {contextFor} from './core.js';
import {normalizeRecommendation} from './reply-options.js';
const aborted=()=>new DOMException('已取消分析','AbortError');
export function validateClientAnalysis(value,input){
 const context=contextFor(input.messages,input.targetIndex),count=context.length;const info=normalizeContextInfo(input.contextInfo,count),relation=normalizeRelationshipContext(input.relationshipContext,count);if(relation&&(!info||relation.sourceCount>info.availableCount))throw new Error('关系档案超出了目标消息的历史范围。');
 const validText=(text,max=2000)=>typeof text==='string'&&!!text.trim()&&text.length<=max;
 const validEvidence=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=6&&ids.every(id=>Number.isInteger(id)&&id>=1&&id<=count);
 if(!value||value.mode!=='ai'||value.contextCount!==count||!['title','feeling','need','question','avoid'].every(key=>validText(value[key]))||!Array.isArray(value.replies)||value.replies.length!==3||!Array.isArray(value.facts)||!value.facts.length||!Array.isArray(value.hypotheses)||value.hypotheses.length<2||value.hypotheses.length>3)throw new Error('分析结果格式不正确，请重试。');
 if(value.replies.some((reply,index)=>!reply||reply.tone!==['warm','honest','brief'][index]||!['text','label','reason'].every(key=>validText(reply[key])))||[...value.facts,...value.hypotheses].some(item=>!item||!validText(item.text,2400)||!validEvidence(item.evidence)))throw new Error('分析结果中的回复或原话引用不正确，请重试。');
 normalizeRecommendation(value.recommendation);normalizeReplyVerification(value.verification,value,input);if(input.verify===true&&!value.verification)throw new Error('Mac 未返回回复核对结果，请更新 Mac 后重试。');
 return value;
}

export function createAnalysisClient({fetcher=(...args)=>fetch(...args),pollInterval=700,timeout=330000,now=()=>Date.now(),cacheTTL=600000}={}){
 let active=null,cancellation=Promise.resolve();
 const cache=new Map();
 const wait=(signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(aborted());return;}
  const abort=()=>{clearTimeout(timer);reject(aborted());};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},pollInterval);
  signal.addEventListener('abort',abort,{once:true});
 });
 async function read(response){
  let value;try{value=await response.json();}catch{throw new Error('Mac 连接中断或返回异常，请重新连接后重试。');}
  if(!response.ok)throw Object.assign(new Error(value?.error||'分析暂时不可用。'),{status:response.status});
  return value;
 }
 function stop(request){
  if(!request)return Promise.resolve();
  request.controller.abort();
  if(!request.submitted)return Promise.resolve();
  request.cleanup ||= fetcher(request.base+'/api/jobs/'+encodeURIComponent(request.remoteId||request.id),{method:'DELETE',headers:{Authorization:'Bearer '+request.token},signal:AbortSignal.timeout(5000)}).catch(()=>{});
  return request.cleanup;
 }
 async function cancel(){const old=active;active=null;cancellation=Promise.all([cancellation,stop(old)]).then(()=>{});await cancellation;}
 async function request({endpoint,token,input,fresh=false}){
  const old=active;
  const current={id:crypto.randomUUID(),controller:new AbortController(),base:endpoint.replace(/\/$/,''),token,submitted:false};
  active=current;
  let complete=false,timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;current.controller.abort();},timeout);
  try{
   cancellation=Promise.all([cancellation,stop(old)]).then(()=>{});
   await cancellation;
   if(current.controller.signal.aborted||active!==current)throw aborted();
   const key=JSON.stringify({base:current.base,token,input});
   if(fresh)cache.delete(key);
   if(cache.has(key)){const entry=cache.get(key),time=now(),age=time-entry.savedAt;if(age>=0&&age<=cacheTTL&&new Date(time).toDateString()===new Date(entry.savedAt).toDateString()){complete=true;return entry.result;}cache.delete(key);}
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
   current.submitted=true;
   let response=await fetcher(current.base+'/api/analyze',{method:'POST',headers,body:JSON.stringify({...input,requestId:current.id}),signal:current.controller.signal});
   let result=await read(response);
   if(response.status===202){
    current.remoteId=result?.jobId;
    if(typeof current.remoteId!=='string')throw new Error('分析任务格式不正确，请重试。');
    while(true){
     await wait(current.controller.signal);
     result=await read(await fetcher(current.base+'/api/jobs/'+encodeURIComponent(current.remoteId),{headers,signal:current.controller.signal}));
     if(result?.status==='completed'){result=result.result;break;}
     if(result?.status==='cancelled')throw aborted();
     if(result?.status==='failed')throw new Error(result.error||'AI 分析失败，请重试。');
    }
   }
   validateClientAnalysis(result,input);
   if(current.controller.signal.aborted||active!==current)throw aborted();
   complete=true;cache.set(key,{result,savedAt:now()});if(cache.size>30)cache.delete(cache.keys().next().value);
   return result;
  }catch(error){
   if(timedOut)throw new DOMException('分析超时，请检查 Mac 连接后重试。','TimeoutError');
   if(current.controller.signal.aborted)throw aborted();
   throw error;
  }finally{
   clearTimeout(deadline);
   if(!complete)await stop(current);
   if(active===current)active=null;
  }
 }
 return {request,cancel,clearCache:()=>cache.clear()};
}
export const analysisClient=createAnalysisClient();
