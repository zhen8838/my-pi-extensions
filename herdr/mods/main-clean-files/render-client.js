import * as fs from "fs/promises";
import { appHome, exec } from "herdr";

// Worker v2 merges fenced-code grammars back into Markdown Source rows.

export async function prepareDocument(text, path) {
  const directory=`${appHome()}/cache/main-clean-files-render`;
  const request=`${directory}/request-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  await fs.mkdir(directory,{recursive:true});
  try{
    await fs.writeFile(request,JSON.stringify({text,path}),{mode:384});
    const result=await exec("node",[`${appHome()}/mods/main-clean-files/.render-runtime/worker.mjs`,request]);
    if(result.code!==0)throw Error(result.stderr||"Render worker failed");
    const document=JSON.parse(await fs.readFile(request+".result","utf8"));
    if(document.version!==2||!document.source?.lines||!Array.isArray(document.blocks))throw Error("Invalid render result");
    return document;
  }finally{
    await fs.unlink(request).catch(()=>{});
    await fs.unlink(request+".result").catch(()=>{});
  }
}
