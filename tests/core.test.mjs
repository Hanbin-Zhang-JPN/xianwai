import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTranscript,validateMessages,contextFor,localAnalysis} from '../dist/core.js';
test('text import preserves speakers, punctuation, emoji and indented continuation',()=>{
 const rows=parseTranscript('我：今天开会。\r\n对方: 好呀🙂\n  等你下班\n不带前缀的一句');
 assert.deepEqual(rows.map(m=>[m.role,m.text]),[['me','今天开会。'],['partner','好呀🙂\n等你下班'],['partner','不带前缀的一句']]);
 assert.equal(rows[2].uncertain,true);assert.equal(rows[1].uncertain,false);
});
test('JSON roundtrip and invalid imports are handled without truncation',()=>{
 const rows=[{role:'me',text:'保留 <script> 和标点：123.45'}];assert.deepEqual(parseTranscript(JSON.stringify(rows)),rows);
 for(const raw of ['','[broken','我：'])assert.throws(()=>parseTranscript(raw));
 assert.throws(()=>validateMessages(Array.from({length:301},()=>({role:'me',text:'一'}))),/300/);
 assert.throws(()=>validateMessages([{role:'other',text:'错'}]));
 assert.throws(()=>validateMessages([{role:'me',text:'字'.repeat(2001)}]),/2,000/);
 assert.throws(()=>validateMessages(Array.from({length:41},()=>({role:'partner',text:'字'.repeat(2000)}))),/80,000/);
});
test('a reply uses all preceding messages and excludes later messages',()=>{
 const rows=Array.from({length:300},(_,i)=>({role:i%2?'me':'partner',text:String(i)}));
 const context=contextFor(rows,199);assert.equal(context.length,200);assert.equal(context[0].id,1);assert.equal(context.at(-1).text,'199');assert.throws(()=>contextFor(rows,300));
});
test('local mode identifies uncertainty, changes tone and handles own messages',()=>{
 const rows=[{role:'me',text:'我晚一点到'},{role:'partner',text:'算了，你忙吧。'}];
 const warm=localAnalysis(rows,1,'warm'),brief=localAnalysis(rows,1,'brief');assert.equal(warm.mode,'local');assert.match(warm.hypotheses[1].text,/也可能/);assert.notDeepEqual(warm.replies,brief.replies);assert.equal(warm.contextCount,2);assert.match(localAnalysis(rows,0).feeling,/不能/);
});
test('explicit boundaries and safety signals take precedence over ordinary advice',()=>{
 assert.match(localAnalysis([{role:'partner',text:'不要再联系我了'}],0).title,/边界/);
 assert.match(localAnalysis([{role:'partner',text:'我不想活了'}],0).title,/安全/);
 assert.match(localAnalysis([{role:'partner',text:'今天买了两杯咖啡'}],0).feeling,/没有足够/);
});
