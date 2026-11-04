import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseTranscript,IMPORT_LIMITS,localAnalysis,contextFor} from '../dist/core.js';
import {buildHistoryContext,setContextPin,normalizeContextInfo,conversationPage,collectReviewPage,HISTORY_LIMITS} from '../dist/history-context.js';
import {prepareContactImport,normalizeContactMemory,replaceContactMessages,saveAnalysisRecord,recordContext,updateRecordDraft} from '../dist/library.js';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {boundaryOverlap} from '../dist/flow.js';
import {WorkspaceStore} from '../lib/workspace-store.mjs';
import {analyzeInput,SYSTEM} from '../lib/ai.mjs';
const messages=(n=1000)=>Array.from({length:n},(_,i)=>({id:'m-'+i,role:i%2?'me':'partner',text:i===10?'纪念日约好一起去海边看日落。':i===n-1?'明天纪念日，海边的约定还记得吗？':'日常闲聊第 '+i+' 条。',createdAt:0}));
const workspace=(rows=messages())=>normalizeWorkspace({active:'person',chats:[{id:'person',title:'虚构长期聊天',name:'小满',messages:rows}],favorites:[]});
test('ten thousand imported messages stay complete while model inputs still enforce their smaller bound',()=>{
 const rows=messages(10000),parsed=parseTranscript(JSON.stringify(rows),IMPORT_LIMITS);assert.equal(parsed.length,10000);let id=0;const plan=prepareContactImport([],parsed,{newId:()=> 'new-'+id++});assert.equal(plan.messages.length,10000);assert.equal(normalizeContactMemory({messages:plan.messages}).messages.length,10000);assert.throws(()=>contextFor(parsed,9999),/300/);assert.throws(()=>parseTranscript(JSON.stringify([...rows,rows[0]]),IMPORT_LIMITS),/10000/);
});
test('JSON source dates survive import, serialization and selection without inventing dates for undated messages',()=>{
 const parsed=parseTranscript(JSON.stringify([{role:'partner',text:'周年纪念',sentAt:'2020-06-10T12:00:00+08:00'},{role:'me',text:'没有明确日期的原话'}]),IMPORT_LIMITS),plan=prepareContactImport([],parsed,{now:Date.parse('2026-11-04T00:00:00Z')});const w=workspace(plan.messages),next=normalizeWorkspace(JSON.parse(JSON.stringify(w))),context=buildHistoryContext(next.chats[0].messages,1);
 assert.equal(context.info.sentAt[0],Date.parse('2020-06-10T04:00:00Z'));assert.equal(context.info.sentAt[1],0);assert.equal(next.chats[0].messages[0].createdAt,Date.parse('2026-11-04T00:00:00Z'));for(const sentAt of ['yesterday','2020-01-01','2024-02-30T12:00:00Z',-1,Number.MAX_SAFE_INTEGER])assert.throws(()=>parseTranscript(JSON.stringify([{role:'me',text:'原话',sentAt}]),IMPORT_LIMITS),/日期/);
});
test('old relevant promises return beside recent conversation in chronological order, with real source positions',()=>{
 const rows=messages(),context=buildHistoryContext(rows,999);assert.ok(context.messages.some(m=>m.id==='m-10'));assert.ok(context.messages.some(m=>m.id==='m-9'));assert.ok(context.messages.some(m=>m.id==='m-11'));assert.equal(context.messages.at(-1).id,'m-999');assert.equal(context.info.availableCount,1000);assert.ok(context.info.positions.every((p,i)=>!i||p>context.info.positions[i-1]));assert.ok(context.messages.length<=300);assert.ok(context.messages.reduce((n,m)=>n+m.text.length,0)<=80000);
});
test('manual long-term evidence works without shared keywords and future pins never enter an old target',()=>{
 const rows=messages();rows[5].text='请不要替我安排聚会。';rows[999].text='明天的事，你怎么看？';const chat=workspace(rows).chats[0];setContextPin(chat,'m-5',true,100);setContextPin(chat,'m-999',true,200);const context=buildHistoryContext(chat.messages,900,{pins:chat.contextPins});assert.ok(context.messages.some(m=>m.id==='m-5'));assert.ok(context.info.pinnedPositions.includes(6));assert.ok(!context.messages.some(m=>m.id==='m-999'));assert.ok(context.info.positions.every(p=>p<=901));assert.equal(context.messages.at(-1).id,'m-900');
});
test('pin removal survives stale-device merges, and pins from one contact never leak into another',()=>{
 const remote=workspace(),chat=remote.chats[0];setContextPin(chat,'m-5',true,100);const local=structuredClone(remote);setContextPin(local.chats[0],'m-5',false,200);const merged=mergeWorkspaces(remote,local).workspace.chats[0];assert.equal(merged.contextPins[0].active,false);const other=workspace(messages().map(m=>({...m,id:'other-'+m.id}))).chats[0],context=buildHistoryContext(other.messages,999,{pins:chat.contextPins});assert.equal(context.info.pinnedPositions.length,0);
});
test('twenty pin capacity failures are atomic and replacing current history deactivates removed pins',()=>{
 const chat=workspace().chats[0];for(let i=0;i<20;i++)setContextPin(chat,'m-'+i,true,100+i);const before=JSON.stringify(chat);assert.throws(()=>setContextPin(chat,'m-20',true,200),/20/);assert.equal(JSON.stringify(chat),before);replaceContactMessages(chat,[{id:'replacement',role:'partner',text:'新的对话'}],300);assert.ok(chat.contextPins.every(pin=>!pin.active));
});
test('long messages fit the exact character budget while pinned centers have priority over their neighbors',()=>{
 const rows=Array.from({length:1000},(_,i)=>({id:'m'+i,role:'partner',text:'长'.repeat(2000)})),pins=Array.from({length:20},(_,i)=>({messageId:'m'+i,active:true,updatedAt:100})),context=buildHistoryContext(rows,999,{pins});assert.equal(context.messages.reduce((n,m)=>n+m.text.length,0),80000);assert.equal(context.info.pinnedPositions.length,20);assert.equal(context.messages.at(-1).id,'m999');
});
test('retrieved records preserve exact selected evidence and metadata after replacement, rewrite and merge',()=>{
 const w=workspace(),chat=w.chats[0],context=buildHistoryContext(chat.messages,999),record=saveAnalysisRecord(chat,context,localAnalysis(context.messages,context.targetIndex),{newId:()=> 'r'});updateRecordDraft(chat,'r','brief',{brief:'我编辑过的回复'},200);const oldInfo=structuredClone(record.contextInfo);replaceContactMessages(chat,[{id:'new',role:'partner',text:'后来的消息不能进入旧分析'}]);const original=recordContext(chat,record),rewritten=saveAnalysisRecord(chat,{messages:original,targetIndex:original.length-1,info:record.contextInfo},record.result,{newId:()=> 'rewrite',replyOptions:{goal:'listen',context:'重新起草'}});assert.deepEqual(rewritten.contextInfo,oldInfo);assert.ok(recordContext(chat,rewritten).some(m=>m.id==='m-10'));const restored=mergeWorkspaces(w,normalizeWorkspace(JSON.parse(JSON.stringify(w)))).workspace;assert.equal(restored.chats[0].analyses.length,2);assert.deepEqual(restored.chats[0].analyses.find(r=>r.id==='r').contextInfo,oldInfo);
});
test('bad or reordered provenance fails closed, including timestamps that disagree with archived evidence',()=>{
 const w=workspace(),chat=w.chats[0],context=buildHistoryContext(chat.messages,999),info=context.info;for(const change of [{positions:info.positions.slice().reverse()},{availableCount:999},{sentAt:[1]},{pinnedPositions:[10001]}])assert.throws(()=>normalizeContextInfo({...info,...change},context.messages.length),/来源/);const r=saveAnalysisRecord(chat,context,localAnalysis(context.messages,context.targetIndex));r.contextInfo.sentAt[0]=100;assert.throws(()=>normalizeWorkspace(w),/发言时间/);
});
test('review pages preserve off-screen edits, dates and original row indices during page changes',()=>{
 const rows=messages(200).map((r,i)=>({...r,sentAt:100+i})),first=collectReviewPage(rows,[{index:2,role:'me',text:'第一页的修改'}]),second=collectReviewPage(first,[{index:82,role:'partner',text:'第二页的修改'}]);assert.equal(second.length,200);assert.equal(second[2].text,'第一页的修改');assert.equal(second[82].text,'第二页的修改');assert.equal(second[82].sentAt,182);assert.equal(rows[2].text,'日常闲聊第 2 条。');
});
test('chat pages cover every original index exactly once and any citation can reveal an early message',()=>{
 const rows=messages(10000),ids=[];for(let page=0;page<Math.ceil(rows.length/HISTORY_LIMITS.page);page++){const view=conversationPage(rows,page);assert.ok(view.rows.length<=60);ids.push(...view.rows.map(m=>m.id));}assert.equal(new Set(ids).size,10000);const index=10,page=conversationPage(rows,Math.floor((rows.length-1-index)/60));assert.equal(page.rows[index-page.start].id,'m-10');
});
test('large exact boundary overlaps are found without collapsing short repeated greetings inside a batch',()=>{
 const rows=messages(10000),incoming=rows.slice(1000);assert.equal(boundaryOverlap(rows,incoming),9000);assert.equal(boundaryOverlap([{role:'me',text:'嗯'}],[{role:'me',text:'嗯'}]),0);const repeated=[{role:'me',text:'同样的长句子'},{role:'partner',text:'同样的长回复'}];assert.equal(boundaryOverlap([...repeated,...repeated],repeated),2);
});
test('schema six backup roundtrips ten thousand messages and blocks version five writers byte for byte',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'xianwai-history-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=new WorkspaceStore(directory),w=workspace(messages(10000));setContextPin(w.chats[0],'m-10',true,100);await store.save(w,0);const before=await readFile(store.file,'utf8');await assert.rejects(store.save({...w,schemaVersion:5},1),{status:409});assert.equal(await readFile(store.file,'utf8'),before);const restored=await store.read();assert.equal(restored.workspace.chats[0].messages.length,10000);assert.equal(restored.workspace.chats[0].contextPins[0].active,true);
});
test('model providers receive the selected source map, with explicit instructions about gaps and outdated facts',async()=>{
 const selection=buildHistoryContext(messages(),999),model={title:'核对旧约定',feeling:'可能在确认旧约定',need:'确认是否仍适用',question:'你说的是之前海边的约定吗？',avoid:'不把旧约定当作当前已确认安排',hypotheses:[{text:'可能在提旧约定',evidence:[1,selection.messages.length]},{text:'也可能只是确认安排',evidence:[selection.messages.length]}],recommendation:{action:'reply',tone:'brief',reason:'先核对约定',check:'确认旧约定是否仍适用'},replies:Array.from({length:3},()=>({label:'回复',text:'你说的是之前海边的约定吗？',reason:'先核对'}))};let sent;await analyzeInput({messages:selection.messages,targetIndex:selection.targetIndex,tone:'brief',note:'',contextInfo:selection.info},{AI_API_KEY:'fictional'},async(_,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(model)}}]}));});assert.deepEqual(sent.contextInfo,selection.info);assert.equal(sent.context.length,selection.messages.length);assert.match(SYSTEM,/不连续/);assert.match(SYSTEM,/不一定|可能已改变/);
});
