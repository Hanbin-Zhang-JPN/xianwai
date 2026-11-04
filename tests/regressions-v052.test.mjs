import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMessageGesture} from '../dist/message-gesture.js';
import {createConnectionMonitor} from '../dist/connection-monitor.js';
import {captureAnalysisView,restoreAnalysisView,reopenAnalysisView} from '../dist/analysis-view.js';
import {mergeWorkspaces,normalizeWorkspace} from '../dist/workspace.js';
import {contextWindow,saveAnalysisRecord,updateRecordDraft} from '../dist/library.js';
import {localAnalysis} from '../dist/core.js';

function gestures(){let time=0,next=0;const scheduled=new Map();const gesture=createMessageGesture({now:()=>time,schedule:(callback,ms)=>{const id=++next;scheduled.set(id,{callback,at:time+ms});return id;},unschedule:id=>scheduled.delete(id)});return {gesture,advance:ms=>{time+=ms;for(const [id,task] of [...scheduled])if(task.at<=time){scheduled.delete(id);task.callback();}},callback:()=>[...scheduled.values()][0]?.callback};}
test('a long press activates once across a render and its context-menu and release click are suppressed',()=>{
 const {gesture,advance}=gestures();let calls=0,originalConnected=true;gesture.start('person/message',()=>originalConnected,()=>{calls++;originalConnected=false;});advance(450);
 assert.equal(calls,1);assert.equal(gesture.suppresses('person/message'),true);assert.equal(gesture.activate('person/message',()=>true,()=>calls++),false);assert.equal(calls,1);assert.equal(gesture.suppresses('another/message'),false);
});
test('a delayed long press cannot analyze the same message index after switching contacts or replacing the DOM',()=>{
 const {gesture,advance}=gestures();let calls=0,currentPerson='first',connected=true;gesture.start('first/0',()=>connected&&currentPerson==='first',()=>calls++);connected=false;currentPerson='second';advance(450);assert.equal(calls,0);
});
test('scroll cancellation and an early context menu both neutralize late timer callbacks',()=>{
 const {gesture,advance,callback}=gestures();let calls=0;gesture.start('a',()=>true,()=>calls++);const late=callback();gesture.cancel();late();assert.equal(calls,0);
 gesture.start('a',()=>true,()=>calls++);assert.equal(gesture.activate('a',()=>true,()=>calls++),true);advance(450);assert.equal(calls,1);
});
test('a new deliberate press can select the same message again without retaining old click suppression',()=>{
 const {gesture,advance}=gestures();gesture.start('a',()=>true,()=>{});advance(450);assert.equal(gesture.suppresses('a'),true);gesture.start('a',()=>true,()=>{});gesture.cancel();assert.equal(gesture.suppresses('a'),false);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('an invalidated old heartbeat cannot mark a newly connecting session as ready',async()=>{
 const work=deferred(),statuses=[],failures=[];let signal;const monitor=createConnectionMonitor({current:()=>({endpoint:'https://fake.invalid',token:'same'}),probe:(_,s)=>{signal=s;return work.promise;},onStatus:value=>statuses.push(value),onFailure:error=>failures.push(error)});
 const checking=monitor.check();monitor.invalidate();assert.equal(signal.aborted,true);work.resolve({ready:true});assert.equal(await checking,false);assert.deepEqual(statuses,[]);assert.deepEqual(failures,[]);
});
test('a late failed heartbeat does not clear a newer in-flight check or change its connected state',async()=>{
 const old=deferred(),fresh=deferred(),statuses=[],failures=[];let calls=0;const monitor=createConnectionMonitor({current:()=>({endpoint:'https://fake.invalid',token:'same'}),probe:()=>++calls===1?old.promise:fresh.promise,onStatus:value=>statuses.push(value),onFailure:error=>failures.push(error)});
 const first=monitor.check();monitor.invalidate();const second=monitor.check();old.reject(new Error('late failure'));await first;assert.equal(await monitor.check(),false);assert.equal(calls,2);fresh.resolve({ready:true});assert.equal(await second,true);assert.deepEqual(statuses,[{ready:true}]);assert.deepEqual(failures,[]);
});
test('changed credentials or a suspended connection drop a response even without explicit invalidation',async()=>{
 for(const next of [null,{endpoint:'https://fake.invalid',token:'new'}]){let pair={endpoint:'https://fake.invalid',token:'old'};const work=deferred(),monitor=createConnectionMonitor({current:()=>pair,probe:()=>work.promise,onStatus:()=>assert.fail('stale result'),onFailure:()=>assert.fail('stale failure')});const checking=monitor.check();pair=next;work.resolve({ready:true});assert.equal(await checking,false);}
});
test('heartbeats skip unavailable sessions, deduplicate concurrent checks and can retry after a real failure',async()=>{
 let pair=null,calls=0,errors=0;const work=deferred(),monitor=createConnectionMonitor({current:()=>pair,probe:()=>++calls===1?work.promise:Promise.resolve({ready:false}),onStatus:()=>{},onFailure:()=>errors++});assert.equal(await monitor.check(),false);pair={endpoint:'',token:'fake'};const first=monitor.check();assert.equal(await monitor.check(),false);work.reject(new Error('offline'));assert.equal(await first,false);assert.equal(errors,1);assert.equal(await monitor.check(),true);assert.equal(calls,2);
});
test('a reconnect restores the latest in-progress form and newly edited draft after merging an older backup',()=>{
 const phone=normalizeWorkspace({active:'person',activeUpdatedAt:100,chats:[{id:'person',name:'小满',title:'虚构',messages:[{id:'m',role:'partner',text:'你几点回家？'}]},{id:'other',name:'家人',title:'另一位联系人',messages:[]}],favorites:[]}),chat=phone.chats[0],context=contextWindow(chat.messages,0),record=saveAnalysisRecord(chat,context,localAnalysis(context.messages,0),{newId:()=> 'record',now:100});const mac=structuredClone(phone);mac.active='other';mac.activeUpdatedAt=200;
 const state={...phone,analysis:record.result,activeRecord:record.id,replyDrafts:{},replyForm:{goal:'clarify',context:'重连开始前'},tone:'brief',mobileSheet:true};
 const retained=captureAnalysisView(state);state.analysis=null;assert.equal(restoreAnalysisView(state,retained),true);state.replyForm.context='重连等待期间继续输入的情况';state.activeUpdatedAt=300;updateRecordDraft(chat,record.id,'brief',{brief:'等待时也改了这句回复'},300);
 const latest=captureAnalysisView(state),merged=mergeWorkspaces(mac,state).workspace;Object.assign(state,merged);assert.equal(restoreAnalysisView(state,latest),true);assert.equal(state.active,'person');assert.equal(state.replyForm.context,'重连等待期间继续输入的情况');assert.equal(state.replyDrafts.brief,'等待时也改了这句回复');assert.equal(state.mobileSheet,true);
});
test('reopening the current mobile analysis preserves unsent facts and edits but never reuses another or missing record',()=>{
 const workspace=normalizeWorkspace({active:'person',chats:[{id:'person',name:'小满',title:'虚构',messages:[{id:'m',role:'partner',text:'你几点回家？'}]}],favorites:[]}),chat=workspace.chats[0],context=contextWindow(chat.messages,0),record=saveAnalysisRecord(chat,context,localAnalysis(context.messages,0),{newId:()=> 'record',now:100});
 updateRecordDraft(chat,record.id,'brief',{brief:'九点半到家。'},200);
 const state={...workspace,analysis:record.result,activeRecord:record.id,tone:'brief',replyDrafts:{brief:'九点半到家。'},replyForm:{goal:'clarify',context:'还在开会，尚未提交。'},mobileSheet:false,page:'history'};
 assert.equal(reopenAnalysisView(state,'person','record'),true);assert.equal(state.mobileSheet,true);assert.equal(state.page,'chat');assert.equal(state.replyForm.context,'还在开会，尚未提交。');assert.equal(state.replyDrafts.brief,'九点半到家。');
 state.mobileSheet=false;assert.equal(reopenAnalysisView(state,'other','record'),false);assert.equal(state.mobileSheet,false);state.loading=true;assert.equal(reopenAnalysisView(state,'person','record'),false);state.loading=false;chat.analyses=[];assert.equal(reopenAnalysisView(state,'person','record'),false);
});
