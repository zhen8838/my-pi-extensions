import {readFile,writeFile} from "node:fs/promises";

const root=new URL("./node_modules/github-markdown-css/",import.meta.url);
const output=new URL("../github-markdown-theme.js",import.meta.url);
const escape=value=>value.replace(/[.*+?^\${}()|[\]\\]/g,"\\$&");
const property=(body,name)=>new RegExp("(?:^|\\n)\\s*"+escape(name)+"\\s*:\\s*([^;]+)","m").exec(body)?.[1]?.trim();
const block=(css,pattern,last=false)=>{
  const values=[...css.matchAll(pattern)].map(match=>match[1]);
  return last?values.at(-1):values[0];
};
function parse(css){
  const body=block(css,/\.markdown-body\s*\{([^}]*)\}/g);
  const link=block(css,/\.markdown-body a\s*\{([^}]*)\}/g,true);
  const quote=block(css,/\.markdown-body blockquote\s*\{([^}]*)\}/g);
  const cells=block(css,/\.markdown-body table th,\s*\.markdown-body table td\s*\{([^}]*)\}/g);
  const row=block(css,/\.markdown-body table tr\s*\{([^}]*)\}/g);
  const alt=block(css,/\.markdown-body table tr:nth-child\(2n\)\s*\{([^}]*)\}/g);
  const inline=block(css,/\.markdown-body code,\s*\.markdown-body tt\s*\{([^}]*)\}/g);
  const pre=block(css,/\.markdown-body \.highlight pre,\s*\.markdown-body pre\s*\{([^}]*)\}/g);
  const border=(property(cells,"border")??"").match(/#[0-9a-f]{6,8}/i)?.[0];
  const quoteBorder=(property(quote,"border-left")??"").match(/#[0-9a-f]{6,8}/i)?.[0];
  return{
    background:property(body,"background-color"),
    foreground:property(body,"color"),
    muted:property(quote,"color"),
    link:property(link,"color"),
    border,
    codeBlockBackground:property(pre,"background-color"),
    inlineCodeBackground:property(inline,"background-color"),
    tableBodyBackground:property(row,"background-color"),
    tableAltBackground:property(alt,"background-color"),
    quoteBorder,
  };
}
const light=parse(await readFile(new URL("github-markdown-light.css",root),"utf8"));
const dark=parse(await readFile(new URL("github-markdown-dark.css",root),"utf8"));
await writeFile(output,
  "// Generated from github-markdown-css 5.9.0 by .render-runtime/generate-theme.mjs.\n"+
  "export const githubMarkdownLight="+JSON.stringify(light,null,2)+";\n"+
  "export const githubMarkdownDark="+JSON.stringify(dark,null,2)+";\n"
);
