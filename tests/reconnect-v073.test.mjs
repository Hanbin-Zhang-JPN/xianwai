import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkspaces} from '../dist/workspace.js';
import {createHistoryReviewClient} from '../dist/history-review-client.js';
const fixture=(sentAt,id='m')=>({active:'one',chats:[{id:'one',name:'虚构',title:'测试',messages:[{id,role:'partner',text:'今天几点回家吃饭？',...(sentAt?{sentAt}:{})}]}],favorites:[]});
const favorite={id:'fav',text:'我先确认安排。',label:'简短',name:'虚构',source:'测试'};
test('re-pairing preserves identical words from different dates or unknown dates as conflict copies',()=>{
 for(const [a,b] of [[100,200],[0,100],[100,0]]){const remote=fixture(a,'mac'),local=fixture(b,'phone');const merged=mergeWorkspaces(remote,local,{newId:()=> 'copy'});assert.equal(merged.conflictCopies,1);assert.equal(merged.workspace.chats.length,2);assert.equal(merged.workspace.chats[1].messages[0].sentAt||0,b);}
 assert.equal(mergeWorkspaces(fixture(100),fixture(100)).workspace.chats.length,1);
});
test('an existing conversation copy is reused only when its dates also match',()=>{
 const remote=fixture(100,'mac'),first=mergeWorkspaces(remote,fixture(200,'phone'),{newId:()=> 'copy1'}),second=mergeWorkspaces(first.workspace,fixture(300,'phone2'),{newId:()=> 'copy2'});
 assert.equal(second.workspace.chats.length,3);assert.deepEqual(second.workspace.chats.map(c=>c.messages[0].sentAt),[100,200,300]);
 const repeat=mergeWorkspaces(second.workspace,fixture(300,'phone2'),{newId:()=>{throw new Error('unnecessary copy');}});assert.equal(repeat.workspace.chats.length,3);assert.equal(repeat.conflictCopies,0);
});
test('reconnecting does not multiply an identical conflicting favorite copy',()=>{
 const remote=fixture(0),local=fixture(0);remote.favorites=[favorite];local.favorites=[{...favorite,text:'我晚点确认后告诉你。'}];
 const first=mergeWorkspaces(remote,local,{newId:()=> 'copy'});assert.equal(first.workspace.favorites.length,2);
 const second=mergeWorkspaces(first.workspace,local,{newId:()=>{throw new Error('unnecessary favorite');}});assert.equal(second.workspace.favorites.length,2);assert.equal(second.conflictCopies,0);
});
test('favorite copy identifier collisions never overwrite unrelated or deleted favorites',()=>{
 for(const deleted of [false,true]){const remote=fixture(0),local=fixture(0);remote.favorites=[favorite,...(deleted?[]:[{...favorite,id:'collision',text:'不能被覆盖的收藏'}])];remote.deletedFavoriteIds=deleted?['collision']:[];local.favorites=[{...favorite,text:'冲突版本'}];const before=JSON.stringify(remote);assert.throws(()=>mergeWorkspaces(remote,local,{newId:()=> 'collision'}),/编号/);assert.equal(JSON.stringify(remote),before);}
});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const json=value=>new Response(JSON.stringify(value));
test('a late cancel result cannot disconnect or replace a newer review on the same connection',async()=>{
 const pair={endpoint:'https://fictional.invalid',token:'fictional'},deletion=deferred(),updates=[],completed=[];let lookups=0;
 const client=createHistoryReviewClient({getPair:()=>pair,interval:10000,onUpdate:v=>updates.push(v.jobId),onComplete:r=>completed.push(r.id),fetcher:(url,options)=>options.method==='DELETE'?deletion.promise:Promise.resolve(json(++lookups===1?{status:'running',jobId:'old',chatId:'old-person'}:{status:'completed',jobId:'new',chatId:'new-person',result:{id:'new-result'}}))});
 await client.resume(pair);const cancelling=client.cancel();await client.resume(pair);deletion.resolve(json({status:'cancelled'}));assert.equal(await cancelling,false);assert.deepEqual(completed,['new-result']);assert.equal(updates.at(-1),'new');client.disconnect();
});
test('an unchanged review session still applies a successful cancel',async()=>{
 const pair={endpoint:'https://fictional.invalid',token:'fictional'},updates=[];const client=createHistoryReviewClient({getPair:()=>pair,interval:10000,onUpdate:v=>updates.push(v.status),fetcher:async(url,options)=>json(options.method==='DELETE'?{status:'cancelled'}:{status:'running',jobId:'old',chatId:'person'})});
 await client.resume(pair);assert.equal(await client.cancel(),true);assert.equal(updates.at(-1),'cancelled');client.disconnect();
});
test('late cancel errors are ignored after a newer review starts, while current errors remain visible',async()=>{
 const pair={endpoint:'https://fictional.invalid',token:'fictional'},deletion=deferred(),completed=[];let lookups=0;
 const client=createHistoryReviewClient({getPair:()=>pair,interval:10000,onComplete:r=>completed.push(r.id),fetcher:(url,options)=>options.method==='DELETE'?deletion.promise:Promise.resolve(json(++lookups===1?{status:'running',jobId:'old',chatId:'person'}:{status:'completed',jobId:'new',chatId:'person',result:{id:'new-result'}}))});
 await client.resume(pair);const cancelling=client.cancel();await client.resume(pair);deletion.resolve(new Response(JSON.stringify({error:'迟到的停止失败'}),{status:503}));assert.equal(await cancelling,false);assert.deepEqual(completed,['new-result']);client.disconnect();
 const current=createHistoryReviewClient({getPair:()=>pair,interval:10000,fetcher:async(url,options)=>options.method==='DELETE'?new Response(JSON.stringify({error:'本次停止失败'}),{status:503}):json({status:'running',jobId:'current',chatId:'person'})});
 await current.resume(pair);await assert.rejects(current.cancel(),/本次停止失败/);current.disconnect();
});
