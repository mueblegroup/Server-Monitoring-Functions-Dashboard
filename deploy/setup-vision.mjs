import {mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../public/vision');
const base='https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/';
async function download(url){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Download failed: HTTP '+response.status+' '+url);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>32*1024*1024)throw Error('Vision asset exceeds size limit');chunks.push(chunk);}return Buffer.concat(chunks);}
await mkdir(root,{recursive:true});
const model=JSON.parse((await download(base+'model.json')).toString('utf8'));
const weights=[...new Set(model.weightsManifest?.flatMap(g=>g.paths)||[])];if(!weights.length||weights.length>32||weights.some(p=>!/^group\d+-shard\d+of\d+(?:\.bin)?$/.test(p)))throw Error('Unexpected model weight manifest');
const assets=[['tf.min.js','https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.es2017.min.js'],['coco-ssd.min.js','https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'],['TFJS-LICENSE.txt','https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE'],['COCO-LICENSE.txt','https://raw.githubusercontent.com/tensorflow/tfjs-models/master/LICENSE'],...weights.map(p=>[p,base+p])];
const manifest={tfjs:'4.22.0',cocoSsd:'2.2.3',installedAt:new Date().toISOString(),files:{}};
for(const[name,url]of assets){console.log('Downloading '+name);const bytes=await download(url);await writeFile(resolve(root,name+'.tmp'),bytes);await rename(resolve(root,name+'.tmp'),resolve(root,name));manifest.files[name]=createHash('sha256').update(bytes).digest('hex');}
await writeFile(resolve(root,'model.json.tmp'),JSON.stringify(model));await rename(resolve(root,'model.json.tmp'),resolve(root,'model.json'));
await writeFile(resolve(root,'assets.json'),JSON.stringify(manifest,null,2));console.log('Vision assets installed. Camera frames will be processed locally in the browser.');
