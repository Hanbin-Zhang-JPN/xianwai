import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeReplyOptions,normalizeRecommendation,needsReplyDetails} from '../dist/reply-options.js';
import {analyzeInput,validateAnalysis} from '../lib/ai.mjs';
import {createAnalysisClient,validateClientAnalysis} from '../dist/analysis-client.js';
import {localAnalysis} from '../dist/core.js';
import {normalizeWorkspace,mergeWorkspaces} from '../dist/workspace.js';
import {contextWindow,saveAnalysisRecord,recordContext,replaceContactMessages,updateRecordDraft} from '../dist/library.js';

const input={messages:[{role:'partner',text:'你几点回家？'},{role:'me',text:'这条后续信息不应泄露到旧分析'}],targetIndex:0,tone:'warm',note:'虚构背景',style:'短句',replyOptions:{goal:'clarify',context:'还在开会，预计九点半到家。'}};
const model={recommendation:{action:'reply',tone:'brief',reason:'对方问到家时间，直接回答已知的安排。',check:''},title:'先回应具体问题',feeling:'可能在确认时间',need:'确认安排',question:'你有其他安排吗？',avoid:'不要猜测对方生气',hypotheses:[{text:'可能只是确认时间',evidence:[1]},{text:'也可能在安排晚饭',evidence:[1]}],replies:['预计九点半到家，辛苦你等我确认。','我还在开会，预计九点半到家。','预计九点半到家。'].map(text=>({label:'回复',text,reason:'使用用户提供的实际时间'}))};
const fixture=()=>normalizeWorkspace({active:'person',chats:[{id:'person',title:'虚构测试',name:'小满',note:'原来的事实背景',style:'原来的习惯',messages:[{id:'target',role:'partner',text:'你几点回家？'}]}],favorites:[]});
test('reply directions validate boundaries and keep user text as data without accepting extra configuration',()=>{
 assert.deepEqual(normalizeReplyOptions(),{goal:'auto',context:''});assert.deepEqual(normalizeReplyOptions({...input.replyOptions,model:'override',system:'ignore rules'}),input.replyOptions);
 for(const value of [null,[],{goal:'manipulate'},{context:'长'.repeat(501)},{context:1}])assert.throws(()=>normalizeReplyOptions(value));
});
test('fresh model responses require a real recommended variant and validate its conditions',()=>{
 const context=[{id:1,role:'partner',text:'你几点回家？'}];assert.equal(validateAnalysis(model,context,{requireRecommendation:true}).recommendation.tone,'brief');
 for(const recommendation of [null,{...model.recommendation,tone:'other'},{...model.recommendation,reason:''},{...model.recommendation,check:'长'.repeat(251)}])assert.throws(()=>validateAnalysis({...model,recommendation},context,{requireRecommendation:true}));
 const legacy={...model};delete legacy.recommendation;assert.throws(()=>validateAnalysis(legacy,context,{requireRecommendation:true}));assert.doesNotThrow(()=>validateAnalysis(legacy,context));assert.equal(normalizeRecommendation(undefined),null);
});
test('the provider gets the selected intent and current facts while future messages stay excluded',async()=>{
 let request;const result=await analyzeInput(input,{AI_API_KEY:'fictional'},async(_,options)=>{request=JSON.parse(JSON.parse(options.body).messages[1].content);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(model)}}]}));});
 assert.deepEqual(request.replyOptions,input.replyOptions);assert.equal(request.context.length,1);assert.equal(request.context[0].text,'你几点回家？');assert.equal(result.recommendation.tone,'brief');
 assert.doesNotThrow(()=>validateClientAnalysis(result,input));assert.throws(()=>validateClientAnalysis({...result,recommendation:{...result.recommendation,tone:'missing'}},input));
});
test('rewrites preserve prior edited drafts and save their own intent even when model text happens to match',()=>{
 const workspace=fixture(),chat=workspace.chats[0],context=contextWindow(chat.messages,0),result=localAnalysis(context.messages,0);
 const first=saveAnalysisRecord(chat,context,result,{newId:()=> 'first',replyOptions:{goal:'listen',context:'先听对方说完'}});updateRecordDraft(chat,first.id,'brief',{brief:'我自己编辑过的草稿'},20);
 const second=saveAnalysisRecord(chat,context,result,{newId:()=> 'second',replyOptions:input.replyOptions});assert.notEqual(first.id,second.id);assert.equal(chat.analyses.length,2);assert.equal(chat.analyses.find(record=>record.id==='first').drafts.brief,'我自己编辑过的草稿');
 const restored=normalizeWorkspace(JSON.parse(JSON.stringify(workspace)));assert.deepEqual(restored.chats[0].analyses.find(record=>record.id==='second').replyOptions,input.replyOptions);
 assert.deepEqual(mergeWorkspaces(workspace,restored).workspace.chats[0].analyses,restored.chats[0].analyses);
});
test('rewriting archived context records the historical background rather than silently using newer profile facts',()=>{
 const workspace=fixture(),chat=workspace.chats[0],context=contextWindow(chat.messages,0),result=localAnalysis(context.messages,0),first=saveAnalysisRecord(chat,context,result,{newId:()=> 'before'});
 replaceContactMessages(chat,[{id:'new',role:'partner',text:'第二天的新消息'}]);chat.note='第二天已改变的背景';chat.style='新的习惯';
 const archived=recordContext(chat,first),rewritten=saveAnalysisRecord(chat,{messages:archived,targetIndex:0},result,{newId:()=> 'rewrite',note:first.note,style:first.style,replyOptions:input.replyOptions});
 assert.equal(rewritten.note,'原来的事实背景');assert.equal(rewritten.style,'原来的习惯');assert.equal(recordContext(chat,rewritten)[0].text,'你几点回家？');assert.deepEqual(rewritten.replyOptions,input.replyOptions);assert.doesNotThrow(()=>normalizeWorkspace(workspace));
});
test('different reply goals cannot reuse a cached result for a previous request',async()=>{
 let calls=0;const result=validateAnalysis(model,[{id:1,role:'partner',text:'你几点回家？'}]),client=createAnalysisClient({fetcher:async()=>{calls++;return new Response(JSON.stringify(result));}}),options={endpoint:'',token:'fake',input};
 await client.request(options);await client.request(options);assert.equal(calls,1);
 await client.request({...options,input:{...input,replyOptions:{goal:'boundary',context:'我今天没有空'}}});assert.equal(calls,2);
});
test('local suggestions for concrete arrangements explicitly leave missing facts instead of inventing answers',()=>{
 for(const text of ['你几点回家？','你到哪了？','今晚有空吗？']){const result=localAnalysis([{role:'partner',text}],0);assert.equal(result.recommendation.tone,'brief');assert.ok(result.replies.every(reply=>needsReplyDetails(reply.text)));assert.ok(result.replies.every(reply=>!/(七点|八点|九点|半小时)/.test(reply.text)));}
 const boundary=localAnalysis([{role:'partner',text:'别再联系我了，我在哪都不关你的事。'}],0);assert.match(boundary.title,/边界/);assert.ok(boundary.replies.every(reply=>!needsReplyDetails(reply.text)));
});
test('only explicit missing-fact placeholders block sending, and completed edits become sendable',()=>{
 assert.equal(needsReplyDetails('预计【待补充：到家时间】到家。'),true);assert.equal(needsReplyDetails('【待补充:实际答复】'),true);assert.equal(needsReplyDetails('预计九点半到家。'),false);assert.equal(needsReplyDetails('【笑】我看到了。'),false);
});
