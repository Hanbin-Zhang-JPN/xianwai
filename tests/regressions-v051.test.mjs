import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {needsReplyDetails,replyCopyProblem} from '../dist/reply-options.js';
import {captureAnalysisView,restoreAnalysisView} from '../dist/analysis-view.js';
import {normalizeWorkspace} from '../dist/workspace.js';
import {contextWindow,saveAnalysisRecord,updateRecordDraft,replaceContactMessages,deleteAnalysisRecord} from '../dist/library.js';
import {localAnalysis} from '../dist/core.js';

const editor=()=>{
 const workspace=normalizeWorkspace({active:'person',chats:[{id:'person',name:'小满',title:'虚构',messages:[{id:'target',role:'partner',text:'你几点回家？'}]}],favorites:[]}),chat=workspace.chats[0],context=contextWindow(chat.messages,0),result=localAnalysis(context.messages,0);
 const record=saveAnalysisRecord(chat,context,result,{newId:()=> 'record',tone:'brief',now:100});updateRecordDraft(chat,record.id,'brief',{brief:'我预计九点到家。'},200);
 return {...workspace,analysis:result,activeRecord:record.id,selected:0,tone:'brief',replyDrafts:{...record.drafts},replyForm:{goal:'clarify',context:'新的实际情况，还没点击起草。'},mobileSheet:true,loading:false,live:true,endpoint:'https://old.invalid',token:'old',persist:true};
};
test('partially edited missing-fact markers remain blocked until they are fully replaced',()=>{
 for(const text of ['预计【待补充：时间','预计待补充：时间】','【待补充】','【 待补充:时间】','待补充：时间']){assert.equal(needsReplyDetails(text),true);assert.ok(replyCopyProblem(text));}
 for(const text of ['我预计九点到家。','【笑】看到了。','补充一下，今天我有空。'])assert.equal(replyCopyProblem(text),'');
});
test('an empty draft cannot overwrite the clipboard with blank content',()=>{
 for(const text of ['', ' \n ',undefined,null])assert.ok(replyCopyProblem(text));assert.equal(needsReplyDetails(''),false);
});
test('saving settings preserves the visible analysis, edited reply and unsent intent without restoring old credentials',()=>{
 const state=editor(),snapshot=captureAnalysisView(state);Object.assign(state,{analysis:null,activeRecord:null,replyDrafts:{},replyForm:{goal:'auto',context:''},live:false,persist:false,token:'new',endpoint:'https://new.invalid'});
 assert.equal(restoreAnalysisView(state,snapshot),true);assert.equal(state.activeRecord,'record');assert.equal(state.replyDrafts.brief,'我预计九点到家。');assert.equal(state.replyForm.context,'新的实际情况，还没点击起草。');assert.equal(state.mobileSheet,true);
 assert.equal(state.live,false);assert.equal(state.persist,false);assert.equal(state.token,'new');assert.equal(state.endpoint,'https://new.invalid');
});
test('editor restoration uses a newer merged draft instead of a stale captured copy',()=>{
 const state=editor(),snapshot=captureAnalysisView(state);updateRecordDraft(state.chats[0],'record','brief',{brief:'另一台设备更新后的草稿。'},300);
 assert.equal(restoreAnalysisView(state,snapshot),true);assert.equal(state.replyDrafts.brief,'另一台设备更新后的草稿。');
});
test('a deleted record or switched contact cannot be resurrected by settings restoration',()=>{
 const state=editor(),snapshot=captureAnalysisView(state);deleteAnalysisRecord(state.chats[0],'record',300);state.analysis=null;assert.equal(restoreAnalysisView(state,snapshot),false);assert.equal(state.analysis,null);
 const other=editor();other.active='another';assert.equal(restoreAnalysisView(other,snapshot),false);
});
test('an archived analysis restores against its saved original while unsaved previews require an unchanged transcript',()=>{
 const state=editor(),snapshot=captureAnalysisView(state);replaceContactMessages(state.chats[0],[{id:'new',role:'partner',text:'第二天的消息'}]);assert.equal(restoreAnalysisView(state,snapshot),true);assert.equal(state.selected,null);assert.equal(state.analysisTarget.text,'你几点回家？');assert.equal(state.analysisMessages.length,1);
 const preview=editor();preview.activeRecord=null;const temporary=captureAnalysisView(preview);assert.equal(restoreAnalysisView(preview,temporary),true);preview.chats[0].messages.push({id:'later',role:'me',text:'新消息'});assert.equal(restoreAnalysisView(preview,temporary),false);
});

test('runtime shutdown waits for analysis and OCR workers to die and removes their temporary files',{timeout:10000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'xianwai-051-shutdown-')),analysisInfo=path.join(dir,'analysis.json'),ocrInfo=path.join(dir,'ocr.json'),fake=path.join(dir,'codex.mjs'),ocr=path.join(dir,'ocr.mjs');let child,analysisWorker,ocrWorker;
 const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
 t.after(async()=>{
  if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  for(const worker of [analysisWorker,ocrWorker])if(worker?.pid&&alive(worker.pid))process.kill(worker.pid,'SIGKILL');
  if(analysisWorker?.cwd.startsWith(path.join(os.tmpdir(),'xianwai-inference-')))await rm(analysisWorker.cwd,{recursive:true,force:true});
  if(ocrWorker?.file&&path.dirname(ocrWorker.file).startsWith(path.join(os.tmpdir(),'xianwai-ocr-')))await rm(path.dirname(ocrWorker.file),{recursive:true,force:true});
  await rm(dir,{recursive:true,force:true});
 });
 const code=file=>'#!'+process.execPath+'\nimport {writeFileSync} from "node:fs";if(process.argv[2]==="login"){console.log("Logged in");}else{writeFileSync('+JSON.stringify(file)+',JSON.stringify({pid:process.pid,cwd:process.cwd(),file:process.argv[2]}));process.on("SIGTERM",()=>{});process.stdin.resume();setInterval(()=>{},1000);}';
 await writeFile(fake,code(analysisInfo),{mode:0o700});await writeFile(ocr,code(ocrInfo),{mode:0o700});
 const token='test-only-shutdown-token-0000000000000000';child=spawn(process.execPath,['desktop/runtime-server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,XIANWAI_TOKEN:token,XIANWAI_PORT:'0',XIANWAI_DATA_DIR:dir,CODEX_BIN:fake,XIANWAI_OCR:ocr},stdio:['ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.once('close',resolve));
 const ready=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(new Error('runtime startup timeout')),5000);child.stdout.on('data',data=>{buffer+=data;for(const line of buffer.split('\n')){try{const value=JSON.parse(line);if(value.event==='ready'){clearTimeout(timer);resolve(value);}}catch{}}});child.once('error',reject);});
 const url='http://127.0.0.1:'+ready.port,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const started=await fetch(url+'/api/analyze',{method:'POST',headers,body:JSON.stringify({messages:[{role:'partner',text:'虚构测试'}],targetIndex:0,tone:'warm',note:''})});assert.equal(started.status,202);
 const recognition=fetch(url+'/api/ocr',{method:'POST',headers,body:JSON.stringify({dataUrl:'data:image/png;base64,AA=='})}).then(response=>response.arrayBuffer(),()=>null);
 const waitForFile=async file=>{for(let i=0;i<100;i++){try{return JSON.parse(await readFile(file,'utf8'));}catch{await new Promise(resolve=>setTimeout(resolve,10));}}throw new Error('worker startup timeout');};
 [analysisWorker,ocrWorker]=await Promise.all([waitForFile(analysisInfo),waitForFile(ocrInfo)]);child.kill('SIGTERM');assert.equal(await closed,0);await recognition;
 assert.equal(alive(analysisWorker.pid),false);assert.equal(alive(ocrWorker.pid),false);await assert.rejects(access(analysisWorker.cwd));await assert.rejects(access(path.dirname(ocrWorker.file)));
});
