import {recordContext,touchContact} from './library.js';
import {normalizeReplyOptions} from './reply-options.js';

// Settings may await a backup merge; keep only the editor view, never credentials or workspace data.
export function captureAnalysisView(state){
 const chat=state.chats.find(chat=>chat.id===state.active);
 if(!chat||!state.analysis)return null;
 const record=chat.analyses.find(record=>record.id===state.activeRecord),view={};
 for(const key of ['analysis','activeRecord','selected','tone','replyDrafts','analysisTarget','analysisMessages','analysisContextStart','analysisContextCount','analysisContextInfo','analysisRelationshipContext','replyForm','mobileSheet'])view[key]=structuredClone(state[key]);
 return {chatId:chat.id,recordId:record?.id||null,contextIds:record?.contextIds.slice()||null,transcript:JSON.stringify(chat.messages),view};
}
export function restoreAnalysisView(state,snapshot,now=Date.now()){
 if(!snapshot||snapshot.chatId!==state.active)return false;
 const chat=state.chats.find(chat=>chat.id===state.active);if(!chat)return false;
 if(snapshot.recordId){
  const record=chat.analyses.find(record=>record.id===snapshot.recordId);
  if(!record||JSON.stringify(record.contextIds)!==JSON.stringify(snapshot.contextIds))return false;
  const context=recordContext(chat,record);if(context.some(message=>!message))return false;
  const selected=chat.messages.findIndex(message=>message.id===record.targetId);
  Object.assign(state,{analysis:record.result,activeRecord:record.id,selected:selected<0?null:selected,tone:record.tone,replyDrafts:{...record.drafts},analysisTarget:context.at(-1),analysisMessages:context,analysisContextStart:0,analysisContextCount:context.length,analysisContextInfo:record.contextInfo||null,analysisRelationshipContext:record.relationshipContext||null,replyForm:normalizeReplyOptions(snapshot.view.replyForm),mobileSheet:!!snapshot.view.mobileSheet});
  if(chat.resumeId!==record.id){chat.resumeId=record.id;chat.resumeUpdatedAt=Math.max(now,(chat.resumeUpdatedAt||0)+1);touchContact(chat,now);}
 }else{
  if(JSON.stringify(chat.messages)!==snapshot.transcript)return false;
  Object.assign(state,structuredClone(snapshot.view));
 }
 state.loading=false;state.analysisError='';return true;
}

export function reopenAnalysisView(state,chatId,recordId){
 if(state.loading||state.active!==chatId||state.activeRecord!==recordId||!state.analysis)return false;
 const snapshot=captureAnalysisView(state);
 if(snapshot?.recordId!==recordId||!restoreAnalysisView(state,snapshot))return false;
 state.page='chat';state.mobileSheet=true;return true;
}
