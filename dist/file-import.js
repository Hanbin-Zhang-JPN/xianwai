// File reads may finish after typing, another selection, or closing the import dialog.
export async function readTranscriptFile(file,{isCurrent,accept,failed}){
 try{
  if(file.size>8000000)throw new Error('文件超过 8 MB，请拆分后导入。');
  const text=await file.text();
  if(!isCurrent())return false;
  accept(text);return true;
 }catch(error){
  if(isCurrent())failed(file.size>8000000?error.message:'无法读取这个文件，请尝试粘贴文字。');
  return false;
 }
}
