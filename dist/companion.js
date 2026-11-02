import {analysisClient} from './analysis-client.js';
import {createWorkspaceSync,withRequestTimeout} from './workspace-sync.js';
import {mergeWorkspaces} from './workspace.js';

export const requestAnalysis=options=>analysisClient.request(options);
export const cancelAnalysis=()=>analysisClient.cancel();

export function startCompanion(api){
 const {getState,modal,closeModal,toast,render,showReview,setReviewRows,stopAnalysis}=api;
 let connected=false,ocrAvailable=false,pendingPair=null,pairTask=null,ocrTask=null,nativeChat=null;
 const sync=createWorkspaceSync({onError:error=>toast(error.message+' 当前设备的记录仍保留。')});
 const endpoint=()=>getState().endpoint.replace(/\/$/,'');
 const auth=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
 const localWorkspace=()=>{const s=getState();return {active:s.active,chats:s.chats.filter(c=>!['late','tired','weekend'].includes(c.id)),favorites:s.favorites};};
 const readJSON=async response=>{let result;try{result=await response.json();}catch{throw new Error('无法连接 Mac，请确认弦外应用仍在运行。');}if(!response.ok)throw new Error(result?.error||'请求失败。');return result;};
 const query=(pair,path,signal)=>withRequestTimeout(activeSignal=>fetch(pair.endpoint+path,{headers:auth(pair.token),signal:activeSignal}).then(readJSON),signal);
 const applyWorkspace=workspace=>{const s=getState();if(workspace.chats.length){Object.assign(s,workspace);s.tone=s.chats.find(c=>c.id===s.active)?.preferredTone||'warm';}};
 const forget=()=>{for(const storage of [localStorage,sessionStorage])try{storage.removeItem('xianwai-connection-v1');}catch{}};
 function rememberPair(pair,remember){forget();try{(remember?localStorage:sessionStorage).setItem('xianwai-connection-v1',JSON.stringify({...pair,live:getState().live}));}catch{toast('浏览器未允许记住连接，下次需重新扫码。');}}
 function cancelPair(){pairTask?.controller.abort();pairTask=null;}
 function cancelOCR(){ocrTask?.controller.abort();ocrTask=null;nativeChat=null;}
 function disconnect(){cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();analysisClient.clearCache();stopAnalysis();forget();connected=false;ocrAvailable=false;const s=getState();s.live=false;s.endpoint='';s.token='';}
 function draw(){
  const s=getState(),bench=document.querySelector('.workbench');
  if(bench&&!document.querySelector('.quick-actions')){
   const bar=document.createElement('div');bar.className='quick-actions';
   bar.innerHTML=`<button class="primary-btn" data-companion="screenshots">导入微信截图</button><button class="outline-btn" data-companion="paste">粘贴一句</button><button class="connection-state" data-companion="connection"><span class="dot"></span>${connected?(s.live?'Mac 已连接 · 真实 AI':'Mac 已连接 · 本地规则'):'连接 Mac，启用真实 AI'}</button>`;bench.before(bar);
  }
  const badge=document.querySelector('.mode-pill');if(badge&&connected)badge.innerHTML='<span class="dot"></span>'+(s.live?'Codex AI 已连接':'本地规则 · Mac 已连接');
  const spinner=document.querySelector('.analysis-empty .spinner');if(spinner&&!document.querySelector('[data-companion="cancel"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='cancel';b.textContent='取消分析';b.style.marginTop='18px';spinner.parentElement.append(b);}
 }
 window.xianwaiCompanionRendered=draw;window.xianwaiIsConnected=()=>connected;
 window.xianwaiImportScreenshots=()=>chooseImages();
 function connectionHelp(){modal('连接你的 Mac','打开 Mac 上的「弦外」应用，扫描窗口里的二维码，或粘贴配对链接。',`<label for="pair-link">Mac 应用显示的配对链接</label><textarea id="pair-link" placeholder="https://…/#key=…" style="min-height:100px"></textarea><div class="notice">Mac 需要保持联网与开机。手机用 Safari 打开，再通过“分享 → 添加到主屏幕”进入。</div>`,`<button class="outline-btn" data-action="close-modal">稍后</button><button class="primary-btn" data-companion="parse-pair">连接 Mac</button>`);}
 function parsePair(value){const url=new URL(value),hash=new URLSearchParams(url.hash.slice(1));const base=hash.get('bridge')||url.origin,key=hash.get('key');const u=new URL(base);if(!key||!/^[a-f0-9]{64}$/.test(key)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw new Error('配对链接不完整，请重新复制 Mac 窗口里的链接。');return{endpoint:base.replace(/\/$/,''),token:key};}
 function pairingModal(pair){pendingPair=pair;const local=pair.endpoint.startsWith('http://127.0.0.1');modal('让这台设备连上弦外','连接后，不需要配置模型密钥。分析使用 Mac 上已登录的 Codex 及其额度。',`<div class="notice">${local?'截图在这台 Mac 上识别。':'截图通过 Cloudflare 的 HTTPS 连接发送到你的 Mac，在 Mac 上识别。'}选择“分析”时，相关聊天文字和背景才会通过 Codex 发送给 OpenAI。</div><label class="checkbox-row"><input id="remember-pair" type="checkbox" checked>在这台设备记住 Mac 连接</label><label class="checkbox-row"><input id="remember-chats" type="checkbox" checked>在这台设备与 Mac 保留聊天和收藏（未加密）</label><p class="intro" style="margin-top:14px">重新连接会合并记录；同一对话有不同内容时，会保留两份供你核对。请勿转发配对链接。</p>`,`<button class="outline-btn" data-action="close-modal">取消</button><button class="primary-btn" data-companion="connect">确认连接，开始使用</button>`);}
 async function connect(pair,options={}){
  cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();connected=false;ocrAvailable=false;stopAnalysis();
  const task={controller:new AbortController(),owner:options.owner};pairTask=task;
  const valid=()=>pairTask===task&&!task.controller.signal.aborted&&(!task.owner||task.owner.isConnected);
  const timeout=setTimeout(()=>task.controller.abort(),15000);
  try{
   const status=await query(pair,'/api/health',task.controller.signal);
   if(status.provider!=='codex'||!status.ready)throw new Error('Mac 上的 Codex 尚未登录，请先在 ChatGPT 应用登录。');
   let restored=null,revision=0;
   if(options.save){const backup=await query(pair,'/api/workspace',task.controller.signal);if(!Number.isSafeInteger(backup.revision)||backup.revision<0)throw new Error('请更新 Mac 上的弦外应用后重新配对。');revision=backup.revision;restored=mergeWorkspaces(backup.workspace,localWorkspace());}
   if(!valid())return;
   const s=getState();s.endpoint=pair.endpoint===location.origin?'':pair.endpoint;s.token=pair.token;s.live=options.live!==false;s.persist=!!options.save;
   if(restored)applyWorkspace(restored.workspace);
   connected=true;ocrAvailable=!!status.ocr;
   if(options.save)sync.connect({...pair,revision});
   rememberPair(pair,options.remember);api.persist();
   pairTask=null;closeModal();render();toast(restored?.conflictCopies?'已连接。两边不同的内容均已保留，带“本机副本”的对话请核对。':(s.live?'已连接真实 AI，聊天记录已就绪。':'已连接 Mac，保留本地规则模式。'));
  }catch(error){
   if(pairTask!==task||(task.owner&&!task.owner.isConnected))return;
   getState().live=false;
   const node=task.owner?.querySelector('#modal-error');const message=task.controller.signal.aborted?'连接超时，请检查 Mac 并重试。':error.message;if(node)node.textContent=message;else toast(message);
   const button=task.owner?.querySelector('[data-companion="connect"]');if(button){button.disabled=false;button.textContent='重试连接';}
  }finally{clearTimeout(timeout);if(pairTask===task)pairTask=null;}
 }
 function chooseImages(){
  if(window.webkit?.messageHandlers?.xianwai){nativeChat=getState().active;window.webkit.messageHandlers.xianwai.postMessage({action:'pickScreenshot'});return;}
  if(!connected||!ocrAvailable){connectionHelp();return;}
  const chatId=getState().active,input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.style.display='none';document.body.append(input);
  input.onchange=()=>{const files=[...input.files];input.remove();if(getState().active===chatId)void importImages(files,chatId);};input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();
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
   if(!valid())return;ocrTask=null;setReviewRows(rows.map(r=>({...r,uncertain:true})));showReview();
   const preview=document.createElement('details');preview.className='screenshot-preview';preview.innerHTML='<summary>对照原截图 · '+previews.length+' 张</summary>'+previews.map(src=>`<img alt="本次选择的聊天截图" src="${src}">`).join('');document.querySelector('#review-rows')?.before(preview);toast('识别完成，核对后可保存并起草回复。');
  }catch(error){if(ocrTask!==task||!task.owner.isConnected)return;task.owner.querySelector('.ocr-progress')?.remove();task.owner.querySelector('#modal-error').textContent=task.controller.signal.aborted?'截图识别已停止或超时，请重新选择截图。':error.message;}finally{if(ocrTask===task)ocrTask=null;}
 }
 const nativeReceive=window.xianwaiReceiveOCR;
 window.xianwaiReceiveOCR=rows=>{const chatId=nativeChat;nativeChat=null;if(chatId&&getState().active===chatId)nativeReceive?.(rows);else toast('对话已切换，本次截图未导入，请重新选择。');};
 async function paste(){try{const text=await navigator.clipboard.readText();if(text.length>2000||(/^(我|对方|她|他|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')))api.openImport(text);else api.quickPaste(text);}catch{api.quickPaste('');toast('在下方输入框长按粘贴，再点帮我回。');}}
 document.addEventListener('xianwai-modal-closing',()=>{cancelPair();cancelOCR();});
 document.addEventListener('xianwai-context-changing',()=>cancelOCR());
 document.addEventListener('click',async event=>{
  const target=event.target.closest('[data-companion]');if(!target)return;
  try{switch(target.dataset.companion){
   case'screenshots':chooseImages();break;case'paste':await paste();break;case'connection':connectionHelp();break;
   case'parse-pair':pairingModal(parsePair(document.querySelector('#pair-link').value.trim()));break;
   case'connect':{const owner=target.closest('.modal'),options={owner,remember:owner.querySelector('#remember-pair').checked,save:owner.querySelector('#remember-chats').checked};target.disabled=true;target.textContent='正在连接 Mac…';await connect({...pendingPair},options);break;}
   case'cancel':stopAnalysis();await cancelAnalysis();toast('已取消分析。');break;
   case'disconnect':disconnect();closeModal();render();toast('已断开 Mac 连接，聊天与收藏仍在当前设备。');break;
  }}catch(error){const node=document.querySelector('#modal-error');if(node)node.textContent=error.message;else toast(error.message);}
 });
 window.xianwaiPersistWorkspace=s=>{if(connected&&s.persist)try{sync.schedule({active:s.active,chats:s.chats,favorites:s.favorites});}catch(error){toast(error.message);}};
 window.xianwaiDeleteBackup=async()=>{if(!connected){let remembered=false;try{remembered=!!(localStorage.getItem('xianwai-connection-v1')||sessionStorage.getItem('xianwai-connection-v1'));}catch{}if(remembered||getState().token)throw new Error('请先重新连接 Mac，再清除 Mac 备份。当前设备的记录未改动。');return;}if(!getState().persist){const pair={endpoint:endpoint(),token:getState().token},backup=await query(pair,'/api/workspace',AbortSignal.timeout(12000));sync.connect({...pair,revision:backup.revision});}await sync.clear();analysisClient.clearCache();};
 window.xianwaiSettingsSaved=()=>{if(connected){let permanent=false;try{permanent=!!localStorage.getItem('xianwai-connection-v1');}catch{}rememberPair({endpoint:endpoint()||location.origin,token:getState().token},permanent);}};
 window.xianwaiBeforeSettings=async(candidate,signal)=>{
  const s=getState();
  if(candidate.endpoint!==s.endpoint||candidate.token!==s.token){disconnect();return;}
  if(!candidate.persist){sync.disconnect();return;}
  if(connected&&!s.persist){const pair={endpoint:endpoint(),token:s.token},backup=await query(pair,'/api/workspace',signal);if(signal.aborted)return;const restored=mergeWorkspaces(backup.workspace,localWorkspace());sync.connect({...pair,revision:backup.revision});applyWorkspace(restored.workspace);}
 };
 const observer=new MutationObserver(()=>{const box=document.querySelector('#endpoint');if(connected&&box&&!document.querySelector('[data-companion="disconnect"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='disconnect';b.textContent='断开这台设备与 Mac 的连接';box.parentElement.append(b);}});observer.observe(document.querySelector('#modal-root'),{childList:true,subtree:true});
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('key')){try{const pair=parsePair(location.href);history.replaceState(null,'',location.pathname+location.search);pairingModal(pair);}catch(error){toast(error.message);}}
 else{let saved,remember=true,savedLive=true;try{const local=localStorage.getItem('xianwai-connection-v1');remember=!!local;saved=JSON.parse(local||sessionStorage.getItem('xianwai-connection-v1')||'null');savedLive=saved?.live!==false;if(saved)saved=parsePair('https://pair.invalid/#bridge='+encodeURIComponent(saved.endpoint)+'&key='+encodeURIComponent(saved.token));}catch{saved=null;}if(saved)void connect(saved,{remember,save:getState().persist,live:savedLive});}
 draw();
}
