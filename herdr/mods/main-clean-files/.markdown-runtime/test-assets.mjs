import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { loadAsset, dimensions } from "./asset-worker.mjs";

const temp=await fs.mkdtemp(path.join(os.tmpdir(),"main-clean-files-images-"));
const cache=path.join(temp,"cache");
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYkAAAAASUVORK5CYII=","base64");
const local=path.join(temp,"local image.png");
await fs.writeFile(local,png);
assert.equal(dimensions(png).width,1);
const loadedLocal=await loadAsset({id:"local",path:local},{cacheDir:cache});
assert.equal(loadedLocal.path,local);
assert.equal(loadedLocal.height,1);

let requests=0;
const server=http.createServer((request,response)=>{
  requests++;
  if(request.url==="/bad"){response.setHeader("content-type","text/html");response.end("<html>not an image</html>");}
  else{response.setHeader("content-type","image/png");response.end(png);}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
try{
  const url=`http://127.0.0.1:${server.address().port}/online.png`;
  const online=await loadAsset({id:"online",url},{cacheDir:cache});
  assert.equal(online.width,1);
  const cached=await loadAsset({id:"online",url},{cacheDir:cache});
  assert.equal(cached.path,online.path);
  assert.equal(requests,1);
  const bad=await loadAsset({id:"bad",url:url.replace("online.png","bad")},{cacheDir:cache});
  assert(bad.error);
  let captured;
  const remote=await loadAsset({id:"remote",path:"/remote/a b $(not-command).png",on:"ssh-box"},{
    cacheDir:cache,
    runner:async(command,args)=>{captured={command,args};return{stdout:png.toString("base64")};},
  });
  assert.equal(remote.width,1);
  assert.equal(captured.command,"hc");
  assert.equal(captured.args.at(-1),"/remote/a b $(not-command).png");
  assert(captured.args.includes("ssh-box"));
  const svg=await loadAsset({id:"svg",data:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"/>')},{cacheDir:cache});
  assert.equal(svg.width,300);
  assert.equal(svg.height,120);
  console.log("PASS: local, HTTP, cached, failed, remote literal-path, data and SVG images");
}finally{
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(temp,{recursive:true,force:true});
}
