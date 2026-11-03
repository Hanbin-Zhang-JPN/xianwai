import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {localAnalysis} from '../dist/core.js';
import {WorkspaceStore} from '../lib/workspace-store.mjs';
import {addContactMessage,contextWindow,saveAnalysisRecord,recordContext,replaceContactMessages,updateRecordDraft,deleteAnalysisRecord,moveContact} from '../dist/library.js';

const library=()=>normalizeWorkspace({active:'person',chats:[{id:'person',name:'小满',title:'和小满的聊天',messages:[{role:'partner',text:'今天有点累'}]}],favorites:[]});
const analyze=(chat,now=1000,id='analysis-one')=>{const context=contextWindow(chat.messages,chat.messages.length-1);return saveAnalysisRecord(chat,context,localAnalysis(context.messages,context.targetIndex),{now,newId:()=>id});};
test('legacy workspaces migrate deterministically without changing speakers, text, or recording invented times',()=>{
 const first=library(),second=library();assert.equal(first.schemaVersion,5);assert.deepEqual(first,second);assert.equal(first.chats[0].messages[0].createdAt,0);assert.deepEqual(first.folders,[]);assert.deepEqual(first.chats[0].analyses,[]);
});
test('next-day continuation keeps previous context and analysis drafts through serialized restore',()=>{
 const original=library(),chat=original.chats[0],record=analyze(chat);
 updateRecordDraft(chat,record.id,'brief',{brief:'我在，想聊的时候告诉我。'},1500);chat.composer={text:'明天还想接着说的内容',role:'partner'};
 const restored=normalizeWorkspace(JSON.parse(JSON.stringify(original))),next=restored.chats[0];next.messages=addContactMessage(next.messages,'昨天休息后好多了','partner',{now:86401000,newId:()=> 'day-two'}).messages;
 assert.equal(next.messages.length,2);assert.equal(next.messages[0].text,'今天有点累');assert.equal(next.resumeId,record.id);assert.equal(next.analyses[0].drafts.brief,'我在，想聊的时候告诉我。');assert.equal(next.composer.text,'明天还想接着说的内容');assert.equal(recordContext(next,next.analyses[0]).length,1);
});
test('replacing a transcript keeps the exact original context of saved analyses',()=>{
 const chat=library().chats[0],record=analyze(chat);const originalId=chat.messages[0].id;
 replaceContactMessages(chat,addContactMessage([],'完全不同的新前文','partner',{newId:()=> 'replacement',now:2000}).messages);
 assert.equal(chat.archive[0].id,originalId);assert.equal(recordContext(chat,record)[0].text,'今天有点累');assert.equal(chat.messages[0].text,'完全不同的新前文');assert.equal(normalizeWorkspace({...library(),chats:[chat]}).chats[0].analyses.length,1);
});
test('long conversations continue past 300 messages while model input remains a bounded preceding window',()=>{
 const chat=library().chats[0];chat.messages=Array.from({length:350},(_,i)=>({id:'m-'+i,role:i%2?'me':'partner',text:'第 '+i+' 条消息',createdAt:1000+i}));
 chat.messages=addContactMessage(chat.messages,'第二天继续','partner',{newId:()=> 'next-day',now:86401000}).messages;
 const window=contextWindow(chat.messages,350);assert.equal(window.messages.length,300);assert.equal(window.start,51);assert.equal(window.messages.at(-1).text,'第二天继续');assert.equal(contextWindow(chat.messages,50).messages.at(-1).text,'第 50 条消息');
 const large=Array.from({length:100},(_,i)=>({id:String(i),role:'partner',text:'测'.repeat(2000)}));assert.equal(contextWindow(large,99).messages.length,40);
});
test('folders can move or be removed without losing contact analyses, including merge with a stale device',()=>{
 const remote=library();remote.folders=[{id:'partner',name:'伴侣',updatedAt:100,deleted:false}];moveContact(remote.chats[0],'partner',100);analyze(remote.chats[0]);
 const local=structuredClone(remote);local.folders[0].deleted=true;local.folders[0].updatedAt=200;moveContact(local.chats[0],null,200);
 const merged=mergeWorkspaces(remote,local).workspace;assert.equal(merged.chats.length,1);assert.equal(merged.chats[0].folderId,null);assert.equal(merged.chats[0].analyses.length,1);assert.equal(merged.folders[0].deleted,true);
});
test('analysis records from two devices merge into the same contact and newer draft edits win',()=>{
 const remote=library();analyze(remote.chats[0]);const local=structuredClone(remote);updateRecordDraft(local.chats[0],'analysis-one','honest',{honest:'我想认真听你说说。'},4000);
 local.chats[0].messages=addContactMessage(local.chats[0].messages,'新的一句','partner',{newId:()=> 'new',now:5000}).messages;analyze(local.chats[0],6000,'analysis-two');
 const merged=mergeWorkspaces(remote,local).workspace;assert.equal(merged.chats.length,1);assert.equal(merged.chats[0].analyses.length,2);assert.equal(merged.chats[0].analyses.find(record=>record.id==='analysis-one').drafts.honest,'我想认真听你说说。');assert.equal(merged.chats[0].messages.length,2);
});
test('deleted analyses do not return when a stale device reconnects',()=>{
 const remote=library();analyze(remote.chats[0]);const local=structuredClone(remote);deleteAnalysisRecord(local.chats[0],'analysis-one',2000);
 const merged=mergeWorkspaces(remote,local).workspace;assert.equal(merged.chats[0].analyses.length,0);assert.ok(merged.chats[0].deletedAnalysisIds.includes('analysis-one'));assert.equal(merged.chats[0].messages.length,1);
});
test('Mac backups roundtrip folders, analysis context, chosen tone and editable progress; old clients cannot strip them',async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-library-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const workspace=library();workspace.folders=[{id:'family',name:'家人',updatedAt:1000,deleted:false}];moveContact(workspace.chats[0],'family',1000);analyze(workspace.chats[0]);updateRecordDraft(workspace.chats[0],'analysis-one','brief',{brief:'我在。'},2000);
 const store=new WorkspaceStore(folder);await store.save(workspace,0);const backup=await store.read();assert.deepEqual(backup.workspace,normalizeWorkspace(workspace));
 const before=await readFile(store.file,'utf8');await assert.rejects(store.save({active:'person',chats:[{id:'person',title:'旧页面',name:'对方',messages:[]}],favorites:[]},1),/升级/);assert.equal(await readFile(store.file,'utf8'),before);
});
test('damaged analysis references stop backup overwrite instead of dropping saved records',()=>{
 const workspace=library();analyze(workspace.chats[0]);workspace.chats[0].analyses[0].contextIds=['missing'];workspace.chats[0].analyses[0].targetId='missing';assert.throws(()=>normalizeWorkspace(workspace),/原文缺失/);
});
test('reopening the same cached analysis does not create duplicate history records',()=>{
 const chat=library().chats[0];const first=analyze(chat);const reopened=analyze(chat,86401000,'duplicate');assert.equal(chat.analyses.length,1);assert.equal(reopened.id,first.id);assert.equal(reopened.createdAt,1000);
});

test('the same greeting on the next day is a new message while an immediate double paste is deduplicated',()=>{
 const now=Date.parse('2026-01-01T12:00:00Z'),first=addContactMessage([],'早安','partner',{now,newId:()=> 'first'});
 assert.equal(addContactMessage(first.messages,'早安','partner',{now:now+1000}).reused,true);
 const next=addContactMessage(first.messages,'早安','partner',{now:now+86400000,newId:()=> 'tomorrow'});assert.equal(next.messages.length,2);assert.equal(next.reused,false);
});
