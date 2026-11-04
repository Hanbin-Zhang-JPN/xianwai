export const HISTORY_LIMITS={messages:10000,total:2000000,bytes:32000000,pins:20,pinEntries:1000,page:60,reviewPage:80};
const stops=new Set('今天 明天 现在 这个 那个 我们 你们 什么 怎么 一下 知道 没有 可以 就是 还是 时候 刚才 事情 真的 觉得 问题 好的 对方 回复 消息'.split(' '));
function terms(text){const found=new Set();for(const part of text.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]{2,}/gu)||[]){if(/^[a-z0-9]+$/.test(part)){found.add(part);continue;}for(const size of [2,3])for(let i=0;i<=part.length-size;i++){const word=part.slice(i,i+size);if(!stops.has(word))found.add(word);}}return found;}
export function normalizeContextInfo(value,count){
 if(value==null)return null;
 const {positions,availableCount,recentStart,pinnedPositions,sentAt}=value;
 if(value.strategy!=='history-v1'||!Number.isInteger(availableCount)||availableCount<1||availableCount>HISTORY_LIMITS.messages||!Number.isInteger(recentStart)||recentStart<1||recentStart>availableCount||!Array.isArray(positions)||positions.length!==count||positions.at(-1)!==availableCount||positions.some((n,i)=>!Number.isInteger(n)||n<1||n>availableCount||(i&&n<=positions[i-1]))||!Array.isArray(pinnedPositions)||pinnedPositions.length>HISTORY_LIMITS.pins||new Set(pinnedPositions).size!==pinnedPositions.length||pinnedPositions.some(n=>!positions.includes(n))||!Array.isArray(sentAt)||sentAt.length!==count||sentAt.some(n=>!Number.isSafeInteger(n)||n<0||n>8640000000000000))throw new Error('历史语境来源格式不正确，已停止分析或覆盖。');
 return {strategy:'history-v1',availableCount,recentStart,positions:[...positions],pinnedPositions:[...pinnedPositions],sentAt:[...sentAt]};
}
export function normalizeContextPins(value=[]){
 if(!Array.isArray(value)||value.length>HISTORY_LIMITS.pinEntries)throw new Error('长期前情标记数量不正确。');const ids=new Set();
 const result=value.map(item=>{if(!item||typeof item.messageId!=='string'||!item.messageId||item.messageId.length>100||ids.has(item.messageId)||typeof item.active!=='boolean'||!Number.isSafeInteger(item.updatedAt)||item.updatedAt<0)throw new Error('长期前情标记格式不正确。');ids.add(item.messageId);return {messageId:item.messageId,active:item.active,updatedAt:item.updatedAt};});
 if(result.filter(item=>item.active).length>HISTORY_LIMITS.pins)throw new Error('最多标记 20 条长期前情，请先取消不再适用的内容。');return result;
}
export function setContextPin(chat,messageId,active,now=Date.now()){
 if(!chat.messages.some(message=>message.id===messageId))throw new Error('原话已变更，请重新打开历史。');
 const prior=(chat.contextPins||[]).find(item=>item.messageId===messageId),next={messageId,active,updatedAt:Math.max(now,(prior?.updatedAt||0)+1)};
 chat.contextPins=normalizeContextPins([...(chat.contextPins||[]).filter(item=>item.messageId!==messageId),next]);chat.updatedAt=Math.max(now,(chat.updatedAt||0)+1);
}
export function mergeContextPins(remote=[],local=[]){const pins=new Map();for(const item of [...remote,...local]){const prior=pins.get(item.messageId);if(!prior||item.updatedAt>prior.updatedAt||(item.updatedAt===prior.updatedAt&&!item.active))pins.set(item.messageId,item);}return normalizeContextPins([...pins.values()]);}
export function buildHistoryContext(messages,index,{pins=[],priorityIds=[]}={}){
 if(!Number.isInteger(index)||index<0||index>=messages.length)throw new Error('请选择一条有效的消息。');
 const count=index+1,selected=new Set();let chars=0,recentStart=index;
 const add=i=>{if(i<0||i>index||selected.has(i))return false;const size=messages[i].text.length;if(selected.size>=300||chars+size>80000)return false;selected.add(i);chars+=size;return true;};
 // Small histories stay complete; long histories reserve space for older evidence.
 const short=count<=300&&messages.slice(0,count).reduce((n,m)=>n+m.text.length,0)<=80000;
 if(short){for(let i=0;i<=index;i++)add(i);recentStart=0;}
 else{
  let recentChars=0;for(let i=index;i>=0&&index-i<80;i--){if(recentChars+messages[i].text.length>40000)break;add(i);recentChars+=messages[i].text.length;recentStart=i;}
  const pinnedIds=new Set(pins.filter(item=>item.active).map(item=>item.messageId)),pinned=[];
  for(let i=0;i<recentStart;i++)if(pinnedIds.has(messages[i].id)){add(i);pinned.push(i);}
  const priority=new Set(priorityIds);for(let i=0;i<recentStart;i++)if(priority.has(messages[i].id))add(i);
  for(const i of pinned)for(const offset of [-1,1])add(i+offset);
  const primary=terms(messages[index].text),query=new Set(primary);for(let i=Math.max(recentStart,index-5);i<index;i++)for(const term of terms(messages[i].text))if(query.size<200)query.add(term);
  const matches=[],frequencies=new Map();
  for(let i=0;i<recentStart;i++){const hit=[...terms(messages[i].text)].filter(term=>query.has(term));if(hit.length){matches.push({i,hit});for(const term of hit)frequencies.set(term,(frequencies.get(term)||0)+1);}}
  const ranked=matches.map(item=>({...item,score:item.hit.reduce((sum,term)=>sum+Math.log(1+recentStart/(frequencies.get(term)||1))*(primary.has(term)?3:1),0)})).sort((a,b)=>b.score-a.score||b.i-a.i);
  for(const {i} of ranked){if(selected.size>=300)break;if(!add(i)&&!selected.has(i))continue;for(const offset of [-2,-1,1,2])if(i+offset<recentStart)add(i+offset);}
 }
 const positions=[...selected].sort((a,b)=>a-b),pinnedIds=new Set(pins.filter(item=>item.active).map(item=>item.messageId));
 const info=normalizeContextInfo({strategy:'history-v1',availableCount:count,recentStart:recentStart+1,positions:positions.map(i=>i+1),pinnedPositions:positions.filter(i=>pinnedIds.has(messages[i].id)).map(i=>i+1),sentAt:positions.map(i=>messages[i].sentAt||0)},positions.length);
 return {start:positions[0],messages:positions.map(i=>messages[i]),targetIndex:positions.length-1,info};
}
export function conversationPage(messages,page=0,size=HISTORY_LIMITS.page){const pages=Math.max(1,Math.ceil(messages.length/size)),safe=Math.max(0,Math.min(pages-1,Math.trunc(page)||0)),end=Math.max(0,messages.length-safe*size),start=Math.max(0,end-size);return {page:safe,pages,start,end,rows:messages.slice(start,end)};}
export function collectReviewPage(rows,edits){const next=rows.slice();for(const edit of edits){if(!Number.isInteger(edit.index)||edit.index<0||edit.index>=next.length)throw new Error('核对页已变更，请重新打开。');next[edit.index]={...next[edit.index],role:edit.role,text:edit.text};}return next;}
