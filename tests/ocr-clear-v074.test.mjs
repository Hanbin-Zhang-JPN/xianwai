import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
test('a screenshot upload completed after clearing cannot start OCR, while a new upload can',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xianwai-ocr-clear-')),marker=path.join(directory,'ocr-started'),ocr=path.join(directory,'ocr.mjs');
 await writeFile(ocr,`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'started');console.log(JSON.stringify([{role:'partner',text:'虚构识别结果'}]));`,{mode:0o700});
 const token='fictional-ocr-token-00000000000000000',child=spawn(process.execPath,['desktop/runtime-server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,XIANWAI_TOKEN:token,XIANWAI_PORT:'0',XIANWAI_DATA_DIR:path.join(directory,'data'),CODEX_BIN:'/not-installed-in-test',XIANWAI_OCR:ocr},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('close',resolve));}await rm(directory,{recursive:true,force:true});});
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('runtime timeout')),5000);child.stdout.on('data',chunk=>{try{const v=JSON.parse(String(chunk));if(v.event==='ready'){clearTimeout(timer);resolve(v);}}catch{}});child.on('error',reject);});
 const base='http://127.0.0.1:'+ready.port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'},text=JSON.stringify({dataUrl:'data:image/png;base64,AAAA'});let finish;
 const delayed=new Promise((resolve,reject)=>{const request=http.request(base+'/api/ocr',{method:'POST',headers},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(raw)}));});request.on('error',reject);request.write(text.slice(0,-1));finish=()=>request.end(text.slice(-1));});
 await new Promise(r=>setTimeout(r,40));assert.equal((await fetch(base+'/api/workspace',{method:'DELETE',headers,body:JSON.stringify({baseRevision:0})})).status,200);finish();const late=await delayed;assert.equal(late.status,503);assert.match(late.body.error,/变更|清除/);await assert.rejects(access(marker),{code:'ENOENT'});
 const fresh=await fetch(base+'/api/ocr',{method:'POST',headers,body:text});assert.equal(fresh.status,200);assert.equal((await fresh.json()).rows[0].text,'虚构识别结果');await access(marker);
});
