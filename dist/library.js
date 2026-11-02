import {validateMessages} from './core.js';
import {combineScreenshotBatches,boundaryOverlap} from './flow.js';
import {validateClientAnalysis} from './analysis-client.js';

export const LIBRARY_LIMITS={folders:20,folderEntries:100,records:100,messages:1500,pool:3000,total:500000,bytes:8000000};
export const isSampleChat=chat=>['late','tired','weekend'].includes(chat.id);
const libraryText=(value,max,fallback='')=>{if(value===undefined)return fallback;if(typeof value!=='string'||value.length>max)throw new Error('联系人资料格式不正确。');return value;};
const libraryTime=value=>{if(value===undefined)return 0;if(!Number.isSafeInteger(value)||value<0)throw new Error('记录时间格式不正确。');return value;};
const libraryId=value=>{if(typeof value!=='string'||!value||value.length>100)throw new Error('记录编号不正确。');return value;};
const libraryCanonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const legacyMessageId=(row,index)=>{let hash=2166136261;for(const char of row.role+'\n'+row.text){hash=Math.imul(hash^char.codePointAt(0),16777619);}return 'legacy-'+index+'-'+(hash>>>0).toString(36);};
export function normalizeContactMessages(rows,{archive=false}={}){
 if(!Array.isArray(rows)||rows.length>(archive?LIBRARY_LIMITS.pool:LIBRARY_LIMITS.messages))throw new Error('每位联系人最多保留 1500 条当前消息，请先导出并整理上下文。');
 const ids=new Set();let total=0;
 const messages=rows.map((row,index)=>{
  if(!row||!['me','partner'].includes(row.role)||typeof row.text!=='string'||!row.text.trim()||row.text.trim().length>2000)throw new Error(`第 ${index+1} 条消息格式不正确。`);
  const text=row.text.trim(),id=row.id===undefined?legacyMessageId({...row,text},index):libraryId(row.id);if(ids.has(id))throw new Error('消息编号重复，请重新导入。');ids.add(id);total+=text.length;
  return {id,role:row.role,text,createdAt:libraryTime(row.createdAt)};
 });
 if(total>LIBRARY_LIMITS.total)throw new Error('这位联系人的上下文已超过 50 万字，请先导出并整理。');return messages;
}
export function normalizeFolders(value=[]){
 if(!Array.isArray(value)||value.length>LIBRARY_LIMITS.folderEntries)throw new Error('文件夹记录数量不正确。');
 const ids=new Set();const folders=value.map(folder=>{if(!folder)throw new Error('文件夹格式不正确。');const id=libraryId(folder.id);if(ids.has(id))throw new Error('文件夹编号重复。');ids.add(id);const name=libraryText(folder.name,24).trim();if(!name)throw new Error('文件夹名称不能为空。');return {id,name,updatedAt:libraryTime(folder.updatedAt),deleted:folder.deleted===true};});
 if(folders.filter(folder=>!folder.deleted).length>LIBRARY_LIMITS.folders)throw new Error('最多创建 20 个文件夹。');return folders;
}
export function createLibraryFolder(folders,name,{now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const title=libraryText(name,24).trim();if(!title)throw new Error('请填写文件夹名称。');
 if(folders.some(folder=>!folder.deleted&&folder.name===title))throw new Error('已有同名文件夹。');
 return normalizeFolders([...folders,{id:newId(),name:title,updatedAt:now,deleted:false}]);
}
export function renameLibraryFolder(folders,id,name,now=Date.now()){
 const title=libraryText(name,24).trim();if(!title)throw new Error('请填写文件夹名称。');
 if(folders.some(folder=>folder.id!==id&&!folder.deleted&&folder.name===title))throw new Error('已有同名文件夹。');
 if(!folders.some(folder=>folder.id===id&&!folder.deleted))throw new Error('文件夹已变更，请重新打开。');
 return normalizeFolders(folders.map(folder=>folder.id===id?{...folder,name:title,updatedAt:Math.max(now,folder.updatedAt+1)}:folder));
}
export function normalizeContactMemory(chat){
 const messages=normalizeContactMessages(chat.messages),archive=normalizeContactMessages(chat.archive||[],{archive:true}),pool=new Map(messages.map(message=>[message.id,message]));
 for(const message of archive){const prior=pool.get(message.id);if(prior&&(prior.role!==message.role||prior.text!==message.text))throw new Error('历史消息与当前消息的编号冲突。');pool.set(message.id,message);}
 if(pool.size>LIBRARY_LIMITS.pool||[...pool.values()].reduce((sum,message)=>sum+message.text.length,0)>LIBRARY_LIMITS.total)throw new Error('联系人历史原文容量已满，请导出后整理分析记录。');
 const deletedAnalysisIds=chat.deletedAnalysisIds||[];if(!Array.isArray(deletedAnalysisIds)||deletedAnalysisIds.length>1000)throw new Error('分析删除记录格式不正确。');const deleted=[...new Set(deletedAnalysisIds.map(libraryId))];
 const ids=new Set(),source=chat.analyses||[];if(!Array.isArray(source)||source.length>LIBRARY_LIMITS.records)throw new Error('每位联系人最多保留 100 条分析记录，请先导出或删除部分记录。');
 const analyses=source.filter(record=>!deleted.includes(record?.id)).map(record=>{
  if(!record)throw new Error('分析记录格式不正确。');const id=libraryId(record.id);if(ids.has(id))throw new Error('分析记录编号重复。');ids.add(id);
  if(!Array.isArray(record.contextIds)||!record.contextIds.length||record.contextIds.length>300||new Set(record.contextIds).size!==record.contextIds.length)throw new Error('分析记录的原文引用不正确。');
  const contextIds=record.contextIds.map(libraryId),context=contextIds.map(id=>pool.get(id));if(context.some(message=>!message))throw new Error('分析记录引用的原文缺失，已停止覆盖。');
  const targetId=libraryId(record.targetId);if(contextIds.at(-1)!==targetId)throw new Error('分析目标与保存的前文不一致。');
  const result=structuredClone(record.result);if(!result||!['ai','local'].includes(result.mode))throw new Error('分析类型不正确。');validateClientAnalysis({...result,mode:'ai'},{messages:context,targetIndex:context.length-1});
  const drafts={};for(const tone of ['warm','honest','brief'])if(record.drafts?.[tone]!==undefined)drafts[tone]=libraryText(record.drafts[tone],2000);
  return {id,createdAt:libraryTime(record.createdAt),updatedAt:libraryTime(record.updatedAt??record.createdAt),targetId,contextIds,result,tone:['warm','honest','brief'].includes(record.tone)?record.tone:'warm',drafts,note:libraryText(record.note,2000),style:libraryText(record.style,1000)};
 }).sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
 return {conflictOf:chat.conflictOf==null?null:libraryId(chat.conflictOf),messages,archive:archive.filter(message=>!messages.some(current=>current.id===message.id)),analyses,deletedAnalysisIds:deleted,resumeId:ids.has(chat.resumeId)?chat.resumeId:null,resumeUpdatedAt:libraryTime(chat.resumeUpdatedAt),updatedAt:libraryTime(chat.updatedAt),profileUpdatedAt:libraryTime(chat.profileUpdatedAt),preferredToneUpdatedAt:libraryTime(chat.preferredToneUpdatedAt),composerUpdatedAt:libraryTime(chat.composerUpdatedAt??chat.updatedAt),folderId:chat.folderId==null?null:libraryId(chat.folderId),folderUpdatedAt:libraryTime(chat.folderUpdatedAt),composer:{text:libraryText(chat.composer?.text,2000),role:chat.composer?.role==='me'?'me':'partner'}};
}
export function touchContact(chat,now=Date.now()){chat.updatedAt=Math.max(now,(chat.updatedAt||0)+1);return chat;}
export function contextWindow(messages,index){
 if(!Number.isInteger(index)||index<0||index>=messages.length)throw new Error('请选择一条消息。');
 let start=index,total=0;
 while(start>=0&&index-start<300&&total+messages[start].text.length<=80000){total+=messages[start].text.length;start--;}
 start++;return {start,messages:messages.slice(start,index+1),targetIndex:index-start};
}
export function addContactMessage(messages,text,role='partner',{now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const value=String(text).trim(),last=messages.at(-1);if(last?.role===role&&last.text===value&&last.createdAt&&new Date(last.createdAt).toDateString()===new Date(now).toDateString())return {messages:normalizeContactMessages(messages),reused:true};
 return {messages:normalizeContactMessages([...messages,{id:newId(),createdAt:now,role,text:value}]),reused:false};
}
export function prepareContactImport(existing,rows,{append=true,removeOverlap=true,now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const batches=[];for(const row of rows){const batch=row.batch??0;if(!batches.length||batches.at(-1).id!==batch)batches.push({id:batch,rows:[]});batches.at(-1).rows.push(row);}
 const combined=combineScreenshotBatches(batches.map(batch=>batch.rows),removeOverlap),overlap=append?boundaryOverlap(existing,combined.messages):0;
 const incoming=combined.messages.slice(removeOverlap?overlap:0).map(message=>({...message,id:newId(),createdAt:now}));
 return {messages:normalizeContactMessages([...(append?existing:[]),...incoming]),removed:removeOverlap?overlap:0,screenshotOverlap:combined.overlapCount,totalOverlap:overlap+combined.overlapCount};
}
export function replaceContactMessages(chat,messages,now=Date.now()){
 const next=normalizeContactMessages(messages),pool=contactMessagePool(chat,{messages:next}),needed=new Set((chat.analyses||[]).flatMap(record=>record.contextIds)),currentIds=new Set(next.map(message=>message.id));
 const archive=[...pool.values()].filter(message=>needed.has(message.id)&&!currentIds.has(message.id));
 const memory=normalizeContactMemory({...chat,messages:next,archive,resumeId:null,resumeUpdatedAt:now,updatedAt:Math.max(now,(chat.updatedAt||0)+1)});
 Object.assign(chat,memory);return chat;
}
export function undoSentMessage(chat,expectedSnapshot,now=Date.now()){
 if(JSON.stringify(chat.messages)!==expectedSnapshot||chat.messages.at(-1)?.role!=='me')return false;
 replaceContactMessages(chat,chat.messages.slice(0,-1),now);return true;
}
export function contactMessagePool(...chats){
 const pool=new Map();for(const chat of chats)for(const message of [...(chat.archive||[]),...chat.messages]){const prior=pool.get(message.id);if(prior&&(prior.role!==message.role||prior.text!==message.text))throw new Error('同一原文编号对应不同内容，已停止合并。请先导出两边的资料库。');if(!prior||message.createdAt>prior.createdAt)pool.set(message.id,message);}return pool;
}
export function recordContext(chat,record){const pool=new Map([...(chat.archive||[]),...chat.messages].map(message=>[message.id,message]));return record.contextIds.map(id=>pool.get(id));}
export function saveAnalysisRecord(chat,context,result,{tone='warm',now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const key=libraryCanonical([context.messages.map(message=>message.id),result,chat.note||'',chat.style||'']);
 let record=(chat.analyses||[]).find(record=>libraryCanonical([record.contextIds,record.result,record.note,record.style])===key);
 if(!record){
  if((chat.analyses||[]).length>=LIBRARY_LIMITS.records)throw new Error('这位联系人的分析记录已满 100 条。请先导出或删除部分记录。');
  record={id:newId(),createdAt:now,updatedAt:now,targetId:context.messages.at(-1).id,contextIds:context.messages.map(message=>message.id),result:structuredClone(result),tone,drafts:{},note:chat.note||'',style:chat.style||''};
  if((chat.analyses||[]).some(prior=>prior.id===record.id)||(chat.deletedAnalysisIds||[]).includes(record.id))throw new Error('分析编号重复，请重试。');
  const memory=normalizeContactMemory({...chat,analyses:[record,...(chat.analyses||[])],resumeId:record.id,resumeUpdatedAt:now,updatedAt:Math.max(now,(chat.updatedAt||0)+1)});
  Object.assign(chat,memory);return chat.analyses.find(saved=>saved.id===record.id);
 }
 chat.resumeId=record.id;chat.resumeUpdatedAt=now;touchContact(chat,now);return record;
}
export function updateRecordDraft(chat,id,tone,drafts,now=Date.now()){
 const record=chat.analyses?.find(record=>record.id===id);if(!record)return;
 if(!['warm','honest','brief'].includes(tone))throw new Error('回复语气不正确。');
 const next={};for(const key of ['warm','honest','brief'])if(drafts[key]!==undefined)next[key]=libraryText(drafts[key],2000);
 if(record.tone===tone&&JSON.stringify(record.drafts)===JSON.stringify(next))return;
 record.tone=tone;record.drafts=next;record.updatedAt=Math.max(now,record.updatedAt+1);chat.resumeId=id;chat.resumeUpdatedAt=now;touchContact(chat,now);
}
export function setContactComposer(chat,composer,now=Date.now()){
 const next={text:libraryText(composer.text,2000),role:composer.role};if(!['me','partner'].includes(next.role))throw new Error('发送者不正确。');
 if(chat.composer?.text===next.text&&chat.composer?.role===next.role)return;
 chat.composer=next;chat.composerUpdatedAt=Math.max(now,(chat.composerUpdatedAt||0)+1);touchContact(chat,now);
}
export function setContactTone(chat,tone,now=Date.now()){
 if(!['warm','honest','brief'].includes(tone))throw new Error('回复语气不正确。');if(chat.preferredTone===tone)return;
 chat.preferredTone=tone;chat.preferredToneUpdatedAt=Math.max(now,(chat.preferredToneUpdatedAt||0)+1);touchContact(chat,now);
}
export function setContactProfile(chat,profile,now=Date.now()){
 const next={title:libraryText(profile.title,30).trim(),name:libraryText(profile.name,20).trim(),note:libraryText(profile.note,2000).trim(),style:libraryText(profile.style,1000).trim()};if(!next.title||!next.name)throw new Error('请填写联系人称呼和标题。');
 if(Object.keys(next).every(key=>chat[key]===next[key]))return;
 Object.assign(chat,next);chat.profileUpdatedAt=Math.max(now,(chat.profileUpdatedAt||0)+1);touchContact(chat,now);
}
export function deleteAnalysisRecord(chat,id,now=Date.now()){
 if(!(chat.analyses||[]).some(record=>record.id===id))return;
 const deletedAnalysisIds=[...new Set([...(chat.deletedAnalysisIds||[]),id])],analyses=chat.analyses.filter(record=>record.id!==id),needed=new Set(analyses.flatMap(record=>record.contextIds));
 const memory=normalizeContactMemory({...chat,deletedAnalysisIds,analyses,archive:(chat.archive||[]).filter(message=>needed.has(message.id)),resumeId:chat.resumeId===id?null:chat.resumeId,updatedAt:Math.max(now,(chat.updatedAt||0)+1)});Object.assign(chat,memory);
}
export function moveContact(chat,folderId,now=Date.now()){const id=folderId?libraryId(folderId):null;if(chat.folderId===id)return;chat.folderId=id;chat.folderUpdatedAt=Math.max(now,(chat.folderUpdatedAt||0)+1);touchContact(chat,now);}
export function mergeContactMemory(remote,local,messages){
 const deletedAnalysisIds=[...new Set([...(remote.deletedAnalysisIds||[]),...(local.deletedAnalysisIds||[])])],records=new Map();
 const identity=record=>libraryCanonical([record.createdAt,record.targetId,record.contextIds,record.result,record.note,record.style]);
 for(const record of [...remote.analyses,...local.analyses])if(!deletedAnalysisIds.includes(record.id)){const prior=records.get(record.id);if(prior&&identity(prior)!==identity(record))throw new Error('同一分析编号对应不同原文或结果，已停止合并。请先导出两边的资料库。');if(!prior||record.updatedAt>prior.updatedAt)records.set(record.id,record);}
 const pool=contactMessagePool(remote,local),needed=new Set([...records.values()].flatMap(record=>record.contextIds)),currentIds=new Set(messages.map(message=>message.id)),folder=(local.folderUpdatedAt>=remote.folderUpdatedAt?local:remote),resume=(local.resumeUpdatedAt>=remote.resumeUpdatedAt?local:remote),composer=(local.composerUpdatedAt>=remote.composerUpdatedAt?local:remote),tone=(local.preferredToneUpdatedAt>=remote.preferredToneUpdatedAt?local:remote),profile=(local.profileUpdatedAt>remote.profileUpdatedAt?local:remote);
 return {...remote,title:profile.title,name:profile.name,note:profile.note,style:profile.style,profileUpdatedAt:profile.profileUpdatedAt,preferredTone:tone.preferredTone,preferredToneUpdatedAt:tone.preferredToneUpdatedAt,messages,archive:[...pool.values()].filter(message=>needed.has(message.id)&&!currentIds.has(message.id)),analyses:[...records.values()],deletedAnalysisIds,resumeId:resume.resumeId,resumeUpdatedAt:resume.resumeUpdatedAt,updatedAt:Math.max(local.updatedAt,remote.updatedAt),folderId:folder.folderId,folderUpdatedAt:folder.folderUpdatedAt,composer:composer.composer,composerUpdatedAt:composer.composerUpdatedAt};
}
