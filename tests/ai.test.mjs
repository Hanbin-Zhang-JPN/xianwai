import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeInput,validateAnalysis} from '../lib/ai.mjs';
const input={messages:[{role:'me',text:'约好七点吃饭'},{role:'partner',text:'你到哪了？'},{role:'me',text:'后来的消息不应纳入'}],targetIndex:1,tone:'warm',note:'约会背景'};
const model={title:'先回应具体问题',feeling:'可能在确认进度',need:'确认抵达时间',question:'你方便等一下吗？',avoid:'不编造到达时间',hypotheses:[{text:'可能在等你',evidence:[1,2]},{text:'也可能只是确认',evidence:[2]}],replies:Array.from({length:3},()=>({label:'自然接话',text:'我先确认一下进度，再告诉你。',reason:'不编造事实'}))};
test('provider receives full relevant context and structured data',async()=>{
 let body;
 const a=await analyzeInput(input,{AI_API_KEY:'test-only-not-real'},async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');body=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(model)}}]}));});
 assert.equal(a.mode,'ai');assert.equal(a.contextCount,2);assert.equal(JSON.parse(body.messages[1].content).context.length,2);assert.equal(a.facts[0].text,'你说：“约好七点吃饭”');assert.equal(body.response_format.type,'json_object');
});
test('model evidence must refer to real preceding messages',()=>{
 const invalid=structuredClone(model);invalid.hypotheses[0].evidence=[3];assert.throws(()=>validateAnalysis(invalid,[{id:1,role:'me',text:'原话'},{id:2,role:'partner',text:'原话'}]));
});
test('missing key, invalid inputs, provider failures and malformed output remain explicit',async()=>{
 await assert.rejects(analyzeInput(input,{}),/尚未配置/);
 await assert.rejects(analyzeInput({...input,targetIndex:-1},{}),/有效/);
 await assert.rejects(analyzeInput({...input,tone:'other'},{}),/语气/);
 await assert.rejects(analyzeInput(input,{AI_API_KEY:'test'},async()=>new Response('{}',{status:429})),/过多/);
 await assert.rejects(analyzeInput(input,{AI_API_KEY:'test'},async()=>new Response('{}')),/格式/);
 await assert.rejects(analyzeInput(input,{AI_API_KEY:'test'},async()=>{throw new Error('private provider detail');}),/连接失败/);
});
