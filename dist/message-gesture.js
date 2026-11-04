export function createMessageGesture({schedule=(callback,ms)=>setTimeout(callback,ms),unschedule=id=>clearTimeout(id),now=()=>performance.now(),delay=450}={}){
 let pending=null,last=null;
 function cancel(){if(pending)unschedule(pending.timer);pending=null;}
 function reset(){cancel();last=null;}
 function suppresses(key){return !!last&&last.key===key&&now()<last.until;}
 function activate(key,isCurrent,action){
  cancel();if(!isCurrent()||suppresses(key))return false;
  last={key,until:now()+1000};action();return true;
 }
 function start(key,isCurrent,action){
  reset();const press={key,isCurrent,action};pending=press;
  press.timer=schedule(()=>{if(pending===press){pending=null;activate(key,isCurrent,action);}},delay);
 }
 return {start,cancel,reset,suppresses,activate};
}
