import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {addContactMessage,undoSentMessage,replaceContactMessages,contextWindow,saveAnalysisRecord,recordContext,LIBRARY_LIMITS} from '../dist/library.js';
import {localAnalysis,parseTranscript} from '../dist/core.js';
import {pasteClipboard} from '../dist/clipboard.js';
import {WorkspaceStore} from '../lib/workspace-store.mjs';
import {connectionError} from '../dist/pairing.js';

const fixture=()=>normalizeWorkspace({active:'person',chats:[{id:'person',name:'小满',title:'虚构回归',messages:[{id:'first',role:'partner',text:'今天有点累',createdAt:100}]}],favorites:[]});
test('offline undo cannot be resurrected by either direction of stale backup merge and history retains evidence',()=>{
 const phone=fixture(),chat=phone.chats[0];chat.messages=addContactMessage(chat.messages,'我在听','me',{now:200,newId:()=> 'sent'}).messages;
 const window=contextWindow(chat.messages,1),record=saveAnalysisRecord(chat,window,localAnalysis(window.messages,1),{newId:()=> 'analysis',now:250}),mac=structuredClone(phone);
 assert.equal(undoSentMessage(chat,JSON.stringify(chat.messages),300),true);
 for(const [a,b] of [[mac,phone],[phone,mac]]){
  const merged=mergeWorkspaces(a,b);assert.equal(merged.conflictCopies,0);assert.deepEqual(merged.workspace.chats[0].messages.map(message=>message.id),['first']);assert.equal(recordContext(merged.workspace.chats[0],record).at(-1).text,'我在听');
  assert.deepEqual(mergeWorkspaces(mac,merged.workspace).workspace,merged.workspace);
 }
});
test('replacing with a shorter transcript stays replaced after reconnect instead of restoring removed old messages',()=>{
 const phone=fixture(),chat=phone.chats[0];chat.messages.push({id:'second',role:'me',text:'晚点聊',createdAt:200});const mac=structuredClone(phone);
 replaceContactMessages(chat,[{id:'replacement',role:'partner',text:'今天有点累',createdAt:300}],400);
 const merged=mergeWorkspaces(mac,phone);assert.equal(merged.conflictCopies,0);assert.deepEqual(merged.workspace.chats[0].messages.map(message=>message.id),['replacement']);
 assert.deepEqual(new Set(merged.workspace.chats[0].removedMessageIds),new Set(['first','second']));
});
test('removing one message still retains a newer message appended on another device',()=>{
 const phone=fixture(),chat=phone.chats[0];chat.messages.push({id:'sent',role:'me',text:'误记的回复',createdAt:200});const mac=structuredClone(phone);
 undoSentMessage(chat,JSON.stringify(chat.messages),300);mac.chats[0].messages.push({id:'new',role:'partner',text:'新的消息',createdAt:400});
 assert.deepEqual(mergeWorkspaces(mac,phone).workspace.chats[0].messages.map(message=>message.id),['first','new']);
});
test('removal marker capacity failures are atomic and repeated merge deduplicates full marker sets',()=>{
 const phone=fixture(),chat=phone.chats[0];chat.removedMessageIds=Array.from({length:LIBRARY_LIMITS.removedMessages},(_,i)=>'removed-'+i);const before=JSON.stringify(chat);
 assert.throws(()=>replaceContactMessages(chat,[],200),/整理记录已满/);assert.equal(JSON.stringify(chat),before);
 const merged=mergeWorkspaces(phone,structuredClone(phone)).workspace;assert.equal(merged.chats[0].removedMessageIds.length,LIBRARY_LIMITS.removedMessages);
 const newer=structuredClone(phone);newer.chats[0].composer={text:'新的输入',role:'partner'};newer.chats[0].composerUpdatedAt=300;
 assert.equal(mergeWorkspaces(phone,newer).workspace.chats[0].composer.text,'新的输入');
});
test('a later same-day repetition is a new message while an immediate duplicate remains deduplicated',()=>{
 const now=new Date(2026,10,4,10).getTime(),first=addContactMessage([],'好','partner',{now,newId:()=> 'initial'});
 assert.equal(addContactMessage(first.messages,'好','partner',{now:now+1000}).reused,true);
 assert.equal(addContactMessage(first.messages,'好','partner',{now:now+3600000,newId:()=> 'later'}).messages.length,2);
 assert.equal(addContactMessage(first.messages,'好','partner',{now:now-1000,newId:()=> 'clock-change'}).reused,false);
});
test('clipboard denial and empty content preserve an existing unsent draft',async()=>{
 let draft='原有输入',focused=0,empty=0;const options={isCurrent:()=>true,accept:text=>{draft=text;},unavailable:()=>focused++,empty:()=>empty++};
 assert.equal(await pasteClipboard({...options,read:async()=>{throw new Error('denied');}}),false);assert.equal(draft,'原有输入');assert.equal(focused,1);
 assert.equal(await pasteClipboard({...options,read:async()=> '   '}),false);assert.equal(draft,'原有输入');assert.equal(empty,1);
});
test('a delayed clipboard result cannot overwrite a changed contact or newer input',async()=>{
 let resolve,current=true,draft='已有草稿',fallback=0;
 const pending=pasteClipboard({read:()=>new Promise(r=>{resolve=r;}),isCurrent:()=>current,accept:text=>{draft=text;},unavailable:()=>fallback++,empty:()=>fallback++});
 current=false;draft='切换后新写的内容';resolve('旧剪贴板');assert.equal(await pending,false);assert.equal(draft,'切换后新写的内容');assert.equal(fallback,0);
});
test('a valid clipboard result is applied exactly once and keeps its text unchanged',async()=>{
 const seen=[];assert.equal(await pasteClipboard({read:async()=> '对方：今天怎么样？\n我：还好。',isCurrent:()=>true,accept:text=>seen.push(text),unavailable:()=>assert.fail(),empty:()=>assert.fail()}),true);assert.deepEqual(seen,['对方：今天怎么样？\n我：还好。']);
});
test('malformed or unsupported JSON objects do not silently become partner messages',()=>{
 for(const input of ['{"messages":','{}','{"contact":{"name":"虚构"}}'])assert.throws(()=>parseTranscript(input),/JSON/);
 assert.equal(parseTranscript('对方：{"some":"message"}')[0].text,'{"some":"message"}');
});
test('an unwrapped upgraded backup refuses an old writer without changing its source bytes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xianwai-042-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new WorkspaceStore(directory),workspace=fixture(),raw=JSON.stringify(workspace);await writeFile(store.file,raw);
 await assert.rejects(store.save({...workspace,schemaVersion:3},0),{status:409});assert.equal(await readFile(store.file,'utf8'),raw);
 await store.save(workspace,0);assert.equal((await store.read()).workspace.schemaVersion,6);
});
test('a conflict copy with a long truncated title is reused on the next reconnect',()=>{
 const mac=fixture(),phone=fixture();phone.chats[0].title=mac.chats[0].title='长'.repeat(30);phone.chats[0].messages[0].text='本机另一段对话';
 const first=mergeWorkspaces(mac,phone,{newId:()=> 'copy'});assert.equal(first.workspace.chats[1].title.length,30);
 const second=mergeWorkspaces(first.workspace,phone,{newId:()=>assert.fail('duplicate conflict copy')});assert.equal(second.workspace.chats.length,2);assert.equal(second.conflictCopies,0);
});
test('replacing one favorite in a full collection merges after applying deletion markers',()=>{
 const mac=fixture();mac.favorites=Array.from({length:300},(_,i)=>({id:'fav-'+i,text:'收藏 '+i,label:'温柔',name:'小满',source:'虚构'}));const phone=structuredClone(mac);
 phone.favorites.shift();phone.deletedFavoriteIds=['fav-0'];phone.favorites.push({id:'new',text:'新的收藏'});
 const merged=mergeWorkspaces(mac,phone).workspace;assert.equal(merged.favorites.length,300);assert.ok(merged.favorites.some(item=>item.id==='new'));assert.ok(!merged.favorites.some(item=>item.id==='fav-0'));
});
test('network errors explain how to reconnect without exposing a raw browser fetch error',()=>{
 assert.match(connectionError(new TypeError('Failed to fetch')),/Mac.*联网/);assert.doesNotMatch(connectionError(new TypeError('Load failed')),/Load failed/);
 assert.match(connectionError(new DOMException('aborted','AbortError')),/超时/);assert.match(connectionError({status:401}),/过期/);
 assert.equal(connectionError(new Error('Mac 备份已有新版本')),'Mac 备份已有新版本');
});
