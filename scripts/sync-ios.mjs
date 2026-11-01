import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('ios/Xianwai/Resources/Web/',root);
await mkdir(out,{recursive:true});
// Bundle a classic script: file:// WKWebView pages cannot rely on browser ES-module loading.
const core=(await readFile(new URL('dist/core.js',root),'utf8')).replace(/^export /gm,'');
const companion=(await readFile(new URL('dist/companion.js',root),'utf8')).replace(/^export /gm,'');
const app=(await readFile(new URL('dist/app.js',root),'utf8')).replace(/^import .*?;\n/gm,'');
await writeFile(new URL('app.js',out),'(()=>{\n'+core+'\n'+companion+'\n'+app+'\n})();\n');
const html=(await readFile(new URL('dist/index.html',root),'utf8')).replace('type="module" src="./app.js"','defer src="./app.js"');
await writeFile(new URL('index.html',out),html);
for(const name of ['styles.css','icon.svg','manifest.json','app-icon.png'])await copyFile(new URL('dist/'+name,root),new URL(name,out));
console.log('Synced offline web resources into the iPhone app.');
