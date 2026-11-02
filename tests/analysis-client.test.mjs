import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisClient} from '../dist/analysis-client.js';
const result={mode:'ai',replies:[{tone:'warm'},{tone:'honest'},{tone:'brief'}],facts:[],hypotheses:[]};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const input={messages:[{role:'partner',text:'虚构测试'}],targetIndex:0,tone:'warm',note:''};
const options=token=>({endpoint:'https://test.invalid',token,input});
const tick=()=>new Promise(r=>setTimeout(r,10));
test('cancel before analyze acknowledgement deletes the client-generated remote task',async()=>{
 const calls=[];let submitted;
 const client=createAnalysisClient({fetcher:(url,opts)=>{calls.push({url,opts});if(opts.method==='DELETE')return Promise.resolve(json({status:'cancelled'}));submitted=JSON.parse(opts.body).requestId;return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true}));}});
 const pending=client.request(options('one'));const checked=assert.rejects(pending,{name:'AbortError'});await tick();await client.cancel();await checked;
 assert.equal(calls.filter(c=>c.opts.method==='DELETE').length,1);assert.ok(calls.at(-1).url.endsWith('/'+submitted));
});
test('rapid repeated requests submit only the newest one and caches are separated by credentials',async()=>{
 let posts=0;const client=createAnalysisClient({fetcher:async()=>{posts++;return json(result);}});
 const first=client.request(options('one'));const firstCheck=assert.rejects(first,{name:'AbortError'});const second=client.request(options('one'));await firstCheck;assert.deepEqual(await second,result);assert.equal(posts,1);
 await client.request(options('one'));assert.equal(posts,1);await client.request(options('two'));assert.equal(posts,2);client.clearCache();await client.request(options('two'));assert.equal(posts,3);
});
test('poll failures cancel the remote worker instead of leaving Mac busy',async()=>{
 const calls=[];const client=createAnalysisClient({pollInterval:1,fetcher:async(url,opts)=>{calls.push(opts.method||'GET');if(opts.method==='POST')return json({jobId:JSON.parse(opts.body).requestId},202);if(opts.method==='DELETE')return json({status:'cancelled'});return json({error:'测试掉线'},503);}});
 await assert.rejects(client.request(options('fake')),/测试掉线/);assert.deepEqual(calls,['POST','GET','DELETE']);
});

test('a new request waits for an explicitly cancelled worker to release the Mac slot',async()=>{
 let release,posts=0;const client=createAnalysisClient({fetcher:(url,opts)=>{
  if(opts.method==='DELETE')return new Promise(r=>{release=()=>r(json({status:'cancelled'}));});
  posts++;if(posts>1)return Promise.resolve(json(result));
  return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true}));
 }});
 const first=client.request(options('same'));const firstCheck=assert.rejects(first,{name:'AbortError'});await tick();const cancelled=client.cancel(),second=client.request(options('same'));await tick();assert.equal(posts,1);release();await cancelled;await firstCheck;assert.deepEqual(await second,result);assert.equal(posts,2);
});
