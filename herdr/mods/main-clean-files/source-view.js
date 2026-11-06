import {div} from "gpui-kit";
import {v_flex,h_flex} from "gpui-base";
import {columns,offsetAtColumn,columnAtOffset,wordRange} from "./source-model.js";
import {captureLineScroll,restoreLineScroll} from "./scroll-state.js";

const GUTTER=58;


export class SourceView{
  constructor(_cx,activate=()=>{}){
    this.activate=activate;
    this.text="";this.lines=[""];this.starts=[0];this.anchor=0;this.cursor=0;
    this.scrollX=0;this.scrollY=0;this.width=0;this.height=0;this.activeLine=0;
  }
  setDocument(document,text,identity,revision=null){
    const sameIdentity=this.documentIdentity===identity;
    const lineHeight=this.lineHeight??Math.ceil((this.size??14)*1.55);
    const scrollAnchor=sameIdentity?captureLineScroll(this.lines,this.scrollY,lineHeight):null;
    if(!sameIdentity){this.anchor=this.cursor=0;this.scrollX=this.scrollY=0;this.activeLine=0}
    this.documentIdentity=identity;this.documentRevision=revision;this.document=document;this.text=text;
    this.lines=text.split("\n");this.starts=[];this.maxColumns=0;let offset=0;
    for(let index=0;index<this.lines.length;index++){this.starts.push(offset);offset+=this.lines[index].length+(index+1<this.lines.length?1:0);this.maxColumns=Math.max(this.maxColumns,columns(this.lines[index]))}
    if(sameIdentity)this.scrollY=restoreLineScroll(scrollAnchor,this.lines,lineHeight);
    this.anchor=Math.max(0,Math.min(this.text.length,this.anchor));
    this.cursor=Math.max(0,Math.min(this.text.length,this.cursor));
    this.activeLine=Math.max(0,Math.min(this.lines.length-1,this.activeLine));
  }
  range(){return[Math.min(this.anchor,this.cursor),Math.max(this.anchor,this.cursor)]}
  selectedText(){const[start,end]=this.range();return this.text.slice(start,end)}
  maxY(lineHeight){return Math.max(0,this.lines.length*lineHeight-this.height)}
  maxX(charWidth){return Math.max(0,(this.maxColumns??0)*charWidth+GUTTER+24-this.width)}
  clamp(lineHeight,charWidth){
    this.scrollY=Math.max(0,Math.min(this.maxY(lineHeight),this.scrollY));
    this.scrollX=Math.max(0,Math.min(this.maxX(charWidth),this.scrollX));
  }
  point(event,lineHeight,charWidth){
    const local=event.local_position??{x:0,y:0};
    const line=Math.max(0,Math.min(this.lines.length-1,Math.floor((local.y+this.scrollY)/lineHeight)));
    const target=Math.max(0,(local.x+this.scrollX-GUTTER-8)/charWidth);
    return{line,offset:this.starts[line]+offsetAtColumn(this.lines[line],target)};
  }
  mouseDown(event,cx,lineHeight,charWidth){
    const point=this.point(event,lineHeight,charWidth);this.activate();this.activeLine=point.line;
    if(event.click_count>=3){
      this.anchor=this.starts[point.line];
      this.cursor=this.anchor+this.lines[point.line].length+(point.line+1<this.lines.length?1:0);
      this.dragging=false;
    }else if(event.click_count===2){
      const[start,end]=wordRange(this.text,point.offset);this.anchor=start;this.cursor=end;this.dragging=false;
    }else{
      if(!event.modifiers?.shift)this.anchor=point.offset;
      this.cursor=point.offset;this.dragging=true;
    }
    cx.stop_propagation();cx.notify();
  }
  mouseMove(event,cx,lineHeight,charWidth){
    if(this.scrollDrag){
      const current=this.scrollDrag.axis==="y"?event.position.y:event.position.x;
      const next=this.scrollDrag.scroll+(current-this.scrollDrag.origin)/this.scrollDrag.travel*this.scrollDrag.max;
      if(this.scrollDrag.axis==="y")this.scrollY=next;else this.scrollX=next;
      this.clamp(lineHeight,charWidth);cx.notify();return;
    }
    if(!this.dragging)return;
    const point=this.point(event,lineHeight,charWidth);
    if(point.offset!==this.cursor){this.cursor=point.offset;this.activeLine=point.line;cx.notify()}
  }
  keyDown(event,cx){
    if(event.keystroke==="cmd-c"||event.keystroke==="ctrl-c"){
      const text=this.selectedText();if(text)cx.write_to_clipboard(text);cx.stop_propagation();
    }else if(event.keystroke==="cmd-a"||event.keystroke==="ctrl-a"){
      this.anchor=0;this.cursor=this.text.length;cx.stop_propagation();cx.notify();
    }else if(event.keystroke==="escape"){
      // Let the owning Files panel handle Escape and return to its tree.
      this.anchor=this.cursor=0;this.dragging=false;cx.notify();
    }
  }
  token(token,index,theme){
    const[text,light,dark]=token,style=theme.dark?dark:light;
    return div().id("source-token-"+index).flex_none().text_color(style.color??theme.source.foreground)
      .when(Boolean(style.background),element=>element.bg(style.background))
      .when(Boolean(style.bold),element=>element.font_bold())
      .when(Boolean(style.italic),element=>element.italic())
      .when(Boolean(style.underline),element=>element.underline())
      .child(text||" ");
  }
  row(index,top,lineHeight,charWidth,theme){
    const raw=this.lines[index]??"",tokens=this.document?.source?.lines?.[index]??[[raw,{color:theme.source.foreground},{color:theme.source.foreground}]];
    const[start,end]=this.range(),lineStart=this.starts[index],lineEnd=lineStart+raw.length;
    const selectedStart=Math.max(start,lineStart),selectedEnd=Math.min(end,lineEnd);
    const from=columnAtOffset(raw,Math.max(0,selectedStart-lineStart));
    const to=columnAtOffset(raw,Math.max(0,selectedEnd-lineStart));
    const selected=selectedStart<selectedEnd||(start<lineStart&&end>lineEnd);
    return h_flex().id("source-line-"+index).absolute().top(top).left(0).right(0).h(lineHeight).items_center()
      .child(div().w(GUTTER).h_full().flex_none().pr(12).flex().items_center().justify_end()
        .bg(theme.source.gutterBackground).text_color(index===this.activeLine?theme.source.activeLineNumber:theme.source.lineNumber).child(String(index+1)))
      .child(div().absolute().left(GUTTER+8-this.scrollX).h_full().flex().items_center().font_family(this.family).text_size(this.size)
        .when(selected,element=>element.child(div().absolute().left(from*charWidth).top(0).h_full().w(Math.max(charWidth,(to-from)*charWidth)).bg(theme.source.selection)))
        .child(h_flex().flex_none().gap(0).children(tokens.map((token,tokenIndex)=>this.token(token,index+"-"+tokenIndex,theme)))));
  }
  render(cx,options){
    const{theme,family,size}=options;this.family=family;this.size=size;
    const lineHeight=Math.ceil(size*1.55),charWidth=size*.7;
    this.lineHeight=lineHeight;
    this.clamp(lineHeight,charWidth);
    const start=Math.max(0,Math.floor(this.scrollY/lineHeight)-2);
    const end=Math.min(this.lines.length,Math.ceil((this.scrollY+this.height)/lineHeight)+2);
    const ratioY=this.lines.length*lineHeight?Math.min(1,this.height/(this.lines.length*lineHeight)):1;
    const thumbY=Math.max(24,this.height*ratioY),travelY=Math.max(1,this.height-thumbY);
    const topY=this.maxY(lineHeight)?this.scrollY/this.maxY(lineHeight)*travelY:0;
    const contentWidth=(this.maxColumns??0)*charWidth+GUTTER+24;
    const ratioX=contentWidth?Math.min(1,this.width/contentWidth):1;
    const thumbX=Math.max(24,this.width*ratioX),travelX=Math.max(1,this.width-thumbX);
    const leftX=this.maxX(charWidth)?this.scrollX/this.maxX(charWidth)*travelX:0;
    return v_flex().id("files-source-view").relative().size_full().min_h(0).min_w(0).overflow_hidden().cursor_text()
      .bg(theme.source.background).text_color(theme.source.foreground)
      .on_size_change((measured,liveCx)=>{if(measured.width!==this.width||measured.height!==this.height){this.width=measured.width;this.height=measured.height;this.clamp(lineHeight,charWidth);liveCx.notify()}})
      .on_mouse_down("left",(event,liveCx)=>this.mouseDown(event,liveCx,lineHeight,charWidth))
      .on_mouse_move((event,liveCx)=>this.mouseMove(event,liveCx,lineHeight,charWidth))
      .on_mouse_up("left",()=>{this.dragging=false;this.scrollDrag=null})
      .on_hover(hovered=>{if(!hovered){this.dragging=false;this.scrollDrag=null}})
      .on_scroll_wheel((event,liveCx)=>{
        this.scrollY-=event.delta.y;this.scrollX-=event.delta.x;
        this.clamp(lineHeight,charWidth);liveCx.stop_propagation();liveCx.notify();
      })
      .children(Array.from({length:end-start},(_,offset)=>this.row(start+offset,(start+offset)*lineHeight-this.scrollY,lineHeight,charWidth,theme)))
      .when(ratioY<1,element=>element.child(div().id("source-scroll-y").absolute().right(2).top(0).bottom(ratioX<1?10:0).w(10).rounded(5).bg(theme.markdown.codeBlockBackground)
        .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();if(event.local_position){this.scrollY=(event.local_position.y-thumbY/2)/travelY*this.maxY(lineHeight);this.clamp(lineHeight,charWidth);liveCx.notify()}})
        .child(div().absolute().top(topY).left(2).w(6).h(thumbY).rounded(3).bg(theme.source.lineNumber)
          .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();this.scrollDrag={axis:"y",origin:event.position.y,scroll:this.scrollY,travel:travelY,max:this.maxY(lineHeight)}}))))
      .when(ratioX<1,element=>element.child(div().id("source-scroll-x").absolute().left(GUTTER).right(12).bottom(2).h(10).rounded(5).bg(theme.markdown.codeBlockBackground)
        .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();if(event.local_position){this.scrollX=(event.local_position.x-thumbX/2)/travelX*this.maxX(charWidth);this.clamp(lineHeight,charWidth);liveCx.notify()}})
        .child(div().absolute().left(leftX).top(2).h(6).w(thumbX).rounded(3).bg(theme.source.lineNumber)
          .on_mouse_down("left",(event,liveCx)=>{liveCx.stop_propagation();this.scrollDrag={axis:"x",origin:event.position.x,scroll:this.scrollX,travel:travelX,max:this.maxX(charWidth)}}))));
  }
}
