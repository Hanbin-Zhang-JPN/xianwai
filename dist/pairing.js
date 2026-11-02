import {withRequestTimeout} from './workspace-sync.js';

export const safeStorage={
 read(kind,key){try{return globalThis[kind]?.getItem(key)||null;}catch{return null;}},
 write(kind,key,value){try{globalThis[kind].setItem(key,value);return true;}catch{return false;}},
 remove(kind,key){try{globalThis[kind]?.removeItem(key);return true;}catch{return false;}}
};
export function parsePairLink(value){
 try{
  const url=new URL(value),hash=new URLSearchParams(url.hash.slice(1)),base=new URL(hash.get('bridge')||url.origin),token=hash.get('key');
  if(!/^[a-f0-9]{64}$/.test(token||'')||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))))throw new Error();
  return {endpoint:base.origin,token};
 }catch{throw new Error('配对链接不完整，请复制 Mac 上的完整手机链接，或重新扫码。');}
}
export function connectionError(error){
 if(error?.status===401)return '二维码或配对链接已过期。请在 Mac 点击“重新连接”，再用 iPhone 相机重新扫码。';
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '连接超时。请确认 Mac 开机联网，用 Safari 重新打开；仍失败时在 Mac 重新连接后扫码。';
 return error?.message||'暂时连不上 Mac，请稍后重试。';
}
function pausePairing(milliseconds,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new DOMException('已取消连接','AbortError'));return;}
 const abort=()=>{clearTimeout(timer);reject(new DOMException('已取消连接','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);signal?.addEventListener('abort',abort,{once:true});
});}
export async function probeConnection(pair,{fetcher=(...args)=>fetch(...args),signal,onAttempt=()=>{},attempts=3,delay=700,timeout=6000}={}){
 let last;
 for(let attempt=0;attempt<attempts;attempt++){
  if(signal?.aborted)throw new DOMException('已取消连接','AbortError');onAttempt(attempt+1,attempts);
  try{return await withRequestTimeout(async activeSignal=>{
   let response;try{response=await fetcher(pair.endpoint+'/api/health',{headers:{Authorization:'Bearer '+pair.token},signal:activeSignal,cache:'no-store'});}catch(error){if(signal?.aborted)throw error;throw Object.assign(new Error('暂时无法访问手机链接，正在重试。可尝试切换 Wi-Fi / 蜂窝网络，并确认 Mac 仍联网。'),{status:502});}
   if(!response.ok)throw Object.assign(new Error(response.status===401?'配对链接已过期。':'Mac 手机连接暂未就绪，请重试。'),{status:response.status});
   let value;try{value=await response.json();}catch{throw Object.assign(new Error('手机链接返回了中转服务页面，尚未连到 Mac。请稍后重试。'),{status:502});}
   if(value?.provider!=='codex'||typeof value.ready!=='boolean')throw Object.assign(new Error('这不是有效的弦外 Mac 连接，请重新扫码。'),{status:400});
   return value;
  },signal,timeout);}catch(error){last=error;if(signal?.aborted||error.status===401||(error.status>=400&&error.status<500)||attempt===attempts-1)throw error;await pausePairing(delay*(attempt+1),signal);}
 }
 throw last;
}
