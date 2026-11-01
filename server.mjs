import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {analyzeInput} from './lib/ai.mjs';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4388),token=process.env.API_TOKEN||'';
if(!['127.0.0.1','localhost','::1'].includes(host)&&!token)throw new Error('Set API_TOKEN before binding to a non-loopback host.');
const limits=new Map();
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  if(!token&&!['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+req.headers.host).hostname)){json(res,403,{error:'本机服务只接受本机主机名。'});return;}
  const origin=req.headers.origin;
  const same=origin&&origin===`http://${req.headers.host}`;
  const authorized=token&&equal(req.headers.authorization||'','Bearer '+token);
  if(origin&&!same&&!token){json(res,403,{error:'跨站请求需要配置后端访问令牌。'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(token&&!authorized){json(res,401,{error:'后端访问令牌不正确，请检查设置。'});return;}
  if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{ready:!!process.env.AI_API_KEY,mode:process.env.AI_API_KEY?'ai':'local'});return;}
  if(req.method!=='POST'||url.pathname!=='/api/analyze'){json(res,404,{error:'接口不存在。'});return;}
  if(!req.headers['content-type']?.startsWith('application/json')){json(res,415,{error:'请求需要使用 JSON。'});return;}
  const address=req.socket.remoteAddress,now=Date.now();if(limits.size>1000)limits.clear();const bucket=limits.get(address);if(bucket&&now-bucket.start<60000&&bucket.count>=12){json(res,429,{error:'分析请求过于频繁，请稍等一分钟。'});return;}limits.set(address,bucket&&now-bucket.start<60000?{...bucket,count:bucket.count+1}:{start:now,count:1});
  let data='',size=0;try{for await(const chunk of req){size+=chunk.length;if(size>400000){json(res,413,{error:'聊天内容太大，请分段导入。'});return;}data+=chunk;}}catch{if(!res.headersSent)json(res,400,{error:'无法读取请求。'});return;}
  let input;try{input=JSON.parse(data);}catch{json(res,400,{error:'请求 JSON 格式不正确。'});return;}
  try{if(!input||typeof input!=='object')throw new Error('请求内容不正确。');json(res,200,await analyzeInput(input));}catch(err){json(res,err.status||400,{error:err.message});}return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let filename;try{filename=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
 if(!filename.startsWith(root)){res.writeHead(404);res.end();return;}
 try{const data=await readFile(filename);res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,host,()=>console.log(`Xianwai: http://${host}:${server.address().port} (model ${process.env.AI_API_KEY?'configured':'not configured — local trial'})`));
