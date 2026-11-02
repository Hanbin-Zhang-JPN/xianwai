import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundaryOverlap,combineScreenshotBatches,prepareImport,addQuickMessage,replyForTone,latestPartnerIndex} from '../dist/flow.js';

const a={role:'partner',text:'今天几点回家吃饭？'},b={role:'me',text:'我可能需要晚一点到。'},c={role:'partner',text:'那我先等你一会儿。'};
test('screenshot overlap removes only a substantial exact boundary',()=>{
 assert.equal(boundaryOverlap([a,b],[a,b,c]),2);
 assert.deepEqual(combineScreenshotBatches([[a,b],[a,b,c]]).messages,[a,b,c]);
 assert.equal(boundaryOverlap([a],[a]),0);
 assert.equal(boundaryOverlap([{role:'me',text:'好'},{role:'partner',text:'嗯'}],[{role:'me',text:'好'},{role:'partner',text:'嗯'}]),0);
 assert.equal(boundaryOverlap([a,b],[{...a,role:'me'},b]),0);
 assert.deepEqual(combineScreenshotBatches([[a,a,b]]).messages,[a,a,b]);
});
test('review edits and the keep-duplicates choice are respected',()=>{
 const rows=[{...a,batch:0},{...b,batch:0},{...a,batch:1},{...b,batch:1},{...c,batch:1}];
 assert.equal(prepareImport([],rows,{append:false}).messages.length,3);
 assert.equal(prepareImport([],rows,{append:false,removeOverlap:false}).messages.length,5);
 rows[2].text='今天几点回家吃饭？我刚修改了';
 assert.equal(prepareImport([],rows,{append:false}).messages.length,5);
 const plan=prepareImport([a,b],[a,b,c],{append:true});
 assert.equal(plan.removed,2);assert.deepEqual(plan.messages,[a,b,c]);
});
test('quick reply does not duplicate the latest pasted message or trim valid punctuation',()=>{
 const first=addQuickMessage([a,b],' 那我先等你一会儿。 ');
 assert.deepEqual(first.messages,[a,b,c]);assert.equal(first.reused,false);
 assert.equal(addQuickMessage(first.messages,c.text).reused,true);
 assert.throws(()=>addQuickMessage([a],''));
 assert.equal(latestPartnerIndex([a,b,c]),2);assert.equal(latestPartnerIndex([b]),-1);
});
test('all tone variants can be selected from a single analysis result',()=>{
 const analysis={replies:[{tone:'warm',text:'我在，慢慢说。'},{tone:'honest',text:'我想听清楚你的意思。'},{tone:'brief',text:'我在听。'}]};
 assert.equal(replyForTone(analysis,'brief').text,'我在听。');
 assert.equal(replyForTone(analysis,'warm').text,'我在，慢慢说。');
});

test('undo cannot remove a replacement transcript with the same message count',async()=>{
 const {canUndoRecord}=await import('../dist/flow.js');
 const chat={id:'test',messages:[a,b]},record={chatId:'test',snapshot:JSON.stringify([a,b])};
 assert.equal(canUndoRecord(record,chat),true);
 assert.equal(canUndoRecord(record,{...chat,messages:[a,c]}),false);
 assert.equal(canUndoRecord(record,{...chat,id:'another'}),false);
});
