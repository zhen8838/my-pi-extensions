import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),LIMIT=8*1024*1024,REMOTE_LIMIT=4*1024*1024;
const cache=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../cache/main-clean-files-markdown');

export function dimensions(b){
  if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return{width:b.readUInt32BE(16),height:b.readUInt32BE(20),ext:'png'};
  if(b.length>=10&&/^GIF8[79]a$/.test(b.toString('ascii',0,6)))return{width:b.readUInt16LE(6),height:b.readUInt16LE(8),ext:'gif'};
  if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const kind=b.toString('ascii',12,16);
    if(kind==='VP8X')return{width:b.readUIntLE(24,3)+1,height:b.readUIntLE(27,3)+1,ext:'webp'};
    if(kind==='VP8 ')return{width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff,ext:'webp'};
    if(kind==='VP8L'){const x=b.readUInt32LE(21);return{width:(x&0x3fff)+1,height:((x>>>14)&0x3fff)+1,ext:'webp'};}
  }
  if(b.length>4&&b[0]===255&&b[1]===216){let i=2;while(i+8<b.length){if(b[i]!==255){i++;continue;}const marker=b[i+1];i+=2;if(marker===216||marker===217)continue;const length=b.readUInt16BE(i);if(length<2)break;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return{height:b.readUInt16BE(i+3),width:b.readUInt16BE(i+5),ext:'jpg'};i+=length;}}
  const text=b.toString('utf8',0,Math.min(b.length,65536)),tag=text.match(/<svg\b[^>]*>/i)?.[0];
  if(tag){const vb=tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number),w=tag.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i),h=tag.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
    return{width:w?+w[1]:vb?.[2]??800,height:h?+h[1]:vb?.[3]??600,ext:'svg'};}
  throw Error('不是可显示的 PNG/JPEG/GIF/WebP/SVG 图片');
}
async function fetchImage(url,timeout){
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error('图片服务器返回 HTTP '+response.status);
  if(Number(response.headers.get('content-length'))>LIMIT)throw Error('图片超过 8 MiB');
  const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>LIMIT)throw Error('图片超过 8 MiB');parts.push(part);}return Buffer.concat(parts);
}
export async function loadAsset(item,{force=false,deadline=Date.now()+22000,cacheDir=cache,runner=run}={}){
  if(item.error)return{id:item.id,error:item.error};
  try{
    const timeout=Math.min(15000,deadline-Date.now());if(timeout<500)throw Error('本轮图片加载超时，请刷新重试');
    let buffer,output;
    const key=crypto.createHash('sha256').update(JSON.stringify([item.url,item.path,item.on,item.data])).digest('hex');
    await fs.mkdir(cacheDir,{recursive:true});
    if(!force&&(item.url||item.on||item.data)){
      for(const ext of ['png','jpg','gif','webp','svg']){const cached=path.join(cacheDir,key+'.'+ext);const stat=await fs.stat(cached).catch(()=>null);
        if(stat&&Date.now()-stat.mtimeMs<300000){const data=await fs.readFile(cached);return{id:item.id,path:cached,...dimensions(data)};}}
    }
    if(item.url){if(!/^https?:\/\//i.test(item.url))throw Error('不支持的图片 URL');buffer=await fetchImage(item.url,Math.min(timeout,10000));}
    else if(item.data){const match=/^data:image\/[a-z0-9.+-]+(;base64)?,([\s\S]*)$/i.exec(item.data);if(!match)throw Error('无效的内嵌图片');buffer=match[1]?Buffer.from(match[2],'base64'):Buffer.from(decodeURIComponent(match[2]));}
    else if(item.on){
      const script='test -f "$1" || exit 44; n=$(wc -c < "$1"); [ "$n" -le 4194304 ] || exit 45; base64 < "$1"';
      const result=await runner('hc',['exec','--on',item.on,'--timeout',String(Math.max(1,Math.floor(timeout/1000))),'--','sh','-c',script,'markdown-image',item.path],{timeout,maxBuffer:6*1024*1024,encoding:'utf8'});
      buffer=Buffer.from(result.stdout.replace(/\s/g,''),'base64');if(buffer.length>REMOTE_LIMIT)throw Error('远程图片超过 4 MiB');
    }else{
      const stat=await fs.stat(item.path);if(stat.size>LIMIT)throw Error('图片超过 8 MiB');buffer=await fs.readFile(item.path);output=item.path;
    }
    if(buffer.length>LIMIT)throw Error('图片超过 8 MiB');
    const info=dimensions(buffer);if(!(info.width>0&&info.height>0&&info.width*info.height<=100000000))throw Error('图片尺寸无效或过大');
    if(!output){output=path.join(cacheDir,key+'.'+info.ext);const tmp=output+'.tmp-'+process.pid+'-'+crypto.randomBytes(6).toString('hex');await fs.writeFile(tmp,buffer);await fs.rename(tmp,output);}
    return{id:item.id,path:output,...info};
  }catch(e){return{id:item.id,error:e.code===44?'远程图片文件不存在':e.code===45?'远程图片超过 4 MiB':String(e.message??e)};}
}
async function main(){
  const request=process.argv[2];const parsed=JSON.parse(await fs.readFile(request,'utf8'));const items=parsed.items.slice(0,128),results=Array(items.length),deadline=Date.now()+22000;let next=0;
  async function worker(){for(;;){const i=next++;if(i>=items.length)return;results[i]=await loadAsset(items[i],{force:parsed.force,deadline,...(parsed.cacheDir?{cacheDir:parsed.cacheDir}:{})});}}
  await Promise.all(Array.from({length:Math.min(8,items.length)},worker));
  await fs.unlink(request).catch(()=>{});process.stdout.write(JSON.stringify({images:results}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{process.stderr.write(String(e.message??e));process.exitCode=1;});
