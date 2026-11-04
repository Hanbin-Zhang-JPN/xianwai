import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
// execFile rejects on abort before the worker necessarily exits. Wait before deleting its files.
export async function execAndWait(file,args,options){
 const operation=exec(file,args,options),child=operation.child;
 const closed=new Promise(resolve=>child.once('close',resolve));
 let result,error,killer;
 try{result=await operation;}catch(issue){error=issue;}
 if(error&&child.pid&&child.exitCode===null&&child.signalCode===null){
  child.kill('SIGTERM');killer=setTimeout(()=>child.kill('SIGKILL'),750);
 }
 await closed;clearTimeout(killer);
 if(error)throw error;return result;
}
