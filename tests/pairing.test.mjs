import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePairLink,probeConnection,connectionError,safeStorage} from '../dist/pairing.js';
const token='1'.repeat(64),pair={endpoint:'https://fictional.trycloudflare.com',token};
const health={provider:'codex',ready:true,ocr:true};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
test('QR links and fixed-page bridge links resolve to the same authenticated Mac',()=>{
 assert.deepEqual(parsePairLink(pair.endpoint+'/#key='+token),pair);
 assert.deepEqual(parsePairLink('https://workspace.invalid/#bridge='+encodeURIComponent(pair.endpoint)+'&key='+token),pair);
 assert.equal(parsePairLink('http://localhost:4399/#key='+token).endpoint,'http://localhost:4399');
 for(const url of ['https://x.invalid/#key=short','https://x.invalid/#bridge=https://user:pass@x.invalid&key='+token,'https://x.invalid/#bridge=https://x.invalid/path&key='+token,'https://x.invalid/#bridge=http://192.0.2.1&key='+token])assert.throws(()=>parsePairLink(url),/完整/);
});
test('a transient tunnel error or HTML landing page is retried before reporting a connection failure',async()=>{
 let tries=0;const attempts=[];
 const result=await probeConnection(pair,{delay:1,onAttempt:attempt=>attempts.push(attempt),fetcher:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+token);assert.equal(url,pair.endpoint+'/api/health');tries++;if(tries===1)return new Response('Cloudflare is starting',{status:502});if(tries===2)return new Response('<html>not ready</html>');return json(health);}});
 assert.deepEqual(result,health);assert.deepEqual(attempts,[1,2,3]);
});
test('expired QR credentials fail immediately and explain how to get a fresh code',async()=>{
 let tries=0;let error;try{await probeConnection(pair,{fetcher:async()=>{tries++;return json({error:'expired'},401);}});}catch(e){error=e;}
 assert.equal(tries,1);assert.equal(error.status,401);assert.match(connectionError(error),/过期/);assert.match(connectionError(error),/重新扫码/);
});
test('Codex login is independent of an otherwise working screenshot/backup connection',async()=>{
 assert.deepEqual(await probeConnection(pair,{fetcher:async()=>json({...health,ready:false})}),{...health,ready:false});
 await assert.rejects(probeConnection(pair,{delay:1,fetcher:async()=>json({ready:true,provider:'other'})}),{status:400});
});
test('pairing can be cancelled during retry without another network request',async()=>{
 const controller=new AbortController();let tries=0;
 const pending=probeConnection(pair,{signal:controller.signal,delay:50,fetcher:async()=>{tries++;return json({},502);}});
 setTimeout(()=>controller.abort(),5);await assert.rejects(pending,{name:'AbortError'});assert.equal(tries,1);
});
test('unavailable storage never crashes a pairing session',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError');}});
 try{assert.equal(safeStorage.read('localStorage','test'),null);assert.equal(safeStorage.write('localStorage','test','test'),false);assert.equal(safeStorage.remove('localStorage','test'),false);}
 finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage;}
});
