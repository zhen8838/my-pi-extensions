function finite(value,fallback=0){return Number.isFinite(value)?value:fallback}

export function captureLineScroll(lines,scrollY,lineHeight){
  const height=Math.max(1,finite(lineHeight,1)),items=Array.isArray(lines)&&lines.length?lines:[""];
  const index=Math.max(0,Math.min(items.length-1,Math.floor(Math.max(0,finite(scrollY))/height)));
  return{
    index,
    offset:Math.max(0,finite(scrollY)-index*height),
    text:items[index]??"",
    before:index>0?items[index-1]:null,
    after:index+1<items.length?items[index+1]:null,
  };
}

export function restoreLineScroll(anchor,lines,lineHeight){
  if(!anchor)return 0;
  const height=Math.max(1,finite(lineHeight,1)),items=Array.isArray(lines)&&lines.length?lines:[""];
  let best=-1,bestScore=-Infinity;
  for(let index=0;index<items.length;index++){
    if(items[index]!==anchor.text)continue;
    let score=-Math.abs(index-anchor.index);
    if(anchor.before!==null&&items[index-1]===anchor.before)score+=100000;
    if(anchor.after!==null&&items[index+1]===anchor.after)score+=100000;
    if(score>bestScore){best=index;bestScore=score}
  }
  const index=best<0?Math.max(0,Math.min(items.length-1,anchor.index)):best;
  return index*height+Math.max(0,Math.min(height-1,finite(anchor.offset)));
}

function runsText(runs){return(runs??[]).map(run=>run?.break?"\n":run?.text??"").join("")}
function blockText(block,depth=0){
  if(!block||depth>5)return"";
  const parts=[];
  if(block.runs)parts.push(runsText(block.runs));
  if(block.lines)parts.push(block.lines.map(line=>(line??[]).map(token=>token?.[0]??"").join("")).join("\n"));
  if(block.header)parts.push(block.header.map(runsText).join("|"));
  if(block.rows)parts.push(block.rows.map(row=>row.map(runsText).join("|")).join("\n"));
  if(block.blocks)parts.push(block.blocks.map(item=>blockText(item,depth+1)).join("\n"));
  if(block.items)parts.push(block.items.map(item=>(item?.marker??"")+":"+(item?.blocks??[]).map(child=>blockText(child,depth+1)).join("\n")).join("\n"));
  if(block.markdown)parts.push(block.markdown);
  if(block.html)parts.push(block.html);
  return parts.join("\n").slice(0,1024);
}

export function blockSignature(block){
  return`${block?.kind??"unknown"}|${block?.depth??""}|${block?.language??""}|${blockText(block)}`;
}

export function captureBlockScroll(blocks,heights,scroll,topOffset){
  const items=Array.isArray(blocks)?blocks:[],top=Math.max(0,finite(topOffset)),position=Math.max(0,finite(scroll));
  if(!items.length||position<top)return{index:0,offset:position-top,signature:items.length?blockSignature(items[0]):null};
  let cursor=top;
  for(let index=0;index<items.length;index++){
    const height=Math.max(0,finite(heights?.[index]));
    if(index===items.length-1||position<cursor+height)return{index,offset:position-cursor,signature:blockSignature(items[index])};
    cursor+=height;
  }
  return{index:items.length-1,offset:0,signature:blockSignature(items.at(-1))};
}

export function restoreBlockScroll(anchor,blocks,heights,topOffset){
  if(!anchor)return 0;
  const items=Array.isArray(blocks)?blocks:[];
  if(!items.length)return Math.max(0,finite(topOffset)+finite(anchor.offset));
  let index=-1,bestDistance=Infinity;
  if(anchor.signature!==null)for(let candidate=0;candidate<items.length;candidate++){
    if(blockSignature(items[candidate])!==anchor.signature)continue;
    const distance=Math.abs(candidate-anchor.index);
    if(distance<bestDistance){index=candidate;bestDistance=distance}
  }
  if(index<0)index=Math.max(0,Math.min(items.length-1,anchor.index));
  let position=Math.max(0,finite(topOffset));
  for(let current=0;current<index;current++)position+=Math.max(0,finite(heights?.[current]));
  const height=Math.max(0,finite(heights?.[index]));
  const offset=height?Math.max(0,Math.min(height-1,finite(anchor.offset))):Math.max(0,finite(anchor.offset));
  return Math.max(0,position+offset);
}
