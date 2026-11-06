// Local-only parser/highlighter worker. Document content is never executed.
import {readFile,writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {all,createStarryNight} from '@wooorm/starry-night'
import {marked} from 'marked'
import sanitizeHtml from 'sanitize-html'
import {parseDocument} from 'htmlparser2'

const MAX_CHARS=120000,MAX_LINES=3000,MAX_BLOCKS=1000
const DEFAULT={light:{color:'#24292f'},dark:{color:'#e1e4e8'}}

function cssRules(css){
  const variables=Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]))
  const rules=[]
  for(const match of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)){
    if(match[1].trim()===':root')continue
    const body=match[2]
    const style={}
    const value=name=>{
      const found=new RegExp(name+'\\s*:\\s*([^;]+)').exec(body)?.[1]?.trim()
      if(!found)return null
      const variable=/^var\((--[\w-]+)\)$/.exec(found)
      return variable?(variables[variable[1]]??null):found
    }
    const color=value('color'),background=value('background-color')
    if(color)style.color=color
    if(background)style.background=background
    if(/font-weight\s*:\s*bold/.test(body))style.bold=true
    if(/font-style\s*:\s*italic/.test(body))style.italic=true
    if(/text-decoration\s*:\s*underline/.test(body))style.underline=true
    for(const selector of match[1].split(',')){
      const classes=[...selector.matchAll(/\.([\w-]+)/g)].map(m=>m[1])
      if(classes.length)rules.push({classes,style})
    }
  }
  return rules
}

const lightRules=cssRules(await readFile(new URL('./node_modules/@wooorm/starry-night/style/light.css',import.meta.url),'utf8'))
const darkRules=cssRules(await readFile(new URL('./node_modules/@wooorm/starry-night/style/dark.css',import.meta.url),'utf8'))
const starryNight=await createStarryNight(all)

function matches(classes,stack){
  let at=0
  for(const wanted of classes){
    const found=stack.slice(at).indexOf(wanted)
    if(found<0)return false
    at+=found+1
  }
  return true
}

function resolveStyle(rules,stack,fallback){
  const style={...fallback}
  for(const rule of rules)if(matches(rule.classes,stack))Object.assign(style,rule.style)
  return style
}

function highlighted(value,flag,includeFences=true){
  const input=String(value??'').split('\n').slice(0,MAX_LINES).join('\n')
  const name=String(flag??''),extension=name.includes('.')?name.split('.').pop():name
  const scope=starryNight.flagToScope(extension)||starryNight.flagToScope(name)
  if(!scope||input.split('\n').some(line=>line.length>4000))return plainCode(input,scope??'text')
  let tree
  try{tree=starryNight.highlight(input,scope)}catch{return plainCode(input,scope)}
  const rows=[[]]
  let column=0,width=0
  const add=(text,stack)=>{
    let part=''
    const flush=()=>{
      if(!part)return
      const light=resolveStyle(lightRules,stack,DEFAULT.light)
      const dark=resolveStyle(darkRules,stack,DEFAULT.dark)
      const previous=rows.at(-1).at(-1)
      const key=JSON.stringify([light,dark])
      if(previous&&previous[3]===key)previous[0]+=part
      else rows.at(-1).push([part,light,dark,key])
      part=''
    }
    for(const ch of text){
      if(ch==='\n'){
        flush();width=Math.max(width,column);rows.push([]);column=0
      }else if(ch==='\t'){
        const spaces=' '.repeat(4-column%4);part+=spaces;column+=spaces.length
      }else{
        part+=ch;column+=ch.codePointAt(0)>255?2:1
      }
    }
    flush()
  }
  const walk=(node,stack=[])=>{
    if(node.type==='text'){add(node.value,stack);return}
    const own=Array.isArray(node.properties?.className)?node.properties.className:[]
    const next=stack.concat(own)
    for(const child of node.children??[])walk(child,next)
  }
  walk(tree)
  width=Math.max(width,column)
  const result={kind:'code',language:scope,lines:rows.map(row=>row.map(token=>token.slice(0,3))),columns:width}
  if(scope==='text.md'&&includeFences)mergeFencedCode(input,result)
  return result
}

function plainCode(input,language='text'){
  let width=0
  const lines=input.split('\n').map(line=>{
    let column=0,expanded=''
    for(const ch of line){
      const part=ch==='\t'?' '.repeat(4-column%4):ch
      expanded+=part;column+=ch.codePointAt(0)>255?2:part.length
    }
    width=Math.max(width,column)
    return [[expanded,DEFAULT.light,DEFAULT.dark]]
  })
  return {kind:'code',language,lines,columns:width}
}

function expandedLine(line){
  let column=0,result=''
  for(const character of line){
    const part=character==='\t'?' '.repeat(4-column%4):character
    result+=part;column+=character.codePointAt(0)>255?2:part.length
  }
  return result
}

function mergeFencedCode(source,document){
  const tokens=marked.lexer(source,{gfm:true,breaks:false})
  const sourceLines=source.split('\n')
  const tick=String.fromCharCode(96)
  let cursor=0
  const visit=items=>{
    for(const token of items??[]){
      if(token.type==='code'&&typeof token.raw==='string'){
        const opening=token.raw.trimStart()
        const fenced=opening.startsWith(tick.repeat(3))||opening.startsWith('~~~')
        if(fenced){
          const at=source.indexOf(token.raw,cursor)
          if(at>=0){
            cursor=at+token.raw.length
            const openingLine=(source.slice(0,at).match(/\n/g)??[]).length
            const embedded=highlighted(token.text,token.lang,false)
            for(let index=0;index<embedded.lines.length;index++){
              const lineIndex=openingLine+1+index
              if(lineIndex>=sourceLines.length)break
              const actual=expandedLine(sourceLines[lineIndex])
              const row=embedded.lines[index]
              const plain=row.map(part=>part[0]).join('')
              if(!plain){
                if(!actual)document.lines[lineIndex]=[]
                continue
              }
              const position=actual.indexOf(plain)
              if(position<0)continue
              const merged=[]
              if(position)merged.push([actual.slice(0,position),DEFAULT.light,DEFAULT.dark])
              merged.push(...row)
              const end=position+plain.length
              if(end<actual.length)merged.push([actual.slice(end),DEFAULT.light,DEFAULT.dark])
              document.lines[lineIndex]=merged
              document.columns=Math.max(document.columns,actual.length)
            }
          }
        }
      }
      visit(token.tokens)
      visit(token.items)
    }
  }
  visit(tokens)
}

const safeOptions={
  allowedTags:['p','br','a','strong','em','del','s','code','kbd','sup','sub','ul','ol','li','blockquote'],
  allowedAttributes:{a:['href','title'],ol:['start']},
  allowedSchemes:['http','https','mailto'],
  allowProtocolRelative:false,
  transformTags:{img:()=>({tagName:'span',text:''})},
}
const clean=html=>sanitizeHtml(html,safeOptions)
const inline=tokens=>clean(marked.Parser.parseInline(tokens??[]))
const segmenter=new Intl.Segmenter('zh',{granularity:'word'})

export function inlineRuns(html){
  const runs=[]
  const textOf=node=>node.type==='text'?node.data:(node.children??[]).map(textOf).join('')
  function walk(node,style={},depth=0){
    if(depth>64)return
    if(node.type==='text'){
      const text=node.data.replace(/[ \t\r\n\f]+/g,' ')
      for(const item of segmenter.segment(text))runs.push({...style,text:item.segment})
      return
    }
    const tag=node.name,next={...style}
    if(tag==='br'){runs.push({break:true});return}
    if(tag==='a')next.href=node.attribs?.href||''
    if(tag==='strong')next.bold=true
    if(tag==='em')next.italic=true
    if(tag==='del'||tag==='s')next.strike=true
    if(tag==='code'){runs.push({...next,code:true,text:textOf(node)});return}
    for(const child of node.children??[])walk(child,next,depth+1)
  }
  walk(parseDocument(html,{decodeEntities:true}))
  return runs
}

function blocks(tokens,count={value:0},depth=0){
  const out=[]
  if(depth>12)return out
  for(const token of tokens){
    if(count.value>=MAX_BLOCKS)break
    if(['space','def','checkbox'].includes(token.type))continue
    count.value++
    const images=[]
    const collect=imageToken=>{
      if(imageToken.type==='image'){
        const src=imageToken.href??'',alt=imageToken.text??'',title=imageToken.title?' "'+String(imageToken.title).replaceAll('"','\\"')+'"':''
        if(src)images.push({kind:'image',markdown:'!['+alt+'](<'+src+'>'+title+')'})
      }
      if(imageToken.type==='html')for(const match of String(imageToken.raw??imageToken.text??'').matchAll(/<img\b[^>]*>/gi))images.push({kind:'image',html:match[0]})
      for(const child of imageToken.tokens??[])collect(child)
      for(const child of imageToken.items??[])collect(child)
    }
    collect(token)
    if(token.type==='code')out.push(highlighted(token.text,token.lang))
    else if(token.type==='heading')out.push({kind:'heading',depth:token.depth,runs:inlineRuns(inline(token.tokens))})
    else if(token.type==='hr')out.push({kind:'rule'})
    else if(token.type==='blockquote')out.push({kind:'quote',blocks:blocks(token.tokens,count,depth+1)})
    else if(token.type==='list')out.push({kind:'list',items:token.items.slice(0,500).map((item,index)=>({
      marker:item.task?(item.checked?'☑':'☐'):token.ordered?String(Number(token.start)+index)+'.':'•',
      blocks:blocks(item.tokens,count,depth+1),
    }))})
    else if(token.type==='table')out.push({
      kind:'table',align:token.align.slice(0,20),
      header:token.header.slice(0,20).map(cell=>inlineRuns(inline(cell.tokens))),
      rows:token.rows.slice(0,200).map(row=>row.slice(0,20).map(cell=>inlineRuns(inline(cell.tokens)))),
    })
    else out.push({kind:'text',runs:inlineRuns(token.tokens?inline(token.tokens):clean(marked.parser([token],{gfm:true})))})
    out.push(...images)
  }
  return out
}

export async function buildDocument({text,path}){
  if(typeof text!=='string'||typeof path!=='string')throw Error('Invalid render request')
  const source=text.slice(0,MAX_CHARS).split('\n').slice(0,MAX_LINES).join('\n')
  const markdown=/\.(md|markdown|mdown|mkd|mkdn)$/i.test(path)
  const count={value:0}
  const parsed=markdown?marked.lexer(source,{gfm:true,breaks:false}):[]
  return {
    version:2,
    engine:'starry-night@3.11.0 + marked@18.1.3',
    markdown,
    source:highlighted(source,path),
    blocks:markdown?blocks(parsed,count):[],
    sourceTruncated:source!==text,
    previewTruncated:count.value>=MAX_BLOCKS,
    truncated:source!==text||count.value>=MAX_BLOCKS,
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const timer=setTimeout(()=>{console.error('Render timed out');process.exit(1)},30000)
  try{
    const request=JSON.parse(await readFile(process.argv[2],'utf8'))
    const result=await buildDocument(request)
    await writeFile(process.argv[2]+'.result',JSON.stringify(result),{mode:0o600})
  }catch(error){console.error(String(error));process.exitCode=1}
  finally{clearTimeout(timer)}
}
