import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HistoryReviewRunner,validateHistoryInput} from '../lib/history-review.mjs';
import {pruneJobs} from '../lib/jobs.mjs';
import {planHistoryReview,reviewMatches,normalizeHistoryReview,reviewPriorities,relationshipContextFor,normalizeReviewReport} from '../dist/relationship-review.js';
import {buildHistoryContext} from '../dist/history-context.js';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {replaceContactMessages,recordContext,saveAnalysisRecord,deleteAnalysisRecord} from '../dist/library.js';
import {localAnalysis} from '../dist/core.js';
import {createHistoryReviewClient,normalizeReviewJob} from '../dist/history-review-client.js';
const input=(count=801)=>({chatId:'person',note:'相亲后持续了解，还未确认恋爱关系。',messages:Array.from({length:count},(_,i)=>({id:'m'+i,role:i%2?'me':'partner',text:i===2?'我喜欢慢慢了解，不急着确定关系。':'虚构的日常交流 '+i,...(i===2?{sentAt:Date.parse('2020-06-01T00:00:00Z')}:{})}))});
const observation=(text,evidence)=>({text,evidence,confidence:'tentative',alternative:'也可能受到当时安排影响，需要向本人确认。'});
function inferFixture(log=[]){return async payload=>{log.push(payload);if(payload.sourceCount){const last=payload.recent.at(-1).id,earlier=payload.reports.flatMap(report=>report.findings.flatMap(item=>item.evidence))[0]||last;return {headline:'按既往交流整理关系进展',summary:'双方持续沟通，关系定位仍需明确。',recentState:observation('近期可能仍在互相了解。',[last]),stages:[{text:'较早的沟通中表达过希望慢慢了解。',evidence:[earlier]}],observations:[observation('部分交流中更偏向逐步了解。',[earlier,last])],openLoops:[{text:'关系定位还需要双方确认。',evidence:[last]}],nextSteps:[{text:'先回应眼前的问题，合适时自然确认彼此期待。',evidence:[last]}],unknowns:['对方当前对关系的期待是什么？']};}const refs=payload.context?[payload.context[0].id,payload.context.at(-1).id]:payload.reports.flatMap(report=>report.findings.flatMap(item=>item.evidence));return {overview:'本段围绕日常交流展开，期待需要核对。',findings:[{kind:'uncertain',text:'对话可能处于逐步了解阶段。',alternative:'也可能只是普通分享近况。',evidence:[...new Set(refs)].slice(0,6)}]};};}
async function runner(t){const directory=await mkdtemp(path.join(os.tmpdir(),'xianwai-full-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));const log=[],runner=new HistoryReviewRunner(directory,{infer:inferFixture(log)});return {directory,log,runner};}
const work=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));
test('whole-history review processes every source message once before hierarchical synthesis and reports exact coverage',async t=>{
 const h=await runner(t),source=input(1801),progress=[];const review=await h.runner.run(source,{onProgress:p=>progress.push(p)}),ids=h.log.filter(p=>p.context).flatMap(p=>p.context.map(m=>m.id));assert.deepEqual(ids,Array.from({length:1801},(_,i)=>i+1));assert.equal(review.sourceCount,1801);assert.equal(review.chunkCount,5);assert.equal(h.log.length,planHistoryReview(source.messages).calls);assert.equal(progress.at(-1).done,progress.at(-1).total);assert.equal(h.log[0].context[2].sentAt,'2020-06-01T00:00:00.000Z');
});
test('identical reviews reuse completed parts and final output, while appended history only processes new parts',async t=>{
 const h=await runner(t),source=input(800),first=await h.runner.run(source);h.log.length=0;assert.deepEqual(await h.runner.run(source),first);assert.equal(h.log.length,0);const added=input(801);await h.runner.run(added);assert.equal(h.log.filter(p=>p.context).length,1);assert.equal(h.log.find(p=>p.context).context[0].id,801);assert.equal(h.log.length,2);
});
test('changed backgrounds and another contact never reuse a previous contact cache',async t=>{
 const h=await runner(t),source=input(5);await h.runner.run(source);h.log.length=0;await h.runner.run({...source,chatId:'other'});assert.equal(h.log.length,2);h.log.length=0;await h.runner.run({...source,note:'新的已确认背景'});assert.equal(h.log.length,2);
});
test('cancelled reviews retain finished chunks for a later resume without producing a partial complete report',async t=>{
 const h=await runner(t),source=input(801),controller=new AbortController();await assert.rejects(h.runner.run(source,{signal:controller.signal,onProgress:p=>{if(p.done===1)controller.abort();}}),{status:499});assert.equal(h.log.length,1);h.log.length=0;const review=await h.runner.run(source);assert.equal(review.sourceCount,801);assert.equal(h.log.filter(p=>p.context).length,2);assert.ok(h.log.filter(p=>p.context).every(p=>p.context[0].id>400));
});
test('corrupt cached evidence is recomputed and fabricated evidence cannot become a saved complete report',async t=>{
 const h=await runner(t),source=input(5);await h.runner.run(source);for(const file of await readdir(h.directory)){const name=path.join(h.directory,file),entry=JSON.parse(await readFile(name,'utf8'));if(entry.value.findings){entry.value.findings[0].evidence=[9999];await writeFile(name,JSON.stringify(entry));}}
 h.log.length=0;await h.runner.run(source);assert.equal(h.log.filter(p=>p.context).length,1);
 const broken=new HistoryReviewRunner(path.join(h.directory,'broken'),{infer:async()=>({overview:'说明',findings:[{kind:'event',text:'未提供的事',alternative:'',evidence:[9999]}]})});await assert.rejects(broken.run(source),/未提供/);assert.equal((await readdir(broken.directory)).length,0);
});
test('old-state claims and fabricated source positions fail validation instead of masquerading as current feelings',()=>{
 const report={headline:'标题',summary:'说明',recentState:observation('状态',[1]),stages:[],observations:[],openLoops:[],nextSteps:[],unknowns:[]};assert.throws(()=>normalizeReviewReport(report,1000),/近期/);assert.throws(()=>normalizeReviewReport({...report,recentState:observation('状态',[1000])},1000,new Set([1])),/引用/);
});
test('a global report never enters an earlier target, another contact, reordered history or changed background',async t=>{
 const h=await runner(t),source=input(),review=await h.runner.run(source),chat={...source,relationshipReview:review};assert.equal(reviewMatches(review,chat,800),true);assert.equal(reviewMatches(review,chat,799),false);assert.equal(reviewMatches(review,{...chat,note:'改变了背景'}),false);assert.equal(reviewMatches(review,{...chat,messages:chat.messages.slice().reverse()}),false);const other={...chat,messages:chat.messages.map(m=>({...m,id:'other-'+m.id}))};assert.deepEqual(reviewPriorities(review,other,800),[]);assert.equal(relationshipContextFor(review,chat,799,chat.messages),null);
});
test('reply context only contains report claims whose complete evidence exists in the selected raw messages',async t=>{
 const h=await runner(t),source=input(),review=await h.runner.run(source),chat={...source,relationshipReview:review},context=buildHistoryContext(chat.messages,800,{priorityIds:reviewPriorities(review,chat,800)}),relation=relationshipContextFor(review,chat,800,context.messages);assert.ok(relation.items.length>0);assert.ok(relation.items.every(item=>item.evidence.every(id=>context.messages[id-1])));assert.ok(!relationshipContextFor(review,chat,800,[chat.messages[200]]));
});
test('review evidence survives transcript replacement, record deletion, serialization and unrelated merge activity',async t=>{
 const h=await runner(t),source=input(),review=await h.runner.run(source),w=normalizeWorkspace({active:'person',chats:[{id:'person',title:'虚构',name:'小满',note:source.note,messages:source.messages,relationshipReview:review,reviewUpdatedAt:100}],favorites:[]}),chat=w.chats[0],context=buildHistoryContext(chat.messages,800,{priorityIds:reviewPriorities(review,chat,800)});context.relationshipContext=relationshipContextFor(review,chat,800,context.messages);const record=saveAnalysisRecord(chat,context,localAnalysis(context.messages,context.targetIndex),{newId:()=> 'analysis'});assert.ok(record.relationshipContext);const stale=structuredClone(w);stale.chats[0].updatedAt=99999;replaceContactMessages(chat,[{id:'new',role:'partner',text:'新的消息'}]);deleteAnalysisRecord(chat,'analysis');assert.ok(normalizeWorkspace(w).chats[0].relationshipReview);assert.ok(chat.archive.length>0);assert.equal(reviewMatches(review,chat),false);assert.ok(recordContext({...chat,messages:source.messages},record).length>0);const merged=mergeWorkspaces(stale,structuredClone(stale)).workspace;assert.equal(merged.chats[0].relationshipReview.sourceHash,review.sourceHash);
});
test('running jobs older than ten minutes survive cleanup and capacity pressure; terminal jobs expire',()=>{
 const now=10000000,jobs=new Map([['running',{status:'running',created:0}],['finished',{status:'completed',created:0}],['recent',{status:'cancelled',created:now}]]);pruneJobs(jobs,now,1);assert.equal(jobs.has('running'),true);assert.equal(jobs.has('finished'),false);assert.equal(jobs.size,1);
});
test('client resume can apply a finished job to its original contact and stale credentials discard late completion',async()=>{
 let pair={endpoint:'https://fixture.invalid',token:'old'};const pending=work(),completed=[];const client=createHistoryReviewClient({getPair:()=>pair,fetcher:()=>pending.promise,onComplete:(result,chat)=>completed.push({result,chat}),interval:1});const checking=client.resume(pair);pair={...pair,token:'new'};pending.resolve(new Response(JSON.stringify({jobId:'job',chatId:'person',status:'completed',result:{id:'old'}})));await checking;await settle();assert.deepEqual(completed,[]);client.disconnect();const newer=createHistoryReviewClient({getPair:()=>pair,fetcher:async()=>new Response(JSON.stringify({jobId:'new',chatId:'other',status:'completed',result:{id:'correct'}})),onComplete:(result,chat)=>completed.push({result,chat})});await newer.resume(pair);await settle();assert.deepEqual(completed,[{result:{id:'correct'},chat:'other'}]);newer.disconnect();
});
test('late same-pair resume responses cannot overwrite a newer observed review',async()=>{
 const first=work(),pair={endpoint:'https://fixture.invalid',token:'same'},done=[];let count=0;const client=createHistoryReviewClient({getPair:()=>pair,fetcher:()=>++count===1?first.promise:Promise.resolve(new Response(JSON.stringify({jobId:'new',chatId:'person',status:'completed',result:{id:'new'}}))),onComplete:result=>done.push(result.id)});const old=client.resume(pair);await client.resume(pair);first.resolve(new Response(JSON.stringify({jobId:'old',chatId:'person',status:'completed',result:{id:'old'}})));await old;await settle();assert.deepEqual(done,['new']);client.disconnect();
});

test('malformed progress and job identifiers cannot reach the rendered status or completed report handler',()=>{
 for(const value of [{status:'running',jobId:'../wrong'},{status:'unknown'},{status:'running',progress:{phase:'阶段',done:'<img onerror=1>',total:3,chunkDone:0,chunkTotal:2,cached:0}},{status:'running',progress:{phase:'阶段',done:4,total:3,chunkDone:1,chunkTotal:2,cached:0}}])assert.throws(()=>normalizeReviewJob(value));
 assert.equal(normalizeReviewJob({status:'none'}).status,'none');
});

test('malformed source timestamps fail instead of being silently treated as undated history',()=>{
 for(const sentAt of [null,false,'',-1,Number.MAX_SAFE_INTEGER])assert.throws(()=>validateHistoryInput({...input(1),messages:[{id:'m0',role:'partner',text:'原话',sentAt}]}),/时间/);
});
