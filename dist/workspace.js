import {LIBRARY_LIMITS,normalizeFolders,normalizeContactMemory,mergeContactMemory,currentMessageCandidates} from './library.js';

const bounded=(value,max,name,fallback)=>{
 if(value===undefined&&fallback!==undefined)return fallback;
 if(typeof value!=='string'||value.length>max)throw new Error(`${name}格式不正确。`);
 return value;
};
export function normalizeWorkspace(value){
 if(value?.schemaVersion!==undefined&&![1,2,3,4,5,6,7].includes(value.schemaVersion))throw new Error('资料库版本较新或格式不正确，请更新应用，已停止覆盖。');
 if(!value||!Array.isArray(value.chats)||value.chats.length>15||!Array.isArray(value.favorites)||value.favorites.length>300)throw new Error('聊天备份格式或数量不正确，已停止覆盖。');
 const folders=normalizeFolders(value.folders),activeFolders=new Set(folders.filter(folder=>!folder.deleted).map(folder=>folder.id));
 const deletedFavoriteIds=value.deletedFavoriteIds||[];if(!Array.isArray(deletedFavoriteIds)||deletedFavoriteIds.length>1000||deletedFavoriteIds.some(id=>typeof id!=='string'||!id||id.length>100))throw new Error('收藏删除记录格式或数量不正确。');
 const deletedFavorites=[...new Set(deletedFavoriteIds)];
 const ids=new Set(),favoriteIds=new Set();
 const chats=value.chats.map(chat=>{
  if(!chat||!Array.isArray(chat.messages))throw new Error('聊天备份中的消息格式不正确。');
  const id=bounded(chat.id,100,'对话编号');if(!id||ids.has(id))throw new Error('聊天备份包含重复或空的对话编号。');ids.add(id);
  return {id,title:bounded(chat.title,30,'标题'),name:bounded(chat.name,20,'称呼'),note:bounded(chat.note,2000,'关系背景',''),style:bounded(chat.style,1000,'说话习惯',''),preferredTone:['warm','honest','brief'].includes(chat.preferredTone)?chat.preferredTone:'warm',subtitle:bounded(chat.subtitle,100,'对话说明',''),...normalizeContactMemory(chat)};
 });
 for(const chat of chats)if(chat.folderId&&!activeFolders.has(chat.folderId))chat.folderId=null;
 const favorites=value.favorites.filter(item=>!deletedFavorites.includes(item?.id)).map(item=>{
  if(!item)throw new Error('收藏备份格式不正确。');
  const id=bounded(item.id,100,'收藏编号');if(!id||favoriteIds.has(id))throw new Error('收藏备份包含重复或空的编号。');favoriteIds.add(id);
  return {id,text:bounded(item.text,2000,'收藏文字'),label:bounded(item.label,100,'收藏语气',''),name:bounded(item.name,100,'收藏称呼',''),source:bounded(item.source,100,'收藏来源','')};
 });
 const activeUpdatedAt=value.activeUpdatedAt??0;if(!Number.isSafeInteger(activeUpdatedAt)||activeUpdatedAt<0)throw new Error('联系人进度时间不正确。');
 const workspace={schemaVersion:7,active:ids.has(value.active)?value.active:chats[0]?.id||null,activeUpdatedAt,chats,favorites,folders,deletedFavoriteIds:deletedFavorites};
 if(new TextEncoder().encode(JSON.stringify(workspace)).length>LIBRARY_LIMITS.bytes)throw new Error('资料库已超过 32 MB，请先导出并整理分析记录，原数据未被覆盖。');return workspace;
}

export function mergeWorkspaces(remote,local,{newId=()=>crypto.randomUUID()}={}){
 const device=normalizeWorkspace(local);
 if(!remote)return {workspace:device,conflictCopies:0};
 const mac=normalizeWorkspace(remote),chats=new Map(mac.chats.map(c=>[c.id,c])),favorites=new Map(mac.favorites.map(f=>[f.id,f]));
 const folders=new Map(mac.folders.map(folder=>[folder.id,folder]));for(const folder of device.folders){const prior=folders.get(folder.id);if(!prior||folder.updatedAt>prior.updatedAt||(folder.updatedAt===prior.updatedAt&&folder.deleted))folders.set(folder.id,folder);}
 const deletedFavoriteIds=[...new Set([...mac.deletedFavoriteIds,...device.deletedFavoriteIds])];
 let copies=0,active=device.active;
 for(const chat of device.chats){
  const placeholder=!chat.messages.length&&!chat.analyses.length&&!chat.composer.text&&!chat.note&&!chat.style&&chat.title==='我的聊天'&&chat.name==='对方'&&chat.subtitle==='常用对话';
  if(placeholder&&mac.chats.length){if(active===chat.id)active=null;continue;}
  const prior=chats.get(chat.id);
  if(!prior){chats.set(chat.id,chat);continue;}
  if(JSON.stringify(prior)===JSON.stringify(chat))continue;
  const sameProfile=['title','name','note','style','subtitle'].every(key=>prior[key]===chat[key]);
  const prefix=(shorter,longer)=>shorter.length<=longer.length&&shorter.every((message,index)=>message.role===longer[index].role&&message.text===longer[index].text);
  const knownProfileEdit=prior.profileUpdatedAt!==chat.profileUpdatedAt&&(prior.profileUpdatedAt>0||chat.profileUpdatedAt>0);
  const candidates=currentMessageCandidates(prior,chat);
  if((sameProfile||knownProfileEdit)&&(prefix(candidates.remote,candidates.local)||prefix(candidates.local,candidates.remote))){
   chats.set(chat.id,mergeContactMemory(prior,chat,candidates.remote.length>=candidates.local.length?candidates.remote:candidates.local));continue;
  }
  const copyTitle=chat.title.slice(0,24)+'（本机副本）';
  const priorCopy=[...chats.values()].find(copy=>copy.id!==chat.id&&(copy.conflictOf===chat.id||(!copy.conflictOf&&copy.title===copyTitle))&&['name','note','style','subtitle'].every(key=>copy[key]===chat[key])&&JSON.stringify(copy.messages.map(({role,text})=>({role,text})))===JSON.stringify(chat.messages.map(({role,text})=>({role,text}))));
  if(priorCopy){chats.set(priorCopy.id,{...mergeContactMemory(priorCopy,chat,priorCopy.messages),id:priorCopy.id,title:priorCopy.title});if(active===chat.id)active=priorCopy.id;continue;}

  const copy={...chat,id:newId(),conflictOf:chat.id,title:chat.title.slice(0,24)+'（本机副本）'};if(chats.has(copy.id))throw new Error('生成对话编号失败，请重试。');chats.set(copy.id,copy);copies++;if(active===chat.id)active=copy.id;
 }
 for(const item of device.favorites){
  const prior=favorites.get(item.id);
  if(!prior)favorites.set(item.id,item);
  else if(JSON.stringify(prior)!==JSON.stringify(item)){const copy={...item,id:newId(),label:item.label.slice(0,94)+'（本机副本）'};favorites.set(copy.id,copy);copies++;}
 }
 for(const id of deletedFavoriteIds)favorites.delete(id);
 if(chats.size>15||favorites.size>300)throw new Error('两边的记录超过容量，已停止自动合并。可取消“保留聊天”后连接，先导出需要的内容。');
 if(mac.activeUpdatedAt>device.activeUpdatedAt)active=mac.active;
 return {workspace:normalizeWorkspace({schemaVersion:7,folders:[...folders.values()],deletedFavoriteIds,activeUpdatedAt:Math.max(mac.activeUpdatedAt,device.activeUpdatedAt),active:active||mac.active,chats:[...chats.values()],favorites:[...favorites.values()]}),conflictCopies:copies};
}
