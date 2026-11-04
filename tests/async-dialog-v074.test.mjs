import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guardClipboardDialog,copyClipboard,pasteClipboard} from '../dist/clipboard.js';
import {createHistoryReviewClient} from '../dist/history-review-client.js';
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
test('a paste permission result cannot replace a newer open dialog',async()=>{
 let owner=null;const pending=deferred(),seen=[],current=guardClipboardDialog(()=>true,()=>owner),request=pasteClipboard({read:()=>pending.promise,isCurrent:current,accept:t=>seen.push(t),unavailable:()=>seen.push('fallback'),empty:()=>seen.push('empty')});
 owner={profileDraft:'未提交的新资料'};pending.resolve('旧剪贴板的长段聊天');assert.equal(await request,false);assert.deepEqual(seen,[]);assert.equal(owner.profileDraft,'未提交的新资料');
});
test('a paste denial cannot focus or alter inputs behind a different dialog',async()=>{
 let owner={original:true};const pending=deferred(),seen=[],current=guardClipboardDialog(()=>true,()=>owner),request=pasteClipboard({read:()=>pending.promise,isCurrent:current,accept:()=>seen.push('accept'),unavailable:()=>seen.push('focus'),empty:()=>seen.push('empty')});
 owner={settings:true};pending.reject(new Error('denied'));assert.equal(await request,false);assert.deepEqual(seen,[]);
});
test('a late copy failure cannot replace a new dialog with the old manual-copy fallback',async()=>{
 let owner=null;const pending=deferred(),seen=[],current=guardClipboardDialog(()=>true,()=>owner),request=copyClipboard('旧回复',{write:()=>pending.promise,isCurrent:current,copied:()=>seen.push('copied'),manual:t=>seen.push(t)});
 owner={newImport:'新导入内容'};pending.reject(new Error('denied'));assert.equal(await request,false);assert.deepEqual(seen,[]);assert.equal(owner.newImport,'新导入内容');
});
test('copy results after switching contact or editing the draft do not emit stale UI feedback',async()=>{
 let valid=true;const pending=deferred(),seen=[],request=copyClipboard('原草稿',{write:()=>pending.promise,isCurrent:()=>valid,copied:()=>seen.push('copied'),manual:()=>seen.push('manual')});valid=false;pending.resolve();assert.equal(await request,false);assert.deepEqual(seen,[]);
});
test('current copy success and denial keep the normal feedback and manual-copy behavior',async()=>{
 const seen=[];assert.equal(await copyClipboard('本次回复',{write:async t=>seen.push(t),isCurrent:()=>true,copied:()=>seen.push('success'),manual:()=>assert.fail()}),true);
 assert.equal(await copyClipboard('本次手动复制',{write:async()=>{throw new Error('denied');},isCurrent:()=>true,copied:()=>assert.fail(),manual:t=>seen.push(t)}),false);assert.deepEqual(seen,['本次回复','success','本次手动复制']);
});
const pair={endpoint:'https://fictional.invalid',token:'fictional'},json=value=>new Response(JSON.stringify(value));
test('a resumed failed history task reports its real error instead of disappearing silently',async()=>{
 const errors=[],states=[];const client=createHistoryReviewClient({getPair:()=>pair,fetcher:async()=>json({status:'failed',jobId:'failed',chatId:'person',error:'虚构模型核对失败'}),onUpdate:v=>states.push(v.status),onError:e=>errors.push(e.message)});await client.resume(pair);await new Promise(r=>setTimeout(r,0));assert.deepEqual(states,['failed']);assert.deepEqual(errors,['虚构模型核对失败']);client.disconnect();
});
test('polling failure states with no server message show a retry instruction without applying a report',async()=>{
 let calls=0;const errors=[],completed=[];const client=createHistoryReviewClient({getPair:()=>pair,interval:1,fetcher:async()=>json(++calls===1?{status:'running',jobId:'job',chatId:'person'}:{status:'failed'}),onError:e=>errors.push(e.message),onComplete:r=>completed.push(r)});await client.resume(pair);for(let i=0;i<40&&!errors.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(errors.length,1);assert.match(errors[0],/未完成|重试/);assert.deepEqual(completed,[]);client.disconnect();
});
