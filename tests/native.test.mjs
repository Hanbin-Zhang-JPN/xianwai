import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);
test('Mac tunnel readiness survives split logs and waits for published DNS answers',{skip:process.platform!=='darwin'},async t=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'xianwai-native-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const source=path.join(folder,'main.swift'),binary=path.join(folder,'test');
 await writeFile(source,`import Foundation
var state = TunnelReadiness()
state.ingest("https://api.trycloudflare.com/tunnel\\nhttps://fictional-demo.trycloud")
assert(state.address == nil)
state.ingest("flare.com\\nRegistered tunnel con")
assert(state.address == "https://fictional-demo.trycloudflare.com")
assert(!state.registered)
state.ingest("nection\\n")
assert(state.registered)
assert(!TunnelReadiness.hasIPv4Answer(";; NXDOMAIN\\n"))
assert(!TunnelReadiness.hasIPv4Answer("999.16.230.132"))
assert(TunnelReadiness.hasIPv4Answer("104.16.230.132\\n104.16.231.132\\n"))
print("native readiness passed")`);
 const {stdout:sdk}=await exec('xcrun',['--show-sdk-path']);const stable='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk';
 const {access}=await import('node:fs/promises');let chosen=sdk.trim();try{await access(stable);chosen=stable;}catch{}
 await exec('swiftc',['-sdk',chosen,'-module-cache-path',path.join(folder,'cache'),'desktop/TunnelReadiness.swift',source,'-o',binary],{cwd:new URL('../',import.meta.url),timeout:30000});
 assert.match((await exec(binary)).stdout,/native readiness passed/);
});
