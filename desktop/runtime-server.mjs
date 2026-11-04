import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {analyzeWithCodex,defaultCodex} from '../lib/codex.mjs';
import {contextFor} from '../dist/core.js';
import {WorkspaceStore} from '../lib/workspace-store.mjs';
import {normalizeReplyOptions} from '../dist/reply-options.js';
import {execAndWait} from '../lib/process.mjs';

const exec=promisify(execFile), root=fileURLToPath(new URL('../dist/',import.meta.url));
const token=process.env.XIANWAI_TOKEN;
if(!token||token.length<32)throw new Error('A strong pairing token is required.');
const jobs=new Map(),ocrTasks=new Set();let active=null,stopping=false;let ready=false,ocrActive=0;
const dataDirectory=process.env.XIANWAI_DATA_DIR||path.join(os.homedir(),'Library/Application Support/Xianwai');
const workspaceStore=new WorkspaceStore(dataDirectory);
let authCheckedAt=0,authCheck=null;
async function refreshAuth(){
 if(authCheck)return authCheck;
 if(Date.now()-authCheckedAt<(ready?30000:3000))return;
 authCheck=(async()=>{try{const status=await exec(process.env.CODEX_BIN||defaultCodex,['login','status'],{timeout:5000});ready=/Logged in/i.test(status.stdout+status.stderr);}catch{ready=false;}finally{authCheckedAt=Date.now();authCheck=null;}})();
 await authCheck;
}
await refreshAuth();
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=400000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('内容过大，请分批导入。'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求格式不正确。'),{status:400});}}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 let url;try{url=new URL(req.url,'http://localhost');}catch{send(res,400,{error:'无效请求。'});return;}
 if(url.pathname.startsWith('/api/')){
  const origin=req.headers.origin;
  if(origin){let allowed=origin==='null';try{const u=new URL(origin);allowed=u.protocol==='https:'||['127.0.0.1','localhost'].includes(u.hostname);}catch{}if(!allowed){send(res,403,{error:'来源不受支持。'});return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(!equal(req.headers.authorization||'','Bearer '+token)){send(res,401,{error:'这台设备尚未配对，请用 Mac 上的二维码重新连接。'});return;}
  if(stopping){send(res,503,{error:'Mac 服务正在关闭，请重新连接后再试。'});return;}
  try{
   if(url.pathname==='/api/health'&&req.method==='GET'){await refreshAuth();send(res,200,{version:'0.5.1',workspaceSchema:5,ready,mode:ready?'ai':'unavailable',provider:'codex',ocr:!!process.env.XIANWAI_OCR,async:true});return;}
   if(url.pathname==='/api/workspace'){
    if(req.method==='GET'){send(res,200,await workspaceStore.read());return;}
    if(req.method==='DELETE'){const input=await body(req);const value=await workspaceStore.clear(input?.baseRevision);send(res,200,{deleted:true,revision:value.revision});return;}
    if(req.method==='POST'){const input=await body(req,10000000);const value=await workspaceStore.save(input,input?.baseRevision);send(res,200,{saved:true,revision:value.revision});return;}
   }
   if(url.pathname==='/api/analyze'&&req.method==='POST'){
    await refreshAuth();if(!ready){send(res,503,{error:'请先在这台 Mac 的 ChatGPT 应用中登录 Codex。'});return;}
    const input=await body(req);if(stopping)throw Object.assign(new Error('Mac 服务正在关闭。'),{status:503});if(!input||typeof input!=='object')throw new Error('分析请求格式不正确。');contextFor(input.messages,input.targetIndex);
    if(!['warm','honest','brief'].includes(input.tone)||typeof input.note!=='string'||input.note.length>2000||(input.style!==undefined&&(typeof input.style!=='string'||input.style.length>1000)))throw new Error('语气或背景格式不正确。');
    normalizeReplyOptions(input.replyOptions);
    for(const [id,job] of jobs)if(Date.now()-job.created>600000)jobs.delete(id);
    const id=input.requestId||randomUUID();
    if(typeof id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(id))throw new Error('分析任务编号不正确。');
    if(jobs.has(id)){const prior=jobs.get(id);if(prior.status==='cancelled'){send(res,409,{error:'这次分析已取消。'});return;}send(res,202,{jobId:id,status:prior.status});return;}
    if(active){send(res,429,{error:'还有一条消息正在分析，请等它完成或取消后再试。'});return;}
    const controller=new AbortController(),job={created:Date.now(),status:'running',controller};jobs.set(id,job);active=id;
    job.finished=analyzeWithCodex(input,{signal:controller.signal}).then(result=>{job.status='completed';job.result=result;}).catch(error=>{job.status='failed';job.error=error.message;}).finally(()=>{if(active===id)active=null;});
    send(res,202,{jobId:id,status:'running'});return;
   }
   if(url.pathname.startsWith('/api/jobs/')){const id=url.pathname.slice(10);if(!/^[-a-zA-Z0-9]{1,100}$/.test(id))throw new Error('分析任务编号不正确。');const job=jobs.get(id);if(req.method==='DELETE'){if(job){job.controller?.abort();await job.finished;job.status='cancelled';delete job.result;}else{jobs.set(id,{created:Date.now(),status:'cancelled'});if(jobs.size>300)jobs.delete(jobs.keys().next().value);}send(res,200,{status:'cancelled'});return;}if(!job){send(res,404,{error:'这次分析已过期，请重新选择消息。'});return;}if(req.method==='GET'){send(res,200,{status:job.status,...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})});return;}}
   if(url.pathname==='/api/ocr'&&req.method==='POST'){
    if(!process.env.XIANWAI_OCR){send(res,503,{error:'本机截图识别尚未准备好。'});return;}
    const input=await body(req,6500000),match=typeof input?.dataUrl==='string'&&input.dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if(stopping)throw Object.assign(new Error('Mac 服务正在关闭。'),{status:503});
    if(!match)throw new Error('请上传 PNG 或 JPG 截图。');
    if(ocrActive>=2){send(res,429,{error:'已有截图正在识别，请稍候再试。'});return;}ocrActive++;
    const ocrController=new AbortController(),abortOCR=()=>{if(!res.writableEnded)ocrController.abort();};res.once('close',abortOCR);
    let finishOCR;const task={controller:ocrController,finished:new Promise(resolve=>{finishOCR=resolve;})};ocrTasks.add(task);
    let folder;try{folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-ocr-'));const file=path.join(folder,'screenshot.'+(match[1]==='jpeg'?'jpg':'png'));await writeFile(file,Buffer.from(match[2],'base64'),{mode:0o600});const result=await execAndWait(process.env.XIANWAI_OCR,[file],{timeout:45000,maxBuffer:400000,signal:ocrController.signal});const rows=JSON.parse(result.stdout);if(!rows.length)throw new Error('没有识别到聊天文字，请选择清晰的竖屏微信截图。');send(res,200,{rows});}finally{ocrActive--;res.removeListener('close',abortOCR);try{if(folder)await rm(folder,{recursive:true,force:true});}finally{ocrTasks.delete(task);finishOCR();}}return;
   }
   send(res,404,{error:'接口不存在。'});
  }catch(error){if(res.destroyed)return;send(res,error.status||400,{error:error.code?'截图处理失败，请换一张图片重试。':error.message});}return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let filename;try{filename=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
 if(!filename.startsWith(root)){res.writeHead(404);res.end();return;}
 try{const content=await readFile(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'})[path.extname(filename)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);}catch{res.writeHead(404);res.end('Not found');}
});
server.requestTimeout=60000;
server.listen(Number(process.env.XIANWAI_PORT||0),'127.0.0.1',()=>console.log(JSON.stringify({event:'ready',port:server.address().port,ai:ready})));
async function shutdown(){
 if(stopping)return;stopping=true;
 const pending=[...jobs.values(),...ocrTasks];for(const task of pending)task.controller?.abort();
 const closed=new Promise(resolve=>server.close(resolve)),closeConnections=setTimeout(()=>server.closeAllConnections(),1200),deadline=setTimeout(()=>process.exit(1),3000);
 closeConnections.unref();deadline.unref();
 await Promise.allSettled([closed,workspaceStore.queue,...pending.map(task=>task.finished)]);
 clearTimeout(closeConnections);clearTimeout(deadline);process.exit(0);
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
