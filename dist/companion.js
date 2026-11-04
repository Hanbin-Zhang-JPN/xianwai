import {analysisClient} from './analysis-client.js';
import {createWorkspaceSync,withRequestTimeout,bindWorkspaceLifecycle} from './workspace-sync.js';
import {mergeWorkspaces} from './workspace.js';
import {validateMessages} from './core.js';
import {safeStorage,parsePairLink,probeConnection,connectionError} from './pairing.js';
import {pasteClipboard} from './clipboard.js';
import {createConnectionMonitor} from './connection-monitor.js';

export const requestAnalysis=async options=>{try{return await analysisClient.request(options);}catch(error){if(error.status===401)error.message=connectionError(error);if(error.status===401||error instanceof TypeError||error.name==='TimeoutError')document.dispatchEvent(new CustomEvent('xianwai-connection-error',{detail:connectionError(error)}));throw error;}};
export const cancelAnalysis=()=>analysisClient.cancel();

export function startCompanion(api){
 const {getState,modal,closeModal,toast,render,showReview,setReviewRows,stopAnalysis}=api;
 let connected=false,ocrAvailable=false,aiReady=false,pendingPair=null,pairTask=null,ocrTask=null,nativeChat=null,phase='disconnected',syncError='';
 let contextVersion=0;
 const sync=createWorkspaceSync({onError:error=>{syncError=connectionError(error);draw();toast(syncError);}});
 const endpoint=()=>getState().endpoint.replace(/\/$/,'');
 const heartbeat=createConnectionMonitor({current:()=>{const s=getState();return document.hidden||pairTask||!connected||!s.token?null:{endpoint:endpoint()||location.origin,token:s.token};},probe:(pair,signal)=>probeConnection(pair,{attempts:1,signal}),onStatus:status=>{connected=true;aiReady=status.ready;ocrAvailable=!!status.ocr;phase='connected';draw();},onFailure:()=>{phase='offline';draw();}});
 const auth=token=>({'Content-Type':'application/json',Authorization:'Bearer '+token});
 const localWorkspace=()=>{const s=getState();return {schemaVersion:5,folders:s.folders,deletedFavoriteIds:s.deletedFavoriteIds,activeUpdatedAt:s.activeUpdatedAt,active:s.active,chats:s.chats.filter(c=>!['late','tired','weekend'].includes(c.id)),favorites:s.favorites};};
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
 function cancelPair(){const old=pairTask;old?.controller.abort();pairTask=null;if(old){heartbeat.invalidate();phase='disconnected';draw();}}
 function cancelOCR(){ocrTask?.controller.abort();ocrTask=null;}
 function disconnect(){heartbeat.invalidate();cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();analysisClient.clearCache();stopAnalysis();forget();connected=false;ocrAvailable=false;aiReady=false;phase='disconnected';syncError='';pendingPair=null;const s=getState();s.live=false;s.endpoint='';s.token='';if(location.hash.includes('key='))history.replaceState(null,'',location.pathname+location.search);}
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
 function pairingModal(pair){pendingPair=pair;const hash=new URLSearchParams({key:pair.token});if(pair.endpoint!==location.origin)hash.set('bridge',pair.endpoint);history.replaceState(null,'',location.pathname+location.search+'#'+hash.toString());const local=pair.endpoint.startsWith('http://127.0.0.1');modal('让这台设备连上弦外','连接后，不需要配置模型密钥。分析使用 Mac 上已登录的 Codex 及其额度。',`<div class="notice">${local?'截图在这台 Mac 上识别。':'截图通过 Cloudflare 的 HTTPS 连接发送到你的 Mac，在 Mac 上识别。'}选择“分析”时，相关聊天文字和背景才会通过 Codex 发送给 OpenAI。</div><label class="checkbox-row"><input id="remember-pair" type="checkbox" checked>在这台设备记住 Mac 连接</label><label class="checkbox-row"><input id="remember-chats" type="checkbox" ${getState().persist?'checked':''}>在这台设备与 Mac 保留聊天和收藏（未加密）</label><p class="intro" style="margin-top:14px">重新连接会合并记录；同一对话有不同内容时，会保留两份供你核对。请勿转发配对链接。</p>`,`<button class="outline-btn" data-companion="edit-pair">更换配对链接</button><button class="primary-btn" data-companion="connect">确认连接，开始使用</button>`);}
 async function connect(pair,options={}){
  const retained=api.captureView?.();heartbeat.invalidate();cancelPair();cancelOCR();sync.disconnect();void cancelAnalysis();connected=false;ocrAvailable=false;phase='connecting';pendingPair=pair;stopAnalysis();if(api.restoreView?.(retained))render();
  const task={controller:new AbortController(),owner:options.owner};pairTask=task;
  const valid=()=>pairTask===task&&!task.controller.signal.aborted&&(!task.owner||task.owner.isConnected);
  const timeout=setTimeout(()=>task.controller.abort(),30000);
  try{
   const status=await probeConnection(pair,{signal:task.controller.signal,onAttempt:(attempt,total)=>{const button=task.owner?.querySelector('[data-companion="connect"]');if(button)button.textContent=`正在验证 Mac（${attempt}/${total}）…`;}});
   if(!task.owner){clearTimeout(timeout);await waitForNoDialog(task.controller.signal);}
   let restored=null,revision=0;
   if(options.save){if(status.workspaceSchema!==5)throw new Error('请先将 Mac 上的弦外升级到 0.5.0，再保存联系人、文件夹和分析记录。');const backup=await query(pair,'/api/workspace',task.controller.signal);if(!Number.isSafeInteger(backup.revision)||backup.revision<0)throw new Error('请更新 Mac 上的弦外应用后重新配对。');if(!task.owner)await waitForNoDialog(task.controller.signal);revision=backup.revision;restored=mergeWorkspaces(backup.workspace,localWorkspace());}
   if(!valid())return;
   const latestView=api.captureView?.(),s=getState();s.endpoint=pair.endpoint===location.origin?'':pair.endpoint;s.token=pair.token;s.live=options.live!==false;s.persist=!!options.save;
   if(restored)applyWorkspace(restored.workspace);
   connected=true;ocrAvailable=!!status.ocr;aiReady=status.ready;phase='connected';syncError='';
   if(options.save)sync.connect({...pair,revision});
   rememberPair(pair,options.remember);api.persist();
   pairTask=null;if(location.hash.includes('key='))history.replaceState(null,'',location.pathname+location.search);if(task.owner)closeModal();if(!api.restoreView?.(latestView))api.restoreProgress();render();toast(!status.ready?'Mac 已连接。请在 Mac 登录 Codex，截图与本地规则可继续使用。':restored?.conflictCopies?'已连接。两边不同的内容均已保留，带“本机副本”的对话请核对。':(s.live?'已连接真实 AI，聊天记录已就绪。':'已连接 Mac，保留本地规则模式。'));
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
 async function paste(){
  const s=getState(),chatId=s.active,version=contextVersion,chat=s.chats.find(chat=>chat.id===chatId),composer=JSON.stringify(chat?.composer);
  await pasteClipboard({isCurrent:()=>getState().active===chatId&&contextVersion===version&&JSON.stringify(getState().chats.find(chat=>chat.id===chatId)?.composer)===composer,
   accept:text=>{if(text.length>2000||(/^(我|自己|对方|她|他|女友|老婆|伴侣|me|partner)\s*[:：]/im.test(text)&&text.includes('\n')))api.openImport(text);else api.quickPaste(text);},
   unavailable:()=>{api.quickPaste();toast('在下方输入框长按粘贴，原有输入已保留。');},empty:()=>toast('剪贴板没有文字，原有输入已保留。')});
 }
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
 window.xianwaiPersistWorkspace=s=>{if(connected&&s.persist)try{sync.schedule({schemaVersion:5,folders:s.folders,deletedFavoriteIds:s.deletedFavoriteIds,activeUpdatedAt:s.activeUpdatedAt,active:s.active,chats:s.chats,favorites:s.favorites});}catch(error){toast(error.message);}};
 window.xianwaiDeleteBackup=async()=>{if(!connected){let remembered=false;remembered=!!(safeStorage.read('localStorage','xianwai-connection-v1')||safeStorage.read('sessionStorage','xianwai-connection-v1'));if(remembered||getState().token)throw new Error('请先重新连接 Mac，再清除 Mac 备份。当前设备的记录未改动。');return;}if(!getState().persist){const pair={endpoint:endpoint(),token:getState().token},backup=await query(pair,'/api/workspace',AbortSignal.timeout(12000));sync.connect({...pair,revision:backup.revision});}await sync.clear();analysisClient.clearCache();};
 window.xianwaiSettingsSaved=()=>{if(connected){let permanent=false;permanent=!!safeStorage.read('localStorage','xianwai-connection-v1');rememberPair({endpoint:endpoint()||location.origin,token:getState().token},permanent);}};
 window.xianwaiBeforeSettings=async(candidate,signal)=>{
  const s=getState();
  if(candidate.endpoint!==s.endpoint||candidate.token!==s.token){disconnect();return;}
  if(!candidate.persist){sync.disconnect();return;}
  if(connected&&!s.persist){const health=await query({endpoint:endpoint(),token:s.token},'/api/health',signal);if(health.workspaceSchema!==5)throw new Error('请先将 Mac 弦外升级到 0.5.0，再保存联系人资料库。');const pair={endpoint:endpoint(),token:s.token},backup=await query(pair,'/api/workspace',signal);if(signal.aborted)return;const restored=mergeWorkspaces(backup.workspace,localWorkspace());sync.connect({...pair,revision:backup.revision});applyWorkspace(restored.workspace);}
 };
 const observer=new MutationObserver(()=>{const box=document.querySelector('#endpoint');if(connected&&box&&!document.querySelector('[data-companion="disconnect"]')){const b=document.createElement('button');b.className='outline-btn';b.dataset.companion='disconnect';b.textContent='断开这台设备与 Mac 的连接';box.parentElement.append(b);}});observer.observe(document.querySelector('#modal-root'),{childList:true,subtree:true});
 const hash=new URLSearchParams(location.hash.slice(1));
 if(hash.has('key')){try{const pair=parsePair(location.href);pairingModal(pair);}catch(error){toast(error.message);}}
 else{let saved,remember=true,savedLive=true;try{const local=safeStorage.read('localStorage','xianwai-connection-v1');remember=!!local;saved=JSON.parse(local||safeStorage.read('sessionStorage','xianwai-connection-v1')||'null');savedLive=saved?.live!==false;if(saved)saved=parsePair('https://pair.invalid/#bridge='+encodeURIComponent(saved.endpoint)+'&key='+encodeURIComponent(saved.token));}catch{saved=null;}if(saved)void connect(saved,{remember,save:getState().persist,live:savedLive});}
 const checkConnection=()=>heartbeat.check();
 bindWorkspaceLifecycle({save:api.persistNow,flush:()=>sync.flush(),resume:()=>void checkConnection()});
 window.addEventListener('online',()=>void checkConnection());
 setInterval(()=>void checkConnection(),20000);
 draw();
}
