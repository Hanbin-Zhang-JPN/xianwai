// A delayed clipboard permission response must not overwrite a different contact or newer input.
export async function pasteClipboard({read=()=>navigator.clipboard.readText(),isCurrent,accept,unavailable,empty}){
 let text;
 try{text=await read();}catch{if(isCurrent())unavailable();return false;}
 if(!isCurrent())return false;
 if(typeof text!=='string'||!text.trim()){empty();return false;}
 accept(text);return true;
}
