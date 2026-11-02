let activeRequest=null;
const cache=new Map();
export async function requestAnalysis({endpoint,token,input}){
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
export async function cancelAnalysis(){
 const old=activeRequest;if(!old)return;activeRequest=null;old.controller.abort();
 if(old.job)try{await fetch(old.base+'/api/jobs/'+encodeURIComponent(old.job),{method:'DELETE',headers:{Authorization:'Bearer '+old.token},signal:AbortSignal.timeout(3000)});}catch{}
}

export function startCompanion(api){
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
