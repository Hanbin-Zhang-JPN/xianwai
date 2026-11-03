import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {localAnalysis,parseTranscript} from '../dist/core.js';
import {normalizeContactMemory,addContactMessage,contextWindow,saveAnalysisRecord,recordContext,replaceContactMessages,updateRecordDraft,undoSentMessage,setContactComposer,setContactTone,setContactProfile,moveContact,createLibraryFolder,LIBRARY_LIMITS} from '../dist/library.js';
import {readPersistencePreference,writePersistencePreference} from '../dist/preferences.js';

const fixture=()=>normalizeWorkspace({active:'person',chats:[{id:'person',name:'小满',title:'日常',messages:[{role:'partner',text:'今天有点累'}]}],favorites:[]});
const analyze=(chat,id='analysis',now=100)=>{const window=contextWindow(chat.messages,chat.messages.length-1);return saveAnalysisRecord(chat,window,localAnalysis(window.messages,window.targetIndex),{newId:()=>id,now});};
test('undo retains the exact original message after that sent message has itself been analyzed',()=>{
 const workspace=fixture(),chat=workspace.chats[0];analyze(chat,'before');
 chat.messages=addContactMessage(chat.messages,'我在听。','me',{newId:()=> 'sent',now:200}).messages;const snapshot=JSON.stringify(chat.messages);const record=analyze(chat,'after',300);
 assert.equal(undoSentMessage(chat,snapshot,400),true);assert.equal(chat.messages.length,1);assert.equal(recordContext(chat,record).at(-1).id,'sent');assert.equal(normalizeWorkspace(workspace).chats[0].analyses.length,2);
});
test('an over-capacity transcript replacement fails without changing the previous valid library',()=>{
 const workspace=fixture(),chat=workspace.chats[0];chat.messages=Array.from({length:200},(_,i)=>({id:'old-'+i,role:'partner',text:'旧'.repeat(2000),createdAt:0}));analyze(chat);
 const before=JSON.stringify(chat),next=Array.from({length:220},(_,i)=>({id:'new-'+i,role:'partner',text:'新'.repeat(2000),createdAt:1000}));
 assert.throws(()=>replaceContactMessages(chat,next,2000),/容量/);assert.equal(JSON.stringify(chat),before);assert.doesNotThrow(()=>normalizeWorkspace(workspace));
});
test('unrelated folder changes cannot replace a newer message composer with an old empty input',()=>{
 const remote=fixture(),local=fixture();remote.folders=local.folders=[{id:'folder',name:'家人',updatedAt:1,deleted:false}];setContactComposer(remote.chats[0],{text:'另一台设备新编辑的内容',role:'partner'},200);moveContact(local.chats[0],'folder',300);
 const merged=mergeWorkspaces(remote,local).workspace.chats[0];assert.equal(merged.composer.text,'另一台设备新编辑的内容');assert.equal(merged.folderId,'folder');assert.equal(merged.composerUpdatedAt,200);
});
test('contact renaming merges into the same identity while retaining the newer remote composer',()=>{
 const remote=fixture(),local=fixture();setContactComposer(remote.chats[0],{text:'继续聊的新草稿',role:'me'},200);setContactProfile(local.chats[0],{name:'小满同学',title:'日常',note:'新的前情',style:''},300);
 const merged=mergeWorkspaces(remote,local);assert.equal(merged.conflictCopies,0);assert.equal(merged.workspace.chats.length,1);assert.equal(merged.workspace.chats[0].name,'小满同学');assert.equal(merged.workspace.chats[0].composer.text,'继续聊的新草稿');
});
test('unrelated activity does not override a newer default tone',()=>{
 const remote=fixture(),local=fixture();setContactTone(remote.chats[0],'brief',200);analyze(local.chats[0],'local-analysis',300);
 const merged=mergeWorkspaces(remote,local).workspace.chats[0];assert.equal(merged.preferredTone,'brief');assert.equal(merged.analyses.length,1);
});
test('writing identical draft values does not make an old analysis edit look newer',()=>{
 const chat=fixture().chats[0],record=analyze(chat);updateRecordDraft(chat,record.id,'warm',{},1000);assert.equal(chat.analyses[0].updatedAt,100);setContactComposer(chat,{text:'新输入',role:'partner'},2000);assert.equal(chat.analyses[0].updatedAt,100);
});
test('conflicting archived message identifiers stop merge rather than changing historical evidence',()=>{
 const make=text=>{const workspace=fixture(),chat=workspace.chats[0];chat.messages=[{id:'source',role:'partner',text,createdAt:1}];analyze(chat,'record-'+text,100);replaceContactMessages(chat,[{id:'current',role:'partner',text:'相同的当前消息',createdAt:200}],200);return normalizeWorkspace(workspace);};
 const remote=make('原文甲'),local=make('原文乙'),before=JSON.stringify([remote,local]);assert.throws(()=>mergeWorkspaces(remote,local),/原文编号/);assert.equal(JSON.stringify([remote,local]),before);
});
test('the same analysis identifier cannot silently acquire different immutable results',()=>{
 const remote=fixture();analyze(remote.chats[0]);const local=structuredClone(remote);local.chats[0].analyses[0].result.title='不同的结果';local.chats[0].analyses[0].updatedAt=1000;
 assert.throws(()=>mergeWorkspaces(remote,local),/分析编号/);
});
test('history equality ignores JSON object key ordering',()=>{
 const remote=fixture();analyze(remote.chats[0]);const local=structuredClone(remote),record=local.chats[0].analyses[0];record.result=Object.fromEntries(Object.entries(record.result).reverse());record.updatedAt=200;
 assert.equal(mergeWorkspaces(remote,local).workspace.chats[0].analyses.length,1);
});
test('analysis identifier collisions fail before mutating the saved record list',()=>{
 const chat=fixture().chats[0];analyze(chat,'fixed-id');chat.messages=addContactMessage(chat.messages,'新的消息','partner',{newId:()=> 'new',now:200}).messages;const before=JSON.stringify(chat);
 assert.throws(()=>analyze(chat,'fixed-id',300),/编号重复/);assert.equal(JSON.stringify(chat),before);
});
test('folder history capacity failure does not leave an invalid extra folder in memory',()=>{
 const folders=Array.from({length:LIBRARY_LIMITS.folderEntries},(_,i)=>({id:'f-'+i,name:'旧分类'+i,updatedAt:i,deleted:true})),before=JSON.stringify(folders);
 assert.throws(()=>createLibraryFolder(folders,'新分类',{newId:()=> 'new',now:1000}),/文件夹/);assert.equal(JSON.stringify(folders),before);
});
test('temporary mode stays disabled after a fresh preference read and corrupted preferences fail closed',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}});
 try{assert.equal(readPersistencePreference(),true);assert.equal(writePersistencePreference(false),true);assert.equal(readPersistencePreference(),false);writePersistencePreference(true);assert.equal(readPersistencePreference(),true);values.set('xianwai-preferences-v1','{broken');assert.equal(readPersistencePreference(),false);}
 finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
test('deleted favorites do not reappear from a stale device and a newly saved favorite remains allowed',()=>{
 const remote=fixture();remote.favorites=[{id:'favorite',text:'我在听。'}];const local=structuredClone(remote);local.favorites=[];local.deletedFavoriteIds=['favorite'];
 const merged=mergeWorkspaces(remote,local).workspace;assert.equal(merged.favorites.length,0);assert.deepEqual(merged.deletedFavoriteIds,['favorite']);
 local.favorites=[{id:'saved-again',text:'我在听。'}];assert.equal(mergeWorkspaces(remote,local).workspace.favorites[0].id,'saved-again');
});
test('library exports cannot be accidentally interpreted as chat messages',()=>{
 assert.throws(()=>parseTranscript(JSON.stringify({format:'xianwai-library',workspace:fixture()})),/资料库导出/);
 assert.throws(()=>parseTranscript(JSON.stringify({format:'xianwai-contact',contact:fixture().chats[0]})),/导出文件/);
 assert.deepEqual(parseTranscript(JSON.stringify({messages:[{role:'partner',text:'你好'}]})),[{role:'partner',text:'你好'}]);
});
test('a newer unsupported workspace schema is preserved by refusing to downgrade it',()=>{assert.throws(()=>normalizeWorkspace({...fixture(),schemaVersion:5}),/版本较新/);});

test('replacing a current message cannot change saved evidence under the same message identifier',()=>{
 const workspace=fixture(),chat=workspace.chats[0];analyze(chat);const before=JSON.stringify(chat);
 assert.throws(()=>replaceContactMessages(chat,[{...chat.messages[0],text:'另一段内容'}]),/编号/);assert.equal(JSON.stringify(chat),before);
});
