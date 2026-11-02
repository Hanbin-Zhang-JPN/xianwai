import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,mkdtemp,rm,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {analyzeWithCodex,defaultCodex} from '../lib/codex.mjs';
import {contextFor,validateMessages} from '../dist/core.js';

const exec=promisify(execFile), root=fileURLToPath(new URL('../dist/',import.meta.url));
const token=process.env.XIANWAI_TOKEN;
if(!token||token.length<32)throw new Error('A strong pairing token is required.');
const jobs=new Map();let active=null;let ready=false;
const dataDirectory=process.env.XIANWAI_DATA_DIR||path.join(os.homedir(),'Library/Application Support/Xianwai');
const workspaceFile=path.join(dataDirectory,'workspace.json');
try{const status=await exec(process.env.CODEX_BIN||defaultCodex,['login','status'],{timeout:10000});ready=/Logged in/i.test(status.stdout+status.stderr);}catch{}
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=400000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('内容过大，请分批导入。'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('请求格式不正确。'),{status:400});}}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 let url;try{url=new URL(req.url,'http://localhost');}catch{send(res,400,{error:'无效请求。'});return;}
 if(url.pathname.startsWith('/api/')){
  const origin=req.headers.origin;
  if(origin){let allowed=false;try{const u=new URL(origin);allowed=u.protocol==='https:'||['127.0.0.1','localhost'].includes(u.hostname);}catch{}if(!allowed){send(res,403,{error:'来源不受支持。'});return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(!equal(req.headers.authorization||'','Bearer '+token)){send(res,401,{error:'这台设备尚未配对，请用 Mac 上的二维码重新连接。'});return;}
  try{
   if(url.pathname==='/api/health'&&req.method==='GET'){send(res,200,{ready,mode:ready?'ai':'unavailable',provider:'codex',ocr:!!process.env.XIANWAI_OCR,async:true});return;}
   if(url.pathname==='/api/workspace'){
    if(req.method==='GET'){try{send(res,200,{workspace:JSON.parse(await readFile(workspaceFile,'utf8'))});}catch(error){if(error.code==='ENOENT')send(res,200,{workspace:null});else throw new Error('Mac 的聊天备份暂时无法读取，请勿覆盖，先导出当前聊天。');}return;}
    if(req.method==='DELETE'){await rm(workspaceFile,{force:true});send(res,200,{deleted:true});return;}
    if(req.method==='POST'){
     const input=await body(req,3000000);
     if(!Array.isArray(input.chats)||input.chats.length>15||!Array.isArray(input.favorites)||input.favorites.length>300)throw new Error('备份格式或数量不正确。');
     const chats=input.chats.map(c=>{if(!c||typeof c.id!=='string'||c.id.length>100||typeof c.title!=='string'||c.title.length>30||typeof c.name!=='string'||c.name.length>20||typeof c.note!=='string'||c.note.length>2000||!Array.isArray(c.messages)||(c.style!==undefined&&(typeof c.style!=='string'||c.style.length>1000)))throw new Error('对话信息不正确。');return{id:c.id,title:c.title,name:c.name,note:c.note,style:c.style||'',preferredTone:['warm','honest','brief'].includes(c.preferredTone)?c.preferredTone:'warm',subtitle:typeof c.subtitle==='string'?c.subtitle.slice(0,100):'',messages:c.messages.length?validateMessages(c.messages):[]};});
     const favorites=input.favorites.map(f=>{if(typeof f.id!=='string'||typeof f.text!=='string'||f.text.length>2000)throw new Error('收藏格式不正确。');return{id:f.id.slice(0,100),text:f.text,label:String(f.label||'').slice(0,100),name:String(f.name||'').slice(0,100),source:String(f.source||'').slice(0,100)};});
     const temporary=workspaceFile+'.'+randomUUID()+'.tmp';await mkdir(dataDirectory,{recursive:true,mode:0o700});await writeFile(temporary,JSON.stringify({active:chats.some(c=>c.id===input.active)?input.active:chats[0]?.id||null,chats,favorites,savedAt:Date.now()}),{mode:0o600});await rename(temporary,workspaceFile);send(res,200,{saved:true});return;
    }
   }
   if(url.pathname==='/api/analyze'&&req.method==='POST'){
    if(!ready){send(res,503,{error:'请先在这台 Mac 的 ChatGPT 应用中登录 Codex。'});return;}
    if(active){send(res,429,{error:'还有一条消息正在分析，请等它完成或取消后再试。'});return;}
    const input=await body(req);contextFor(input.messages,input.targetIndex);
    if(!['warm','honest','brief'].includes(input.tone)||typeof input.note!=='string'||input.note.length>2000||(input.style!==undefined&&(typeof input.style!=='string'||input.style.length>1000)))throw new Error('语气或背景格式不正确。');
    for(const [id,job] of jobs)if(Date.now()-job.created>600000)jobs.delete(id);
    const id=randomUUID(),controller=new AbortController(),job={created:Date.now(),status:'running',controller};jobs.set(id,job);active=id;
    job.finished=analyzeWithCodex(input,{signal:controller.signal}).then(result=>{job.status='completed';job.result=result;}).catch(error=>{job.status='failed';job.error=error.message;}).finally(()=>{if(active===id)active=null;});
    send(res,202,{jobId:id,status:'running'});return;
   }
   if(url.pathname.startsWith('/api/jobs/')){const id=url.pathname.slice(10),job=jobs.get(id);if(!job){send(res,404,{error:'这次分析已过期，请重新选择消息。'});return;}if(req.method==='DELETE'){job.controller.abort();await job.finished;send(res,200,{status:'cancelled'});return;}if(req.method==='GET'){send(res,200,{status:job.status,...(job.result?{result:job.result}:{}),...(job.error?{error:job.error}:{})});return;}}
   if(url.pathname==='/api/ocr'&&req.method==='POST'){
    if(!process.env.XIANWAI_OCR){send(res,503,{error:'本机截图识别尚未准备好。'});return;}
    const input=await body(req,6500000),match=typeof input.dataUrl==='string'&&input.dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
    if(!match)throw new Error('请上传 PNG 或 JPG 截图。');
    const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-ocr-'));
    try{const file=path.join(folder,'screenshot.'+(match[1]==='jpeg'?'jpg':'png'));await writeFile(file,Buffer.from(match[2],'base64'),{mode:0o600});const result=await exec(process.env.XIANWAI_OCR,[file],{timeout:45000,maxBuffer:400000});const rows=JSON.parse(result.stdout);if(!rows.length)throw new Error('没有识别到聊天文字，请选择清晰的竖屏微信截图。');send(res,200,{rows});}finally{await rm(folder,{recursive:true,force:true});}return;
   }
   send(res,404,{error:'接口不存在。'});
  }catch(error){send(res,error.status||400,{error:error.code?'截图处理失败，请换一张图片重试。':error.message});}return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let filename;try{filename=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
 if(!filename.startsWith(root)){res.writeHead(404);res.end();return;}
 try{const content=await readFile(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'})[path.extname(filename)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:content);}catch{res.writeHead(404);res.end('Not found');}
});
server.requestTimeout=60000;
server.listen(Number(process.env.XIANWAI_PORT||0),'127.0.0.1',()=>console.log(JSON.stringify({event:'ready',port:server.address().port,ai:ready})));
function shutdown(){for(const job of jobs.values())job.controller.abort();server.close(()=>process.exit());setTimeout(()=>process.exit(),2000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
