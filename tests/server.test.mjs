import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('HTTP: static assets, no-key failure, invalid JSON and cross-origin protection',async(t)=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',AI_API_KEY:'',API_TOKEN:''},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('server timeout')),5000);child.stdout.on('data',chunk=>{const match=String(chunk).match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});child.on('error',reject);child.on('exit',code=>{if(code)reject(new Error('server failed'));});});
 const url='http://127.0.0.1:'+port;
 let r=await fetch(url);assert.equal(r.status,200);assert.match(await r.text(),/弦外/);
 r=await fetch(url+'/api/health');assert.deepEqual(await r.json(),{ready:false,mode:'local'});
 r=await fetch(url+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'partner',text:'你好'}],targetIndex:0,tone:'warm',note:''})});assert.equal(r.status,503);assert.match((await r.json()).error,/尚未配置/);
 r=await fetch(url+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});assert.equal(r.status,400);
 r=await fetch(url+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(r.status,403);
 r=await fetch(url+'/../.env');assert.equal(r.status,404);
});
