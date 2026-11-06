export function wide(character){return character.codePointAt(0)>255?2:1}
export function columns(text){let column=0;for(const character of text)column+=character==="\t"?4-column%4:wide(character);return column}
export function offsetAtColumn(text,wanted){let column=0,offset=0;for(const character of text){const width=character==="\t"?4-column%4:wide(character);if(wanted<column+width/2)return offset;column+=width;offset+=character.length}return text.length}
export function columnAtOffset(text,wanted){let column=0,offset=0;for(const character of text){if(offset>=wanted)break;column+=character==="\t"?4-column%4:wide(character);offset+=character.length}return column}
export function wordRange(text,offset){const word=character=>/[\p{L}\p{N}_$./:-]/u.test(character||"");let start=offset,end=offset;while(start>0&&word(text[start-1]))start--;while(end<text.length&&word(text[end]))end++;if(start===end&&end<text.length)end++;return[start,end]}
