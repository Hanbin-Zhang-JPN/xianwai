import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('paired runtime protects OCR and workspace and restores a saved conversation',async(t)=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-runtime-test-'));
 const token='test-only-pairing-token-not-a-real-token-00000';
 const child=spawn(process.execPath,['desktop/runtime-server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,XIANWAI_TOKEN:token,XIANWAI_PORT:'0',XIANWAI_DATA_DIR:folder,CODEX_BIN:'/not-installed-in-test',XIANWAI_OCR:''},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await rm(folder,{recursive:true,force:true});});
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('runtime timeout')),5000);child.stdout.on('data',c=>{try{const v=JSON.parse(String(c));if(v.event==='ready'){clearTimeout(timer);resolve(v);}}catch{}});child.on('error',reject);});
 const url='http://127.0.0.1:'+ready.port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 assert.equal((await fetch(url+'/api/health')).status,401);
 assert.equal((await fetch(url+'/api/ocr',{method:'POST',body:'{}'})).status,401);
 let r=await fetch(url+'/api/health',{headers});assert.equal((await r.json()).provider,'codex');
 const preflight=await fetch(url+'/api/health',{method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Headers':'authorization'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'null');
 r=await fetch(url+'/api/health',{headers:{...headers,Origin:'null'}});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'null');
 const workspace={schemaVersion:6,active:'fake-chat',chats:[{id:'fake-chat',title:'测试',name:'对方',note:'虚构测试',style:'不叫宝贝，句子短一点',preferredTone:'brief',messages:[{role:'partner',text:'你好'}]}],favorites:[]};
 r=await fetch(url+'/api/workspace',{method:'POST',headers,body:JSON.stringify({...workspace,baseRevision:0})});assert.equal(r.status,200);
 r=await fetch(url+'/api/workspace',{headers});const restored=(await r.json()).workspace;assert.deepEqual(restored.chats[0].messages.map(({role,text})=>({role,text})),workspace.chats[0].messages);assert.equal(restored.active,'fake-chat');assert.equal(restored.chats[0].style,workspace.chats[0].style);assert.equal(restored.chats[0].preferredTone,'brief');
 assert.equal((await stat(path.join(folder,'workspace.json'))).mode&0o777,0o600);
 assert.ok(!(await readFile(path.join(folder,'workspace.json'),'utf8')).includes(token));
 const large={schemaVersion:6,active:'bulk-0',chats:Array.from({length:15},(_,i)=>({id:'bulk-'+i,title:'虚构容量测试',name:'对方',messages:Array.from({length:40},()=>({role:'partner',text:'测'.repeat(2000)}))})),favorites:[],baseRevision:1};
 const largeBody=JSON.stringify(large);assert.ok(Buffer.byteLength(largeBody)>3000000);
 r=await fetch(url+'/api/workspace',{method:'POST',headers,body:largeBody});assert.equal(r.status,200,'a valid full workspace must fit the HTTP backup limit');
 r=await fetch(url+'/api/workspace',{method:'DELETE',headers,body:JSON.stringify({baseRevision:2})});assert.equal(r.status,200);
 r=await fetch(url+'/api/workspace',{headers});assert.equal((await r.json()).workspace,null);
});

test('runtime atomically reserves one analysis and honors cancellation before submission',async t=>{
 const {writeFile}=await import('node:fs/promises'),http=await import('node:http');
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-jobs-test-')),fake=path.join(folder,'codex.mjs');
 await writeFile(fake,'#!'+process.execPath+'\nif(process.argv[2]==="login"){console.log("Logged in");}else{process.stdin.resume();setInterval(()=>{},1000);}',{mode:0o700});
 const token='fictional-runtime-token-0000000000000000',child=spawn(process.execPath,['desktop/runtime-server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,XIANWAI_TOKEN:token,XIANWAI_PORT:'0',XIANWAI_DATA_DIR:folder,CODEX_BIN:fake},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill();await new Promise(r=>child.once('close',r));await rm(folder,{recursive:true,force:true});});
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('runtime timeout')),5000);child.stdout.on('data',c=>{try{const v=JSON.parse(String(c));if(v.event==='ready'){clearTimeout(timer);resolve(v);}}catch{}});child.on('error',reject);});
 const url='http://127.0.0.1:'+ready.port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'},input={messages:[{role:'partner',text:'虚构测试'}],targetIndex:0,tone:'warm',note:''};
 // Hold both request bodies open so both handlers reach the body await together.
 const streams=['first','second'].map(requestId=>{let finish;const response=new Promise((resolve,reject)=>{const req=http.request(url+'/api/analyze',{method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);const body=JSON.stringify({...input,requestId});req.write(body.slice(0,-1));finish=()=>req.end(body.slice(-1));});return {finish,response};});
 await new Promise(r=>setTimeout(r,20));streams.forEach(s=>s.finish());const statuses=await Promise.all(streams.map(s=>s.response));assert.deepEqual([...statuses].sort(),[202,429]);
 const winner=statuses[0]===202?'first':'second';assert.equal((await fetch(url+'/api/jobs/'+winner,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(url+'/api/jobs/not-yet-submitted',{method:'DELETE',headers})).status,200);
 const cancelled=await fetch(url+'/api/analyze',{method:'POST',headers,body:JSON.stringify({...input,requestId:'not-yet-submitted'})});assert.equal(cancelled.status,409);
 const malformed=await fetch(url+'/api/analyze',{method:'POST',headers,body:'null'});assert.equal(malformed.status,400);assert.match((await malformed.json()).error,/格式/);
});
