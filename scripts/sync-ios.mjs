import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('ios/Xianwai/Resources/Web/',root);
await mkdir(out,{recursive:true});
// Bundle a classic script: file:// WKWebView pages cannot rely on browser ES-module loading.
const modules=['core','flow','analysis-client','library','workspace','workspace-sync','pairing','companion','library-ui','app'];
const bundled=[];
for(const name of modules)bundled.push((await readFile(new URL('dist/'+name+'.js',root),'utf8')).replace(/^import .*?;\n/gm,'').replace(/^export /gm,''));
await writeFile(new URL('app.js',out),'(()=>{\n'+bundled.join('\n')+'\n})();\n');
const html=(await readFile(new URL('dist/index.html',root),'utf8')).replace('type="module" src="./app.js"','defer src="./app.js"');
await writeFile(new URL('index.html',out),html);
for(const name of ['styles.css','icon.svg','manifest.json','app-icon.png'])await copyFile(new URL('dist/'+name,root),new URL(name,out));
console.log('Synced offline web resources into the iPhone app.');
