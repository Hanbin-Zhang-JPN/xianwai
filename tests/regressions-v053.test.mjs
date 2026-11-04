import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readTranscriptFile} from '../dist/file-import.js';
import {bindWorkspaceLifecycle,createWorkspaceSync} from '../dist/workspace-sync.js';
import {normalizeWorkspace} from '../dist/workspace.js';
import {contextWindow,saveAnalysisRecord,updateRecordDraft,setContactComposer} from '../dist/library.js';
import {localAnalysis} from '../dist/core.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fileRead(){const work=deferred(),file={size:12,text:()=>work.promise},input={value:'原导入内容',connected:true};let selected=file,person='one';const errors=[];return {work,file,input,errors,select:value=>selected=value,switchPerson:()=>person='two',read:()=>readTranscriptFile(file,{isCurrent:()=>input.connected&&person==='one'&&selected===file&&input.value==='原导入内容',accept:text=>input.value=text,failed:error=>errors.push(error)})};}
test('a delayed file read never overwrites text edited while the file was loading',async()=>{
 const h=fileRead(),reading=h.read();h.input.value='手动改好的新消息';h.work.resolve('旧文件文字');assert.equal(await reading,false);assert.equal(h.input.value,'手动改好的新消息');assert.deepEqual(h.errors,[]);
});
test('closing the dialog, switching contacts, or choosing a new file makes late successes and failures inert',async()=>{
 for(const change of [h=>h.input.connected=false,h=>h.switchPerson(),h=>h.select({})])for(const failed of [false,true]){const h=fileRead(),reading=h.read();change(h);if(failed)h.work.reject(new Error('late failure'));else h.work.resolve('旧文件文字');assert.equal(await reading,false);assert.equal(h.input.value,'原导入内容');assert.deepEqual(h.errors,[]);}
});
test('a valid file preserves multiline Chinese text and is applied once',async()=>{
 const h=fileRead(),reading=h.read(),text='我：几点出发？\n对方：下午两点。🙂';h.work.resolve(text);assert.equal(await reading,true);assert.equal(h.input.value,text);assert.deepEqual(h.errors,[]);
});
test('file failures and oversized files preserve the current input and report only the current error',async()=>{
 const h=fileRead(),reading=h.read();h.work.reject(new Error('disk error'));assert.equal(await reading,false);assert.equal(h.input.value,'原导入内容');assert.match(h.errors[0],/无法读取/);
 let reads=0;const errors=[];assert.equal(await readTranscriptFile({size:8000001,text:()=>reads++},{isCurrent:()=>true,accept:()=>assert.fail('oversized import'),failed:error=>errors.push(error)}),false);assert.equal(reads,0);assert.match(errors[0],/8 MB/);
});
function lifecycle(){
 const documentTarget=new EventTarget(),windowTarget=new EventTarget(),posted=[];documentTarget.hidden=false;
 const workspace=normalizeWorkspace({active:'one',chats:[{id:'one',title:'虚构',name:'小满',messages:[{id:'m',role:'partner',text:'你几点回家？'}]}],favorites:[]}),chat=workspace.chats[0],context=contextWindow(chat.messages,0),record=saveAnalysisRecord(chat,context,localAnalysis(context.messages,0),{newId:()=> 'r',now:100});
 const sync=createWorkspaceSync({delay:60000,fetcher:async(_,options)=>{posted.push(JSON.parse(options.body));return new Response(JSON.stringify({revision:posted.length}));}});sync.connect({endpoint:'https://fixture.invalid',token:'fake',revision:0});sync.schedule(workspace);
 let saves=0,resumes=0;const unbind=bindWorkspaceLifecycle({documentTarget,windowTarget,save:()=>{saves++;sync.schedule(workspace);},flush:()=>sync.flush(),resume:()=>resumes++});
 return {documentTarget,windowTarget,workspace,chat,record,sync,posted,unbind,counts:()=>({saves,resumes})};
}
test('leaving the page submits the final composer and edited analysis even before either debounce fires',async t=>{
 const h=lifecycle();t.after(()=>{h.unbind();h.sync.disconnect();});setContactComposer(h.chat,{text:'离开前最后输入',role:'partner'},200);updateRecordDraft(h.chat,h.record.id,'brief',{brief:'九点半到家。'},200);
 h.windowTarget.dispatchEvent(new Event('pagehide'));await h.sync.flush();assert.equal(h.posted.length,1);assert.equal(h.posted[0].chats[0].composer.text,'离开前最后输入');assert.equal(h.posted[0].chats[0].analyses[0].drafts.brief,'九点半到家。');assert.equal(h.posted[0].baseRevision,0);
});
test('entering the background saves before flushing, and returning only checks the connection',async t=>{
 const h=lifecycle();t.after(()=>{h.unbind();h.sync.disconnect();});setContactComposer(h.chat,{text:'锁屏前的输入',role:'me'},200);h.documentTarget.hidden=true;h.documentTarget.dispatchEvent(new Event('visibilitychange'));await h.sync.flush();assert.equal(h.posted[0].chats[0].composer.text,'锁屏前的输入');assert.deepEqual(h.counts(),{saves:1,resumes:0});
 h.documentTarget.hidden=false;h.documentTarget.dispatchEvent(new Event('visibilitychange'));assert.deepEqual(h.counts(),{saves:1,resumes:1});assert.equal(h.posted.length,1);
});
test('returning from the browser page cache checks the connection without rewriting saved input',()=>{
 const h=lifecycle();h.windowTarget.dispatchEvent(new Event('pageshow'));assert.deepEqual(h.counts(),{saves:0,resumes:1});h.documentTarget.hidden=true;h.windowTarget.dispatchEvent(new Event('pageshow'));assert.deepEqual(h.counts(),{saves:0,resumes:1});h.unbind();h.sync.disconnect();
});
