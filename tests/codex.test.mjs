import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {analyzeWithCodex} from '../lib/codex.mjs';
const input={messages:[{role:'partner',text:'今天有点累'}],targetIndex:0,tone:'warm',note:''};
const model={recommendation:{action:'reply',tone:'brief',reason:'先回应具体原话，再根据实际情况补充。',check:''},title:'先倾听',feeling:'可能疲惫',need:'倾听',question:'愿意说说吗？',avoid:'不要催促',hypotheses:[{text:'可能想倾诉',evidence:[1]},{text:'也可能想休息',evidence:[1]}],replies:Array.from({length:3},()=>({label:'自然接话',text:'我在听，你慢慢说。',reason:'先倾听'}))};
async function fake(t,source){const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-codex-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));const executable=path.join(folder,'fake-codex.mjs');await writeFile(executable,'#!'+process.execPath+'\n'+source,{mode:0o700});const previous=process.env.CODEX_BIN;process.env.CODEX_BIN=executable;t.after(()=>{if(previous===undefined)delete process.env.CODEX_BIN;else process.env.CODEX_BIN=previous;});return folder;}
test('Codex output handles split Chinese bytes and a final event without newline',async t=>{
 const text=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(model)}})+'\n'+JSON.stringify({type:'turn.completed'});
 await fake(t,`const data=Buffer.from(${JSON.stringify(text)});const split=data.indexOf(Buffer.from('先'))+1;process.stdout.write(data.subarray(0,split));setTimeout(()=>process.stdout.write(data.subarray(split)),10);process.stdin.resume();`);
 const result=await analyzeWithCodex(input);assert.equal(result.title,'先倾听');assert.equal(result.replies[0].text,'我在听，你慢慢说。');
});
test('cancellation waits until an uncooperative worker is killed',async t=>{
 const folder=await fake(t,`import {writeFileSync} from 'node:fs';writeFileSync(new URL('./pid',import.meta.url),String(process.pid));process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);`);
 const controller=new AbortController(),pending=analyzeWithCodex(input,{signal:controller.signal}),checked=assert.rejects(pending,{status:499});
 let pid;for(let i=0;i<50;i++){try{pid=Number(await readFile(path.join(folder,'pid'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,10));}}
 assert.ok(pid);controller.abort();await checked;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});
