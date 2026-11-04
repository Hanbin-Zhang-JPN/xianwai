// A delayed clipboard permission response must not overwrite a different contact or newer input.
export async function pasteClipboard({read=()=>navigator.clipboard.readText(),isCurrent,accept,unavailable,empty}){
 let text;
 try{text=await read();}catch{if(isCurrent())unavailable();return false;}
 if(!isCurrent())return false;
 if(typeof text!=='string'||!text.trim()){empty();return false;}
 accept(text);return true;
}

export function guardClipboardDialog(isCurrent,getDialog){const owner=getDialog();return ()=>isCurrent()&&getDialog()===owner;}

// The browser write may already be in progress; only current views receive UI feedback.
export async function copyClipboard(text,{write=value=>navigator.clipboard.writeText(value),isCurrent,copied,manual}){
 if(!isCurrent())return false;
 try{await write(text);}catch{if(isCurrent())manual(text);return false;}
 if(!isCurrent())return false;copied();return true;
}
