import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeWorkspace} from '../dist/workspace.js';

export class WorkspaceStore{
 constructor(directory){this.directory=directory;this.file=path.join(directory,'workspace.json');this.queue=Promise.resolve();}
 serial(operation){const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;}
 async current(){
  let value;try{value=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return {revision:0,workspace:null};throw Object.assign(new Error('Mac 备份无法读取，已停止覆盖。请先导出或保留原始备份。'),{status:409});}
  try{
   if(value?.format===1){if(!Number.isSafeInteger(value.revision)||value.revision<0)throw new Error();return {revision:value.revision,workspace:value.workspace===null?null:normalizeWorkspace(value.workspace),libraryUpgraded:value.workspace?.schemaVersion>=2};}
   return {revision:0,workspace:normalizeWorkspace(value)};
  }catch{throw Object.assign(new Error('Mac 备份格式损坏，已停止覆盖。请保留原始文件。'),{status:409});}
 }
 read(){return this.serial(()=>this.current());}
 async write(workspace,baseRevision){
  const current=await this.current();
  if(!Number.isSafeInteger(baseRevision)||baseRevision!==current.revision)throw Object.assign(new Error('Mac 备份已有新版本，或网页需要刷新。已停止覆盖，请重新配对合并记录。'),{status:409});
  const revision=current.revision+1,temporary=this.file+'.'+randomUUID()+'.tmp';
  await mkdir(this.directory,{recursive:true,mode:0o700});
  try{await writeFile(temporary,JSON.stringify({format:1,revision,workspace}),{mode:0o600});await rename(temporary,this.file);}finally{await rm(temporary,{force:true});}
  return {revision,workspace};
 }
 save(workspace,baseRevision){return this.serial(async()=>{const current=await this.current();if(current.libraryUpgraded&&workspace?.schemaVersion!==3)throw Object.assign(new Error('联系人资料库已升级，请刷新网页或重新扫码后再保存，已有记录未改动。'),{status:409});return this.write(normalizeWorkspace(workspace),baseRevision);});}
 clear(baseRevision){return this.serial(()=>this.write(null,baseRevision));}
}
