import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localAnalysis} from '../dist/core.js';
import {normalizeWorkspace} from '../dist/workspace.js';
import {saveAnalysisRecord} from '../dist/library.js';
import {buildHistoryContext} from '../dist/history-context.js';
import {normalizeHistoryReview,reviewMatches,relationshipContextFor,reviewPriorities,reviewMessageCheck} from '../dist/relationship-review.js';
import {normalizeReplyVerification,replyReviewStatus,preferredVerifiedTone} from '../dist/reply-verification.js';
import {attachVerification} from '../lib/reply-verification.mjs';
import {analyzeInput} from '../lib/ai.mjs';
import {validateClientAnalysis,createAnalysisClient} from '../dist/analysis-client.js';
const input={messages:[{role:'partner',text:'你几点到家？'}],targetIndex:0,tone:'brief',note:'',replyOptions:{goal:'auto',context:''},verify:true};
const analysis=()=>{const value=localAnalysis(input.messages,0);value.mode='ai';value.replies=value.replies.map((r,i)=>({...r,text:['我九点半到家。','我在开会。','我先确认安排再告诉你。'][i]}));return value;};
const audit=(value=analysis())=>({action:'reply',actionReason:'普通问题可以按实际情况回应。',replies:value.replies.map((reply,i)=>({tone:reply.tone,status:i===2?'ready':'review',reason:i===2?'未发现编造的具体安排。':'缺少当前事实依据。',issues:i===2?[]:[{quote:reply.text,reason:'用户未提供这个安排或状态。'}]})),interpretation:{status:'tentative',reason:'保留了其他解释。',issues:[]}});
const profile=()=>{const rows=Array.from({length:100},(_,i)=>({id:'m'+i,role:i%2?'me':'partner',text:'虚构交流 '+i}));const report={headline:'历史概述',summary:'仅供核对的概述',recentState:{text:'可能忙碌',evidence:[100],confidence:'tentative',alternative:'也可能暂时想休息'},stages:[{text:'较早聊过见面',evidence:[1]}],observations:[{text:'当时表达过喜欢提前安排',evidence:[2],confidence:'explicit',alternative:'以后偏好可能改变'},{text:'可能比较谨慎',evidence:[3],confidence:'tentative',alternative:'也可能只是那次没有空'}],openLoops:[{text:'等待上次见面',evidence:[4]}],nextSteps:[{text:'可以询问上次见面',evidence:[4]}],unknowns:['上次见面是否落实']};return {chat:{id:'person',name:'小满',title:'虚构',note:'',messages:rows},review:{id:'r',createdAt:100,sourceHash:'a'.repeat(64),sourceIds:rows.map(m=>m.id),sourceChecks:rows.map(reviewMessageCheck),sourceCount:100,sourceNote:'',chunkCount:1,report}};};
test('an appended message cannot inherit the old report end-state, old open loops or old advice as current',()=>{
 const {chat,review}=profile();chat.relationshipReview=normalizeHistoryReview(review,new Map(chat.messages.map(m=>[m.id,m])));chat.messages.push({id:'new',role:'partner',text:'之前的事情已经解决，现在想正式交往。'});const context=buildHistoryContext(chat.messages,100,{priorityIds:reviewPriorities(chat.relationshipReview,chat,100)}),relation=relationshipContextFor(chat.relationshipReview,chat,100,context.messages);assert.equal(relation.items.length,1);assert.equal(relation.items[0].text,'当时表达过喜欢提前安排');assert.deepEqual(relation.unknowns,[]);assert.equal(relation.items[0].kind,'此前明确表达，仅代表当时');
});
test('identical message IDs cannot hide changed words, speaker attribution, or message dates',()=>{
 for(const change of [m=>m.text='已经改变的原话',m=>m.role='me',m=>m.sentAt=100]){const {chat,review}=profile();change(chat.messages[0]);assert.equal(reviewMatches(review,chat),false);assert.throws(()=>normalizeHistoryReview(review,new Map(chat.messages.map(m=>[m.id,m]))),/原话/);}
});
test('legacy reports remain readable but are excluded from new replies until original content is checked again',()=>{
 const {chat,review}=profile();delete review.sourceChecks;const legacy=normalizeHistoryReview(review,new Map(chat.messages.map(m=>[m.id,m])));assert.equal(legacy.sourceChecks,null);assert.equal(reviewMatches(legacy,chat),false);assert.equal(relationshipContextFor(legacy,chat,99,chat.messages),null);
});
test('unsafe original recommendation switches to a checked alternative and the quoted rationale remains valid',()=>{
 const value=analysis();value.recommendation.tone='warm';const result=attachVerification(audit(value),value,input);assert.equal(result.recommendation.tone,'brief');assert.equal(preferredVerifiedTone(result),'brief');assert.doesNotThrow(()=>normalizeReplyVerification(result.verification,result,input));assert.equal(replyReviewStatus(result,'warm',result.replies[0].text,input.replyOptions).status,'review');assert.equal(replyReviewStatus(result,'brief',result.replies[2].text,input.replyOptions).status,'ready');
});
test('editing a checked reply or unsent actual situation invalidates the old ready result',()=>{
 const result=attachVerification(audit(),analysis(),input),text=result.replies[2].text;assert.equal(replyReviewStatus(result,'brief',text+'我马上过去。',input.replyOptions).status,'review');assert.equal(replyReviewStatus(result,'brief',text,{goal:'auto',context:'我今天不能出门。'}).status,'review');assert.equal(replyReviewStatus(result,'brief','【待补充：时间】',input.replyOptions).status,'blocked');assert.equal(replyReviewStatus(null,'brief',text).status,'review');
});
test('audit results cannot be detached from the exact source words, directions and reviewed variant',()=>{
 const result=attachVerification(audit(),analysis(),input);for(const changed of [{...input,messages:[{role:'me',text:'你几点到家？'}]},{...input,replyOptions:{goal:'plan',context:''}},{...input,messages:[{role:'partner',text:'你什么时候到家？'}]}])assert.throws(()=>normalizeReplyVerification(result.verification,result,changed),/变更/);const corrupted=structuredClone(result);corrupted.replies[2].text='我保证明天有空。';assert.throws(()=>normalizeReplyVerification(corrupted.verification,corrupted,input),/不对应/);
});
test('fabricated audit quotations and a ready verdict with issues fail closed',()=>{
 const bad=audit();bad.replies[0].issues[0].quote='不存在的原话';assert.throws(()=>attachVerification(bad,analysis(),input),/引用/);const conflicting=audit();conflicting.replies[0].status='ready';assert.throws(()=>attachVerification(conflicting,analysis(),input),/不一致/);
});
test('verified analyses retain source checks through saved history, and edited backup evidence is rejected',()=>{
 const w=normalizeWorkspace({chats:[{id:'person',name:'小满',title:'虚构',messages:input.messages}],active:'person',favorites:[]}),chat=w.chats[0],context=buildHistoryContext(chat.messages,0),request={...input,contextInfo:context.info},result=attachVerification(audit(),analysis(),request);saveAnalysisRecord(chat,context,result,{replyOptions:input.replyOptions});assert.doesNotThrow(()=>normalizeWorkspace(JSON.parse(JSON.stringify(w))));chat.messages[0].text='不同的原话';assert.throws(()=>normalizeWorkspace(w),/核对的原文/);
});
test('the API provider runs a separate audit and returns no new suggestion when verification fails',async()=>{
 const raw={recommendation:{action:'reply',tone:'warm',reason:'先回复',check:''},title:'回应原话',feeling:'可能在确认时间',need:'确认安排',question:'你有其他安排吗？',avoid:'不编造',hypotheses:[{text:'可能确认安排',evidence:[1]},{text:'也可能分享近况',evidence:[1]}],replies:analysis().replies};let calls=0;const result=await analyzeInput(input,{AI_API_KEY:'fictional'},async(_,options)=>{calls++;const payload=JSON.parse(options.body);if(calls===2){assert.match(payload.messages[0].content,/核对员/);assert.equal(JSON.parse(payload.messages[1].content).context[0].role,'partner');}return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?raw:audit())}}]}));});assert.equal(calls,2);assert.ok(result.verification);calls=0;await assert.rejects(analyzeInput(input,{AI_API_KEY:'fictional'},async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(++calls===1?raw:{})}}]}))),/核对未完成/);
});
test('a client requesting verification rejects unaudited results and caches only the verified input scope',async()=>{
 const result=analysis();assert.throws(()=>validateClientAnalysis(result,input),/核对结果/);const verified=attachVerification(audit(),result,input);let calls=0;const client=createAnalysisClient({fetcher:async()=>{calls++;return new Response(JSON.stringify(verified));}});await client.request({endpoint:'',token:'fake',input});await client.request({endpoint:'',token:'fake',input});assert.equal(calls,1);
});

test('an audited earlier source still requires current-context confirmation before copying',()=>{
 const result=attachVerification(audit(),analysis(),input);assert.equal(replyReviewStatus(result,'brief',result.replies[2].text,input.replyOptions,false).status,'review');
});
test('analysis caches expire instead of keeping the same audited suggestion indefinitely across days',async()=>{
 let now=0,calls=0;const result=attachVerification(audit(),analysis(),input),client=createAnalysisClient({now:()=>now,cacheTTL:100,fetcher:async()=>{calls++;return new Response(JSON.stringify(result));}});const request={endpoint:'',token:'fake',input};await client.request(request);now=50;await client.request(request);assert.equal(calls,1);now=101;await client.request(request);assert.equal(calls,2);now=0;await client.request(request);assert.equal(calls,3);
});

test('auditor tone ordering is keyed by tone and a pause verdict suppresses the original reply recommendation',()=>{
 const value=analysis(),check=audit(value);check.replies.reverse();check.action='pause';check.actionReason='对方明确要求暂停沟通。';const result=attachVerification(check,value,input);assert.equal(result.recommendation.action,'pause');assert.equal(result.verification.replies[0].tone,'warm');assert.doesNotThrow(()=>normalizeReplyVerification(result.verification,result,input));
});
