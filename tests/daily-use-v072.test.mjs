import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundaryOverlap,reviewTranscript} from '../dist/flow.js';
import {parseTranscript,IMPORT_LIMITS,localAnalysis} from '../dist/core.js';
import {normalizeWorkspace} from '../dist/workspace.js';
import {prepareContactImport,saveAnalysisRecord} from '../dist/library.js';
import {buildHistoryContext} from '../dist/history-context.js';
import {createAnalysisClient} from '../dist/analysis-client.js';
import {isReplySourceCurrent} from '../dist/reply-verification.js';
const rows=[{role:'partner',text:'今天几点回家吃饭？'},{role:'me',text:'我可能需要晚一点到。'}];
const day=new Date(2026,10,4,12).getTime();
test('repeated dated conversations on different days survive boundary deduplication',()=>{
 const dated=rows.map((m,i)=>({...m,sentAt:day+i})),later=dated.map(m=>({...m,sentAt:m.sentAt+86400000}));
 assert.equal(boundaryOverlap(dated,dated),2);assert.equal(boundaryOverlap(dated,later),0);assert.equal(boundaryOverlap(dated,rows),0);assert.equal(boundaryOverlap(rows,dated),0);
 let serial=0;const options={newId:()=>String(++serial),now:day};const first=prepareContactImport([],dated,options).messages;
 assert.equal(prepareContactImport(first,later,options).messages.length,4);assert.equal(prepareContactImport(first,dated,options).messages.length,2);
});
test('returning from review preserves source dates, multiline messages and corrected speakers',()=>{
 for(const source of [rows,rows.map((m,i)=>({...m,sentAt:day+i})),[{role:'me',text:'第一行\n第二行'},{role:'partner',text:'收到啦'}]]){
  assert.deepEqual(parseTranscript(reviewTranscript(source),IMPORT_LIMITS).map(({uncertain,...m})=>m),source);
 }
});
const input={messages:[rows[0]],targetIndex:0,tone:'warm',note:''};
const result=()=>({...localAnalysis(input.messages,0),mode:'ai'});
test('an explicit rewrite makes a fresh request and replaces the cached result',async()=>{
 let posts=0;const client=createAnalysisClient({fetcher:async()=>new Response(JSON.stringify({...result(),title:'第'+(++posts)+'稿'}))});const request={endpoint:'',token:'fictional',input};
 const first=await client.request(request);assert.equal((await client.request(request)).title,first.title);assert.equal(posts,1);
 assert.equal((await client.request({...request,fresh:true})).title,'第2稿');assert.equal((await client.request(request)).title,'第2稿');assert.equal(posts,2);
});
test('a failed forced rewrite cannot fall back to the earlier cached response',async()=>{
 let calls=0;const client=createAnalysisClient({fetcher:async(url,options)=>{if(options.method==='DELETE')return new Response('{}');if(++calls===2)throw new Error('虚构核对失败');return new Response(JSON.stringify(result()));}}),request={endpoint:'',token:'fictional',input};
 await client.request(request);await assert.rejects(client.request({...request,fresh:true}),/核对失败/);await client.request(request);assert.equal(calls,3);
});
test('midnight expires a cache even when its ten-minute lifetime has not elapsed',async()=>{
 let now=new Date(2026,10,4,23,59).getTime(),calls=0;const client=createAnalysisClient({now:()=>now,fetcher:async()=>{calls++;return new Response(JSON.stringify(result()));}}),request={endpoint:'',token:'fictional',input};
 await client.request(request);now+=120000;await client.request(request);assert.equal(calls,2);
});
test('cross-day suggestions, changed relationship facts and unsaved results need source review',()=>{
 const createdAt=new Date(2026,10,4,23,59).getTime(),chat={messages:[{id:'target'}],note:'尚未确认关系',style:'简短自然'},record={createdAt,targetId:'target',note:chat.note,style:chat.style};
 assert.equal(isReplySourceCurrent(record,chat,createdAt+1000),true);assert.equal(isReplySourceCurrent(record,chat,createdAt+120000),false);assert.equal(isReplySourceCurrent(record,chat,createdAt-1),false);
 assert.equal(isReplySourceCurrent(record,{...chat,note:'已经确认关系'},createdAt),false);assert.equal(isReplySourceCurrent(record,{...chat,style:'自然但直接'},createdAt),false);assert.equal(isReplySourceCurrent(null,chat,createdAt),false);
});
test('a successful explicit rewrite saves another record even if the model returns identical text',()=>{
 const chat=normalizeWorkspace({chats:[{id:'contact',name:'虚构',title:'测试',messages:rows}],active:'contact',favorites:[]}).chats[0],context=buildHistoryContext(chat.messages,1),value=localAnalysis(context.messages,1);let id=0;const options={newId:()=>String(++id),now:day};
 const original=saveAnalysisRecord(chat,context,value,options);original.drafts.warm='保留原先编辑的回复';
 const next=saveAnalysisRecord(chat,context,value,{...options,forceNew:true,now:day+1});assert.notEqual(next.id,original.id);assert.deepEqual(next.drafts,{});assert.equal(chat.analyses.length,2);assert.equal(chat.analyses.find(r=>r.id===original.id).drafts.warm,'保留原先编辑的回复');
});
