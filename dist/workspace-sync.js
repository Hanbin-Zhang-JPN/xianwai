import {normalizeWorkspace} from './workspace.js';

export function bindWorkspaceLifecycle({documentTarget=document,windowTarget=window,save,flush,resume}){
 const leave=()=>{save();void flush();};
 const visible=()=>{if(!documentTarget.hidden)resume();};
 const visibility=()=>{if(documentTarget.hidden)leave();else visible();};
 documentTarget.addEventListener('visibilitychange',visibility);
 windowTarget.addEventListener('pagehide',leave);
 windowTarget.addEventListener('pageshow',visible);
 return ()=>{documentTarget.removeEventListener('visibilitychange',visibility);windowTarget.removeEventListener('pagehide',leave);windowTarget.removeEventListener('pageshow',visible);};
}

// Use AbortController directly so older iPhone WebKit versions need no AbortSignal.any.
export async function withRequestTimeout(operation,signal,milliseconds=12000){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),milliseconds);
 try{return await operation(controller.signal);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function createWorkspaceSync({fetcher=(...args)=>fetch(...args),delay=700,onError=()=>{}}={}){
 let session=null;
 async function read(response){
  let value;try{value=await response.json();}catch{throw new Error('Mac 备份返回异常，当前设备的记录仍保留。');}
  if(!response.ok)throw Object.assign(new Error(value?.error||'Mac 备份未能保存。'),{status:response.status});
  if(!Number.isSafeInteger(value?.revision)||value.revision<0)throw new Error('Mac 备份版本不正确。');
  return value;
 }
 function disconnect(){if(session){clearTimeout(session.timer);session.pending=null;session.controller.abort();}session=null;}
 function connect({endpoint,token,revision}){
  disconnect();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Mac 备份版本不正确。');
  session={base:endpoint.replace(/\/$/,''),token,revision,controller:new AbortController(),blocked:false,clearing:false,pending:null,running:Promise.resolve()};
 }
 function flush(scope=session){
  if(!scope)return Promise.resolve();clearTimeout(scope.timer);scope.timer=null;
  const payload=scope.pending;scope.pending=null;if(!payload)return scope.running;
  scope.running=scope.running.then(async()=>{
   if(session!==scope||scope.blocked||scope.clearing)return;
   try{const serialized=JSON.stringify({...payload,baseRevision:scope.revision});const value=await withRequestTimeout(async signal=>read(await fetcher(scope.base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+scope.token},body:serialized,keepalive:new TextEncoder().encode(serialized).length<60000,signal})),scope.controller.signal);if(session===scope)scope.revision=value.revision;}
   catch(error){if(session!==scope||scope.controller.signal.aborted)return;scope.blocked=true;scope.pending=null;onError(error);}
  });
  return scope.running;
 }
 function schedule(value){
  const scope=session;if(!scope||scope.blocked||scope.clearing)return;
  scope.pending=normalizeWorkspace(value);clearTimeout(scope.timer);scope.timer=setTimeout(()=>{void flush(scope);},delay);
 }
 async function clear(){
  const scope=session;if(!scope)throw new Error('Mac 尚未连接，无法删除 Mac 备份。');
  clearTimeout(scope.timer);scope.timer=null;scope.pending=null;scope.clearing=true;
  try{
   await scope.running;
   if(session!==scope)throw new Error('连接已变更，未删除 Mac 备份。');
   if(scope.blocked)throw new Error('Mac 备份存在冲突或连接异常，请重新配对后再清除。');
   const value=await withRequestTimeout(async signal=>read(await fetcher(scope.base+'/api/workspace',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+scope.token},body:JSON.stringify({baseRevision:scope.revision}),signal})),scope.controller.signal);
   if(session!==scope)throw new Error('连接已变更。');scope.revision=value.revision;return value;
  }catch(error){scope.blocked=true;throw error;}finally{scope.clearing=false;}
 }
 return {connect,disconnect,schedule,flush:()=>flush(),clear};
}
