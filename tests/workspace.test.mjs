import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {WorkspaceStore} from '../lib/workspace-store.mjs';
import {createWorkspaceSync} from '../dist/workspace-sync.js';

const workspace=text=>({schemaVersion:5,active:'one',chats:[{id:'one',title:'测试',name:'对方',note:'',messages:[{role:'partner',text}]}],favorites:[]});
const tick=()=>new Promise(r=>setTimeout(r,15));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
test('re-pairing preserves both differing conversations and rejects destructive truncation',()=>{
 const remote=workspace('Mac 上的新消息'),local=workspace('手机上的旧消息');
 const merged=mergeWorkspaces(remote,local,{newId:()=> 'copy'});
 assert.equal(merged.conflictCopies,1);assert.equal(merged.workspace.chats.length,2);
 assert.equal(merged.workspace.chats[0].messages[0].text,'Mac 上的新消息');
 assert.equal(merged.workspace.chats[1].messages[0].text,'手机上的旧消息');assert.equal(merged.workspace.active,'copy');
 assert.equal(mergeWorkspaces(remote,remote).conflictCopies,0);
 const full=workspace('原文');full.chats=Array.from({length:15},(_,i)=>({...full.chats[0],id:String(i)}));
 assert.throws(()=>mergeWorkspaces(full,local),/容量/);
 assert.throws(()=>normalizeWorkspace({...local,chats:[...local.chats,...local.chats]}),/重复/);
});
test('workspace revisions prevent stale saves and resurrection after clear; legacy backup migrates',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-store-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const original=workspace('原始测试');await writeFile(path.join(folder,'workspace.json'),JSON.stringify(original));
 const store=new WorkspaceStore(folder);assert.equal((await store.read()).revision,0);
 const results=await Promise.allSettled([store.save(workspace('版本一'),0),store.save(workspace('版本二'),0)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results[1].reason.status,409);
 assert.equal((await store.read()).workspace.chats[0].messages[0].text,'版本一');
 await store.clear(1);assert.equal((await store.read()).workspace,null);
 await assert.rejects(store.save(original,1),{status:409});assert.equal((await store.read()).workspace,null);
 assert.ok(!(await readFile(store.file,'utf8')).includes('版本一'));
});
test('invalid backup is preserved byte for byte instead of overwritten',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-corrupt-'));t.after(()=>rm(folder,{recursive:true,force:true}));const store=new WorkspaceStore(folder);
 for(const raw of ['{broken','{"chats":null,"favorites":[]}']){
  await writeFile(store.file,raw);await assert.rejects(store.save(workspace('测试'),0),{status:409});assert.equal(await readFile(store.file,'utf8'),raw);
 }
});
test('disconnect cancels delayed backup and each save captures its own destination and snapshot',async()=>{
 const calls=[];const sync=createWorkspaceSync({delay:5,fetcher:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body),auth:opts.headers.Authorization});return json({revision:1});}});
 sync.connect({endpoint:'https://old.invalid',token:'old',revision:0});sync.schedule(workspace('旧'));sync.disconnect();await tick();assert.equal(calls.length,0);
 sync.connect({endpoint:'https://new.invalid',token:'new',revision:0});const source=workspace('快照');sync.schedule(source);source.chats[0].messages[0].text='之后的修改';await sync.flush();
 assert.equal(calls[0].url,'https://new.invalid/api/workspace');assert.equal(calls[0].auth,'Bearer new');assert.equal(calls[0].body.chats[0].messages[0].text,'快照');sync.disconnect();
});
test('clear waits for in-flight save then uses its revision; conflicts stop further autosaves',async()=>{
 let release;const calls=[];const sync=createWorkspaceSync({fetcher:async(url,opts)=>{calls.push({method:opts.method,body:JSON.parse(opts.body)});if(opts.method==='POST')return new Promise(r=>{release=()=>r(json({revision:5}));});return json({revision:6});}});
 sync.connect({endpoint:'https://test.invalid',token:'fake',revision:4});sync.schedule(workspace('待保存'));const saving=sync.flush();await tick();const clearing=sync.clear();await tick();assert.equal(calls.length,1);release();await Promise.all([saving,clearing]);
 assert.deepEqual(calls.map(c=>[c.method,c.body.baseRevision]),[['POST',4],['DELETE',5]]);sync.disconnect();
 let errors=0,count=0;const conflict=createWorkspaceSync({fetcher:async()=>{count++;return json({error:'已更新'},409);},onError:()=>errors++});conflict.connect({endpoint:'',token:'fake',revision:0});conflict.schedule(workspace('旧'));await conflict.flush();conflict.schedule(workspace('再旧'));await conflict.flush();assert.equal(errors,1);assert.equal(count,1);await assert.rejects(conflict.clear(),/冲突/);conflict.disconnect();
});

test('request deadlines and caller cancellation work without AbortSignal.any',async()=>{
 const {withRequestTimeout}=await import('../dist/workspace-sync.js');
 const waitForAbort=signal=>new Promise((resolve,reject)=>{const fail=()=>reject(new DOMException('cancel','AbortError'));if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true});});
 await assert.rejects(withRequestTimeout(waitForAbort,undefined,5),{name:'AbortError'});
 const controller=new AbortController(),pending=withRequestTimeout(waitForAbort,controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});
});

test('ordinary appended messages and tone preferences do not create a conflict copy',()=>{
 const local=workspace('第一句'),remote=structuredClone(local);remote.chats[0].messages.push({role:'me',text:'更新的消息'});local.chats[0].preferredTone='brief';
 const merged=mergeWorkspaces(remote,local);assert.equal(merged.conflictCopies,0);assert.equal(merged.workspace.chats.length,1);assert.equal(merged.workspace.chats[0].messages.length,2);assert.equal(merged.workspace.chats[0].preferredTone,'brief');
 assert.equal(mergeWorkspaces(local,remote).workspace.chats[0].messages.length,2);
});
test('re-pairing reuses an existing identical conflict copy instead of multiplying copies',()=>{
 const remote=workspace('Mac 版'),local=workspace('本机不同版');
 const first=mergeWorkspaces(remote,local,{newId:()=> 'copy'});
 const second=mergeWorkspaces(first.workspace,local,{newId:()=>{throw new Error('unnecessary copy');}});
 assert.equal(second.workspace.chats.length,2);assert.equal(second.workspace.active,'copy');assert.equal(second.conflictCopies,0);
});
