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

let activeRequest=null;
const cache=new Map();
async function requestAnalysis({endpoint,token,input}){
 await cancelAnalysis();
 const base=endpoint.replace(/\/$/,'');
 const key=JSON.stringify({base,input});
 if(cache.has(key))return cache.get(key);
 const controller=new AbortController(),request={controller,job:null,base,token};activeRequest=request;
 const headers={'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
 const deadline=setTimeout(()=>controller.abort(),170000);
 try{
  let response=await fetch(base+'/api/analyze',{method:'POST',headers,body:JSON.stringify(input),signal:controller.signal});
  const read=async r=>{let value;try{value=await r.json();}catch{throw new Error('Mac 连接中断或服务返回异常，请重新连接后重试。');}if(!r.ok)throw new Error(value.error||'分析暂时不可用。');return value;};
  let result=await read(response);
  if(response.status===202){
   request.job=result.jobId;
   const start=Date.now();
   while(Date.now()-start<165000){
    await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new DOMException('已取消分析','AbortError'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},700);if(controller.signal.aborted){clearTimeout(timer);reject(new DOMException('已取消分析','AbortError'));}else controller.signal.addEventListener('abort',abort,{once:true});});
    response=await fetch(base+'/api/jobs/'+encodeURIComponent(request.job),{headers,signal:controller.signal});
    result=await read(response);
    if(result.status==='completed'){result=result.result;break;}
    if(result.status==='failed')throw new Error(result.error||'AI 分析失败，请重试。');
   }
  }
  if(!result||result.mode!=='ai'||!Array.isArray(result.replies))throw new Error('分析结果尚未完成，请重试。');
  cache.set(key,result);if(cache.size>30)cache.delete(cache.keys().next().value);
  return result;
 }finally{clearTimeout(deadline);if(activeRequest===request)activeRequest=null;}
}
async function cancelAnalysis(){
 const old=activeRequest;if(!old)return;activeRequest=null;old.controller.abort();
 if(old.job)try{await fetch(old.base+'/api/jobs/'+encodeURIComponent(old.job),{method:'DELETE',headers:{Authorization:'Bearer '+old.token},signal:AbortSignal.timeout(3000)});}catch{}
}

function startCompanion(api){
 const {getState,modal,closeModal,toast,render,showReview,setReviewRows,escape:esc,stopAnalysis}=api;
 let connected=false,ocrAvailable=false,pendingPair=null,ocrTask=null;
 const endpoint=()=>getState().endpoint.replace(/\/$/,'');
 const auth=()=>({'Content-Type':'application/json',Authorization:'Bearer '+getState().token});
 const readJSON=async response=>{let result;try{result=await response.json();}catch{throw new Error('无法连接 Mac，请确认弦外应用仍在运行。');}if(!response.ok)throw new Error(result.error||'请求失败。');return result;};
 async function health(){const r=await fetch(endpoint()+'/api/health',{headers:auth(),signal:AbortSignal.timeout(12000)});const data=await readJSON(r);connected=data.provider==='codex';ocrAvailable=!!data.ocr;return data;}
 function draw(){
  const s=getState(),bench=document.querySelector('.workbench');
  if(bench&&!document.querySelector('.quick-actions')){
   const bar=document.createElement('div');bar.className='quick-actions';
   bar.innerHTML=`<button class="primary-btn" data-companion="screenshots">导入微信截图</button><button class="outline-btn" data-companion="paste">粘贴一句</button><button class="connection-state" data-companion="connection"><span class="dot"></span>${connected?'Mac 已连接 · 真实 AI':'连接 Mac，启用真实 AI'}</button>`;
   bench.before(bar);
  }
  const badge=document.querySelector('.mode-pill');if(badge&&connected)badge.innerHTML='<span class="dot"></span>'+(s.live?'Codex AI 已连接':'本地规则 · Mac 已连接');
  const spinner=document.querySelector('.analysis-empty .spinner');if(spinner&&!document.querySelector('[data-companion="cancel"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='cancel';b.textContent='取消分析';b.style.marginTop='18px';spinner.parentElement.append(b);}
 }
 window.xianwaiCompanionRendered=draw;window.xianwaiIsConnected=()=>connected;
 window.xianwaiImportScreenshots=()=>chooseImages();
 function connectionHelp(){
  modal('连接你的 Mac','打开 Mac 上的「弦外」应用，扫描窗口里的二维码，或粘贴配对链接。',`<label for="pair-link">Mac 应用显示的配对链接</label><textarea id="pair-link" placeholder="https://…/#bridge=…&key=…" style="min-height:100px"></textarea><div class="notice">连接后可直接识别截图、调用真实 AI。Mac 需要保持联网与开机。手机用 Safari 打开，再通过“分享 → 添加到主屏幕”进入。</div>`,`<button class="outline-btn" data-action="close-modal">稍后</button><button class="primary-btn" data-companion="parse-pair">连接 Mac</button>`);
 }
 function parsePair(value){const url=new URL(value),hash=new URLSearchParams(url.hash.slice(1));const base=hash.get('bridge')||url.origin,key=hash.get('key');const u=new URL(base);if(!key||!/^[a-f0-9]{64}$/.test(key)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw new Error('配对链接不完整，请重新复制 Mac 窗口里的链接。');return{endpoint:base.replace(/\/$/,''),token:key};}
 function pairingModal(pair){pendingPair=pair;const local=pair.endpoint.startsWith('http://127.0.0.1');modal('让这台设备连上弦外','连接后，不需要配置模型密钥。分析使用 Mac 上已登录的 Codex 及其额度。',`<div class="notice">${local?'截图在这台 Mac 上识别。':'截图通过 Cloudflare 的 HTTPS 连接发送到你的 Mac，在 Mac 上识别。'}只有选择“分析”时，相关聊天文字和背景才会通过 Codex 发送给 OpenAI。</div><label class="checkbox-row"><input id="remember-pair" type="checkbox" checked>在这台设备记住 Mac 连接</label><label class="checkbox-row"><input id="remember-chats" type="checkbox" checked>在这台设备与 Mac 保留聊天和收藏（未加密）</label><p class="intro" style="margin-top:14px">请勿转发配对链接。关闭 Mac 窗口可继续后台运行；从菜单退出后，再打开需重新扫码。</p>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-companion="connect">确认连接，开始使用</button>`);}
 async function connect(){const s=getState(),remember=document.querySelector('#remember-pair').checked,save=document.querySelector('#remember-chats').checked;const prev={endpoint:s.endpoint,token:s.token};s.endpoint=pendingPair.endpoint===location.origin?'':pendingPair.endpoint;s.token=pendingPair.token;const button=document.querySelector('[data-companion="connect"]');button.disabled=true;button.textContent='正在连接 Mac…';try{const status=await health();if(!status.ready)throw new Error('Mac 上的 Codex 尚未登录，请先在 ChatGPT 应用登录。');s.live=true;s.analysis=null;s.selected=null;s.persist=save;if(save){const backup=await readJSON(await fetch(endpoint()+'/api/workspace',{headers:auth()}));if(backup.workspace?.chats?.length){const custom=s.chats.filter(c=>!['late','tired','weekend'].includes(c.id));const all=new Map(backup.workspace.chats.map(c=>[c.id,c]));for(const c of custom)all.set(c.id,c);s.chats=[...all.values()].slice(0,15);s.favorites=[...new Map([...backup.workspace.favorites,...s.favorites].map(f=>[f.id,f])).values()].slice(0,300);s.active=s.chats.some(c=>c.id===backup.workspace.active)?backup.workspace.active:s.chats[0].id;s.tone=s.chats.find(c=>c.id===s.active)?.preferredTone||'warm';}}api.persist();if(remember)localStorage.setItem('xianwai-connection-v1',JSON.stringify(pendingPair));else sessionStorage.setItem('xianwai-connection-v1',JSON.stringify(pendingPair));closeModal();render();toast('已连接真实 AI。先补充前情，日常粘贴一句就能帮你回。');}catch(error){s.endpoint=prev.endpoint;s.token=prev.token;connected=false;document.querySelector('#modal-error').textContent=error.message;button.disabled=false;button.textContent='重试连接';}}
 function chooseImages(){if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'pickScreenshot'});return;}if(!connected||!ocrAvailable){connectionHelp();return;}const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.style.display='none';document.body.append(input);input.onchange=()=>{const files=[...input.files];input.remove();importImages(files);};input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();}
 async function resize(file){if(file.size>30000000)throw new Error('单张图片不能超过 30 MB。');const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const ratio=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.88);}finally{URL.revokeObjectURL(url);}}
 async function importImages(files){if(!files.length)return;ocrTask?.abort();const controller=new AbortController();ocrTask=controller;if(files.length>12){toast('每次最多选择 12 张截图。');return;}modal('正在识别聊天截图','截图只发送到你的 Mac 进行识别，识别结束后临时图片会删除。','<div class="ocr-progress"><div class="spinner"></div><p id="ocr-status">正在读取图片…</p></div>');const rows=[],previews=[];try{for(let i=0;i<files.length;i++){document.querySelector('#ocr-status').textContent=`正在识别第 ${i+1} / ${files.length} 张，请稍候…`;const dataUrl=await resize(files[i]);let result;const timer=setTimeout(()=>controller.abort(),60000);try{result=await readJSON(await fetch(endpoint()+'/api/ocr',{method:'POST',headers:auth(),body:JSON.stringify({dataUrl}),signal:controller.signal}));}finally{clearTimeout(timer);}if(controller.signal.aborted)return;rows.push(...result.rows.map(row=>({...row,batch:i})));previews.push(dataUrl);if(rows.length>300)throw new Error('识别超过 300 条，请减少本次截图数量。');}setReviewRows(rows.map(r=>({...r,uncertain:true})));showReview();const preview=document.createElement('details');preview.className='screenshot-preview';preview.innerHTML='<summary>对照原截图 · '+previews.length+' 张</summary>'+previews.map(src=>`<img alt="本次选择的聊天截图" src="${src}">`).join('');document.querySelector('#review-rows').before(preview);toast('识别完成，核对后可直接保存并起草回复。');}catch(error){if(error.name==='AbortError'){toast('已停止这次截图识别。');return;}document.querySelector('.ocr-progress')?.remove();const errorNode=document.querySelector('#modal-error');if(errorNode)errorNode.textContent=error.name==='TimeoutError'?'截图识别超时，请检查 Mac 是否仍在线。':error.message;}}
 async function paste(){try{const text=await navigator.clipboard.readText();if(text.length>2000||(/^(我|对方|她|他|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')))api.openImport(text);else api.quickPaste(text);}catch{api.quickPaste('');toast('在下方输入框长按粘贴，或按 ⌘V，再点帮我回。');}}
 document.addEventListener('click',async event=>{if(event.target.closest('[data-action="close-modal"]')){ocrTask?.abort();ocrTask=null;}const target=event.target.closest('[data-companion]');if(!target)return;const action=target.dataset.companion;try{if(action==='screenshots')chooseImages();if(action==='paste')paste();if(action==='connection')connectionHelp();if(action==='parse-pair')pairingModal(parsePair(document.querySelector('#pair-link').value.trim()));if(action==='connect')await connect();if(action==='cancel'){await cancelAnalysis();stopAnalysis();toast('已取消分析。');}if(action==='disconnect'){localStorage.removeItem('xianwai-connection-v1');sessionStorage.removeItem('xianwai-connection-v1');connected=false;ocrAvailable=false;const s=getState();s.live=false;s.endpoint='';s.token='';s.analysis=null;closeModal();render();toast('已断开 Mac 连接，聊天与收藏仍在当前设备。');}}catch(error){const node=document.querySelector('#modal-error');if(node)node.textContent=error.message;else toast(error.message);}});
 let backupTimer;
 window.xianwaiPersistWorkspace=s=>{clearTimeout(backupTimer);if(!connected||!s.persist)return;const payload={active:s.active,chats:s.chats,favorites:s.favorites};backupTimer=setTimeout(()=>fetch(endpoint()+'/api/workspace',{method:'POST',headers:auth(),body:JSON.stringify(payload)}).then(readJSON).catch(()=>toast('Mac 备份暂未保存，当前设备的内容仍在。')),700);};
 window.xianwaiDeleteBackup=()=>{clearTimeout(backupTimer);if(connected)fetch(endpoint()+'/api/workspace',{method:'DELETE',headers:auth()}).then(readJSON).catch(()=>toast('Mac 备份未能删除，请在 Mac 联网后重试。'));};
 // Add a clear disconnect action to the existing settings modal.
 const observer=new MutationObserver(()=>{const box=document.querySelector('#endpoint');if(connected&&box&&!document.querySelector('[data-companion="disconnect"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='disconnect';b.textContent='断开这台设备与 Mac 的连接';box.parentElement.append(b);}});observer.observe(document.querySelector('#modal-root'),{childList:true,subtree:true});
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('key')){try{const pair=parsePair(location.href);history.replaceState(null,'',location.pathname+location.search);pairingModal(pair);}catch(error){toast(error.message);}}
 else{let saved;try{saved=JSON.parse(localStorage.getItem('xianwai-connection-v1')||sessionStorage.getItem('xianwai-connection-v1')||'null');if(saved)saved=parsePair('https://pair.invalid/#bridge='+encodeURIComponent(saved.endpoint)+'&key='+encodeURIComponent(saved.token));}catch{saved=null;}if(saved){const s=getState();s.endpoint=saved.endpoint===location.origin?'':saved.endpoint;s.token=saved.token;s.live=true;s.analysis=null;s.selected=null;health().then(status=>{if(!status.ready)toast('Mac 上的 Codex 暂不可用，请检查登录。');render();}).catch(()=>{toast('Mac 暂未连接，请打开 Mac 上的弦外并重新扫码。');render();});}}
 draw();
}

const paths={chat:'M4 4h16v12H9l-5 5V4z',plus:'M12 5v14M5 12h14',book:'M4 4h6c1 0 2 1 2 2v15c0-2-2-3-4-3H4V4zm16 0h-6c-1 0-2 1-2 2v15c0-2 2-3 4-3h4V4z',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3zM9 12l2 2 4-4',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',upload:'M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5',spark:'m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3z',arrow:'M5 12h14m-6-6 6 6-6 6',send:'m3 3 19 9-19 9 4-9-4-9zm4 9h15',copy:'M9 9h12v12H9zM15 5V3H3v12h2',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',menu:'M4 6h16M4 12h16M4 18h16',down:'m6 9 6 6 6-6',more:'M5 12h.01M12 12h.01M19 12h.01',warn:'m12 3 10 18H2L12 3zm0 6v5m0 3h.01',link:'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2',edit:'m16 3 5 5-13 13H3v-5L16 3z',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',photo:'M3 4h18v16H3zm0 12 5-5 5 5 4-4 4 4M15 8h.01',lock:'M6 11h12v10H6zm2 0V7a4 4 0 1 1 8 0v4',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4'};
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
let state={chats:[freshChat,...structuredClone(samples)],active:freshChat.id,page:'chat',selected:null,tone:'warm',replyDrafts:{},analysis:null,favorites:[],persist:false,live:false,endpoint:'',token:'',loading:false,mobileSheet:false};
try{const saved=JSON.parse(localStorage.getItem('xianwai-v1')||'null');if(saved?.persist){const chats=saved.chats.filter(c=>typeof c.id==='string'&&typeof c.name==='string'&&typeof c.title==='string'&&typeof c.note==='string'&&(c.messages.length===0||validateMessages(c.messages)));if(chats.length){state={...state,chats,active:chats.some(c=>c.id===saved.active)?saved.active:chats[0].id,selected:null,favorites:Array.isArray(saved.favorites)?saved.favorites.filter(f=>typeof f.text==='string'&&typeof f.id==='string'):[],persist:true};}}}catch{}
const $=(s,root=document)=>root.querySelector(s);const current=()=>state.chats.find(c=>c.id===state.active)||state.chats[0];let generation=0,toastTimer,reviewRows=[];
state.tone=current().preferredTone||'warm';
function adoptCurrent(){const c=current();if(samples.some(sample=>sample.id===c.id)){c.id=crypto.randomUUID();state.active=c.id;c.title='我的聊天';c.name='对方';c.subtitle='已导入的聊天';}return c;}
function persist(){window.xianwaiPersistWorkspace?.(state);try{if(state.persist)localStorage.setItem('xianwai-v1',JSON.stringify({persist:true,active:state.active,chats:state.chats,favorites:state.favorites}));else localStorage.removeItem('xianwai-v1');}catch{toast('浏览器未允许保存，内容仍保留在当前页面。');}}
function toast(t){const node=$('#toast');node.textContent=t;node.classList.add('toast-show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('toast-show'),3200);}
function header(title,sub,eyebrow='A LITTLE CLOSER',button='import'){return `<div class="workspace-header"><div><div class="eyebrow">${eyebrow}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>${button?`<button class="outline-btn" data-action="${button}">${icon('upload')}导入聊天</button>`:''}</div>`;}
function render(){const c=current();$('#app').innerHTML=`<div class="app-shell"><aside class="sidebar" id="sidebar"><div class="brand"><span class="brandmark">${icon('chat')}</span><div><strong>弦外</strong><small>BETWEEN THE LINES</small></div></div><button class="new-chat" data-action="new">${icon('plus')}开启一段对话</button><nav aria-label="主导航">${[['chat','chat','聊天工作台'],['favorites','heart','回复收藏'],['guide','book','使用指南']].map(([id,i,label])=>`<button class="nav-item ${state.page===id?'active':''}" data-page="${id}">${icon(i)}${label}${id==='favorites'?`<span class="count">${state.favorites.length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-label">我的对话</div><div>${state.chats.map(chat=>`<button class="conversation ${chat.id===c.id&&state.page==='chat'?'active':''}" data-chat="${esc(chat.id)}"><span class="avatar ${chat.id==='late'?'peach':''}">${esc(chat.name.slice(0,1))}</span><span><strong>${esc(chat.title)}</strong><small>${chat.messages.length} 条消息 · ${chat.id==='late'?'示例':chat.id==='tired'||chat.id==='weekend'?'示例':'我的对话'}</small></span></button>`).join('')}</div><div class="sidebar-bottom"><div class="privacy-card">${icon('shield')}<p>${state.persist?'已开启本机保存':'聊天默认只在当前页面'}<br>每一次理解，都值得被保护。</p></div><button class="settings-btn" data-action="settings">${icon('settings')}设置与隐私</button></div></aside><main class="workspace"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>沟通，有回声。</span><span>/</span><span>${state.page==='chat'?'聊天工作台':state.page==='favorites'?'回复收藏':'使用指南'}</span></div><div class="top-actions"><button class="mode-pill" data-action="settings"><span class="dot"></span>${state.live?'AI 服务已选择':'本地试用'}</button><button class="icon-btn" data-page="guide" aria-label="使用指南">${icon('book')}</button><span class="header-avatar">我</span></div></header>${state.page==='chat'?renderChat():state.page==='favorites'?renderFavorites():renderGuide()}</main></div>`;if(state.page==='chat'){renderAnalysis();const box=$('.chat-messages');if(box)box.scrollTop=box.scrollHeight;}bindLongPress();window.xianwaiCompanionRendered?.();}
function renderChat(){
 const c=current();
 return `${header('这句话，怎么回？','记住前文，先给你一条自然的回复。')}
 <div class="workbench"><section class="chat-panel" aria-label="聊天上下文">
  <div class="chat-head"><span class="avatar peach">${esc(c.name.slice(0,1))}</span>
   <label class="contact-picker"><span>正在和谁聊</span><select id="active-chat" aria-label="切换当前对话">${state.chats.map(chat=>`<option value="${esc(chat.id)}" ${chat.id===c.id?'selected':''}>${esc(chat.name)} · ${esc(chat.title)}${samples.some(x=>x.id===chat.id)?'（示例）':''}</option>`).join('')}</select></label>
   <button class="icon-btn" data-action="profile" aria-label="编辑对话与说话习惯">${icon('settings')}</button>
  </div>
  <div class="context-bar">${icon('link')}${c.messages.length} 条已导入语境 <span>不会自动读取微信</span></div>
  ${c.messages.at(-1)?.role==='partner'?`<button class="latest-reply" data-action="reply-latest">${icon('spark')}帮我回最新一句 ${icon('arrow')}</button>`:''}
  <div class="chat-messages"><div class="date-divider">${samples.some(x=>x.id===c.id)?'虚构示例 · 仅供体验':'你的聊天上下文'}</div>
   ${c.messages.length?c.messages.map((m,i)=>`<div class="msg ${m.role==='me'?'me':''} ${i===state.selected?'selected':''}" id="msg-${i}"><span class="avatar ${m.role==='partner'?'peach':''}">${m.role==='me'?'我':esc(c.name.slice(0,1))}</span><div class="msg-body"><div class="msg-name">${m.role==='me'?'我':esc(c.name)} <span style="opacity:.55">· ${i+1}</span></div><button class="bubble" data-message="${i}" aria-label="分析第 ${i+1} 条消息：${esc(m.text)}">${esc(m.text)}</button>${state.selected===i?`<div class="selected-hint">${icon('spark')}已选中这句话</div>`:''}</div></div>`).join(''):`<div class="empty-state"><h2>复制她刚发的那句话</h2><p>在下方粘贴，再点“帮我回”。<br>已有聊天可先导入截图，前情会一起参考。</p><button class="outline-btn" data-action="profile">${icon('edit')}设置称呼和说话习惯</button></div>`}
  </div>
  <div class="chat-tip">${icon('shield')}复制草稿不会自动记为已发送</div>
  <form class="composer quick-composer" id="composer"><select name="role" aria-label="添加消息的发送者"><option value="partner">对方</option><option value="me">我</option></select><textarea name="message" aria-label="对方刚发的消息" placeholder="粘贴对方刚发的一句…" maxlength="2000" rows="2"></textarea><button type="submit" aria-label="帮我回这句话">帮我回 ${icon('arrow')}</button></form>
  ${state.undoRecord?.chatId===c.id&&c.messages.length===state.undoRecord.length?'<button class="undo-record" data-action="undo-record">撤销刚才的“已发出”记录</button>':''}
 </section><div class="analysis-scrim ${state.mobileSheet?'open':''}" data-action="close-analysis"></div><section class="analysis-panel ${state.mobileSheet?'open':''}" aria-label="消息分析" id="analysis"></section></div>`;
}
function renderAnalysis(){
 const c=current(),node=$('#analysis');if(!node)return;
 const a=state.analysis,m=c.messages[state.selected];
 let content;
 if(state.loading)content=`<div class="analysis-empty"><div class="spinner"></div><h3>正在帮你接这句话</h3><p>一次准备三种语气，切换时不用再等。<br>本次参考 ${state.selected+1} 条前文消息。</p></div>`;
 else if(!a||!m)content=`<div class="analysis-empty">${icon('chat')}<h3>${c.messages.length?'接着这段聊天，继续说':'先粘贴一句，或导入截图'}</h3><p>下方输入对方的新消息后点“帮我回”，<br>也可以选择历史中的某一句。</p>${state.analysisError?`<p class="error">${esc(state.analysisError)}</p><button class="outline-btn" data-action="retry">重新分析</button>`:''}</div>`;
 else{
  const reply=replyForTone(a,state.tone),draft=state.replyDrafts[state.tone]??reply.text;
  content=`<div class="analysis-scroll reply-first"><div class="quote"><span>回应 ${m.role==='me'?'自己的表达':esc(c.name)} · 消息 ${state.selected+1}</span>“${esc(m.text)}”</div>
   <div class="section-heading"><h3>${icon('spark')}先给你一条可改的草稿</h3><small>${a.mode==='local'?'本地规则提示':'三种语气已备好'}</small></div>
   <div class="tone-switch prominent-tones" aria-label="回复语气">${TONES.map(t=>`<button class="${state.tone===t.id?'active':''}" data-tone="${t.id}" aria-pressed="${state.tone===t.id}">${t.label}</button>`).join('')}</div>
   <article class="draft-card"><label for="reply-draft">${esc(reply.label)} · 可以直接修改</label><textarea id="reply-draft" maxlength="2000" rows="4" aria-label="可编辑的回复草稿">${esc(draft)}</textarea><p class="draft-reason">${esc(reply.reason)}</p><div class="draft-actions"><button class="primary-btn" data-action="copy-draft">${icon('copy')}复制这句</button><button class="outline-btn" data-action="save-draft">${icon('heart')}收藏</button><button class="outline-btn" data-action="record-draft">${icon('check')}我已发出</button></div><small>只有已在微信发送后，再点“我已发出”补入前文。</small></article>
   <div class="gentle-note">${icon('shield')}先确认符合实际情况，再复制发送。${a.mode==='local'?' 当前使用本地规则，并未调用大模型。':''}</div>
   <details class="understanding"><summary>${icon('heart')}看看为什么这样回 <span>可能的解释与原话依据</span></summary>
    <div class="insight-card"><div class="mini-label">推测，需要和本人确认</div><h3>${esc(a.title)}</h3><p><b>可能的感受</b> · ${esc(a.feeling)}</p><p><b>值得确认的需求</b> · ${esc(a.need)}</p></div>
    ${a.hypotheses.map(h=>`<div class="hypothesis">${esc(h.text)}${citations(h.evidence)}</div>`).join('')}
    <div class="confirm-question"><b>也可以直接确认</b><p>${esc(a.question)}</p></div>
    <details class="facts"><summary>原话依据 · ${a.contextCount} 条语境消息</summary>${a.facts.map(f=>`<p class="fact">${esc(f.text)}${citations(f.evidence)}</p>`).join('')}<p class="fact">目标之后的 ${c.messages.length-state.selected-1} 条消息未用于起草；${c.style?'已参考你的说话习惯。':'可在对话设置中补充自己的说话习惯。'}</p></details>
   </details><div class="avoid">${icon('warn')}<div>${esc(a.avoid)}</div></div><div class="analysis-foot">解释可能不准确，真正的答案来自你们的沟通。</div></div>`;
 }
 node.innerHTML=`<div class="analysis-header"><div class="analysis-title">${icon('spark')}<h2>帮你把话接下去</h2></div><small>${state.loading?'AI 正在起草':a?.mode==='ai'?'AI 语境分析':state.live?'AI 已就绪':'本地规则试用'}</small><button class="icon-btn mobile-close" data-action="close-analysis" aria-label="关闭分析">${icon('close')}</button></div>${content}`;
 window.xianwaiCompanionRendered?.();
}
function citations(ids){return(ids||[]).map(id=>`<button class="citation" data-ref="${id-1}">原话 ${id}</button>`).join('');}
function renderFavorites(){return `${header('留住，好好说话的时刻。','收藏的回复只属于你的工作台。','WORDS TO KEEP',null)}<div class="page-content">${state.favorites.length?state.favorites.map(f=>`<article class="collection-item"><small>${esc(f.name)} · ${esc(f.label)}</small><p>${esc(f.text)}</p><footer><small>${esc(f.source||'自定义回复')}</small><button class="outline-btn" data-fav-copy="${esc(f.id)}">${icon('copy')}复制</button><button class="icon-btn" data-fav-remove="${esc(f.id)}" aria-label="移除收藏">${icon('trash')}</button></footer></article>`).join(''):`<div class="empty-state"><h2>一句合适的话，值得留下</h2><p>在回复建议旁点击爱心，即可收藏。<br>${state.persist?'本机保存已开启。':'默认关闭页面后清除，可在设置中开启本机保存。'}</p><button class="primary-btn" data-page="chat">回到聊天工作台 ${icon('arrow')}</button></div>`}</div>`;}
function renderGuide(){return `${header('靠近，从听懂开始。','用工具留意语境，用真实的沟通确认彼此。','A SMALL GUIDE',null)}<div class="page-content"><div class="reading-grid">${[['01','把语境放在一起','先粘贴带发送者的聊天文本，或导入 TXT / JSON。最多 300 条、80,000 字，不会静默截断。导入前可逐条核对说话人。','连接 Mac 后，网页可从相册批量选择微信截图，在 Mac 使用 Apple Vision 识别。识别后先核对顺序、发送者和文字，再分析。'],['02','选中你想回应的那一句','在本工作台里长按、点击消息，或用键盘选中后按 Enter。分析使用目标消息及之前的全部已导入内容，可补充关系背景。','iOS 的应用隔离限制了跨 App 读取。这个版本不会读取微信后台，也不能在微信原有的长按菜单中添加功能。'],['03','先看依据，再选怎么说','分析把原话和可能的解释分开。点击“原话”可定位消息。没有单句消息能证明一个人的真实心思。','用温柔、坦诚、简短三种语气起草回复。根据自己的真实情况编辑后复制，再回微信发送；不要承诺做不到的事。'],['04','让私密内容由你决定','未配对时默认只在当前页面保留内容。配对时可选择保存到当前设备与 Mac，下次连接可以恢复，也可主动清除。','手机扫码连接 Mac 可复用已登录的 Codex，无需密钥。截图通过 Cloudflare 连接到 Mac；选择分析时相关文字发送给 OpenAI。模型结果可能不准确。']].map(([n,t,p,q])=>`<article class="reading-card"><div class="step">${n}</div><h2>${t}</h2><p>${p}</p><p>${q}</p></article>`).join('')}</div></div>`;}
async function analyze(index,open=true){const c=current();if(!c.messages[index])return;state.selected=index;state.mobileSheet=open;state.analysisError='';state.replyDrafts={};const seq=++generation;state.loading=state.live;state.analysis=null;render();if(!state.live){state.analysis=localAnalysis(c.messages,index,state.tone);renderAnalysis();return;}try{const base=state.endpoint.replace(/\/$/,'');if(base){const u=new URL(base);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('AI 服务请使用 HTTPS 地址。');}const a=await requestAnalysis({endpoint:base,token:state.token,input:{messages:c.messages.slice(0,index+1),targetIndex:index,tone:'warm',note:c.note||'',style:c.style||''}});if(seq!==generation)return;if(!a||a.mode!=='ai'||!Array.isArray(a.replies))throw new Error('服务返回的分析格式不正确。');state.analysis=a;}catch(err){if(seq!==generation)return;state.analysisError=err.name==='TimeoutError'?'分析超时，请稍后重试。':err.message;toast(state.analysisError);}finally{if(seq===generation){state.loading=false;renderAnalysis();window.xianwaiCompanionRendered?.();}}}
function selectChat(id){generation++;state.active=id;state.page='chat';state.selected=null;state.analysis=null;state.replyDrafts={};state.tone=current().preferredTone||'warm';state.loading=false;state.mobileSheet=false;persist();render();}
function modal(title,intro,body,footer=''){const root=$('#modal-root');root.innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭窗口">${icon('close')}</button></div><p class="intro">${intro}</p>${body}<div class="error" id="modal-error" role="alert"></div><div class="modal-footer">${footer}</div></section></div>`;const focusable=root.querySelectorAll('button,input,textarea,select');setTimeout(()=>focusable[1]?.focus(),20);}
function closeModal(){$('#modal-root').innerHTML='';}
function modalError(t){$('#modal-error').textContent=t;}
function openImport(raw=''){modal('把聊天带进来','粘贴一段聊天，再核对说话人。仅替换当前对话，最多 300 条。',`<label for="transcript">聊天内容</label><textarea id="transcript" placeholder="我：今晚一起吃饭？&#10;对方：好呀，我等你。&#10;我：临时有个会，可能晚一点。">${esc(raw)}</textarea><div class="import-tools"><button class="outline-btn" data-action="choose-file">${icon('upload')}TXT / JSON 文件</button><button class="outline-btn" data-action="screenshot">${icon('photo')}截图识别</button></div><input id="file-input" type="file" accept=".txt,.json,text/plain,application/json" hidden><div class="notice">没有标记发送者的行会暂记为“对方”并高亮，请在下一步确认。请只导入你有权使用的内容，先移除不必要的私人信息。</div>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="parse">下一步 · 核对消息 ${icon('arrow')}</button>`);}
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
function reviewPlan(){return prepareImport(current().messages,collectRows(),{append:!!$('#append-import')?.checked,removeOverlap:$('#dedupe-import')?.checked!==false});}
function updateReviewSummary(){const node=$('#import-summary');if(!node)return;try{const plan=reviewPlan();node.textContent=`保存后共 ${plan.messages.length} 条语境${plan.totalOverlap?' · 发现 '+plan.totalOverlap+' 条完全重叠，'+($('#dedupe-import').checked?'将合并':'保留全部'):''}。最后一句是${plan.messages.at(-1).role==='partner'?'对方的消息，可直接起草回复':'你发出的消息，会先保存前情'}。`;}catch(error){node.textContent=error.message;}}
async function confirmImport(reply=false){try{const plan=reviewPlan();adoptCurrent().messages=plan.messages;generation++;state.selected=null;state.analysis=null;state.replyDrafts={};persist();closeModal();render();if(reply&&plan.messages.at(-1).role==='partner')await analyze(plan.messages.length-1);else toast(`已保存 ${plan.messages.length} 条${plan.removed||plan.screenshotOverlap?'，已合并完全重叠的前文':''}。`);}catch(error){modalError(error.message);}}

function collectRows(){return [...document.querySelectorAll('.review-row')].map((r,i)=>({...reviewRows[i],role:$('select',r).value,text:$('textarea',r).value}));}
function settings(){const paired=window.xianwaiIsConnected?.();modal('让理解，按你的方式发生',paired?'已通过 Mac 连接 Codex，不需要模型密钥。':'扫码连接 Mac，即可识别截图并使用真实 AI。',`<label class="checkbox-row"><input type="checkbox" id="persist" ${state.persist?'checked':''}>保存聊天与收藏${paired?'到当前设备和 Mac':''}（未加密）</label><label class="checkbox-row"><input type="checkbox" id="live" ${state.live?'checked':''}>使用在线 AI 分析（相关文字和背景会发送给模型服务）</label><div class="notice">${paired?'截图通过加密连接送到你的 Mac 进行识别；分析文字通过 Codex 发送给 OpenAI，并使用你的当前账户额度。退出 Mac 应用后需重新扫码；关闭窗口不会断开。':'在 Mac 上打开弦外应用，扫描二维码即可配对。不连接时仍可使用明确标注的本地规则提示。'}</div><details><summary style="font-size:11px;color:#839373;margin-top:18px;cursor:pointer">高级连接设置</summary><label for="endpoint">后端地址</label><input id="endpoint" type="url" value="${esc(state.endpoint)}" placeholder="留空使用当前站点"><label for="token">访问令牌</label><input id="token" type="password" value="${esc(state.token)}" autocomplete="off" placeholder="配对时自动填写"></details><button class="danger-btn" data-action="clear">清除当前设备与 Mac 备份中的聊天和收藏…</button>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="save-settings">保存设置 ${icon('check')}</button>`);}
function editProfile(){
 const c=current();modal('让回复更像你自己','事实背景只填一次；说话习惯会用于后续起草。',`
 <label for="chat-title">对话标题</label><input id="chat-title" maxlength="30" value="${esc(c.title)}">
 <label for="partner-name">对方的称呼</label><input id="partner-name" maxlength="20" value="${esc(c.name)}">
 <label for="preferred-tone">默认语气</label><select id="preferred-tone">${TONES.map(t=>`<option value="${t.id}" ${(c.preferredTone||'warm')===t.id?'selected':''}>${t.label}</option>`).join('')}</select>
 <label for="reply-style">我平时怎么说话 · 可选</label><textarea id="reply-style" maxlength="1000" style="min-height:90px" placeholder="例如：句子短一点，不叫宝贝，少用表情，不用肉麻的称呼。">${esc(c.style||'')}</textarea>
 <label for="context-note">关系与前情 · 可选</label><textarea id="context-note" maxlength="2000" style="min-height:100px" placeholder="例如：交往两年；今晚约好吃饭；最近双方都在加班。">${esc(c.note)}</textarea>`,
 `<button class="outline-btn" data-action="export">${icon('download')}导出聊天</button><button class="primary-btn" data-action="save-profile">保存习惯与背景</button>`);
}
async function copyText(t){if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'copy',text:t});toast('已复制，回微信前再确认一下语气。');return;}try{await navigator.clipboard.writeText(t);toast('已复制，回微信前再确认一下语气。');}catch{modal('复制这句话','浏览器未允许自动复制，可选择下面的文字手动复制。',`<textarea id="manual-copy">${esc(t)}</textarea>`,`<button class="primary-btn" data-action="close-modal">完成</button>`);$('#manual-copy').select();}}
document.addEventListener('click',async e=>{const b=e.target.closest('button,[data-action]');if(!b)return;const action=b.dataset.action;if(b.dataset.page){state.page=b.dataset.page;state.mobileSheet=false;render();return;}if(b.dataset.chat){selectChat(b.dataset.chat);return;}if(b.dataset.message!==undefined){analyze(Number(b.dataset.message));return;}if(b.dataset.ref!==undefined){if(matchMedia('(max-width:950px)').matches){state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');}const msg=$('#msg-'+b.dataset.ref);msg?.scrollIntoView({behavior:'smooth',block:'center'});msg?.animate([{opacity:.4},{opacity:1}],{duration:600});return;}if(b.dataset.tone){state.tone=b.dataset.tone;current().preferredTone=state.tone;persist();renderAnalysis();return;}if(b.dataset.copy!==undefined){copyText(state.analysis.replies[Number(b.dataset.copy)].text);return;}if(b.dataset.edit!==undefined){const r=state.analysis.replies[Number(b.dataset.edit)];modal('改成你自己的话','先确认回复符合真实情况，再复制发送。',`<textarea id="edit-reply">${esc(r.text)}</textarea>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-action="copy-edited">${icon('copy')}复制编辑后的回复</button>`);return;}if(b.dataset.save!==undefined){const r=state.analysis.replies[Number(b.dataset.save)],existing=state.favorites.find(f=>f.text===r.text);if(existing)state.favorites=state.favorites.filter(f=>f.id!==existing.id);else state.favorites.unshift({id:crypto.randomUUID(),text:r.text,label:r.label,name:current().name,source:current().title});persist();renderAnalysis();const count=$('.nav-item .count');if(count)count.textContent=state.favorites.length;toast(existing?'已移除收藏':'已收藏这句话');return;}if(b.dataset.favCopy){copyText(state.favorites.find(f=>f.id===b.dataset.favCopy).text);return;}if(b.dataset.favRemove){state.favorites=state.favorites.filter(f=>f.id!==b.dataset.favRemove);persist();render();return;}if(b.dataset.moveRow!==undefined){reviewRows=collectRows();const from=Number(b.dataset.moveRow),to=from+Number(b.dataset.direction);if(to>=0&&to<reviewRows.length)[reviewRows[from],reviewRows[to]]=[reviewRows[to],reviewRows[from]];showReview();return;}if(b.dataset.removeRow!==undefined){reviewRows=collectRows();reviewRows.splice(Number(b.dataset.removeRow),1);showReview();return;}
switch(action){case'menu':$('#sidebar').classList.toggle('open');break;case'import':openImport();break;case'close-modal':closeModal();break;case'settings':settings();break;case'profile':editProfile();break;case'close-analysis':state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');break;case'new':{if(state.chats.length>=15){toast('最多保留 15 段对话，请先导出并清理。');break;}const c={id:crypto.randomUUID(),title:'新的对话',name:'对方',subtitle:'给彼此多一点理解',note:'',messages:[]};state.chats.unshift(c);persist();selectChat(c.id);openImport();break;}case'choose-file':$('#file-input').click();break;case'parse':try{reviewRows=parseTranscript($('#transcript').value);showReview();}catch(err){modalError(err.message);}break;case'back-import':{reviewRows=collectRows();openImport(reviewRows.map(r=>(r.role==='me'?'我':'对方')+'：'+r.text).join('\n'));break;}case'confirm-import':await confirmImport(false);break;case'import-and-reply':await confirmImport(true);break;case'swap-review':reviewRows=collectRows().map(r=>({...r,role:r.role==='me'?'partner':'me'}));showReview();break;case'reply-latest':{const i=latestPartnerIndex(current().messages);if(i>=0)analyze(i);break;}case'copy-draft':await copyText($('#reply-draft').value);break;case'save-draft':{const text=$('#reply-draft').value.trim();if(text&&!state.favorites.some(f=>f.text===text)){state.favorites.unshift({id:crypto.randomUUID(),text,label:TONES.find(t=>t.id===state.tone)?.label||'草稿',name:current().name,source:current().title});persist();const count=$('.nav-item .count');if(count)count.textContent=state.favorites.length;toast('已收藏你编辑后的草稿。');}break;}case'record-draft':{const c=current(),text=$('#reply-draft').value.trim();try{const result=addQuickMessage(c.messages,text,'me');c.messages=result.messages;state.undoRecord=result.reused?null:{chatId:c.id,length:c.messages.length,analysis:state.analysis,selected:state.selected,tone:state.tone,drafts:{...state.replyDrafts}};state.selected=null;state.analysis=null;state.mobileSheet=false;persist();render();toast(result.reused?'这句已经在前文中。':'已记录为你发出的消息，下次会一起参考。');}catch(error){toast(error.message);}break;}case'undo-record':{const c=current();if(state.undoRecord?.chatId===c.id&&state.undoRecord.length===c.messages.length){c.messages.pop();const undo=state.undoRecord;state.undoRecord=null;state.analysis=undo.analysis;state.selected=undo.selected;state.tone=undo.tone;state.replyDrafts=undo.drafts;state.mobileSheet=true;persist();render();toast('已撤销记录，编辑过的草稿也已恢复。');}break;}case'screenshot':if(window.xianwaiImportScreenshots){window.xianwaiImportScreenshots();}else if(window.webkit?.messageHandlers?.xianwai){toast('正在打开相册，图片将在本机识别。');window.webkit.messageHandlers.xianwai.postMessage({action:'pickScreenshot'});}else{modal('在 iPhone 上识别截图','网页原型暂不识别图片。iPhone 源码版内置 Apple Vision 本机文字识别。',`<div class="notice">在 iPhone App 的“导入聊天 → 截图识别”中，从相册选择截图。识别后的文字先进入核对界面，不会自动上传。网页可以粘贴已有文字，或导入 TXT / JSON。</div>`,`<button class="primary-btn" data-action="import">返回文字导入</button>`);}break;case'save-settings':{const endpoint=$('#endpoint').value.trim().replace(/\/$/,'');if(endpoint){try{const u=new URL(endpoint);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))))throw new Error();}catch{modalError('请输入不带路径和参数的 HTTPS 后端地址，本机可用 http://localhost:4388。');break;}}state.persist=$('#persist').checked;state.live=$('#live').checked;state.endpoint=endpoint;state.token=$('#token').value.trim();generation++;state.loading=false;state.analysis=null;persist();closeModal();if(state.selected!==null)analyze(state.selected,false);else render();toast(state.live?'已开启在线 AI，聊天将发送至你配置的服务。':'已切换为本地规则试用');break;}case'save-profile':{const c=current();c.title=$('#chat-title').value.trim()||'新的对话';c.name=$('#partner-name').value.trim()||'对方';c.note=$('#context-note').value.trim();c.style=$('#reply-style').value.trim();c.preferredTone=$('#preferred-tone').value;state.tone=c.preferredTone;persist();closeModal();state.analysis=null;state.selected=null;render();toast('已保存，下一次起草会参考你的习惯。');break;}case'copy-edited':copyText($('#edit-reply').value);break;case'retry':if(state.selected!==null)analyze(state.selected);break;case'export':{const c=current(),data=JSON.stringify(c.messages,null,2);if(window.webkit?.messageHandlers?.xianwai){window.webkit.messageHandlers.xianwai.postMessage({action:'export',text:data});break;}const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='弦外-聊天.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('已导出聊天 JSON');break;}case'clear':modal('清除这台设备的内容','这会删除当前工作台的聊天和收藏、已连接 Mac 的备份，并关闭保存。请先导出需要保留的聊天。',`<div class="notice">无法撤销此操作。清除后显示的三个对话是虚构示例，不包含你的内容。</div>`,`<button class="outline-btn" data-action="settings">返回设置</button><button class="primary-btn" data-action="confirm-clear">确认清除</button>`);break;case'confirm-clear':window.xianwaiDeleteBackup?.();generation++;state={...state,chats:structuredClone(samples),favorites:[],persist:false,active:'late',selected:null,analysis:null,loading:false,page:'chat',mobileSheet:false,live:false,endpoint:'',token:''};persist();closeModal();render();toast('已清除本机聊天与收藏。');break;}});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='composer')return;e.preventDefault();const f=e.target,text=f.elements.message.value.trim(),role=f.elements.role.value;if(!text){toast('先粘贴对方的一句话。');return;}
 if(/^(我|自己|对方|她|他|女友|老婆|伴侣|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')){openImport(text);return;}
 try{const c=current(),result=addQuickMessage(samples.some(x=>x.id===c.id)?[]:c.messages,text,role);adoptCurrent();generation++;state.loading=false;c.messages=result.messages;state.analysis=null;state.selected=null;state.replyDrafts={};persist();if(role==='partner')await analyze(c.messages.length-1);else{render();toast(result.reused?'这句已经在前文中。':'已把你的回复加入前文。');}}catch(error){toast(error.message);}
});
document.addEventListener('change',async e=>{if(e.target.id==='active-chat'){selectChat(e.target.value);return;}if(e.target.closest('.review-row')||['append-import','dedupe-import'].includes(e.target.id)){updateReviewSummary();return;}if(e.target.name==='role'&&e.target.closest('#composer')){$('#composer button').innerHTML=e.target.value==='me'?'记录这句':'帮我回 '+icon('arrow');return;}if(e.target.id!=='file-input')return;const f=e.target.files[0];if(!f)return;if(f.size>500000){modalError('文件超过 500 KB，请拆分后导入。');return;}try{$('#transcript').value=await f.text();toast('已读取文件，下一步核对消息。');}catch{modalError('无法读取这个文件，请尝试粘贴文字。');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();state.mobileSheet=false;$('.analysis-panel')?.classList.remove('open');$('.analysis-scrim')?.classList.remove('open');$('#sidebar')?.classList.remove('open');}if(e.key==='Tab'&&$('#modal-root .modal')){const items=[...$('#modal-root').querySelectorAll('button,input,textarea,select')].filter(x=>!x.hidden&&!x.disabled);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}}});
function bindLongPress(){document.querySelectorAll('[data-message]').forEach(b=>{let timer,x,y,fired=false;b.addEventListener('pointerdown',e=>{if(e.button!==0)return;fired=false;x=e.clientX;y=e.clientY;timer=setTimeout(()=>{fired=true;navigator.vibrate?.(15);analyze(Number(b.dataset.message));},450);});b.addEventListener('pointermove',e=>{if(Math.abs(e.clientX-x)>8||Math.abs(e.clientY-y)>8)clearTimeout(timer);});for(const event of ['pointerup','pointercancel','pointerleave'])b.addEventListener(event,()=>clearTimeout(timer));b.addEventListener('click',e=>{if(fired){e.preventDefault();e.stopPropagation();} });b.addEventListener('contextmenu',e=>{e.preventDefault();clearTimeout(timer);analyze(Number(b.dataset.message));});});}
window.xianwaiReceiveOCR=(rows)=>{try{reviewRows=validateMessages(rows).map(r=>({...r,uncertain:true}));showReview();toast('识别完成，请核对发送者、文字和顺序。');}catch(err){toast(err.message);}};
window.xianwaiError=message=>toast(message);
state.analysis=state.selected!==null?localAnalysis(current().messages,state.selected,state.tone):null;render();

startCompanion({getState:()=>state,modal,closeModal,toast,render,showReview,setReviewRows:rows=>{reviewRows=rows;},escape:esc,persist,openImport,quickPaste:text=>{const input=$('#composer textarea');if(input){input.value=text;input.focus();}else openImport(text);},stopAnalysis:()=>{generation++;state.loading=false;state.analysis=null;state.analysisError='已取消这次分析，可以重新选择消息。';renderAnalysis();}});

document.addEventListener('input',e=>{if(e.target.id==='reply-draft')state.replyDrafts[state.tone]=e.target.value;if(e.target.closest('.review-row'))updateReviewSummary();});

})();
