(()=>{
const LIMITS = { messages: 300, text: 2000, total: 80000 };
function parseTranscript(raw) {
 const text = raw.trim();
 if (!text) throw new Error('先粘贴一段聊天，再开始整理。');
 if (text.length > LIMITS.total) throw new Error('这段聊天超过 80,000 字，请分段导入。');
 if (text.startsWith('[')) {
  let rows;
  try { rows = JSON.parse(text); } catch { throw new Error('JSON 格式不正确，请检查括号和引号。'); }
  return validateMessages(rows);
 }
 const rows = []; let unknown = 0;
 for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = line.match(/^\s*(我|自己|me|对方|她|他|女友|老婆|伴侣|partner)\s*[:：]\s*(.*)$/i);
  if (match) rows.push({ role: /^(我|自己|me)$/i.test(match[1]) ? 'me' : 'partner', text: match[2].trim() });
  else if (rows.length && /^\s+/.test(line)) rows.at(-1).text += '\n' + line.trim();
  else { rows.push({ role: 'partner', text: line.trim(), uncertain: true }); unknown++; }
 }
 const valid = validateMessages(rows);
 return valid.map((m,i) => ({...m, uncertain: !!rows[i].uncertain}));
}
function validateMessages(rows) {
 if (!Array.isArray(rows) || !rows.length) throw new Error('至少需要一条聊天消息。');
 if (rows.length > LIMITS.messages) throw new Error('每次最多导入 300 条消息，请分段整理。');
 let total = 0;
 const result = rows.map((row,i) => {
  if (!row || !['me','partner'].includes(row.role) || typeof row.text !== 'string' || !row.text.trim()) throw new Error(`第 ${i+1} 条消息需要选择发送者并填写文字。`);
  const text = row.text.trim(); total += text.length;
  if (text.length > LIMITS.text) throw new Error(`第 ${i+1} 条超过 2,000 字，请拆成多条消息。`);
  return {role:row.role, text};
 });
 if (total > LIMITS.total) throw new Error('聊天总字数不能超过 80,000 字。');
 return result;
}
function contextFor(messages, targetIndex) {
 const rows = validateMessages(messages);
 if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= rows.length) throw new Error('请选择一条有效的消息。');
 return rows.slice(0,targetIndex+1).map((m,i)=>({id:i+1,...m}));
}
function localAnalysis(messages, targetIndex, tone = 'warm') {
 const context = contextFor(messages,targetIndex), target=context.at(-1), t=target.text;
 const prior=context.slice(0,-1), previous=prior.filter(m=>m.role==='me').at(-1);
 const gap=prior.some(m=>m.role==='partner'&&/等你|我等|等着|还没吃/.test(m.text))&&prior.some(m=>m.role==='me'&&/忙|开会|加班|晚|工作|临时.*会/.test(m.text));
 let kind=/算了|随便|你忙|没事|不用|哦|嗯|好吧/.test(t) ? 'distance' : /累|难受|烦|委屈|压力|崩溃/.test(t) ? 'tired' : /总是|每次|答应|忘|从来|失望/.test(t) ? 'promise' : /想你|喜欢|爱你|开心|谢谢/.test(t) ? 'affection' : 'open';
 if(target.role==='me') kind='self';
 if(/别再联系|不要再联系|不想聊|别烦|别找我|别来找|不要来找/.test(t))kind='boundary';
 if(/打死|杀了|掐死|揍你|威胁|伤害自己|不想活|自杀/.test(t))kind='safety';
 const profiles={
  boundary:{title:'先尊重清楚表达的边界',feeling:'消息里明确表达了暂停沟通或不被联系的意愿',need:'尊重这一请求，停止追问和反复联系',other:'具体原因仍不确定，但不需要先弄清原因才尊重边界。',ask:'这时不必继续追问。',avoid:'不要换账号、找朋友代问或用连续消息试图说服对方。',replies:['明白，我会尊重你的意思，先不打扰了。','收到，我会停下来。','好，我尊重你的决定。']},
  safety:{title:'先确认安全，暂停争执',feeling:'这句话可能涉及人身安全或强烈的痛苦，需要认真对待',need:'先确认当下是否安全，必要时联系当地紧急服务或身边可信赖的人',other:'单条消息不足以判断具体风险或动机，不宜用普通恋爱话术处理。',ask:'你现在安全吗？身边有可以陪你的人吗？',avoid:'不要承诺独自保密或靠继续争辩解决；若有危险，优先现实中的支持。',replies:['我们先暂停争执。眼下最重要的是安全。','你现在安全吗？身边有可以陪你的人吗？','现在先联系一个能在现实中提供帮助的人，好吗？']},
  distance:{title:'先确认感受，再解释事情',feeling:'可能有些失落，也可能只是想结束这轮聊天',need:'确认她是否想被陪伴，也给她不继续聊的空间',other:'她也可能真的希望你先忙完；短消息本身不能证明生气。',ask:'你是想先休息一下，还是希望我陪你聊一会儿？',avoid:'别急着反问“你又怎么了”，也别用连续追问逼对方表态。', replies: gap ? ['我先确认一下，刚才让你等着，是不是有点失落？你想让我陪你聊会儿，还是先休息一下？','我刚才没说清楚，让你一直等着了。你现在想聊聊吗？我在。','好，我先把手上的事收尾。你想聊的时候告诉我；如果刚才让你不舒服，也可以直接跟我说。'] : ['我有点拿不准你的意思。你是想先安静一会儿，还是希望我再听你说说？','我在。你愿意的话，可以跟我说说刚才的感受。','好，你先按自己舒服的节奏来。想聊的时候我在。']},
  tired:{title:'先陪她待在情绪里',feeling:'表达了疲惫或烦闷，但原因和程度还不清楚',need:'先被倾听，再确认是否需要一起想办法',other:'她可能只是分享近况，并不期待你立刻解决问题。',ask:'你想让我听你说说，还是一起想个办法？',avoid:'先别说“想开点”或马上列解决方案。',replies:['听起来今天挺难熬的。想跟我说说发生什么了吗？我先听你说。','今天辛苦了。我在，你慢慢说；不想说也没关系。','要不要先歇一会儿？你希望我陪你聊聊，还是帮你做点什么？']},
  promise:{title:'把回应落到具体的事情上',feeling:'可能对某个约定或重复发生的事情感到失望',need:'确认具体影响，并商量你能兑现的下一步',other:'这也可能是对一件具体事情的提醒，需要问清楚，不能推断整段关系。',ask:'这件事里最让你难受的是哪一部分？',avoid:'别用“我都道歉了”结束话题；别承诺自己做不到的事。',replies:['我想认真听听，这件事里最让你难受的是哪一部分？我先听完，再跟你商量怎么改。','你说的这件事，我想弄清楚。是我没有做到之前约好的事吗？','我们把之前怎么约的、这次哪里没做到一起说清楚吧。我想和你商量一个能落实的办法。']},
  affection:{title:'接住这份靠近',feeling:'文字中有主动表达亲近或感谢的线索',need:'自然回应你的真实感受，不必刻意升温',other:'这是当下的表达，不能据此推断关系一定稳定或对方有更多期待。',ask:'想不想跟我讲讲今天？',avoid:'不必照搬自己平时不会用的称呼或夸张承诺。',replies:['看到你这么说，我也很开心。想听你再多说一点。','收到啦，看到这条消息心情都变好了。','我也很珍惜我们这样聊天的时刻。今天过得怎么样？']},
  open:{title:'先听明白，再往下聊',feeling:'目前没有足够线索判断明确的情绪',need:'围绕她说的具体事情接话，用开放问题补充语境',other:'她可能是在陈述事实、开玩笑或开启话题；还需要更多上下文。',ask:'你说这件事的时候，最在意的是什么？',avoid:'不要把每一句普通消息都解读成试探或考验。',replies:['我想再听你说说，这件事里你最在意的是什么？','我在听，后来呢？','你希望我先听你说，还是一起想想接下来怎么办？']},
  self:{title:'让自己的意思更容易被听见',feeling:'这是你发出的消息，不能用它确定对方的感受',need:'确认自己的表达有没有把事实、感受和请求说清楚',other:'要理解对方，最好选择她的原话，并结合之前的交流。',ask:'我刚才的表达，你听起来是什么感觉？',avoid:'避免替对方定义情绪，或要求她马上接受你的解释。',replies:['我想把刚才的意思说清楚，也想听听你是怎么理解的。','刚才我可能说得太简略了。你愿意告诉我你的感受吗？','我先把自己的情况说清楚，再听听你的想法，好吗？']}
 };
 const p=profiles[kind];
 const short={distance:gap?['我在。你想聊一会儿，还是先休息？','刚才让你等了，抱歉。现在想聊聊吗？','好，你先按自己的节奏来。']:['我在。你想聊一会儿，还是先休息？','我有点拿不准，你是想先歇会儿吗？','好，你先按自己的节奏来。'],tired:['今天辛苦了。想说说吗？我听着。','我在，慢慢说。','你想让我陪着，还是帮点忙？'],promise:['我想听清楚：哪一部分让你最难受？','是我没做到之前约好的事吗？','我们一起商量个能落实的办法吧。'],affection:['看到这条消息，我也很开心。','收到啦，我很珍惜。','我也想听你说说今天。'],open:['我在听，后来呢？','这件事你最在意什么？','你想聊聊，还是一起想办法？'],self:['我想说清楚，也想听听你的理解。','刚才说得简略了，你是什么感受？','我先说情况，再听你的想法，好吗？']};
 const variants=[p.replies[1],p.replies[0],short[kind]?.[2]||p.replies[2]];
 return {mode:'local',title:p.title,feeling:p.feeling,need:p.need,hypotheses:[{text:p.feeling,evidence:[target.id]},{text:p.other,evidence:[target.id]}],facts:[{text:`${target.role==='me'?'你':'对方'}说：“${t}”`,evidence:[target.id]},...(previous?[{text:`此前你说：“${previous.text}”`,evidence:[previous.id]}]:[])],question:p.ask,avoid:p.avoid,replies:variants.map((text,i)=>({tone:['warm','honest','brief'][i],label:['温柔一点','坦诚一点','简短一点'][i],text,reason:'结合自己的真实情况调整后，再复制发送。'})),contextCount:context.length};
}


const TONES = [
  {id: 'warm', label: '温柔一点'},
  {id: 'honest', label: '坦诚一点'},
  {id: 'brief', label: '简短一点'}
];

// Only compare screenshot boundaries. Repeated text inside a screenshot is kept.
function boundaryOverlap(previous, incoming) {
  const max = Math.min(previous.length, incoming.length);
  for (let length = max; length >= 2; length--) {
    const tail = previous.slice(-length), head = incoming.slice(0, length);
    if (tail.reduce((sum, row) => sum + row.text.trim().length, 0) < 10) continue;
    if (tail.every((row, index) => row.role === head[index].role && row.text.trim() === head[index].text.trim())) return length;
  }
  return 0;
}

function combineScreenshotBatches(batches, removeOverlap = true) {
  let messages = [], overlapCount = 0;
  for (const batch of batches) {
    validateMessages(batch);
    const overlap = boundaryOverlap(messages, batch);
    overlapCount += overlap;
    messages = messages.concat(batch.slice(removeOverlap ? overlap : 0));
  }
  validateMessages(messages);
  return {messages, overlapCount};
}

function planImport(existing, incoming, {append = true, removeOverlap = true} = {}) {
  validateMessages(incoming);
  const overlap = append ? boundaryOverlap(existing, incoming) : 0;
  const messages = validateMessages([...(append ? existing : []), ...incoming.slice(removeOverlap ? overlap : 0)]);
  return {messages, overlapCount: overlap, removed: removeOverlap ? overlap : 0};
}

function prepareImport(existing, rows, options = {}) {
  const batches = [];
  for (const row of rows) {
    const batch = row.batch ?? 0;
    if (!batches.length || batches.at(-1).id !== batch) batches.push({id: batch, rows: []});
    batches.at(-1).rows.push(row);
  }
  const combined = combineScreenshotBatches(batches.map(batch => batch.rows), options.removeOverlap !== false);
  const plan = planImport(existing, combined.messages, options);
  return {...plan, screenshotOverlap: combined.overlapCount, totalOverlap: combined.overlapCount + plan.overlapCount};
}

function latestPartnerIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'partner') return index;
  return -1;
}

function addQuickMessage(messages, text, role = 'partner') {
  const value = String(text).trim();
  const last = messages.at(-1);
  if (last?.role === role && last.text === value) return {messages: validateMessages(messages), reused: true};
  return {messages: validateMessages([...messages, {role, text: value}]), reused: false};
}

function replyForTone(analysis, tone) {
  const index = TONES.findIndex(item => item.id === tone);
  return analysis.replies.find(reply => reply.tone === tone) || analysis.replies[Math.max(0, index)] || analysis.replies[0];
}

function canUndoRecord(record,chat){return !!record&&record.chatId===chat.id&&record.snapshot===JSON.stringify(chat.messages);}

const aborted=()=>new DOMException('已取消分析','AbortError');
function validateClientAnalysis(value,input){
 const context=contextFor(input.messages,input.targetIndex),count=context.length;
 const validText=(text,max=2000)=>typeof text==='string'&&!!text.trim()&&text.length<=max;
 const validEvidence=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=6&&ids.every(id=>Number.isInteger(id)&&id>=1&&id<=count);
 if(!value||value.mode!=='ai'||value.contextCount!==count||!['title','feeling','need','question','avoid'].every(key=>validText(value[key]))||!Array.isArray(value.replies)||value.replies.length!==3||!Array.isArray(value.facts)||!value.facts.length||!Array.isArray(value.hypotheses)||value.hypotheses.length<2||value.hypotheses.length>3)throw new Error('分析结果格式不正确，请重试。');
 if(value.replies.some((reply,index)=>!reply||reply.tone!==['warm','honest','brief'][index]||!['text','label','reason'].every(key=>validText(reply[key])))||[...value.facts,...value.hypotheses].some(item=>!item||!validText(item.text,2400)||!validEvidence(item.evidence)))throw new Error('分析结果中的回复或原话引用不正确，请重试。');
 return value;
}

function createAnalysisClient({fetcher=(...args)=>fetch(...args),pollInterval=700,timeout=170000}={}){
 let active=null,cancellation=Promise.resolve();
 const cache=new Map();
 const wait=(signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(aborted());return;}
  const abort=()=>{clearTimeout(timer);reject(aborted());};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},pollInterval);
  signal.addEventListener('abort',abort,{once:true});
 });
 async function read(response){
  let value;try{value=await response.json();}catch{throw new Error('Mac 连接中断或返回异常，请重新连接后重试。');}
  if(!response.ok)throw Object.assign(new Error(value?.error||'分析暂时不可用。'),{status:response.status});
  return value;
 }
 function stop(request){
  if(!request)return Promise.resolve();
  request.controller.abort();
  if(!request.submitted)return Promise.resolve();
  request.cleanup ||= fetcher(request.base+'/api/jobs/'+encodeURIComponent(request.remoteId||request.id),{method:'DELETE',headers:{Authorization:'Bearer '+request.token},signal:AbortSignal.timeout(5000)}).catch(()=>{});
  return request.cleanup;
 }
 async function cancel(){const old=active;active=null;cancellation=Promise.all([cancellation,stop(old)]).then(()=>{});await cancellation;}
 async function request({endpoint,token,input}){
  const old=active;
  const current={id:crypto.randomUUID(),controller:new AbortController(),base:endpoint.replace(/\/$/,''),token,submitted:false};
  active=current;
  let complete=false,timedOut=false;
  const deadline=setTimeout(()=>{timedOut=true;current.controller.abort();},timeout);
  try{
   cancellation=Promise.all([cancellation,stop(old)]).then(()=>{});
   await cancellation;
   if(current.controller.signal.aborted||active!==current)throw aborted();
   const key=JSON.stringify({base:current.base,token,input});
   if(cache.has(key)){complete=true;return cache.get(key);}
   const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
   current.submitted=true;
   let response=await fetcher(current.base+'/api/analyze',{method:'POST',headers,body:JSON.stringify({...input,requestId:current.id}),signal:current.controller.signal});
   let result=await read(response);
   if(response.status===202){
    current.remoteId=result?.jobId;
    if(typeof current.remoteId!=='string')throw new Error('分析任务格式不正确，请重试。');
    while(true){
     await wait(current.controller.signal);
     result=await read(await fetcher(current.base+'/api/jobs/'+encodeURIComponent(current.remoteId),{headers,signal:current.controller.signal}));
     if(result?.status==='completed'){result=result.result;break;}
     if(result?.status==='cancelled')throw aborted();
     if(result?.status==='failed')throw new Error(result.error||'AI 分析失败，请重试。');
    }
   }
   validateClientAnalysis(result,input);
   if(current.controller.signal.aborted||active!==current)throw aborted();
   complete=true;cache.set(key,result);if(cache.size>30)cache.delete(cache.keys().next().value);
   return result;
  }catch(error){
   if(timedOut)throw new DOMException('分析超时，请检查 Mac 连接后重试。','TimeoutError');
   if(current.controller.signal.aborted)throw aborted();
   throw error;
  }finally{
   clearTimeout(deadline);
   if(!complete)await stop(current);
   if(active===current)active=null;
  }
 }
 return {request,cancel,clearCache:()=>cache.clear()};
}
const analysisClient=createAnalysisClient();


const LIBRARY_LIMITS={folders:20,folderEntries:100,records:100,messages:1500,pool:3000,total:500000,bytes:8000000};
const isSampleChat=chat=>['late','tired','weekend'].includes(chat.id);
const libraryText=(value,max,fallback='')=>{if(value===undefined)return fallback;if(typeof value!=='string'||value.length>max)throw new Error('联系人资料格式不正确。');return value;};
const libraryTime=value=>{if(value===undefined)return 0;if(!Number.isSafeInteger(value)||value<0)throw new Error('记录时间格式不正确。');return value;};
const libraryId=value=>{if(typeof value!=='string'||!value||value.length>100)throw new Error('记录编号不正确。');return value;};
const legacyMessageId=(row,index)=>{let hash=2166136261;for(const char of row.role+'\n'+row.text){hash=Math.imul(hash^char.codePointAt(0),16777619);}return 'legacy-'+index+'-'+(hash>>>0).toString(36);};
function normalizeContactMessages(rows,{archive=false}={}){
 if(!Array.isArray(rows)||rows.length>(archive?LIBRARY_LIMITS.pool:LIBRARY_LIMITS.messages))throw new Error('每位联系人最多保留 1500 条当前消息，请先导出并整理上下文。');
 const ids=new Set();let total=0;
 const messages=rows.map((row,index)=>{
  if(!row||!['me','partner'].includes(row.role)||typeof row.text!=='string'||!row.text.trim()||row.text.trim().length>2000)throw new Error(`第 ${index+1} 条消息格式不正确。`);
  const text=row.text.trim(),id=row.id===undefined?legacyMessageId({...row,text},index):libraryId(row.id);if(ids.has(id))throw new Error('消息编号重复，请重新导入。');ids.add(id);total+=text.length;
  return {id,role:row.role,text,createdAt:libraryTime(row.createdAt)};
 });
 if(total>LIBRARY_LIMITS.total)throw new Error('这位联系人的上下文已超过 50 万字，请先导出并整理。');return messages;
}
function normalizeFolders(value=[]){
 if(!Array.isArray(value)||value.length>LIBRARY_LIMITS.folderEntries)throw new Error('文件夹记录数量不正确。');
 const ids=new Set();const folders=value.map(folder=>{if(!folder)throw new Error('文件夹格式不正确。');const id=libraryId(folder.id);if(ids.has(id))throw new Error('文件夹编号重复。');ids.add(id);const name=libraryText(folder.name,24).trim();if(!name)throw new Error('文件夹名称不能为空。');return {id,name,updatedAt:libraryTime(folder.updatedAt),deleted:folder.deleted===true};});
 if(folders.filter(folder=>!folder.deleted).length>LIBRARY_LIMITS.folders)throw new Error('最多创建 20 个文件夹。');return folders;
}
function normalizeContactMemory(chat){
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
 return {messages,archive:archive.filter(message=>!messages.some(current=>current.id===message.id)),analyses,deletedAnalysisIds:deleted,resumeId:ids.has(chat.resumeId)?chat.resumeId:null,resumeUpdatedAt:libraryTime(chat.resumeUpdatedAt),updatedAt:libraryTime(chat.updatedAt),folderId:chat.folderId==null?null:libraryId(chat.folderId),folderUpdatedAt:libraryTime(chat.folderUpdatedAt),composer:{text:libraryText(chat.composer?.text,2000),role:chat.composer?.role==='me'?'me':'partner'}};
}
function touchContact(chat,now=Date.now()){chat.updatedAt=Math.max(now,(chat.updatedAt||0)+1);return chat;}
function contextWindow(messages,index){
 if(!Number.isInteger(index)||index<0||index>=messages.length)throw new Error('请选择一条消息。');
 let start=index,total=0;
 while(start>=0&&index-start<300&&total+messages[start].text.length<=80000){total+=messages[start].text.length;start--;}
 start++;return {start,messages:messages.slice(start,index+1),targetIndex:index-start};
}
function addContactMessage(messages,text,role='partner',{now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const value=String(text).trim(),last=messages.at(-1);if(last?.role===role&&last.text===value&&last.createdAt&&new Date(last.createdAt).toDateString()===new Date(now).toDateString())return {messages:normalizeContactMessages(messages),reused:true};
 return {messages:normalizeContactMessages([...messages,{id:newId(),createdAt:now,role,text:value}]),reused:false};
}
function prepareContactImport(existing,rows,{append=true,removeOverlap=true,now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const batches=[];for(const row of rows){const batch=row.batch??0;if(!batches.length||batches.at(-1).id!==batch)batches.push({id:batch,rows:[]});batches.at(-1).rows.push(row);}
 const combined=combineScreenshotBatches(batches.map(batch=>batch.rows),removeOverlap),overlap=append?boundaryOverlap(existing,combined.messages):0;
 const incoming=combined.messages.slice(removeOverlap?overlap:0).map(message=>({...message,id:newId(),createdAt:now}));
 return {messages:normalizeContactMessages([...(append?existing:[]),...incoming]),removed:removeOverlap?overlap:0,screenshotOverlap:combined.overlapCount,totalOverlap:overlap+combined.overlapCount};
}
function replaceContactMessages(chat,messages,now=Date.now()){
 const next=normalizeContactMessages(messages),pool=new Map([...(chat.archive||[]),...chat.messages].map(message=>[message.id,message])),needed=new Set((chat.analyses||[]).flatMap(record=>record.contextIds)),currentIds=new Set(next.map(message=>message.id));
 chat.archive=[...pool.values()].filter(message=>needed.has(message.id)&&!currentIds.has(message.id));chat.messages=next;chat.resumeId=null;chat.resumeUpdatedAt=now;touchContact(chat,now);return chat;
}
function recordContext(chat,record){const pool=new Map([...(chat.archive||[]),...chat.messages].map(message=>[message.id,message]));return record.contextIds.map(id=>pool.get(id));}
function saveAnalysisRecord(chat,context,result,{tone='warm',now=Date.now(),newId=()=>crypto.randomUUID()}={}){
 const key=JSON.stringify([context.messages.map(message=>message.id),result,chat.note||'',chat.style||'']);
 let record=(chat.analyses||[]).find(record=>JSON.stringify([record.contextIds,record.result,record.note,record.style])===key);
 if(!record){if((chat.analyses||[]).length>=LIBRARY_LIMITS.records)throw new Error('这位联系人的分析记录已满 100 条。请先导出或删除部分记录。');record={id:newId(),createdAt:now,updatedAt:now,targetId:context.messages.at(-1).id,contextIds:context.messages.map(message=>message.id),result:structuredClone(result),tone,drafts:{},note:chat.note||'',style:chat.style||''};chat.analyses??=[];chat.analyses.unshift(record);}
 chat.resumeId=record.id;chat.resumeUpdatedAt=now;touchContact(chat,now);return record;
}
function updateRecordDraft(chat,id,tone,drafts,now=Date.now()){
 const record=chat.analyses?.find(record=>record.id===id);if(!record)return;record.tone=tone;record.drafts={...drafts};record.updatedAt=Math.max(now,record.updatedAt+1);chat.resumeId=id;chat.resumeUpdatedAt=now;touchContact(chat,now);
}
function deleteAnalysisRecord(chat,id,now=Date.now()){
 chat.deletedAnalysisIds=[...new Set([...(chat.deletedAnalysisIds||[]),id])];chat.analyses=(chat.analyses||[]).filter(record=>record.id!==id);if(chat.resumeId===id)chat.resumeId=null;
 const needed=new Set(chat.analyses.flatMap(record=>record.contextIds));chat.archive=(chat.archive||[]).filter(message=>needed.has(message.id));touchContact(chat,now);
}
function moveContact(chat,folderId,now=Date.now()){chat.folderId=folderId||null;chat.folderUpdatedAt=now;touchContact(chat,now);}
function mergeContactMemory(remote,local,messages){
 const deletedAnalysisIds=[...new Set([...(remote.deletedAnalysisIds||[]),...(local.deletedAnalysisIds||[])])],records=new Map();
 for(const record of [...remote.analyses,...local.analyses])if(!deletedAnalysisIds.includes(record.id)){const prior=records.get(record.id);if(!prior||record.updatedAt>prior.updatedAt)records.set(record.id,record);}
 const pool=new Map([...remote.archive,...remote.messages,...local.archive,...local.messages].map(message=>[message.id,message])),needed=new Set([...records.values()].flatMap(record=>record.contextIds)),currentIds=new Set(messages.map(message=>message.id)),folder=(local.folderUpdatedAt>=remote.folderUpdatedAt?local:remote),resume=(local.resumeUpdatedAt>=remote.resumeUpdatedAt?local:remote);
 return {...remote,messages,archive:[...pool.values()].filter(message=>needed.has(message.id)&&!currentIds.has(message.id)),analyses:[...records.values()],deletedAnalysisIds,resumeId:resume.resumeId,resumeUpdatedAt:resume.resumeUpdatedAt,updatedAt:Math.max(local.updatedAt,remote.updatedAt),folderId:folder.folderId,folderUpdatedAt:folder.folderUpdatedAt,composer:local.updatedAt>=remote.updatedAt?local.composer:remote.composer};
}


const bounded=(value,max,name,fallback)=>{
 if(value===undefined&&fallback!==undefined)return fallback;
 if(typeof value!=='string'||value.length>max)throw new Error(`${name}格式不正确。`);
 return value;
};
function normalizeWorkspace(value){
 if(!value||!Array.isArray(value.chats)||value.chats.length>15||!Array.isArray(value.favorites)||value.favorites.length>300)throw new Error('聊天备份格式或数量不正确，已停止覆盖。');
 const folders=normalizeFolders(value.folders),activeFolders=new Set(folders.filter(folder=>!folder.deleted).map(folder=>folder.id));
 const ids=new Set(),favoriteIds=new Set();
 const chats=value.chats.map(chat=>{
  if(!chat||!Array.isArray(chat.messages))throw new Error('聊天备份中的消息格式不正确。');
  const id=bounded(chat.id,100,'对话编号');if(!id||ids.has(id))throw new Error('聊天备份包含重复或空的对话编号。');ids.add(id);
  return {id,title:bounded(chat.title,30,'标题'),name:bounded(chat.name,20,'称呼'),note:bounded(chat.note,2000,'关系背景',''),style:bounded(chat.style,1000,'说话习惯',''),preferredTone:['warm','honest','brief'].includes(chat.preferredTone)?chat.preferredTone:'warm',subtitle:bounded(chat.subtitle,100,'对话说明',''),...normalizeContactMemory(chat)};
 });
 for(const chat of chats)if(chat.folderId&&!activeFolders.has(chat.folderId))chat.folderId=null;
 const favorites=value.favorites.map(item=>{
  if(!item)throw new Error('收藏备份格式不正确。');
  const id=bounded(item.id,100,'收藏编号');if(!id||favoriteIds.has(id))throw new Error('收藏备份包含重复或空的编号。');favoriteIds.add(id);
  return {id,text:bounded(item.text,2000,'收藏文字'),label:bounded(item.label,100,'收藏语气',''),name:bounded(item.name,100,'收藏称呼',''),source:bounded(item.source,100,'收藏来源','')};
 });
 const activeUpdatedAt=value.activeUpdatedAt??0;if(!Number.isSafeInteger(activeUpdatedAt)||activeUpdatedAt<0)throw new Error('联系人进度时间不正确。');
 const workspace={schemaVersion:2,active:ids.has(value.active)?value.active:chats[0]?.id||null,activeUpdatedAt,chats,favorites,folders};
 if(new TextEncoder().encode(JSON.stringify(workspace)).length>LIBRARY_LIMITS.bytes)throw new Error('资料库已超过 8 MB，请先导出并整理分析记录，原数据未被覆盖。');return workspace;
}

function mergeWorkspaces(remote,local,{newId=()=>crypto.randomUUID()}={}){
 const device=normalizeWorkspace(local);
 if(!remote)return {workspace:device,conflictCopies:0};
 const mac=normalizeWorkspace(remote),chats=new Map(mac.chats.map(c=>[c.id,c])),favorites=new Map(mac.favorites.map(f=>[f.id,f]));
 const folders=new Map(mac.folders.map(folder=>[folder.id,folder]));for(const folder of device.folders){const prior=folders.get(folder.id);if(!prior||folder.updatedAt>prior.updatedAt||(folder.updatedAt===prior.updatedAt&&folder.deleted))folders.set(folder.id,folder);}
 let copies=0,active=device.active;
 for(const chat of device.chats){
  const placeholder=!chat.messages.length&&!chat.analyses.length&&!chat.composer.text&&!chat.note&&!chat.style&&chat.title==='我的聊天'&&chat.name==='对方'&&chat.subtitle==='常用对话';
  if(placeholder&&mac.chats.length){if(active===chat.id)active=null;continue;}
  const prior=chats.get(chat.id);
  if(!prior){chats.set(chat.id,chat);continue;}
  if(JSON.stringify(prior)===JSON.stringify(chat))continue;
  const sameProfile=['title','name','note','style','subtitle'].every(key=>prior[key]===chat[key]);
  const prefix=(shorter,longer)=>shorter.length<=longer.length&&shorter.every((message,index)=>message.role===longer[index].role&&message.text===longer[index].text);
  if(sameProfile&&(prefix(prior.messages,chat.messages)||prefix(chat.messages,prior.messages))){
   chats.set(chat.id,{...mergeContactMemory(prior,chat,prior.messages.length>=chat.messages.length?prior.messages:chat.messages),preferredTone:chat.id===device.active?chat.preferredTone:prior.preferredTone});continue;
  }
  const priorCopy=[...chats.values()].find(copy=>copy.id!==chat.id&&copy.title.replace(/（本机副本）$/,'')===chat.title.replace(/（本机副本）$/,'')&&['name','note','style','subtitle'].every(key=>copy[key]===chat[key])&&JSON.stringify(copy.messages)===JSON.stringify(chat.messages));
  if(priorCopy){chats.set(priorCopy.id,{...mergeContactMemory(priorCopy,chat,priorCopy.messages),id:priorCopy.id,title:priorCopy.title});if(active===chat.id)active=priorCopy.id;continue;}

  const copy={...chat,id:newId(),title:chat.title.slice(0,24)+'（本机副本）'};if(chats.has(copy.id))throw new Error('生成对话编号失败，请重试。');chats.set(copy.id,copy);copies++;if(active===chat.id)active=copy.id;
 }
 for(const item of device.favorites){
  const prior=favorites.get(item.id);
  if(!prior)favorites.set(item.id,item);
  else if(JSON.stringify(prior)!==JSON.stringify(item)){const copy={...item,id:newId(),label:item.label.slice(0,94)+'（本机副本）'};favorites.set(copy.id,copy);copies++;}
 }
 if(chats.size>15||favorites.size>300)throw new Error('两边的记录超过容量，已停止自动合并。可取消“保留聊天”后连接，先导出需要的内容。');
 if(mac.activeUpdatedAt>device.activeUpdatedAt)active=mac.active;
 return {workspace:normalizeWorkspace({schemaVersion:2,folders:[...folders.values()],activeUpdatedAt:Math.max(mac.activeUpdatedAt,device.activeUpdatedAt),active:active||mac.active,chats:[...chats.values()],favorites:[...favorites.values()]}),conflictCopies:copies};
}


// Use AbortController directly so older iPhone WebKit versions need no AbortSignal.any.
async function withRequestTimeout(operation,signal,milliseconds=12000){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(),milliseconds);
 try{return await operation(controller.signal);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function createWorkspaceSync({fetcher=(...args)=>fetch(...args),delay=700,onError=()=>{}}={}){
 let session=null;
 async function read(response){
  let value;try{value=await response.json();}catch{throw new Error('Mac 备份返回异常，当前设备的记录仍保留。');}
  if(!response.ok)throw Object.assign(new Error(value?.error||'Mac 备份未能保存。'),{status:response.status});
  if(!Number.isSafeInteger(value?.revision)||value.revision<0)throw new Error('Mac 备份版本不正确。');
  return value;
 }
 function disconnect(){if(session){clearTimeout(session.timer);session.pending=null;session.controller.abort();}session=null;}
 function connect({endpoint,token,revision}){
  disconnect();if(!Number.isSafeInteger(revision)||revision<0)throw new Error('Mac 备份版本不正确。');
  session={base:endpoint.replace(/\/$/,''),token,revision,controller:new AbortController(),blocked:false,clearing:false,pending:null,running:Promise.resolve()};
 }
 function flush(scope=session){
  if(!scope)return Promise.resolve();clearTimeout(scope.timer);scope.timer=null;
  const payload=scope.pending;scope.pending=null;if(!payload)return scope.running;
  scope.running=scope.running.then(async()=>{
   if(session!==scope||scope.blocked||scope.clearing)return;
   try{const serialized=JSON.stringify({...payload,baseRevision:scope.revision});const value=await withRequestTimeout(async signal=>read(await fetcher(scope.base+'/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+scope.token},body:serialized,keepalive:new TextEncoder().encode(serialized).length<60000,signal})),scope.controller.signal);if(session===scope)scope.revision=value.revision;}
   catch(error){if(session!==scope||scope.controller.signal.aborted)return;scope.blocked=true;scope.pending=null;onError(error);}
  });
  return scope.running;
 }
 function schedule(value){
  const scope=session;if(!scope||scope.blocked||scope.clearing)return;
  scope.pending=normalizeWorkspace(value);clearTimeout(scope.timer);scope.timer=setTimeout(()=>{void flush(scope);},delay);
 }
 async function clear(){
  const scope=session;if(!scope)throw new Error('Mac 尚未连接，无法删除 Mac 备份。');
  clearTimeout(scope.timer);scope.timer=null;scope.pending=null;scope.clearing=true;
  try{
   await scope.running;
   if(session!==scope)throw new Error('连接已变更，未删除 Mac 备份。');
   if(scope.blocked)throw new Error('Mac 备份存在冲突或连接异常，请重新配对后再清除。');
   const value=await withRequestTimeout(async signal=>read(await fetcher(scope.base+'/api/workspace',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+scope.token},body:JSON.stringify({baseRevision:scope.revision}),signal})),scope.controller.signal);
   if(session!==scope)throw new Error('连接已变更。');scope.revision=value.revision;return value;
  }catch(error){scope.blocked=true;throw error;}finally{scope.clearing=false;}
 }
 return {connect,disconnect,schedule,flush:()=>flush(),clear};
}


const safeStorage={
 read(kind,key){try{return globalThis[kind]?.getItem(key)||null;}catch{return null;}},
 write(kind,key,value){try{globalThis[kind].setItem(key,value);return true;}catch{return false;}},
 remove(kind,key){try{globalThis[kind]?.removeItem(key);return true;}catch{return false;}}
};
function parsePairLink(value){
 try{
  const url=new URL(value),hash=new URLSearchParams(url.hash.slice(1)),base=new URL(hash.get('bridge')||url.origin),token=hash.get('key');
  if(!/^[a-f0-9]{64}$/.test(token||'')||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))))throw new Error();
  return {endpoint:base.origin,token};
 }catch{throw new Error('配对链接不完整，请复制 Mac 上的完整手机链接，或重新扫码。');}
}
function connectionError(error){
 if(error?.status===401)return '二维码或配对链接已过期。请在 Mac 点击“重新连接”，再用 iPhone 相机重新扫码。';
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '连接超时。请确认 Mac 开机联网，用 Safari 重新打开；仍失败时在 Mac 重新连接后扫码。';
 return error?.message||'暂时连不上 Mac，请稍后重试。';
}
function pausePairing(milliseconds,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new DOMException('已取消连接','AbortError'));return;}
 const abort=()=>{clearTimeout(timer);reject(new DOMException('已取消连接','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);signal?.addEventListener('abort',abort,{once:true});
});}
async function probeConnection(pair,{fetcher=(...args)=>fetch(...args),signal,onAttempt=()=>{},attempts=3,delay=700,timeout=6000}={}){
 let last;
 for(let attempt=0;attempt<attempts;attempt++){
  if(signal?.aborted)throw new DOMException('已取消连接','AbortError');onAttempt(attempt+1,attempts);
  try{return await withRequestTimeout(async activeSignal=>{
   let response;try{response=await fetcher(pair.endpoint+'/api/health',{headers:{Authorization:'Bearer '+pair.token},signal:activeSignal,cache:'no-store'});}catch(error){if(signal?.aborted)throw error;throw Object.assign(new Error('暂时无法访问手机链接，正在重试。可尝试切换 Wi-Fi / 蜂窝网络，并确认 Mac 仍联网。'),{status:502});}
   if(!response.ok)throw Object.assign(new Error(response.status===401?'配对链接已过期。':'Mac 手机连接暂未就绪，请重试。'),{status:response.status});
   let value;try{value=await response.json();}catch{throw Object.assign(new Error('手机链接返回了中转服务页面，尚未连到 Mac。请稍后重试。'),{status:502});}
   if(value?.provider!=='codex'||typeof value.ready!=='boolean')throw Object.assign(new Error('这不是有效的弦外 Mac 连接，请重新扫码。'),{status:400});
   return value;
  },signal,timeout);}catch(error){last=error;if(signal?.aborted||error.status===401||(error.status>=400&&error.status<500)||attempt===attempts-1)throw error;await pausePairing(delay*(attempt+1),signal);}
 }
 throw last;
}


const requestAnalysis=async options=>{try{return await analysisClient.request(options);}catch(error){if(error.status===401)error.message=connectionError(error);if(error.status===401||error instanceof TypeError||error.name==='TimeoutError')document.dispatchEvent(new CustomEvent('xianwai-connection-error',{detail:connectionError(error)}));throw error;}};
const cancelAnalysis=()=>analysisClient.cancel();

function startCompanion(api){
 const {getState,modal,closeModal,toast,render,showReview,setReviewRows,stopAnalysis}=api;
 let connected=false,ocrAvailable=false,aiReady=false,pendingPair=null,pairTask=null,ocrTask=null,nativeChat=null,phase='disconnected',syncError='',heartbeat=null;
 let contextVersion=0;
 const sync=createWorkspaceSync({onError:error=>{syncError=error.message;draw();toast(error.message+' 当前设备的记录仍保留。');}});
 const endpoint=()=>getState().endpoint.replace(/\/$/,'');
 const auth=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
 const localWorkspace=()=>{const s=getState();return {schemaVersion:2,folders:s.folders,activeUpdatedAt:s.activeUpdatedAt,active:s.active,chats:s.chats.filter(c=>!['late','tired','weekend'].includes(c.id)),favorites:s.favorites};};
 const readJSON=async response=>{let result;try{result=await response.json();}catch{throw new Error('无法连接 Mac，请确认弦外应用仍在运行。');}if(!response.ok)throw Object.assign(new Error(result?.error||'请求失败。'),{status:response.status});return result;};
 const query=(pair,path,signal)=>withRequestTimeout(activeSignal=>fetch(pair.endpoint+path,{headers:auth(pair.token),signal:activeSignal}).then(readJSON),signal);
 const applyWorkspace=workspace=>{const s=getState();if(workspace.chats.length){Object.assign(s,workspace);s.composerDrafts=Object.fromEntries(workspace.chats.map(chat=>[chat.id,{...chat.composer}]));s.tone=s.chats.find(chat=>chat.id===s.active)?.preferredTone||'warm';}};
 const forget=()=>{for(const kind of ['localStorage','sessionStorage'])safeStorage.remove(kind,'xianwai-connection-v1');};
 function rememberPair(pair,remember){forget();if(!safeStorage.write(remember?'localStorage':'sessionStorage','xianwai-connection-v1',JSON.stringify({...pair,live:getState().live})))toast('浏览器未允许记住连接，下次需重新扫码。');}
 function waitForNoDialog(signal){return new Promise((resolve,reject)=>{
  const root=document.querySelector('#modal-root');
  const done=()=>{observer.disconnect();signal.removeEventListener('abort',abort);resolve();};
  const check=()=>{if(!root.querySelector('.modal'))done();};
  const abort=()=>{observer.disconnect();reject(new DOMException('已取消连接','AbortError'));};
  const observer=new MutationObserver(check);if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});observer.observe(root,{childList:true,subtree:true});check();
 });}
 function cancelPair(){const old=pairTask;old?.controller.abort();pairTask=null;if(old){phase='disconnected';draw();}}
 function cancelOCR(){ocrTask?.controller.abort();ocrTask=null;}
 function disconnect(){cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();analysisClient.clearCache();stopAnalysis();forget();connected=false;ocrAvailable=false;aiReady=false;phase='disconnected';syncError='';pendingPair=null;const s=getState();s.live=false;s.endpoint='';s.token='';if(location.hash.includes('key='))history.replaceState(null,'',location.pathname+location.search);}
 function draw(){
  const s=getState(),bench=document.querySelector('.workbench');
  if(bench&&!document.querySelector('.quick-actions')){
   const bar=document.createElement('div');bar.className='quick-actions';
   bar.innerHTML=`<button class="primary-btn" data-companion="screenshots">导入微信截图</button><button class="outline-btn" data-companion="paste">粘贴一句</button><button class="connection-state" data-companion="connection"><span class="dot"></span>${connected?(s.live?'Mac 已连接 · 真实 AI':'Mac 已连接 · 本地规则'):'连接 Mac，启用真实 AI'}</button>`;bench.before(bar);
  }
  const status=phase==='connecting'?'正在验证 Mac 连接…':phase==='offline'?'Mac 连接中断 · 点此重试':connected?(aiReady?(s.live?'Mac 已连接 · 真实 AI':'Mac 已连接 · 本地规则'):'Mac 已连接 · Codex 待登录'):'连接 Mac，启用真实 AI';
  const connectionButton=document.querySelector('[data-companion="connection"]');if(connectionButton)connectionButton.innerHTML='<span class="dot"></span>'+status;
  const badge=document.querySelector('.mode-pill');if(badge)badge.innerHTML='<span class="dot"></span>'+(phase==='offline'?'Mac 连接中断':connected?(aiReady?(s.live?'Codex AI 已连接':'本地规则 · Mac 已连接'):'Codex 待登录'):phase==='connecting'?'正在连接 Mac':phase==='offline'?'Mac 连接中断':s.live?'在线服务已选择':'本地规则试用');
  let backup=document.querySelector('.backup-status');if(!backup&&document.querySelector('.quick-actions')){backup=document.createElement('button');backup.className='backup-status';backup.dataset.companion='retry-backup';document.querySelector('.quick-actions').append(backup);}if(backup){backup.hidden=!syncError;backup.textContent=syncError?'Mac 备份未同步 · 点此恢复':'';backup.title=syncError;}

  const spinner=document.querySelector('.analysis-empty .spinner');if(spinner&&!document.querySelector('[data-companion="cancel"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='cancel';b.textContent='取消分析';b.style.marginTop='18px';spinner.parentElement.append(b);}
 }
 window.xianwaiCompanionRendered=draw;window.xianwaiIsConnected=()=>connected&&phase==='connected';
 window.xianwaiImportScreenshots=()=>chooseImages();
 function connectionHelp(edit=false){if(pendingPair&&!edit){pairingModal(pendingPair);return;}modal('连接你的 Mac','打开 Mac 上的「弦外」应用，扫描窗口里的二维码，或粘贴配对链接。',`<label for="pair-link">Mac 应用显示的配对链接</label><textarea id="pair-link" placeholder="https://…/#key=…" style="min-height:100px"></textarea><div class="notice">Mac 需要保持联网与开机。手机用 Safari 打开，再通过“分享 → 添加到主屏幕”进入。</div>`,`<button class="outline-btn" data-action="close-modal">稍后</button><button class="primary-btn" data-companion="parse-pair">连接 Mac</button>`);}
 const parsePair=parsePairLink;
 function pairingModal(pair){pendingPair=pair;const hash=new URLSearchParams({key:pair.token});if(pair.endpoint!==location.origin)hash.set('bridge',pair.endpoint);history.replaceState(null,'',location.pathname+location.search+'#'+hash.toString());const local=pair.endpoint.startsWith('http://127.0.0.1');modal('让这台设备连上弦外','连接后，不需要配置模型密钥。分析使用 Mac 上已登录的 Codex 及其额度。',`<div class="notice">${local?'截图在这台 Mac 上识别。':'截图通过 Cloudflare 的 HTTPS 连接发送到你的 Mac，在 Mac 上识别。'}选择“分析”时，相关聊天文字和背景才会通过 Codex 发送给 OpenAI。</div><label class="checkbox-row"><input id="remember-pair" type="checkbox" checked>在这台设备记住 Mac 连接</label><label class="checkbox-row"><input id="remember-chats" type="checkbox" checked>在这台设备与 Mac 保留聊天和收藏（未加密）</label><p class="intro" style="margin-top:14px">重新连接会合并记录；同一对话有不同内容时，会保留两份供你核对。请勿转发配对链接。</p>`,`<button class="outline-btn" data-companion="edit-pair">更换配对链接</button><button class="primary-btn" data-companion="connect">确认连接，开始使用</button>`);}
 async function connect(pair,options={}){
  cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();connected=false;ocrAvailable=false;phase='connecting';pendingPair=pair;stopAnalysis();
  const task={controller:new AbortController(),owner:options.owner};pairTask=task;
  const valid=()=>pairTask===task&&!task.controller.signal.aborted&&(!task.owner||task.owner.isConnected);
  const timeout=setTimeout(()=>task.controller.abort(),30000);
  try{
   const status=await probeConnection(pair,{signal:task.controller.signal,onAttempt:(attempt,total)=>{const button=task.owner?.querySelector('[data-companion="connect"]');if(button)button.textContent=`正在验证 Mac（${attempt}/${total}）…`;}});
   if(!task.owner){clearTimeout(timeout);await waitForNoDialog(task.controller.signal);}
   let restored=null,revision=0;
   if(options.save){if(status.workspaceSchema!==2)throw new Error('请先将 Mac 上的弦外升级到 0.4.0，再保存联系人、文件夹和分析记录。');const backup=await query(pair,'/api/workspace',task.controller.signal);if(!Number.isSafeInteger(backup.revision)||backup.revision<0)throw new Error('请更新 Mac 上的弦外应用后重新配对。');if(!task.owner)await waitForNoDialog(task.controller.signal);revision=backup.revision;restored=mergeWorkspaces(backup.workspace,localWorkspace());}
   if(!valid())return;
   const s=getState();s.endpoint=pair.endpoint===location.origin?'':pair.endpoint;s.token=pair.token;s.live=options.live!==false;s.persist=!!options.save;
   if(restored)applyWorkspace(restored.workspace);
   connected=true;ocrAvailable=!!status.ocr;aiReady=status.ready;phase='connected';syncError='';
   if(options.save)sync.connect({...pair,revision});
   rememberPair(pair,options.remember);api.persist();
   pairTask=null;if(location.hash.includes('key='))history.replaceState(null,'',location.pathname+location.search);if(task.owner)closeModal();api.restoreProgress();render();toast(!status.ready?'Mac 已连接。请在 Mac 登录 Codex，截图与本地规则可继续使用。':restored?.conflictCopies?'已连接。两边不同的内容均已保留，带“本机副本”的对话请核对。':(s.live?'已连接真实 AI，聊天记录已就绪。':'已连接 Mac，保留本地规则模式。'));
  }catch(error){
   if(pairTask!==task||(task.owner&&!task.owner.isConnected))return;
   phase='offline';draw();
   const node=task.owner?.querySelector('#modal-error');const message=connectionError(error);if(node)node.textContent=message;else toast(message);
   const button=task.owner?.querySelector('[data-companion="connect"]');if(button){button.disabled=false;button.textContent='重试连接';}
  }finally{clearTimeout(timeout);if(pairTask===task)pairTask=null;}
 }
 function chooseImages(){
  if(window.webkit?.messageHandlers?.xianwai){if(nativeChat){toast('相册或截图识别仍在进行，请稍候。');return;}nativeChat={chatId:getState().active,id:crypto.randomUUID(),version:contextVersion};window.webkit.messageHandlers.xianwai.postMessage({action:'pickScreenshot',requestId:nativeChat.id});return;}
  if(!connected||!ocrAvailable){connectionHelp();return;}
  const chatId=getState().active,version=contextVersion,owner=document.querySelector('#modal-root .modal'),input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.style.display='none';document.body.append(input);
  input.onchange=()=>{const files=[...input.files];input.remove();if(getState().active===chatId&&contextVersion===version&&document.querySelector('#modal-root .modal')===owner)void importImages(files,chatId);};input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();
 }
 async function resize(file){if(file.size>30000000)throw new Error('单张图片不能超过 30 MB。');const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const ratio=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.88);}finally{URL.revokeObjectURL(url);}}
 async function importImages(files,chatId){
  if(!files.length)return;if(files.length>12){toast('每次最多选择 12 张截图。');return;}
  cancelOCR();modal('正在识别聊天截图','截图发送到你的 Mac 识别，处理后的临时图片会删除。','<div class="ocr-progress"><div class="spinner"></div><p id="ocr-status">正在读取图片…</p></div>');
  const task={controller:new AbortController(),owner:document.querySelector('#modal-root .modal'),chatId,base:endpoint(),token:getState().token};ocrTask=task;
  const valid=()=>ocrTask===task&&!task.controller.signal.aborted&&task.owner.isConnected&&getState().active===chatId;
  const rows=[],previews=[];
  try{
   for(let i=0;i<files.length;i++){
    if(!valid())return;task.owner.querySelector('#ocr-status').textContent=`正在识别第 ${i+1} / ${files.length} 张，请稍候…`;
    const dataUrl=await resize(files[i]);if(!valid())return;
    const timer=setTimeout(()=>task.controller.abort(),60000);let result;
    try{result=await readJSON(await fetch(task.base+'/api/ocr',{method:'POST',headers:auth(task.token),body:JSON.stringify({dataUrl}),signal:task.controller.signal}));}finally{clearTimeout(timer);}
    if(!valid())return;if(!Array.isArray(result.rows))throw new Error('截图识别返回格式异常，请重试。');
    rows.push(...result.rows.map(row=>({...row,batch:i})));previews.push(dataUrl);if(rows.length>300)throw new Error('识别超过 300 条，请减少本次截图数量。');
   }
   if(!valid())return;validateMessages(rows);ocrTask=null;setReviewRows(rows.map(r=>({...r,uncertain:true})));showReview();
   const preview=document.createElement('details');preview.className='screenshot-preview';preview.innerHTML='<summary>对照原截图 · '+previews.length+' 张</summary>'+previews.map(src=>`<img alt="本次选择的聊天截图" src="${src}">`).join('');document.querySelector('#review-rows')?.before(preview);toast('识别完成，核对后可保存并起草回复。');
  }catch(error){if(ocrTask!==task||!task.owner.isConnected)return;task.owner.querySelector('.ocr-progress')?.remove();task.owner.querySelector('#modal-error').textContent=task.controller.signal.aborted?'截图识别已停止或超时，请重新选择截图。':error.message;}finally{if(ocrTask===task)ocrTask=null;}
 }
 const nativeReceive=window.xianwaiReceiveOCR;
 window.xianwaiReceiveOCR=(rows,id)=>{const task=nativeChat;if(!task||id!==task.id)return;nativeChat=null;if(getState().active===task.chatId&&contextVersion===task.version)nativeReceive?.(rows);else toast('对话已切换，本次截图未导入，请重新选择。');};
 window.xianwaiOCRCancelled=id=>{if(nativeChat?.id===id)nativeChat=null;};
 async function paste(){try{const text=await navigator.clipboard.readText();if(text.length>2000||(/^(我|对方|她|他|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')))api.openImport(text);else api.quickPaste(text);}catch{api.quickPaste('');toast('在下方输入框长按粘贴，再点帮我回。');}}
 document.addEventListener('xianwai-modal-closing',()=>{if(pairTask?.owner)cancelPair();if(ocrTask)cancelOCR();});
 document.addEventListener('xianwai-context-changing',()=>{contextVersion++;cancelOCR();});
 document.addEventListener('xianwai-connection-error',event=>{phase='offline';draw();toast(event.detail);});
 document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-companion]');if(!target)return;
  try{switch(target.dataset.companion){
   case'screenshots':chooseImages();break;case'paste':await paste();break;case'connection':connectionHelp();break;
   case'edit-pair':connectionHelp(true);break;
   case'retry-backup':if(getState().token)await connect({endpoint:endpoint()||location.origin,token:getState().token},{save:getState().persist,remember:!!safeStorage.read('localStorage','xianwai-connection-v1'),live:getState().live});break;
   case'parse-pair':pairingModal(parsePair(document.querySelector('#pair-link').value.trim()));break;
   case'connect':{const owner=target.closest('.modal'),options={owner,remember:owner.querySelector('#remember-pair').checked,save:owner.querySelector('#remember-chats').checked};target.disabled=true;target.textContent='正在连接 Mac…';await connect({...pendingPair},options);break;}
   case'cancel':stopAnalysis();await cancelAnalysis();toast('已取消分析。');break;
   case'disconnect':disconnect();closeModal();render();toast('已断开 Mac 连接，聊天与收藏仍在当前设备。');break;
  }}catch(error){const node=document.querySelector('#modal-error');if(node)node.textContent=error.message;else toast(error.message);}
 });
 window.xianwaiPersistWorkspace=s=>{if(connected&&s.persist)try{sync.schedule({schemaVersion:2,folders:s.folders,activeUpdatedAt:s.activeUpdatedAt,active:s.active,chats:s.chats,favorites:s.favorites});}catch(error){toast(error.message);}};
 window.xianwaiDeleteBackup=async()=>{if(!connected){let remembered=false;remembered=!!(safeStorage.read('localStorage','xianwai-connection-v1')||safeStorage.read('sessionStorage','xianwai-connection-v1'));if(remembered||getState().token)throw new Error('请先重新连接 Mac，再清除 Mac 备份。当前设备的记录未改动。');return;}if(!getState().persist){const pair={endpoint:endpoint(),token:getState().token},backup=await query(pair,'/api/workspace',AbortSignal.timeout(12000));sync.connect({...pair,revision:backup.revision});}await sync.clear();analysisClient.clearCache();};
 window.xianwaiSettingsSaved=()=>{if(connected){let permanent=false;permanent=!!safeStorage.read('localStorage','xianwai-connection-v1');rememberPair({endpoint:endpoint()||location.origin,token:getState().token},permanent);}};
 window.xianwaiBeforeSettings=async(candidate,signal)=>{
  const s=getState();
  if(candidate.endpoint!==s.endpoint||candidate.token!==s.token){disconnect();return;}
  if(!candidate.persist){sync.disconnect();return;}
  if(connected&&!s.persist){const health=await query({endpoint:endpoint(),token:s.token},'/api/health',signal);if(health.workspaceSchema!==2)throw new Error('请先将 Mac 弦外升级到 0.4.0，再保存联系人资料库。');const pair={endpoint:endpoint(),token:s.token},backup=await query(pair,'/api/workspace',signal);if(signal.aborted)return;const restored=mergeWorkspaces(backup.workspace,localWorkspace());sync.connect({...pair,revision:backup.revision});applyWorkspace(restored.workspace);}
 };
 const observer=new MutationObserver(()=>{const box=document.querySelector('#endpoint');if(connected&&box&&!document.querySelector('[data-companion="disconnect"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='disconnect';b.textContent='断开这台设备与 Mac 的连接';box.parentElement.append(b);}});observer.observe(document.querySelector('#modal-root'),{childList:true,subtree:true});
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('key')){try{const pair=parsePair(location.href);pairingModal(pair);}catch(error){toast(error.message);}}
 else{let saved,remember=true,savedLive=true;try{const local=safeStorage.read('localStorage','xianwai-connection-v1');remember=!!local;saved=JSON.parse(local||safeStorage.read('sessionStorage','xianwai-connection-v1')||'null');savedLive=saved?.live!==false;if(saved)saved=parsePair('https://pair.invalid/#bridge='+encodeURIComponent(saved.endpoint)+'&key='+encodeURIComponent(saved.token));}catch{saved=null;}if(saved)void connect(saved,{remember,save:getState().persist,live:savedLive});}
 async function checkConnection(){
  const s=getState();if(document.hidden||pairTask||heartbeat||!s.token)return;
  const pair={endpoint:endpoint()||location.origin,token:s.token};
  heartbeat=probeConnection(pair,{attempts:1});
  try{const status=await heartbeat;if(s!==getState()||pair.token!==getState().token||pair.endpoint!==(endpoint()||location.origin))return;connected=true;aiReady=status.ready;ocrAvailable=!!status.ocr;phase='connected';draw();}
  catch{if(pair.token===getState().token){phase='offline';draw();}}
  finally{heartbeat=null;}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkConnection();else void sync.flush();});
 window.addEventListener('online',()=>void checkConnection());
 window.addEventListener('pagehide',()=>void sync.flush());
 setInterval(()=>void checkConnection(),20000);
 draw();
}


const libraryDate=(value,detail=false)=>value?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',...(detail?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value)):'较早记录';
function createLibraryUI(api){
 const {getState,current,modal,closeModal,persist,render,toast,selectChat,openRecord,icon,escape:esc}=api;
 const contacts=()=>getState().chats.filter(chat=>!isSampleChat(chat));
 const folders=()=>getState().folders.filter(folder=>!folder.deleted);
 const folderOptions=selected=>'<option value="">未分类</option>'+folders().map(folder=>`<option value="${esc(folder.id)}" ${folder.id===selected?'selected':''}>${esc(folder.name)}</option>`).join('');
 const folderName=chat=>folders().find(folder=>folder.id===chat.folderId)?.name||'未分类';
 const countRecords=()=>contacts().reduce((total,chat)=>total+chat.analyses.length,0);
 function tree(){
  const s=getState(),real=contacts();
  const row=chat=>`<button class="conversation ${chat.id===s.active&&s.page==='chat'?'active':''}" data-chat="${esc(chat.id)}"><span class="avatar">${esc(chat.name.slice(0,1))}</span><span><strong>${esc(chat.name)}</strong><small>${chat.messages.length} 条消息 · ${chat.analyses.length} 次分析</small></span></button>`;
  const group=(id,name)=>{const list=real.filter(chat=>(chat.folderId||'unfiled')===id);return `<details class="contact-folder" open><summary>${icon('folder')}<span>${esc(name)}</span><small>${list.length}</small></summary><button class="folder-overview" data-library-folder="${esc(id)}">查看此分类</button>${list.map(row).join('')}${list.length?'':'<p class="folder-empty">还没有联系人</p>'}</details>`;};
  return `<div class="library-tree-title"><span>联系人资料库</span><button class="icon-btn" data-library-action="new-folder" aria-label="新建文件夹">${icon('plus')}</button></div><div class="contact-library-tree"><button class="all-contacts" data-library-folder="all">${icon('folder')}全部联系人 <small>${real.length}</small></button>${folders().map(folder=>group(folder.id,folder.name)).join('')}${group('unfiled','未分类')}${s.chats.some(isSampleChat)?`<details class="contact-folder sample-folder"><summary>${icon('book')}体验示例</summary>${s.chats.filter(isSampleChat).map(row).join('')}</details>`:''}</div>`;
 }
 function renderContacts(){
  const s=getState(),filter=s.folderFilter||'all',selected=folders().find(folder=>folder.id===filter),list=contacts().filter(chat=>filter==='all'||(chat.folderId||'unfiled')===filter).sort((a,b)=>b.updatedAt-a.updatedAt),name=filter==='all'?'联系人与文件夹':selected?.name||'未分类';
  return `<div class="workspace-header library-heading"><div><div class="eyebrow">YOUR CONVERSATIONS, KEPT TOGETHER</div><h1>${esc(name)}</h1><p>同一个人，持续接着聊。前文、分析和草稿会一起保留。</p></div><button class="primary-btn" data-library-action="new-contact">${icon('plus')}新建联系人</button></div><div class="page-content library-content"><div class="library-toolbar"><button class="outline-btn" data-library-folder="all">全部联系人</button><button class="outline-btn" data-library-action="new-folder">${icon('folder')}新建文件夹</button>${selected?`<button class="outline-btn" data-library-edit-folder="${esc(selected.id)}">整理这个文件夹</button>`:''}<button class="outline-btn" data-library-action="export-all">${icon('download')}导出资料库</button></div>${filter==='all'?`<div class="folder-grid">${folders().map(folder=>`<button class="folder-card" data-library-folder="${esc(folder.id)}">${icon('folder')}<strong>${esc(folder.name)}</strong><small>${contacts().filter(chat=>chat.folderId===folder.id).length} 位联系人</small></button>`).join('')}<button class="folder-card" data-library-folder="unfiled">${icon('folder')}<strong>未分类</strong><small>${contacts().filter(chat=>!chat.folderId).length} 位联系人</small></button></div>`:''}<p class="library-retention">${icon('shield')}${s.persist?'自动保存已开启；连接 Mac 后也会备份到 Mac。':'当前为临时模式。要跨天保留，请在设置中开启“保存聊天与收藏”。'}</p><div class="contact-grid">${list.map(chat=>`<article class="contact-card"><div class="contact-card-head"><span class="avatar peach">${esc(chat.name.slice(0,1))}</span><div><h2>${esc(chat.name)}</h2><p>${esc(chat.title)}</p></div><span class="folder-tag">${esc(folderName(chat))}</span></div><p class="contact-preview">${esc(chat.messages.at(-1)?.text||'还没有消息，可以粘贴一句或导入历史。')}</p><div class="contact-metadata"><span>${chat.messages.length} 条消息 · ${chat.analyses.length} 次分析</span><small>${chat.updatedAt?'最近记录 '+libraryDate(chat.updatedAt,true):'还没有新记录'}</small></div><div class="contact-card-actions"><button class="primary-btn" data-chat="${esc(chat.id)}">继续聊天 ${icon('arrow')}</button><button class="outline-btn" data-library-history="${esc(chat.id)}">分析记录</button><button class="icon-btn" data-library-move="${esc(chat.id)}" aria-label="整理 ${esc(chat.name)} 的分类">${icon('folder')}</button></div></article>`).join('')}</div>${list.length?'':'<div class="empty-state"><h2>给持续的聊天留个位置</h2><p>创建联系人后，每天在同一位联系人下补充消息，昨天的前文会继续保留。</p><button class="primary-btn" data-library-action="new-contact">新建联系人</button></div>'}</div>`;
 }
 function renderHistory(){
  const s=getState(),filter=s.historyContact||'all',all=contacts().flatMap(chat=>chat.analyses.map(record=>({chat,record}))).filter(item=>filter==='all'||item.chat.id===filter).sort((a,b)=>b.record.createdAt-a.record.createdAt);
  let priorDay='';const rows=all.map(({chat,record})=>{const day=libraryDate(record.createdAt),heading=day!==priorDay?`<h2 class="history-day">${day}</h2>`:'';priorDay=day;const target=recordContext(chat,record).at(-1),search=[chat.name,chat.title,target?.text,record.result.title,record.result.feeling,record.result.need,record.result.question,...record.result.hypotheses.map(item=>item.text),...Object.values(record.drafts),...record.result.replies.map(reply=>reply.text)].join(' ').toLowerCase();return `${heading}<article class="analysis-history-card" data-history-search="${esc(search)}"><div class="history-card-meta"><strong>${esc(chat.name)}</strong><span>${libraryDate(record.createdAt,true)}</span><span class="history-mode">${record.result.mode==='ai'?'AI 分析':'本地规则'}</span></div><p class="history-target">“${esc(target?.text||'')}”</p><h3>${esc(record.result.title)}</h3><p class="history-reply">${esc(record.drafts[record.tone]??(record.result.replies.find(reply=>reply.tone===record.tone)?.text||''))}</p><small>${record.contextIds.length} 条当时前文 · ${Object.keys(record.drafts).length?'含你编辑过的草稿':'已保存三种回复语气'}</small><div class="history-actions"><button class="primary-btn" data-library-open-record="${esc(record.id)}" data-library-chat="${esc(chat.id)}">查看分析</button><button class="outline-btn" data-chat="${esc(chat.id)}">继续聊天</button><button class="icon-btn" data-library-delete-record="${esc(record.id)}" data-library-chat="${esc(chat.id)}" aria-label="删除这条分析记录">${icon('trash')}</button></div></article>`;}).join('');
  return `<div class="workspace-header"><div><div class="eyebrow">SAVED WITH ITS CONTEXT</div><h1>保存下来的每一次理解</h1><p>按联系人和记录时间查找；打开后可查看当时的原文与草稿。</p></div></div><div class="page-content history-content"><div class="history-filters"><label>联系人<select id="history-contact" aria-label="筛选分析记录的联系人"><option value="all">全部联系人</option>${contacts().map(chat=>`<option value="${esc(chat.id)}" ${filter===chat.id?'selected':''}>${esc(chat.name)} · ${esc(chat.title)}</option>`).join('')}</select></label><label>查找记录<input id="history-search" type="search" placeholder="搜索原话、分析或回复…" value="${esc(s.historyQuery||'')}"></label><button class="outline-btn" data-library-action="export-all">${icon('download')}导出资料库</button></div><p class="library-retention">${icon('shield')}${s.persist?'已开启自动保存。分析保留当时前文，后续新消息不会改写旧记录。':'临时模式：这些记录尚未持久保存，请在设置中开启保存。'}</p><div class="history-list">${rows||'<div class="empty-state"><h2>还没有分析记录</h2><p>在联系人聊天中选择一句消息，每次分析会自动记在这里。</p><button class="primary-btn" data-page="chat">回到聊天</button></div>'}</div><p id="history-no-match" class="folder-empty" hidden>没有匹配的分析记录。</p></div>`;
 }
 function filterHistory(){const query=(getState().historyQuery||'').trim().toLowerCase();let visible=0;document.querySelectorAll('[data-history-search]').forEach(node=>{node.hidden=!node.dataset.historySearch.includes(query);if(!node.hidden)visible++;});document.querySelectorAll('.history-day').forEach(node=>{let next=node.nextElementSibling,has=false;while(next&&!next.classList.contains('history-day')){if(next.matches('[data-history-search]')&&!next.hidden)has=true;next=next.nextElementSibling;}node.hidden=!has;});const empty=document.querySelector('#history-no-match');if(empty)empty.hidden=!!visible||!query;}
 function newContact(){modal('新建联系人','以后每天在同一位联系人下补充消息，前文和分析会持续保留。',`<label for="contact-name">对方的称呼</label><input id="contact-name" maxlength="20" placeholder="例如：小满"><label for="contact-label">资料标题 · 可选</label><input id="contact-label" maxlength="30" placeholder="例如：和小满的日常"><label for="contact-folder">放进文件夹</label><select id="contact-folder">${folderOptions(getState().folderFilter)}</select>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-action="create-contact">创建并继续聊天</button>`);}
 function newFolder(){modal('新建文件夹','按你的习惯分类，例如伴侣、家人、朋友。',`<label for="folder-name">文件夹名称</label><input id="folder-name" maxlength="24" placeholder="例如：伴侣">`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-action="create-folder">创建文件夹</button>`);}
 function editFolder(id){const folder=folders().find(folder=>folder.id===id);if(!folder)return;modal('整理文件夹','重命名会保留其中的联系人。删除文件夹只会将联系人移到“未分类”。',`<label for="folder-name">文件夹名称</label><input id="folder-name" maxlength="24" value="${esc(folder.name)}"><button class="danger-btn" data-library-remove-folder="${esc(id)}">删除此文件夹…</button>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-save-folder="${esc(id)}">保存名称</button>`);}
 function showMove(id){const chat=getState().chats.find(chat=>chat.id===id);if(!chat)return;modal('整理联系人的分类',`为 ${esc(chat.name)} 选择文件夹，聊天和分析记录都会保留。`,`<label for="move-folder">文件夹</label><select id="move-folder">${folderOptions(chat.folderId)}</select>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-confirm-move="${esc(id)}">保存分类</button>`);}
 function download(value,name){const text=JSON.stringify(value,null,2);if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'export',text});return;}const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('已导出，包含聊天原文、分析和编辑后的草稿。');}
 function exportContact(chat=current()){download({format:'xianwai-contact',version:1,exportedAt:Date.now(),folder:folderName(chat),contact:chat},'弦外-'+chat.name+'-联系人资料.json');}
 function showContext(chatId,recordId,highlight=0){const chat=getState().chats.find(chat=>chat.id===chatId),record=chat?.analyses.find(record=>record.id===recordId);if(!record)return;const context=recordContext(chat,record);modal('分析时的前文',`记录于 ${libraryDate(record.createdAt,true)} · ${esc(chat.name)} · 后续消息未用于这次分析。`,`<div class="snapshot-context">${context.map((message,index)=>`<article class="snapshot-message ${index===highlight?'snapshot-highlight':''}"><small>原话 ${index+1} · ${message.role==='me'?'我':esc(chat.name)}</small><p>${esc(message.text)}</p></article>`).join('')}</div>${record.note?`<details class="snapshot-note"><summary>当时保存的关系背景</summary><p>${esc(record.note)}</p></details>`:''}`,`<button class="primary-btn" data-action="close-modal">返回分析</button>`);}
 const error=message=>{const node=document.querySelector('#modal-error');if(node)node.textContent=message;else toast(message);};
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;const s=getState(),data=button.dataset;
  try{
   if(data.libraryFolder){s.folderFilter=data.libraryFolder;s.page='contacts';s.mobileSheet=false;render();return;}
   if(data.libraryHistory){s.historyContact=data.libraryHistory;s.historyQuery='';s.page='history';s.mobileSheet=false;render();return;}
   if(data.libraryMove){showMove(data.libraryMove);return;}
   if(data.libraryEditFolder){editFolder(data.libraryEditFolder);return;}
   if(data.libraryOpenRecord){openRecord(data.libraryChat,data.libraryOpenRecord);return;}
   if(data.libraryContext){showContext(s.active,data.libraryContext,Number(data.highlight||0));return;}
   if(data.libraryConfirmMove){const chat=s.chats.find(chat=>chat.id===data.libraryConfirmMove);moveContact(chat,document.querySelector('#move-folder').value);persist();closeModal();render();toast('已保存分类。');return;}
   if(data.librarySaveFolder){const name=document.querySelector('#folder-name').value.trim();if(!name)throw new Error('请填写文件夹名称。');if(folders().some(folder=>folder.id!==data.librarySaveFolder&&folder.name===name))throw new Error('已有同名文件夹。');const folder=s.folders.find(folder=>folder.id===data.librarySaveFolder);folder.name=name;folder.updatedAt=Date.now();persist();closeModal();render();return;}
   if(data.libraryRemoveFolder){modal('删除这个文件夹？','其中的联系人、聊天前文和分析都不会删除，只会移到“未分类”。','',`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-confirm-remove-folder="${esc(data.libraryRemoveFolder)}">移到未分类并删除文件夹</button>`);return;}
   if(data.libraryConfirmRemoveFolder){const now=Date.now(),folder=s.folders.find(folder=>folder.id===data.libraryConfirmRemoveFolder);folder.deleted=true;folder.updatedAt=now;s.chats.filter(chat=>chat.folderId===folder.id).forEach(chat=>moveContact(chat,null,now));s.folderFilter='all';persist();closeModal();render();return;}
   if(data.libraryDeleteRecord){modal('删除这条分析记录？','只删除这次分析及其草稿，当前聊天消息与其他分析不会受影响。','',`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-library-confirm-delete-record="${esc(data.libraryDeleteRecord)}" data-library-chat="${esc(data.libraryChat)}">删除这次分析</button>`);return;}
   if(data.libraryConfirmDeleteRecord){const chat=s.chats.find(chat=>chat.id===data.libraryChat);deleteAnalysisRecord(chat,data.libraryConfirmDeleteRecord);if(s.activeRecord===data.libraryConfirmDeleteRecord)api.invalidate();persist();closeModal();render();return;}
   switch(data.libraryAction){
    case'new-contact':newContact();break;
    case'new-folder':newFolder();break;
    case'create-contact':{const name=document.querySelector('#contact-name').value.trim();if(!name)throw new Error('请填写对方的称呼。');s.chats=s.chats.filter(chat=>!(chat.title==='我的聊天'&&chat.name==='对方'&&chat.subtitle==='常用对话'&&!chat.messages.length&&!chat.analyses.length&&!chat.note&&!chat.style&&!chat.composer.text));if(contacts().length>=15)throw new Error('最多保留 15 位联系人。');if(s.chats.length>=15)s.chats=s.chats.filter(chat=>!isSampleChat(chat));const now=Date.now(),chat={id:crypto.randomUUID(),name,title:document.querySelector('#contact-label').value.trim()||'和'+name+'的聊天',note:'',style:'',subtitle:'持续聊天',preferredTone:'warm',...normalizeContactMemory({messages:[],updatedAt:now,folderId:document.querySelector('#contact-folder').value||null,folderUpdatedAt:now})};s.chats.unshift(chat);closeModal();selectChat(chat.id);toast('联系人已创建。今天和明天，都可以从这里继续。');break;}
    case'create-folder':{const name=document.querySelector('#folder-name').value.trim();if(!name)throw new Error('请填写文件夹名称。');if(folders().some(folder=>folder.name===name))throw new Error('已有同名文件夹。');if(folders().length>=LIBRARY_LIMITS.folders)throw new Error('最多创建 20 个文件夹。');s.folders.push({id:crypto.randomUUID(),name,updatedAt:Date.now(),deleted:false});s.folderFilter=s.folders.at(-1).id;s.page='contacts';persist();closeModal();render();break;}
    case'export-all':download({format:'xianwai-library',version:1,exportedAt:Date.now(),workspace:{schemaVersion:2,active:s.active,activeUpdatedAt:s.activeUpdatedAt,chats:s.chats,favorites:s.favorites,folders:s.folders}},'弦外-完整资料库.json');break;
    case'export-contact':exportContact();break;
    case'open-resume':if(current().resumeId)openRecord(s.active,current().resumeId);break;
   }
  }catch(problem){error(problem.message);}
 });
 document.addEventListener('change',event=>{if(event.target.id==='history-contact'){getState().historyContact=event.target.value;render();}});
 document.addEventListener('input',event=>{if(event.target.id==='history-search'){getState().historyQuery=event.target.value;filterHistory();}});
 return {tree,renderContacts,renderHistory,filterHistory,newContact,folderOptions,folderName,countRecords,exportContact};
}

const paths={folder:'M3 7V4h6l2 3h10v14H3V7z',clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',chat:'M4 4h16v12H9l-5 5V4z',plus:'M12 5v14M5 12h14',book:'M4 4h6c1 0 2 1 2 2v15c0-2-2-3-4-3H4V4zm16 0h-6c-1 0-2 1-2 2v15c0-2 2-3 4-3h4V4z',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3zM9 12l2 2 4-4',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',upload:'M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5',spark:'m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3z',arrow:'M5 12h14m-6-6 6 6-6 6',send:'m3 3 19 9-19 9 4-9-4-9zm4 9h15',copy:'M9 9h12v12H9zM15 5V3H3v12h2',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',menu:'M4 6h16M4 12h16M4 18h16',down:'m6 9 6 6 6-6',more:'M5 12h.01M12 12h.01M19 12h.01',warn:'m12 3 10 18H2L12 3zm0 6v5m0 3h.01',link:'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2',edit:'m16 3 5 5-13 13H3v-5L16 3z',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',photo:'M3 4h18v16H3zm0 12 5-5 5 5 4-4 4 4M15 8h.01',lock:'M6 11h12v10H6zm2 0V7a4 4 0 1 1 8 0v4',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4'};
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.chat}"/></svg>`;
const esc=(x='')=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sample=(id,title,name,subtitle,messages)=>({id,title,name,subtitle,note:'',messages:messages.map(([role,text])=>({role,text}))});
const samples=[sample('late','晚归的约定','小满','关于陪伴与期待',[
 ['partner','今天有点累，想早点回家。'],['me','辛苦啦，晚上一起吃饭？'],['partner','好呀，我等你。'],['me','临时有个会，可能要晚一点。'],['partner','大概多久呀？我还没吃。'],['me','还不确定，你先吃吧。'],['partner','算了，你忙吧。']
]),sample('tired','忙碌的一天','小满','先倾听，再给建议',[
 ['partner','今天的方案又被打回来了。'],['me','那你明天再改改？'],['partner','已经改三次了，真的好累。']
]),sample('weekend','周末的小计划','小满','把约定说清楚',[
 ['partner','周六我们去看那个展吧？'],['me','好，等我忙完订票。'],['partner','你上次也这么说，后来就忘了。']
])];
const freshChat={id:crypto.randomUUID(),title:'我的聊天',name:'对方',subtitle:'常用对话',note:'',style:'',preferredTone:'warm',messages:[]};
let state={chats:[freshChat,...structuredClone(samples)],active:freshChat.id,page:'chat',selected:null,tone:'warm',replyDrafts:{},analysis:null,favorites:[],persist:true,folders:[],activeUpdatedAt:0,activeRecord:null,folderFilter:'all',historyContact:'all',historyQuery:'',live:false,endpoint:'',token:'',loading:false,mobileSheet:false,composerDrafts:{}};
state={...state,...normalizeWorkspace(state)};
let localRecovery=null;
try{const raw=safeStorage.read('localStorage','xianwai-v1');if(raw){try{const saved=JSON.parse(raw);if(saved?.persist){const workspace=normalizeWorkspace(saved);if(!workspace.chats.length)throw new Error();state={...state,...workspace,persist:true};}}catch{localRecovery=raw;}}}catch{}
const $=(s,root=document)=>root.querySelector(s);const current=()=>state.chats.find(c=>c.id===state.active)||state.chats[0];let generation=0,toastTimer,reviewRows=[],clearing=false,progressTimer;
state.tone=current().preferredTone||'warm';
function adoptCurrent(){const c=current();if(samples.some(sample=>sample.id===c.id)){c.id=crypto.randomUUID();state.active=c.id;c.title='我的聊天';c.name='对方';c.subtitle='已导入的聊天';}return c;}
function persist(){
 if(clearing)return;if(localRecovery){toast('本机旧记录格式异常，已保留原文件。请在设置中下载后清除。');return;}
 const c=current();if(c&&state.composerDrafts[c.id])c.composer={...state.composerDrafts[c.id]};
 try{const workspace=normalizeWorkspace(state);if(state.persist){if(!safeStorage.write('localStorage','xianwai-v1',JSON.stringify({persist:true,...workspace}))){state.saveError='本机保存失败，请导出并检查 Mac 备份';toast('本机空间不足或浏览器未允许保存，请及时导出资料库；Mac 备份仍会尝试保存。');}else state.saveError='';}else safeStorage.remove('localStorage','xianwai-v1');window.xianwaiPersistWorkspace?.({...state,...workspace});}catch(error){state.saveError='未能保存：'+error.message;toast(state.saveError);}
 const status=$('#local-save-state');if(status)status.textContent=state.saveError||(state.persist?'已自动保存':'仅当前页面');
}
function saveProgress(){const c=current();if(state.activeRecord)updateRecordDraft(c,state.activeRecord,state.tone,state.replyDrafts);clearTimeout(progressTimer);progressTimer=setTimeout(persist,350);}
function savedRecord(){return current().analyses?.find(record=>record.id===state.activeRecord);}
function restoreProgress(open=false){
 const c=current(),record=c.analyses?.find(record=>record.id===c.resumeId);
 state.activeRecord=record?.id||null;state.analysis=record?.result||null;const index=record?c.messages.findIndex(message=>message.id===record.targetId):-1;state.selected=index>=0?index:null;state.replyDrafts={...(record?.drafts||{})};state.tone=record?.tone||c.preferredTone||'warm';state.mobileSheet=!!record&&open;
 if(!state.composerDrafts[c.id])state.composerDrafts[c.id]={...(c.composer||{text:'',role:'partner'})};
}
function openRecord(chatId,recordId){
 const chat=state.chats.find(chat=>chat.id===chatId);if(!chat?.analyses.some(record=>record.id===recordId))return;
 invalidate();state.active=chatId;state.activeUpdatedAt=Date.now();state.page='chat';chat.resumeId=recordId;chat.resumeUpdatedAt=Date.now();restoreProgress(true);persist();closeModal();render();
}
function toast(t){const node=$('#toast');node.textContent=t;node.classList.add('toast-show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('toast-show'),3200);}
function header(title,sub,eyebrow='A LITTLE CLOSER',button='import'){return `<div class="workspace-header"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${button?`<button class="outline-btn" data-action="${button}">${icon('upload')}导入聊天</button>`:''}</div>`;}
const pageLabel=()=>({chat:'聊天工作台',contacts:'联系人与文件夹',history:'分析记录',favorites:'回复收藏',guide:'使用指南'}[state.page]||'聊天工作台');
function render(){
 const c=current();$('#app').innerHTML=`<div class="app-shell"><aside class="sidebar" id="sidebar"><div class="brand"><span class="brandmark">${icon('chat')}</span><div><strong>弦外</strong><small>BETWEEN THE LINES</small></div></div><button class="new-chat" data-action="new">${icon('plus')}新建联系人</button><nav aria-label="主导航">${[['chat','chat','聊天工作台'],['contacts','folder','联系人与文件夹'],['history','clock','分析记录'],['favorites','heart','回复收藏'],['guide','book','使用指南']].map(([id,i,label])=>`<button class="nav-item ${state.page===id?'active':''}" data-page="${id}">${icon(i)}${label}${id==='favorites'?`<span class="count">${state.favorites.length}</span>`:id==='history'?`<span class="count">${libraryUI.countRecords()}</span>`:''}</button>`).join('')}</nav>${libraryUI.tree()}<div class="sidebar-bottom"><div class="privacy-card">${icon('shield')}<p>${state.persist?'联系人与分析自动保存':'临时模式 · 关闭页面不保留'}<br>前文、分析和草稿由你掌握。</p></div><button class="settings-btn" data-action="settings">${icon('settings')}设置与隐私</button></div></aside><main class="workspace"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>沟通，有回声。</span><span>/</span><span>${pageLabel()}</span></div><div class="top-actions"><button class="mode-pill" data-action="settings"><span class="dot"></span>${state.live?'AI 服务已选择':'本地规则'}</button><button class="icon-btn" data-page="guide" aria-label="使用指南">${icon('book')}</button><span class="header-avatar">我</span></div></header>${state.page==='chat'?renderChat():state.page==='contacts'?libraryUI.renderContacts():state.page==='history'?libraryUI.renderHistory():state.page==='favorites'?renderFavorites():renderGuide()}</main></div>`;
 if(state.page==='chat'){renderAnalysis();const box=$('.chat-messages');if(box)box.scrollTop=box.scrollHeight;}if(state.page==='history')libraryUI.filterHistory();bindLongPress();window.xianwaiCompanionRendered?.();
}
function renderChat(){
 const c=current();
 return `${header('这句话，怎么回？','接着上次的前文，继续和同一个人聊。')}
 <div class="workbench"><section class="chat-panel" aria-label="聊天上下文">
  <div class="chat-head"><span class="avatar peach">${esc(c.name.slice(0,1))}</span>
   <label class="contact-picker"><span>正在和谁聊</span><select id="active-chat" aria-label="切换当前对话">${state.chats.map(chat=>`<option value="${esc(chat.id)}" ${chat.id===c.id?'selected':''}>${esc(chat.name)} · ${esc(chat.title)}${samples.some(x=>x.id===chat.id)?'（示例）':''}</option>`).join('')}</select></label>
   <button class="icon-btn" data-action="profile" aria-label="编辑对话与说话习惯">${icon('settings')}</button>
  </div>
  <div class="context-bar">${icon('folder')}${esc(libraryUI.folderName(c))} · ${c.messages.length} 条前文 <span>不会自动读取微信</span></div><div class="contact-progress"><button data-library-history="${esc(c.id)}">${icon('clock')}分析记录 · ${c.analyses.length}</button>${c.resumeId?`<button data-library-action="open-resume">继续上次分析 ${icon('arrow')}</button>`:`<small>${state.persist?'自动保存已开启':'临时模式，尚未持久保存'}</small>`}</div>
  ${c.messages.at(-1)?.role==='partner'?`<button class="latest-reply" data-action="reply-latest">${icon('spark')}帮我回最新一句 ${icon('arrow')}</button>`:''}
  <div class="chat-messages"><div class="date-divider">${samples.some(x=>x.id===c.id)?'虚构示例 · 仅供体验':'你的聊天上下文'}</div>
   ${c.messages.length?c.messages.map((m,i)=>`${m.createdAt&&(!i||libraryDate(m.createdAt)!==libraryDate(c.messages[i-1].createdAt))?`<div class="date-divider">记录于 ${libraryDate(m.createdAt)}</div>`:''}<div class="msg ${m.role==='me'?'me':''} ${i===state.selected?'selected':''}" id="msg-${i}"><span class="avatar ${m.role==='partner'?'peach':''}">${m.role==='me'?'我':esc(c.name.slice(0,1))}</span><div class="msg-body"><div class="msg-name">${m.role==='me'?'我':esc(c.name)} <span style="opacity:.55">· ${i+1}</span></div><button class="bubble" data-message="${i}" aria-label="分析第 ${i+1} 条消息：${esc(m.text)}">${esc(m.text)}</button>${state.selected===i?`<div class="selected-hint">${icon('spark')}已选中这句话</div>`:''}</div></div>`).join(''):`<div class="empty-state"><h2>复制她刚发的那句话</h2><p>在下方粘贴，再点“帮我回”。<br>已有聊天可先导入截图，前情会一起参考。</p><button class="outline-btn" data-action="profile">${icon('edit')}设置称呼和说话习惯</button></div>`}
  </div>
  <div class="chat-tip">${icon('shield')}复制草稿不会自动记为已发送</div>
  <form class="composer quick-composer" id="composer" data-chat-id="${esc(c.id)}"><select name="role" aria-label="添加消息的发送者"><option value="partner" ${state.composerDrafts[c.id]?.role!=='me'?'selected':''}>对方</option><option value="me" ${state.composerDrafts[c.id]?.role==='me'?'selected':''}>我</option></select><textarea name="message" aria-label="对方刚发的消息" placeholder="粘贴对方刚发的一句…" maxlength="2000" rows="2">${esc(state.composerDrafts[c.id]?.text||'')}</textarea><button type="submit" aria-label="帮我回这句话">${state.composerDrafts[c.id]?.role==='me'?'记录这句':'帮我回 '+icon('arrow')}</button></form>
  ${canUndoRecord(state.undoRecord,c)?'<button class="undo-record" data-action="undo-record">撤销刚才的“已发出”记录</button>':''}
 </section><div class="analysis-scrim ${state.mobileSheet?'open':''}" data-action="close-analysis"></div><section class="analysis-panel ${state.mobileSheet?'open':''}" aria-label="消息分析" id="analysis"></section></div>`;
}
function renderAnalysis(){
 const c=current(),node=$('#analysis');if(!node)return;
 const a=state.analysis,record=savedRecord(),m=record?recordContext(c,record).at(-1):c.messages[state.selected];
 let content;
 if(state.loading)content=`<div class="analysis-empty"><div class="spinner"></div><h3>正在帮你接这句话</h3><p>一次准备三种语气，切换时不用再等。<br>本次参考 ${state.analysisContextCount||state.selected+1} 条前文消息。</p></div>`;
 else if(!a||!m)content=`<div class="analysis-empty">${icon('chat')}<h3>${c.messages.length?'接着这段聊天，继续说':'先粘贴一句，或导入截图'}</h3><p>下方输入对方的新消息后点“帮我回”，<br>也可以选择历史中的某一句。</p>${state.analysisError?`<p class="error">${esc(state.analysisError)}</p><button class="outline-btn" data-action="retry">重新分析</button>`:''}</div>`;
 else{
  const reply=replyForTone(a,state.tone),draft=state.replyDrafts[state.tone]??reply.text;
  content=`<div class="analysis-scroll reply-first"><div class="quote"><span>回应 ${m.role==='me'?'自己的表达':esc(c.name)} · ${record?'保存的分析':'消息 '+(state.selected+1)}</span>“${esc(m.text)}”</div>
   ${record?`<div class="saved-analysis-status">${icon('clock')}记录于 ${libraryDate(record.createdAt,true)} · <span id="local-save-state">${state.saveError?esc(state.saveError):state.persist?'已自动保存':'仅当前页面'}</span><button data-library-context="${esc(record.id)}">查看当时前文</button></div>`:''}<div class="section-heading"><h3>${icon('spark')}先给你一条可改的草稿</h3><small>${a.mode==='local'?'本地规则提示':'三种语气已备好'}</small></div>
   <div class="tone-switch prominent-tones" aria-label="回复语气">${TONES.map(t=>`<button class="${state.tone===t.id?'active':''}" data-tone="${t.id}" aria-pressed="${state.tone===t.id}">${t.label}</button>`).join('')}</div>
   <article class="draft-card"><label for="reply-draft">${esc(reply.label)} · 可以直接修改</label><textarea id="reply-draft" maxlength="2000" rows="4" aria-label="可编辑的回复草稿">${esc(draft)}</textarea><p class="draft-reason">${esc(reply.reason)}</p><div class="draft-actions"><button class="primary-btn" data-action="copy-draft">${icon('copy')}复制这句</button><button class="outline-btn" data-action="save-draft">${icon('heart')}收藏</button><button class="outline-btn" data-action="record-draft">${icon('check')}我已发出</button></div><small>只有已在微信发送后，再点“我已发出”补入前文。</small></article>
   <div class="gentle-note">${icon('shield')}${state.analysisError?`<p class="error">${esc(state.analysisError)}</p>`:''}先确认符合实际情况，再复制发送。${a.mode==='local'?' 当前使用本地规则，并未调用大模型。':''}</div>
   <details class="understanding"><summary>${icon('heart')}看看为什么这样回 <span>可能的解释与原话依据</span></summary>
    <div class="insight-card"><div class="mini-label">推测，需要和本人确认</div><h3>${esc(a.title)}</h3><p><b>可能的感受</b> · ${esc(a.feeling)}</p><p><b>值得确认的需求</b> · ${esc(a.need)}</p></div>
    ${a.hypotheses.map(h=>`<div class="hypothesis">${esc(h.text)}${citations(h.evidence)}</div>`).join('')}
    <div class="confirm-question"><b>也可以直接确认</b><p>${esc(a.question)}</p></div>
    <details class="facts"><summary>原话依据 · ${a.contextCount} 条语境消息</summary>${a.facts.map(f=>`<p class="fact">${esc(f.text)}${citations(f.evidence)}</p>`).join('')}<p class="fact">${record?'这条分析只使用保存时目标及之前最近的前文（最多 300 条、8 万字），后续新增或替换的消息未用于起草。':'目标之后的 '+(c.messages.length-state.selected-1)+' 条消息未用于起草；'}${a.mode==='ai'&&(record?record.style:c.style)?'生成时参考了当时保存的说话习惯。':a.mode==='local'?'本地规则未调用模型。':'可在对话设置中补充自己的说话习惯。'}</p></details>
   </details><div class="avoid">${icon('warn')}<div>${esc(a.avoid)}</div></div><div class="analysis-foot">解释可能不准确，真正的答案来自你们的沟通。</div></div>`;
 }
 node.innerHTML=`<div class="analysis-header"><div class="analysis-title">${icon('spark')}<h2>帮你把话接下去</h2></div><small>${state.loading?'AI 正在起草':a?.mode==='ai'?'AI 语境分析':state.live?'AI 已就绪':'本地规则试用'}</small><button class="icon-btn mobile-close" data-action="close-analysis" aria-label="关闭分析">${icon('close')}</button></div>${content}`;
 window.xianwaiCompanionRendered?.();
}
function citations(ids){const record=savedRecord();return(ids||[]).map(id=>{const index=record?current().messages.findIndex(message=>message.id===record.contextIds[id-1]):(state.analysisContextStart||0)+id-1;return index>=0?`<button class="citation" data-ref="${index}">原话 ${id}</button>`:`<button class="citation" data-library-context="${esc(record.id)}" data-highlight="${id-1}">原话 ${id}</button>`;}).join('');}
function renderFavorites(){return `${header('留住，好好说话的时刻。','收藏的回复只属于你的工作台。','WORDS TO KEEP',null)}<div class="page-content">${state.favorites.length?state.favorites.map(f=>`<article class="collection-item"><small>${esc(f.name)} · ${esc(f.label)}</small><p>${esc(f.text)}</p><footer><small>${esc(f.source||'自定义回复')}</small><button class="outline-btn" data-fav-copy="${esc(f.id)}">${icon('copy')}复制</button><button class="icon-btn" data-fav-remove="${esc(f.id)}" aria-label="移除收藏">${icon('trash')}</button></footer></article>`).join(''):`<div class="empty-state"><h2>一句合适的话，值得留下</h2><p>在回复建议旁点击爱心，即可收藏。<br>${state.persist?'本机保存已开启。':'默认关闭页面后清除，可在设置中开启本机保存。'}</p><button class="primary-btn" data-page="chat">回到聊天工作台 ${icon('arrow')}</button></div>`}</div>`;}
function renderGuide(){return `${header('靠近，从听懂开始。','用工具留意语境，用真实的沟通确认彼此。','A SMALL GUIDE',null)}<div class="page-content"><div class="reading-grid">${[['01','把语境放在一起','每批导入最多 300 条、8 万字，核对后追加到同一联系人。每位联系人最多保留 1500 条当前消息，跨天继续追加。','连接 Mac 后，网页可从相册批量选择微信截图，在 Mac 使用 Apple Vision 识别。识别后先核对顺序、发送者和文字，再分析。'],['02','选中你想回应的那一句','在本工作台里长按、点击消息，或用键盘选中后按 Enter。分析使用目标及之前最近的前文，最多 300 条、8 万字；不会使用目标之后的消息。可补充关系背景。','iOS 的应用隔离限制了跨 App 读取。这个版本不会读取微信后台，也不能在微信原有的长按菜单中添加功能。'],['03','先看依据，再选怎么说','分析把原话和可能的解释分开。点击“原话”可定位消息。没有单句消息能证明一个人的真实心思。','用温柔、坦诚、简短三种语气起草回复。根据自己的真实情况编辑后复制，再回微信发送；不要承诺做不到的事。'],['04','让私密内容由你决定','联系人、聊天、分析和草稿默认保存在当前设备（未加密）。配对时可备份到 Mac；关闭保存进入临时模式，可随时导出或清除。','手机扫码连接 Mac 可复用已登录的 Codex，无需密钥。截图通过 Cloudflare 连接到 Mac；选择分析时相关文字发送给 OpenAI。模型结果可能不准确。']].map(([n,t,p,q])=>`<article class="reading-card"><div class="step">${n}</div><h2>${t}</h2><p>${p}</p><p>${q}</p></article>`).join('')}</div></div>`;}
async function analyze(index,open=true){
 const c=current();if(!c.messages[index])return;
 const context=contextWindow(c.messages,index);state.selected=index;state.mobileSheet=open;state.analysisError='';state.replyDrafts={};state.activeRecord=null;state.analysisContextStart=context.start;state.analysisContextCount=context.messages.length;
 const seq=++generation;state.loading=state.live;state.analysis=null;render();
 const keep=result=>{state.analysis=result;if(!isSampleChat(c)){try{const record=saveAnalysisRecord(c,context,result,{tone:state.tone});state.activeRecord=record.id;state.replyDrafts={...record.drafts};persist();}catch(error){state.analysisError='分析已完成，但记录未保存：'+error.message;toast(state.analysisError);}}};
 if(!state.live){keep(localAnalysis(context.messages,context.targetIndex,state.tone));render();return;}
 try{const base=state.endpoint.replace(/\/$/,'');if(base){const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('AI 服务请使用 HTTPS 地址。');}
  const result=await requestAnalysis({endpoint:base,token:state.token,input:{messages:context.messages.map(message=>({role:message.role,text:message.text})),targetIndex:context.targetIndex,tone:'warm',note:c.note||'',style:c.style||''}});if(seq!==generation)return;keep(result);
 }catch(error){if(seq!==generation)return;state.analysisError=error.name==='TimeoutError'?'分析超时，请检查 Mac 后重试。':error.message;toast(state.analysisError);}
 finally{if(seq===generation){state.loading=false;render();}}
}
function invalidate(){generation++;void cancelAnalysis();state.loading=false;state.analysis=null;state.selected=null;state.replyDrafts={};state.undoRecord=null;state.analysisError='';state.activeRecord=null;document.dispatchEvent(new Event('xianwai-context-changing'));}
function selectChat(id){if(!state.chats.some(chat=>chat.id===id))return;invalidate();closeModal();state.active=id;state.activeUpdatedAt=Date.now();state.page='chat';restoreProgress();persist();render();}
function modal(title,intro,body,footer=''){if(clearing)return;document.dispatchEvent(new Event('xianwai-modal-closing'));const root=$('#modal-root');root.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭窗口">${icon('close')}</button></div><p class="intro">${intro}</p>${body}<div class="error" id="modal-error" role="alert"></div><div class="modal-footer">${footer}</div></section></div>`;const focusable=root.querySelectorAll('button,input,textarea,select');setTimeout(()=>focusable[1]?.focus(),20);}
function closeModal(){if(clearing)return;document.dispatchEvent(new Event('xianwai-modal-closing'));$('#modal-root').innerHTML='';}
function modalError(t){const node=$('#modal-error');if(node)node.textContent=t;else toast(t);}
function openImport(raw=''){modal('把聊天带进来','粘贴一段聊天，再核对说话人。每批最多 300 条；可追加到当前联系人，已保存的分析原文会保留。',`<label for="transcript">聊天内容</label><textarea id="transcript" placeholder="我：今晚一起吃饭？&#10;对方：好呀，我等你。&#10;我：临时有个会，可能晚一点。">${esc(raw)}</textarea><div class="import-tools"><button class="outline-btn" data-action="choose-file">${icon('upload')}TXT / JSON 文件</button><button class="outline-btn" data-action="screenshot">${icon('photo')}截图识别</button></div><input id="file-input" type="file" accept=".txt,.json,text/plain,application/json" hidden><div class="notice">没有标记发送者的行会暂记为“对方”并高亮，请在下一步确认。请只导入你有权使用的内容，先移除不必要的私人信息。</div>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="parse">下一步 · 核对消息 ${icon('arrow')}</button>`);}
function showReview(){
 const priorAppend=$('#append-import')?.checked,priorDedupe=$('#dedupe-import')?.checked,originals=$('.screenshot-preview')?.outerHTML||'';
 modal('核对一下，直接帮你回','可调整发送者和顺序；只会合并截图边界或前文末尾完全一致的重叠消息。',`
 ${current().messages.length?`<label class="checkbox-row"><input id="append-import" type="checkbox" ${(priorAppend??!samples.some(x=>x.id===current().id))?'checked':''}>接着当前对话（已有 ${current().messages.length} 条）</label>`:''}
 <label class="checkbox-row"><input id="dedupe-import" type="checkbox" ${priorDedupe!==false?'checked':''}>合并完全重叠的消息（至少连续两条）</label><div class="import-summary" id="import-summary"></div>
 ${originals}<div class="review-toolbar"><button class="outline-btn" data-action="swap-review">${icon('arrow')}互换双方</button><small>所有识别结果都列在下方，可对照原图。</small></div>
 <div id="review-rows">${reviewRows.map((r,i)=>`<div class="review-row ${r.uncertain?'uncertain':''}" data-row="${i}"><span class="row-number">${i+1}</span><select aria-label="第 ${i+1} 条发送者"><option value="partner" ${r.role==='partner'?'selected':''}>对方</option><option value="me" ${r.role==='me'?'selected':''}>我</option></select><textarea aria-label="第 ${i+1} 条文字" maxlength="2000">${esc(r.text)}</textarea><div class="row-tools"><button data-move-row="${i}" data-direction="-1" aria-label="上移第 ${i+1} 条" ${i===0?'disabled':''}>↑</button><button data-move-row="${i}" data-direction="1" aria-label="下移第 ${i+1} 条" ${i===reviewRows.length-1?'disabled':''}>↓</button><button data-remove-row="${i}" aria-label="删除第 ${i+1} 条">${icon('trash')}</button></div></div>`).join('')}</div>`,
 `<button class="outline-btn" data-action="back-import">返回粘贴</button><button class="outline-btn" data-action="confirm-import">仅保存</button><button class="primary-btn" data-action="import-and-reply">保存并帮我回</button>`);
 updateReviewSummary();
}
function reviewPlan(){return prepareContactImport(current().messages,collectRows(),{append:!!$('#append-import')?.checked,removeOverlap:$('#dedupe-import')?.checked!==false});}
function updateReviewSummary(){const buttons=document.querySelectorAll('[data-action="confirm-import"],[data-action="import-and-reply"]');const node=$('#import-summary');if(!node)return;try{const plan=reviewPlan();buttons.forEach(button=>button.disabled=false);node.textContent=`保存后共 ${plan.messages.length} 条语境${plan.totalOverlap?' · 发现 '+plan.totalOverlap+' 条完全重叠，'+($('#dedupe-import').checked?'将合并':'保留全部'):''}。最后一句是${plan.messages.at(-1).role==='partner'?'对方的消息，可直接起草回复':'你发出的消息，会先保存前情'}。`;}catch(error){buttons.forEach(button=>button.disabled=true);node.textContent=error.message;}}
async function confirmImport(reply=false){try{const plan=reviewPlan();invalidate();replaceContactMessages(adoptCurrent(),plan.messages);state.selected=null;state.analysis=null;state.replyDrafts={};persist();closeModal();render();if(reply&&plan.messages.at(-1).role==='partner')await analyze(plan.messages.length-1);else toast(`已保存 ${plan.messages.length} 条${plan.removed||plan.screenshotOverlap?'，已合并完全重叠的前文':''}。`);}catch(error){modalError(error.message);}}

function collectRows(){return [...document.querySelectorAll('.review-row')].map((r,i)=>({...reviewRows[i],role:$('select',r).value,text:$('textarea',r).value}));}
function settings(){const paired=window.xianwaiIsConnected?.();modal('让理解，按你的方式发生',paired?'已通过 Mac 连接 Codex，不需要模型密钥。':'扫码连接 Mac，即可识别截图并使用真实 AI。',`<label class="checkbox-row"><input type="checkbox" id="persist" ${state.persist?'checked':''}>保存联系人、聊天、分析与草稿${paired?'到当前设备和 Mac':''}（未加密）</label><label class="checkbox-row"><input type="checkbox" id="live" ${state.live?'checked':''}>使用在线 AI 分析（相关文字和背景会发送给模型服务）</label><div class="notice">${paired?'截图通过加密连接送到你的 Mac 进行识别；分析文字通过 Codex 发送给 OpenAI，并使用你的当前账户额度。退出 Mac 应用后需重新扫码；关闭窗口不会断开。':'在 Mac 上打开弦外应用，扫描二维码即可配对。不连接时仍可使用明确标注的本地规则提示。'}</div><details><summary style="font-size:11px;color:#839373;margin-top:18px;cursor:pointer">高级连接设置</summary><label for="endpoint">后端地址</label><input id="endpoint" type="url" value="${esc(state.endpoint)}" placeholder="留空使用当前站点"><label for="token">访问令牌</label><input id="token" type="password" value="${esc(state.token)}" autocomplete="off" placeholder="配对时自动填写"></details>${localRecovery?'<div class="notice">旧记录格式异常，原始内容已保留。请先下载备份，再清除。</div><button class="outline-btn" data-action="download-recovery">下载原始记录备份</button>':''}<button class="danger-btn" data-action="clear">清除当前设备与 Mac 备份中的完整资料库…</button>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="save-settings">保存设置 ${icon('check')}</button>`);}
function editProfile(){
 const c=current();modal('让回复更像你自己','事实背景只填一次；说话习惯会用于后续起草。',`
 <label for="chat-title">对话标题</label><input id="chat-title" maxlength="30" value="${esc(c.title)}">
 <label for="partner-name">对方的称呼</label><input id="partner-name" maxlength="20" value="${esc(c.name)}">
 <label for="profile-folder">所属文件夹</label><select id="profile-folder">${libraryUI.folderOptions(c.folderId)}</select><label for="preferred-tone">默认语气</label><select id="preferred-tone">${TONES.map(t=>`<option value="${t.id}" ${(c.preferredTone||'warm')===t.id?'selected':''}>${t.label}</option>`).join('')}</select>
 <label for="reply-style">我平时怎么说话 · 可选</label><textarea id="reply-style" maxlength="1000" style="min-height:90px" placeholder="例如：句子短一点，不叫宝贝，少用表情，不用肉麻的称呼。">${esc(c.style||'')}</textarea>
 <label for="context-note">关系与前情 · 可选</label><textarea id="context-note" maxlength="2000" style="min-height:100px" placeholder="例如：交往两年；今晚约好吃饭；最近双方都在加班。">${esc(c.note)}</textarea>`,
 `<button class="outline-btn" data-library-action="export-contact">${icon('download')}导出联系人资料</button><button class="primary-btn" data-action="save-profile">保存习惯与背景</button>`);
}
async function copyText(t){if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'copy',text:t});toast('已复制，回微信前再确认一下语气。');return;}try{await navigator.clipboard.writeText(t);toast('已复制，回微信前再确认一下语气。');}catch{modal('复制这句话','浏览器未允许自动复制，可选择下面的文字手动复制。',`<textarea id="manual-copy">${esc(t)}</textarea>`,`<button class="primary-btn" data-action="close-modal">完成</button>`);$('#manual-copy').select();}}
document.addEventListener('click',async e=>{const b=e.target.closest('button,[data-action]');if(!b)return;const action=b.dataset.action;if(b.dataset.page){state.page=b.dataset.page;if(state.page==='history'){state.historyContact='all';state.historyQuery='';}state.mobileSheet=false;render();return;}if(b.dataset.chat){selectChat(b.dataset.chat);return;}if(b.dataset.message!==undefined){analyze(Number(b.dataset.message));return;}if(b.dataset.ref!==undefined){if(matchMedia('(max-width:950px)').matches){state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');}const msg=$('#msg-'+b.dataset.ref);msg?.scrollIntoView({behavior:'smooth',block:'center'});msg?.animate([{opacity:.4},{opacity:1}],{duration:600});return;}if(b.dataset.tone){state.tone=b.dataset.tone;current().preferredTone=state.tone;saveProgress();persist();renderAnalysis();return;}if(b.dataset.copy!==undefined){copyText(state.analysis.replies[Number(b.dataset.copy)].text);return;}if(b.dataset.edit!==undefined){const r=state.analysis.replies[Number(b.dataset.edit)];modal('改成你自己的话','先确认回复符合真实情况，再复制发送。',`<textarea id="edit-reply">${esc(r.text)}</textarea>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="copy-edited">${icon('copy')}复制编辑后的回复</button>`);return;}if(b.dataset.save!==undefined){const r=state.analysis.replies[Number(b.dataset.save)],existing=state.favorites.find(f=>f.text===r.text);if(!existing&&state.favorites.length>=300){toast('收藏已满 300 条，请先移除部分收藏。');return;}if(existing)state.favorites=state.favorites.filter(f=>f.id!==existing.id);else state.favorites.unshift({id:crypto.randomUUID(),text:r.text,label:r.label,name:current().name,source:current().title});persist();renderAnalysis();const count=$('.nav-item[data-page="favorites"] .count');if(count)count.textContent=state.favorites.length;toast(existing?'已移除收藏':'已收藏这句话');return;}if(b.dataset.favCopy){copyText(state.favorites.find(f=>f.id===b.dataset.favCopy).text);return;}if(b.dataset.favRemove){state.favorites=state.favorites.filter(f=>f.id!==b.dataset.favRemove);persist();render();return;}if(b.dataset.moveRow!==undefined){reviewRows=collectRows();const from=Number(b.dataset.moveRow),to=from+Number(b.dataset.direction);if(to>=0&&to<reviewRows.length)[reviewRows[from],reviewRows[to]]=[reviewRows[to],reviewRows[from]];showReview();return;}if(b.dataset.removeRow!==undefined){reviewRows=collectRows();reviewRows.splice(Number(b.dataset.removeRow),1);showReview();return;}
switch(action){case'menu':$('#sidebar').classList.toggle('open');break;case'import':openImport();break;case'close-modal':closeModal();break;case'settings':settings();break;case'profile':editProfile();break;case'close-analysis':state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');break;case'new':libraryUI.newContact();break;case'choose-file':$('#file-input').click();break;case'parse':try{reviewRows=parseTranscript($('#transcript').value);showReview();}catch(err){modalError(err.message);}break;case'back-import':{reviewRows=collectRows();openImport(reviewRows.map(r=>(r.role==='me'?'我':'对方')+'：'+r.text).join('\n'));break;}case'confirm-import':await confirmImport(false);break;case'import-and-reply':await confirmImport(true);break;case'swap-review':reviewRows=collectRows().map(r=>({...r,role:r.role==='me'?'partner':'me'}));showReview();break;case'reply-latest':{const i=latestPartnerIndex(current().messages);if(i>=0)analyze(i);break;}case'copy-draft':await copyText($('#reply-draft').value);break;case'save-draft':{if(state.favorites.length>=300){toast('收藏已满 300 条，请先移除部分收藏。');break;}const text=$('#reply-draft').value.trim();if(text&&!state.favorites.some(f=>f.text===text)){state.favorites.unshift({id:crypto.randomUUID(),text,label:TONES.find(t=>t.id===state.tone)?.label||'草稿',name:current().name,source:current().title});persist();const count=$('.nav-item[data-page="favorites"] .count');if(count)count.textContent=state.favorites.length;toast('已收藏你编辑后的草稿。');}break;}case'record-draft':{const original=current(),text=$('#reply-draft').value.trim();try{saveProgress();const result=addContactMessage(original.messages,text,'me'),c=adoptCurrent();c.messages=result.messages;touchContact(c);state.undoRecord=result.reused?null:{chatId:c.id,snapshot:JSON.stringify(c.messages),activeRecord:state.activeRecord,analysis:state.analysis,selected:state.selected,tone:state.tone,drafts:{...state.replyDrafts}};state.selected=null;state.analysis=null;state.activeRecord=null;state.mobileSheet=false;persist();render();toast(result.reused?'这句已经在前文中。':'已记录为你发出的消息，下次会一起参考。');}catch(error){toast(error.message);}break;}case'undo-record':{const c=current();if(canUndoRecord(state.undoRecord,c)){c.messages.pop();const undo=state.undoRecord;state.undoRecord=null;state.analysis=undo.analysis;state.activeRecord=undo.activeRecord;state.selected=undo.selected;touchContact(c);state.tone=undo.tone;state.replyDrafts=undo.drafts;state.mobileSheet=true;persist();render();toast('已撤销记录，编辑过的草稿也已恢复。');}break;}case'screenshot':if(window.xianwaiImportScreenshots){window.xianwaiImportScreenshots();}else if(window.webkit?.messageHandlers?.xianwai){toast('正在打开相册，图片将在本机识别。');window.webkit.messageHandlers.xianwai.postMessage({action:'pickScreenshot'});}else{modal('在 iPhone 上识别截图','网页原型暂不识别图片。iPhone 源码版内置 Apple Vision 本机文字识别。',`<div class="notice">在 iPhone App 的“导入聊天 → 截图识别”中，从相册选择截图。识别后的文字先进入核对界面，不会自动上传。网页可以粘贴已有文字，或导入 TXT / JSON。</div>`,`<button class="primary-btn" data-action="import">返回文字导入</button>`);}break;case'save-settings':{const endpoint=$('#endpoint').value.trim().replace(/\/$/,'');if(endpoint){try{const u=new URL(endpoint);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))))throw new Error();}catch{modalError('请输入不带路径和参数的 HTTPS 后端地址，本机可用 http://localhost:4388。');break;}}const owner=$('#modal-root .modal'),candidate={endpoint,token:$('#token').value.trim(),persist:$('#persist').checked,live:$('#live').checked};b.disabled=true;const settingsTask=new AbortController(),abortSettings=()=>settingsTask.abort();document.addEventListener('xianwai-modal-closing',abortSettings,{once:true});try{await window.xianwaiBeforeSettings?.(candidate,settingsTask.signal);if(!owner.isConnected)break;invalidate();Object.assign(state,candidate);window.xianwaiSettingsSaved?.();persist();}catch(error){if(owner.isConnected){modalError(error.message);b.disabled=false;}break;}finally{document.removeEventListener('xianwai-modal-closing',abortSettings);}closeModal();if(state.selected!==null)analyze(state.selected,false);else render();toast(state.live?'已开启在线 AI，聊天将发送至你配置的服务。':'已切换为本地规则试用');break;}case'save-profile':{invalidate();const c=adoptCurrent();c.title=$('#chat-title').value.trim()||'新的对话';c.name=$('#partner-name').value.trim()||'对方';c.note=$('#context-note').value.trim();c.style=$('#reply-style').value.trim();c.preferredTone=$('#preferred-tone').value;moveContact(c,$('#profile-folder').value);touchContact(c);state.tone=c.preferredTone;persist();closeModal();state.analysis=null;state.selected=null;render();toast('已保存，下一次起草会参考你的习惯。');break;}case'copy-edited':copyText($('#edit-reply').value);break;case'retry':if(state.selected!==null)analyze(state.selected);break;case'export':{const c=current(),data=JSON.stringify(c.messages,null,2);if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'export',text:data});break;}const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='弦外-聊天.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('已导出聊天 JSON');break;}case'clear':modal('清除聊天与收藏','这会删除当前资料库的联系人、文件夹、分析、草稿和收藏，以及已连接 Mac 的备份，并关闭保存。请先导出需要保留的聊天。',`<div class="notice">无法撤销此操作。如已配对，Mac 备份删除成功后才会清除本机内容。</div>`,`<button class="outline-btn" data-action="settings">返回设置</button><button class="primary-btn" data-action="confirm-clear">确认清除</button>`);break;case'confirm-clear':{if(clearing)break;const owner=$('#modal-root .modal');clearing=true;owner.querySelectorAll('button').forEach(button=>button.disabled=true);invalidate();try{await window.xianwaiDeleteBackup?.();clearing=false;localRecovery=null;const chat={...freshChat,id:crypto.randomUUID(),...normalizeContactMemory({messages:[]})};state={...state,folders:[],activeUpdatedAt:0,chats:[chat],favorites:[],persist:false,active:chat.id,selected:null,analysis:null,loading:false,page:'chat',mobileSheet:false,composerDrafts:{}};persist();closeModal();render();toast('已清除联系人资料库与收藏，并关闭保存。');}catch(error){clearing=false;modalError(error.message);owner.querySelectorAll('button').forEach(button=>button.disabled=false);}break;}case'download-recovery':{const url=URL.createObjectURL(new Blob([localRecovery||''],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='弦外-原始记录备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);break;}}});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='composer')return;e.preventDefault();const f=e.target,text=f.elements.message.value.trim(),role=f.elements.role.value;if(!text){toast('先粘贴对方的一句话。');return;}
 if(/^(我|自己|对方|她|他|女友|老婆|伴侣|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')){openImport(text);return;}
 try{const c=current(),result=addContactMessage(samples.some(x=>x.id===c.id)?[]:c.messages,text,role);const priorId=c.id;adoptCurrent();delete state.composerDrafts[priorId];invalidate();c.messages=result.messages;c.composer={text:'',role};touchContact(c);state.analysis=null;state.selected=null;state.replyDrafts={};persist();if(role==='partner')await analyze(c.messages.length-1);else{render();toast(result.reused?'这句已经在前文中。':'已把你的回复加入前文。');}}catch(error){toast(error.message);}
});
document.addEventListener('change',async e=>{if(e.target.id==='active-chat'){selectChat(e.target.value);return;}if(e.target.closest('.review-row')||['append-import','dedupe-import'].includes(e.target.id)){updateReviewSummary();return;}if(e.target.name==='role'&&e.target.closest('#composer')){state.composerDrafts[state.active]={text:$('#composer textarea').value,role:e.target.value};current().composer={...state.composerDrafts[state.active]};saveProgress();$('#composer button').innerHTML=e.target.value==='me'?'记录这句':'帮我回 '+icon('arrow');return;}if(e.target.id!=='file-input')return;const f=e.target.files[0];if(!f)return;if(f.size>500000){modalError('文件超过 500 KB，请拆分后导入。');return;}try{const input=$('#transcript'),chatId=state.active,text=await f.text();if(!input?.isConnected||state.active!==chatId)return;input.value=text;toast('已读取文件，下一步核对消息。');}catch{modalError('无法读取这个文件，请尝试粘贴文字。');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');$('#sidebar')?.classList.remove('open');}if(e.key==='Tab'&&$('#modal-root .modal')){const items=[...$('#modal-root').querySelectorAll('button,input,textarea,select')].filter(x=>!x.hidden&&!x.disabled);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}});
function bindLongPress(){document.querySelectorAll('[data-message]').forEach(b=>{let timer,x,y,fired=false;b.addEventListener('pointerdown',e=>{if(e.button!==0)return;fired=false;x=e.clientX;y=e.clientY;timer=setTimeout(()=>{fired=true;navigator.vibrate?.(15);analyze(Number(b.dataset.message));},450);});b.addEventListener('pointermove',e=>{if(Math.abs(e.clientX-x)>8||Math.abs(e.clientY-y)>8)clearTimeout(timer);});for(const event of ['pointerup','pointercancel','pointerleave'])b.addEventListener(event,()=>clearTimeout(timer));b.addEventListener('click',e=>{if(fired){e.preventDefault();e.stopPropagation();} });b.addEventListener('contextmenu',e=>{e.preventDefault();clearTimeout(timer);analyze(Number(b.dataset.message));});});}
window.xianwaiReceiveOCR=(rows)=>{try{reviewRows=validateMessages(rows).map(r=>({...r,uncertain:true}));showReview();toast('识别完成，请核对发送者、文字和顺序。');}catch(err){toast(err.message);}};
window.xianwaiError=message=>toast(message);
const libraryUI=createLibraryUI({getState:()=>state,current,modal,closeModal,persist,render,toast,selectChat,openRecord,icon,escape:esc,invalidate});
restoreProgress();render();

startCompanion({getState:()=>state,modal,closeModal,toast,render,showReview,setReviewRows:rows=>{reviewRows=rows;},escape:esc,persist,restoreProgress,openImport,quickPaste:text=>{const input=$('#composer textarea');if(input){input.value=text;input.focus();}else openImport(text);},stopAnalysis:()=>{invalidate();render();}});

document.addEventListener('input',event=>{
 if(event.target.closest('#composer')){state.composerDrafts[state.active]={text:$('#composer textarea').value,role:$('#composer select').value};current().composer={...state.composerDrafts[state.active]};touchContact(current());saveProgress();}
 if(event.target.id==='reply-draft'){state.replyDrafts[state.tone]=event.target.value;saveProgress();}
 if(event.target.closest('.review-row'))updateReviewSummary();
});
window.addEventListener('pagehide',()=>{clearTimeout(progressTimer);persist();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(progressTimer);persist();}});

})();
