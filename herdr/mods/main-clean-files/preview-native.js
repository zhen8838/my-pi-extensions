import {div} from "gpui-kit";
import {v_flex,h_flex,TextView} from "gpui-base";
import {prepareMarkdownImages} from "./preview-assets.js";
import {prepareDocument} from "./render-client.js";
import {headingSlug,collectMarkdownImages} from "./markdown-model.js";
import {captureBlockScroll,restoreBlockScroll} from "./scroll-state.js";

const escapeHtml=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
function textOf(runs){return(runs??[]).map(run=>run.break?"\n":run.text??"").join("")}
function tokenElement(token,id,dark,theme){
  const[text,light,night]=token,style=dark?night:light;
  return div().id(id).flex_none().text_color(style.color??theme.markdown.foreground)
    .when(Boolean(style.background),element=>element.bg(style.background))
    .when(Boolean(style.bold),element=>element.font_bold())
    .when(Boolean(style.italic),element=>element.italic())
    .when(Boolean(style.underline),element=>element.underline())
    .child(text||" ");
}

export class MarkdownPreview{
  constructor(){
    this.doc={blocks:[]};this.toc=[];this.heights=[];this.scroll=0;this.scrollX=0;this.contentWidth=0;this.height=0;this.width=0;
    this.total=0;this.tocHeight=0;this.generation=0;this.showToc=true;this.loading=false;this.error=null;
    this.scrollEpoch=0;this.refreshAnchor=null;this.layoutPending=false;this.layoutMeasured=false;
  }
  hasToc(){return this.toc.length>0}
  clearDerivedState(){
    this.doc={blocks:[]};this.toc=[];this.heights=[];this.total=0;this.tocHeight=0;
    this.pending=null;this.drag=null;this.refreshAnchor=null;this.layoutPending=false;this.layoutMeasured=false;
  }
  applyDocument(document){
    this.doc=document;this.toc=this.buildToc(document.blocks);this.heights=[];this.error=null;
    if(!this.toc.length)this.tocHeight=0;
    this.layoutPending=true;this.layoutMeasured=false;
  }
  close(){
    this.generation++;this.clearDerivedState();this.loading=false;this.error=null;
    this.identity=null;this.source=null;this.target=null;this.scrollX=0;
  }
  async build(source,target,generation,cx){
    try{
      const images=await prepareMarkdownImages(source,target);
      if(this.generation!==generation)return;
      const document=await prepareDocument(images.source,target.path);
      if(this.generation!==generation)return;
      this.applyDocument(document);
    }catch(error){if(this.generation===generation)this.error=String(error)}
    finally{if(this.generation===generation)this.loading=false;cx.notify()}
  }
  setDocument(source,target,cx,force=false,prepared=null){
    const identity=JSON.stringify([target.space,target.on,target.root,target.path]);
    if(!force&&identity===this.identity&&source===this.source)return;
    const sameIdentity=identity===this.identity;
    if(sameIdentity&&this.doc.blocks.length)this.refreshAnchor={...captureBlockScroll(this.doc.blocks,this.heights,this.scroll,this.topOffset()),epoch:this.scrollEpoch};
    if(!sameIdentity){this.scroll=0;this.scrollX=0;this.selected=null;this.clearDerivedState()}
    this.identity=identity;this.source=source;this.target={...target};this.error=null;
    const generation=++this.generation;
    if(prepared&&!collectMarkdownImages(source).length){this.loading=false;this.applyDocument(prepared);return}
    // Keep the previous layout visible during a same-file image rebuild.  Apart
    // from avoiding flicker, this lets a user scroll while the new render is in flight.
    this.loading=!sameIdentity;cx.spawn(async liveCx=>this.build(source,target,generation,liveCx));
  }
  buildToc(blocks){
    const result=[],used=new Map();
    const visit=items=>{for(const block of items??[]){
      if(block.kind==="heading"){
        const title=textOf(block.runs),slug=headingSlug(title,used);block.slug=slug;result.push({title,slug,level:block.depth,index:block.__index});
      }
      if(block.blocks)visit(block.blocks);
      if(block.items)for(const item of block.items)visit(item.blocks);
    }};
    blocks.forEach((block,index)=>{block.__index=index});visit(blocks);return result;
  }
  maxScroll(){return Math.max(0,this.total-this.height)}
  maxScrollX(){return Math.max(0,this.contentWidth-this.width)}
  moveX(next,cx){
    const value=Math.max(0,Math.min(this.maxScrollX(),next));
    if(Math.abs(value-this.scrollX)>.2){this.scrollX=value;cx.notify()}
  }
  tableWidths(block,size){
    const rows=[block.header,...block.rows];
    return block.header.map((_cell,column)=>Math.max(120,...rows.map(cells=>Math.min(420,Math.max(80,textOf(cells[column]).length*size*.65+34)))));
  }
  canvasWidth(size){
    let wide=0;
    const visit=(items,indent=0)=>{for(const block of items??[]){
      if(block.kind==="code")wide=Math.max(wide,Math.ceil(block.columns*size*.7)+26+indent);
      if(block.kind==="table")wide=Math.max(wide,this.tableWidths(block,size).reduce((sum,width)=>sum+width,0)+2+indent);
      if(block.blocks)visit(block.blocks,indent+22);
      if(block.items)for(const item of block.items)visit(item.blocks,indent+36);
    }};
    visit(this.doc.blocks);
    return Math.ceil(Math.max(Math.min(900,this.width||900),wide+48));
  }
  topOffset(){return 24+this.tocHeight+(this.loading?21:0)+(this.error?21:0)}
  manualScroll(){
    this.pending=null;this.scrollEpoch++;
    if(this.refreshAnchor&&this.layoutPending)this.refreshAnchor=null;
  }
  move(next,cx,manual=true){
    if(manual)this.manualScroll();
    const value=Math.max(0,Math.min(this.maxScroll(),next));
    if(Math.abs(value-this.scroll)>.2){this.scroll=value;cx.notify()}
    if(manual&&this.refreshAnchor&&!this.layoutPending)this.refreshAnchor={...captureBlockScroll(this.doc.blocks,this.heights,this.scroll,this.topOffset()),epoch:this.scrollEpoch};
  }
  finishLayout(cx){
    if(!this.layoutPending)return;
    const ready=this.doc.blocks.length===0||this.doc.blocks.every((_block,index)=>Number.isFinite(this.heights[index]));
    if(!ready)return;
    // Block measurements are authoritative enough to restore the logical
    // anchor even if the parent size callback has not fired yet.
    if(!this.layoutMeasured)this.total=Math.max(0,this.topOffset()+24+this.heights.reduce((sum,height)=>sum+(Number.isFinite(height)?height:0),0));
    if(this.refreshAnchor?.epoch===this.scrollEpoch)this.scroll=restoreBlockScroll(this.refreshAnchor,this.doc.blocks,this.heights,this.topOffset());
    this.refreshAnchor=null;this.layoutPending=false;
    const value=Math.max(0,Math.min(this.maxScroll(),this.scroll));
    if(Math.abs(value-this.scroll)>.2)this.scroll=value;
    cx.notify();
  }
  jump(slug,cx,manual=true){
    const heading=this.toc.find(item=>item.slug===slug);if(!heading)return;
    let offset=this.topOffset();for(let index=0;index<heading.index;index++)offset+=this.heights[index]??0;
    this.move(offset,cx,manual);this.pending=slug;this.selected=slug;cx.notify();
  }
  measure(index,height,cx){
    const value=Math.ceil(height);if(this.heights[index]===value)return;this.heights[index]=value;
    if(this.pending)this.jump(this.pending,cx,false);this.finishLayout(cx);cx.notify();
  }
  link(url,cx){if(/^https?:\/\//i.test(url)||/^mailto:/i.test(url))cx.open_url(url)}
  rich(id,runs,size,theme){
    const lineHeight=Math.ceil(size*1.6);
    const plain=escapeHtml(textOf(runs)).replaceAll("\n","<br>");
    const visible=h_flex().w_full().min_w(0).flex_wrap().gap(0).items_center().text_size(size).line_height(lineHeight+"px")
      .children((runs??[]).map((run,index)=>{
        if(run.break)return div().w_full().h(0);
        return div().id(id+"-run-"+index).flex_none().min_h(lineHeight).flex().items_center().text_color(run.href?theme.markdown.link:run.code?theme.markdown.inlineCodeForeground:theme.markdown.foreground)
          .when(Boolean(run.code),element=>element.mx(2).px(size*.35).rounded(4).bg(theme.markdown.inlineCodeBackground).font_family(this.family).text_size(size*.85))
          .when(Boolean(run.bold),element=>element.font_bold()).when(Boolean(run.italic),element=>element.italic()).when(Boolean(run.strike),element=>element.line_through())
          .when(Boolean(run.href&&/^https?:\/\//i.test(run.href)),element=>element.cursor_pointer().underline().on_click((_event,cx)=>this.link(run.href,cx)))
          .child(run.text??"");
      }));
    return div().id(id).relative().w_full().min_w(0)
      .child(TextView.html(id+"-selection","<div>"+plain+"</div>").selectable(true).scrollable(false).absolute().top(0).left(0).right(0).bottom(0)
        .text_size(size).line_height(lineHeight+"px").text_color("#00000000"))
      .child(visible);
  }
  code(block,id,size,theme){
    const lineHeight=Math.ceil(size*1.55),width=Math.max(80,Math.ceil(block.columns*size*.7));
    const raw=block.lines.map(line=>line.map(token=>token[0]).join("")).join("\n");
    return v_flex().w_full().flex_none().rounded(6).bg(theme.markdown.codeBlockBackground).border_1().border_color(theme.markdown.tableBorder)
      .when(Boolean(block.language&&block.language!=="text"),element=>element.child(div().h(26).px(12).flex().items_center().text_size(11).text_color(theme.markdown.muted).child(block.language)))
      .child(div().id(id+"-code").w_full().min_w(0).p(12)
        .child(v_flex().relative().min_w(width).font_family(this.family).text_size(size).line_height(lineHeight+"px")
          .children(block.lines.map((line,lineIndex)=>h_flex().id(id+"-line-"+lineIndex).h(lineHeight).flex_none().gap(0)
            .children(line.map((token,tokenIndex)=>tokenElement(token,id+"-"+lineIndex+"-"+tokenIndex,theme.dark,theme)))))
          .child(TextView.html(id+"-selection","<pre>"+escapeHtml(raw)+"</pre>").selectable(true).scrollable(false)
            .absolute().top(0).left(0).min_w(width).font_family(this.family).text_size(size).line_height(lineHeight+"px").text_color("#00000000"))));
  }
  table(block,id,size,theme){
    const rows=[block.header,...block.rows];
    const widths=this.tableWidths(block,size);
    const total=widths.reduce((sum,width)=>sum+width,0);
    return div().id(id+"-table").w_full().min_w(0)
      .child(v_flex().w(total).flex_none().border_1().border_color(theme.markdown.tableBorder)
        .children(rows.map((cells,row)=>h_flex().w_full().items_stretch().bg(row===0?theme.markdown.tableHeaderBackground:row%2===0?theme.markdown.tableAltBackground:theme.markdown.tableBodyBackground)
          .children(cells.map((runs,column)=>v_flex().w(widths[column]).min_w(widths[column]).flex_none().px(12).py(8)
            .border_b(1).border_r(1).border_color(theme.markdown.tableBorder)
            .when(block.align[column]==="right",element=>element.text_right()).when(block.align[column]==="center",element=>element.text_center())
            .child(this.rich(id+"-"+row+"-"+column,runs,size,theme)))))));
  }
  blocks(items,id,size,theme){
    return v_flex().w_full().min_w(0).flex_none().gap(16).children((items??[]).map((block,index)=>{
      const key=id+"-"+index;let body;
      if(block.kind==="code")body=this.code(block,key,size,theme);
      else if(block.kind==="heading"){
        const headingSize=size*([0,2,1.5,1.25,1,1,1][block.depth]??1);
        body=div().pt(index?8:0).pb(8).when(block.depth<3,element=>element.border_b(1).border_color(theme.markdown.tableBorder))
          .child(this.rich(key,block.runs,headingSize,theme));
      }else if(block.kind==="rule")body=div().h(1).my(8).bg(theme.markdown.tableBorder);
      else if(block.kind==="quote")body=div().bg(theme.markdown.quoteBackground).border_l(4).border_color(theme.markdown.quoteBorder).pl(14).py(8).child(this.blocks(block.blocks,key,size,theme));
      else if(block.kind==="list")body=v_flex().gap(6).children(block.items.map((item,itemIndex)=>h_flex().gap(8).items_start()
        .child(div().w(28).flex_none().text_right().text_size(size).text_color(theme.markdown.muted).child(item.marker))
        .child(div().flex_1().min_w(0).child(this.blocks(item.blocks,key+"-item-"+itemIndex,size,theme)))));
      else if(block.kind==="table")body=this.table(block,key,size,theme);
      else if(block.kind==="image")body=(block.markdown?TextView.markdown(key,block.markdown):TextView.html(key,block.html??"")).selectable(true).scrollable(false).w_full();
      else body=this.rich(key,block.runs??[],size,theme);
      return div().id(key).w_full().min_w(0).flex_none()
        .when(block.kind!=="code"&&block.kind!=="table"&&block.kind!=="list"&&block.kind!=="quote",element=>element.max_w(852)).child(body);
    }));
  }
  tocView(theme,cx){
    if(!this.showToc||!this.toc.length)return null;
    return v_flex().id("files-markdown-toc").w_full().flex_none().mb(20).p(14).rounded(6).bg(theme.markdown.codeBlockBackground).border_1().border_color(theme.markdown.tableBorder)
      .on_size_change((size,liveCx)=>{const height=Math.ceil(size.height);if(height!==this.tocHeight){this.tocHeight=height;liveCx.notify()}})
      .child(h_flex().items_center().justify_between().pb(8).child(div().text_size(12).font_semibold().text_color(theme.markdown.muted).child("Table of contents"))
        .child(div().id("toc-hide").cursor_pointer().text_size(11).text_color(theme.markdown.muted).on_click((_event,liveCx)=>{this.showToc=false;this.tocHeight=0;liveCx.notify()}).child("Hide")))
      .child(v_flex().gap(2).children(this.toc.map(heading=>div().id("toc-"+heading.slug).min_h(24).pl((heading.level-1)*12).pr(8).py(3).rounded(3).cursor_pointer()
        .text_size(13).text_color(this.selected===heading.slug?theme.markdown.link:theme.markdown.muted)
        .bg(this.selected===heading.slug?theme.source.selection:"#00000000").on_click((_event,liveCx)=>this.jump(heading.slug,liveCx)).child(heading.title))));
  }
  render(cx,options){
    const{theme,family,size}=options;this.family=family;
    this.contentWidth=this.canvasWidth(size);
    this.scrollX=Math.max(0,Math.min(this.maxScrollX(),this.scrollX));
    const ratioX=Math.min(1,this.width/this.contentWidth),trackX=Math.max(1,this.width-12);
    const thumbX=Math.max(24,trackX*ratioX),travelX=Math.max(1,trackX-thumbX);
    const leftX=this.maxScrollX()?this.scrollX/this.maxScrollX()*travelX:0;
    const ratio=this.total?Math.min(1,this.height/this.total):1,thumb=Math.max(24,this.height*ratio),travel=Math.max(1,this.height-thumb);
    const thumbTop=this.maxScroll()?this.scroll/this.maxScroll()*travel:0,toc=this.tocView(theme,cx);
    return v_flex().id("files-markdown-preview").relative().size_full().min_h(0).min_w(0).overflow_hidden().bg(theme.markdown.background).text_color(theme.markdown.foreground)
      .on_size_change((measured,liveCx)=>{if(this.width!==measured.width||this.height!==measured.height){this.width=measured.width;this.height=measured.height;this.move(this.scroll,liveCx,false);liveCx.notify()}})
      .on_mouse_up("left",()=>{this.drag=null}).on_hover(hovered=>{if(!hovered)this.drag=null})
      .on_mouse_move((event,liveCx)=>{if(this.drag){if(this.drag.axis==="x")this.moveX(this.drag.scroll+(event.position.x-this.drag.x)/travelX*this.maxScrollX(),liveCx);else this.move(this.drag.scroll+(event.position.y-this.drag.y)/travel*this.maxScroll(),liveCx)}})
      .on_scroll_wheel((event,liveCx)=>{if(event.delta.y)this.move(this.scroll-event.delta.y,liveCx);if(event.delta.x)this.moveX(this.scrollX-event.delta.x,liveCx);liveCx.stop_propagation()})
      .child(div().absolute().left(Math.max(0,(this.width-this.contentWidth)/2)-this.scrollX).w(this.contentWidth).top(-this.scroll)
        .child(v_flex().id("markdown-content").w_full().px(24).py(24).bg(theme.markdown.background)
          .on_size_change((measured,liveCx)=>{const height=Math.ceil(measured.height);this.layoutMeasured=true;if(height!==this.total){this.total=height;if(!this.layoutPending)this.move(this.scroll,liveCx,false);liveCx.notify()}this.finishLayout(liveCx)})
          .when(this.loading,element=>element.child(div().pb(10).text_size(11).text_color(theme.markdown.muted).child("Loading preview…")))
          .when(Boolean(this.error),element=>element.child(div().pb(10).text_size(11).text_color(theme.markdown.muted).child(this.error)))
          .when(Boolean(this.doc.previewTruncated||this.doc.sourceTruncated),element=>element.child(div().pb(10).text_size(11).text_color(theme.markdown.muted).child("Preview limited · full text remains in Source")))
          .when(Boolean(toc),element=>element.child(toc))
          .children(this.doc.blocks.map((block,index)=>div().id("markdown-measure-"+index).w_full().flex_none()
            .on_size_change((measured,liveCx)=>this.measure(index,measured.height,liveCx)).child(this.blocks([block],"block-"+index,size,theme))))))
      .when(ratioX<1,element=>element.child(div().id("markdown-scroll-x").absolute().left(0).right(12).bottom(2).h(10).rounded(5).bg(theme.markdown.codeBlockBackground)
        .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();if(event.local_position)this.moveX((event.local_position.x-thumbX/2)/travelX*this.maxScrollX(),liveCx)})
        .child(div().absolute().left(leftX).top(2).h(6).w(thumbX).rounded(3).bg(theme.markdown.muted)
          .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();this.drag={axis:"x",x:event.position.x,scroll:this.scrollX}}))))
      .when(ratio<1,element=>element.child(div().id("markdown-scroll").absolute().right(2).top(0).bottom(ratioX<1?12:0).w(10).rounded(5).bg(theme.markdown.codeBlockBackground)
        .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();if(event.local_position)this.move((event.local_position.y-thumb/2)/travel*this.maxScroll(),liveCx)})
        .child(div().absolute().top(thumbTop).left(2).w(6).h(thumb).rounded(3).bg(theme.markdown.muted)
          .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();this.drag={y:event.position.y,scroll:this.scroll}}))));
  }
}
