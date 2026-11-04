export function createConnectionMonitor({current,probe,onStatus,onFailure}){
 let active=null;
 const same=(a,b)=>!!a&&!!b&&a.endpoint===b.endpoint&&a.token===b.token;
 function invalidate(){const old=active;active=null;old?.controller.abort();}
 async function check(){
  const pair=current();if(!pair||active)return false;
  const task={pair:{...pair},controller:new AbortController()};active=task;
  const valid=()=>active===task&&!task.controller.signal.aborted&&same(task.pair,current());
  try{
   let status,error;try{status=await probe(task.pair,task.controller.signal);}catch(issue){error=issue;}
   if(!valid())return false;
   if(error)onFailure(error);else onStatus(status);return !error;
  }finally{if(active===task)active=null;}
 }
 return {check,invalidate};
}
