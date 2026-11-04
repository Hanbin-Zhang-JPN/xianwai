import {withRequestTimeout} from './workspace-sync.js';
export function normalizeReviewJob(value){
 if(!value||!['none','running','completed','failed','cancelled'].includes(value.status))throw new Error('梳理状态格式不正确。');
 if(value.jobId!==undefined&&(typeof value.jobId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(value.jobId)))throw new Error('梳理任务编号不正确。');
 if(value.chatId!==undefined&&(typeof value.chatId!=='string'||!value.chatId||value.chatId.length>100))throw new Error('梳理联系人来源不正确。');
 if(value.progress){const p=value.progress;if(typeof p.phase!=='string'||p.phase.length>80||!['done','total','chunkDone','chunkTotal','cached'].every(k=>Number.isInteger(p[k])&&p[k]>=0&&p[k]<=400)||p.done>p.total||p.cached>p.done||p.chunkDone>p.chunkTotal)throw new Error('梳理进度格式不正确。');}
 return value;
}
export function createHistoryReviewClient({fetcher=(...args)=>fetch(...args),getPair,onUpdate=()=>{},onComplete=()=>{},onError=()=>{},interval=1200}={}){
 let active=null,known=null;
 const same=(a,b)=>a?.endpoint===b?.endpoint&&a?.token===b?.token;
 const valid=task=>active===task&&!task.controller.signal.aborted&&same(task.pair,getPair());
 function disconnect(){active?.controller.abort();active=null;known=null;}
 function begin(pair){disconnect();const task={pair:{...pair},controller:new AbortController()};active=task;return task;}
 async function call(pair,path,options={},signal){return withRequestTimeout(async live=>{const response=await fetcher(pair.endpoint+path,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.token},signal:live});let value;try{value=await response.json();}catch{throw new Error('Mac 梳理服务返回异常，请重新连接。');}if(!response.ok)throw Object.assign(new Error(value.error||'梳理暂未完成，请重试。'),{status:response.status});return normalizeReviewJob(value);},signal);}
 const sleep=signal=>new Promise((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,interval),abort=()=>{clearTimeout(timer);reject(new DOMException('cancelled','AbortError'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
 async function follow(task,value){
  try{while(valid(task)){
   known={...value,pair:task.pair};onUpdate(value);
   if(value.status==='completed'){onComplete(value.result,task.chatId);return;}
   if(value.status!=='running')return;
   await sleep(task.controller.signal);if(!valid(task))return;
   value={...await call(task.pair,'/api/jobs/'+encodeURIComponent(task.jobId),{},task.controller.signal),jobId:task.jobId,chatId:task.chatId};
  }}catch(error){if(valid(task))onError(error);}finally{if(active===task)active=null;}
 }
 async function start(pair,input){const task=begin(pair);task.chatId=input.chatId;try{const value=await call(pair,'/api/history-review',{method:'POST',body:JSON.stringify(input)},task.controller.signal);if(!valid(task))return false;if(typeof value.jobId!=='string')throw new Error('梳理任务编号不正确。');task.jobId=value.jobId;known={...value,chatId:task.chatId,pair:task.pair};onUpdate({...value,chatId:task.chatId});void follow(task,{...await call(pair,'/api/jobs/'+encodeURIComponent(task.jobId),{},task.controller.signal),jobId:task.jobId,chatId:task.chatId});return true;}catch(error){if(valid(task)){active=null;onError(error);}return false;}}
 async function resume(pair){const task=begin(pair);try{const value=await call(pair,'/api/history-review',{},task.controller.signal);if(!valid(task))return;if(value.status==='none'){onUpdate(value);active=null;return;}if(typeof value.jobId!=='string'||typeof value.chatId!=='string')throw new Error('梳理任务来源不正确。');task.jobId=value.jobId;task.chatId=value.chatId;void follow(task,value);}catch(error){if(valid(task)){active=null;onError(error);}}}
 async function cancel(){const task=known;if(!task||!same(task.pair,getPair()))return false;const result=await call(task.pair,'/api/jobs/'+encodeURIComponent(task.jobId),{method:'DELETE'});if(!same(task.pair,getPair()))return false;disconnect();onUpdate({...result,chatId:task.chatId,jobId:task.jobId});return true;}
 return {start,resume,cancel,disconnect};
}
