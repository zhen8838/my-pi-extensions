import assert from "node:assert/strict";
import {captureLineScroll,restoreLineScroll,captureBlockScroll,restoreBlockScroll} from "../scroll-state.js";

{
  const before=["first","keep this line","after"];
  const anchor=captureLineScroll(before,25+7,25);
  const after=["inserted one","inserted two",...before];
  assert.equal(restoreLineScroll(anchor,after,25),3*25+7);
  assert.equal(restoreLineScroll(anchor,["first","replacement"],25),25+7);
}

{
  const paragraph=text=>({kind:"paragraph",runs:[{text}]});
  const before=[paragraph("first"),paragraph("keep this block"),paragraph("after")];
  const anchor=captureBlockScroll(before,[80,120,90],24+80+17,24);
  const after=[paragraph("inserted"),...before];
  assert.equal(restoreBlockScroll(anchor,after,[60,80,120,90],24),24+60+80+17);
  assert.equal(restoreBlockScroll(anchor,[paragraph("first"),paragraph("replacement")],[80,50],24),24+80+17);
}

console.log("PASS: logical line and Markdown block anchors survive insertions and have bounded fallbacks");
