// Reads the school's exam-schedule PDF ("לוח מבחנים") and turns it into a list of dated entries.
// The sheet is a calendar table: one or more blocks of [date | day letter | גוש א/ב | מב"ר | חנ"מ], every cell right-aligned.
// readPdf() needs the network (pdf.js comes from a CDN, only when a file is picked); parseSheet() and classify() are pure.
import { SUBJ } from "./school.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/";
const pad = n => String(n).padStart(2,"0");
const DATE_RE = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/;

/** file: File/Blob -> [{s, x, y, w}] text pieces of page 1..n with their position (PDF units, y grows upward). */
export async function readPdf(file){
  const pdfjs = await import(PDFJS + "pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for(let p=1; p<=doc.numPages; p++){
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for(const i of tc.items) if(i.str && i.str.trim()) out.push({ s:i.str.trim(), x:i.transform[4], y:i.transform[5] - (p-1)*10000, w:i.width });
  }
  return out;
}

function joinCell(items){
  const it = [...items].sort((a,b)=>b.x-a.x); // right to left = reading order
  let t = "";
  it.forEach((c,i)=>{ if(i){ const prev = it[i-1]; if(prev.x - (c.x+c.w) > 1.5) t += " "; } t += c.s; });
  return t.replace(/([א-ת])(\d)/g,"$1 $2").replace(/(\d)([א-ת])/g,"$1 $2")
    .replace(/\s*,\s*'?\s*/g,", ").replace(/\s*-\s*/g," - ").replace(/\s*\(\s*/g," (").replace(/\s+\)/g,")").replace(/'(?=[א-ת])/g,"' ").replace(/\s+/g," ").trim();
}
function splitAlts(t){ // "A / B" are alternatives for different groups; keep slashes that sit inside parentheses
  const out = []; let depth = 0, cur = "";
  for(const ch of t){ if(ch==="(") depth++; if(ch===")") depth = Math.max(0, depth-1);
    if(ch==="/" && !depth){ out.push(cur); cur = ""; } else cur += ch; }
  out.push(cur);
  return out.map(s=>s.replace(/\/\s*\)/g,")").replace(/^\s*-\s*|\s*-\s*$/g,"").trim()).filter(Boolean);
}

/** items -> { columns:[label], entries:[{date:'YYYY-MM-DD', col:index, raw}] } */
export function parseSheet(items, now = new Date()){
  const dates = items.map(i=>({ ...i, m: i.s.match(DATE_RE) })).filter(i=>i.m && +i.m[1]>=1 && +i.m[1]<=31 && +i.m[2]>=1 && +i.m[2]<=12);
  if(dates.length < 10) return { columns:[], entries:[] };
  // blocks: date cells that share the same x
  const blocks = [];
  for(const d of [...dates].sort((a,b)=>a.x-b.x)){ const b = blocks.find(b=>Math.abs(b.x-d.x) < 25); if(b) b.rows.push(d); else blocks.push({ x:d.x, rows:[d] }); }
  blocks.sort((a,b)=>a.x-b.x); // left to right
  // school year: an explicit year on any date fixes it, else the school year we are in
  const withY = dates.find(d=>d.m[3]);
  let fall = now.getMonth()>=6 ? now.getFullYear() : now.getFullYear()-1;
  if(withY){ let y = +withY.m[3]; if(y<100) y += 2000; fall = +withY.m[2]>=8 ? y : y-1; }
  const iso = m => { const mo = +m[2]; let y = m[3] ? +m[3] : (mo>=8 ? fall : fall+1); if(y<100) y += 2000; return `${y}-${pad(mo)}-${pad(+m[1])}`; };
  // column headers (right edge of each), per block
  const heads = [["מב",'מב"ר'],["חנ",'חנ"מ']].flatMap(([k,label])=>items.filter(i=>i.s===k).map(i=>({ label, r:i.x+i.w, y:i.y })));
  const entries = []; let columns = ["גוש א / גוש ב"];
  blocks.forEach((b, bi)=>{
    const left = bi ? blocks[bi-1].x + 12 : -Infinity;           // everything left of the previous block's dates belongs to it
    const mine = h => h.r < b.x && h.r > left;
    const edges = [{ label:"גוש א / גוש ב", r:b.x - 8 }, ...heads.filter(mine).sort((a,c)=>c.r-a.r)];
    edges.slice(1).forEach(e=>{ if(!columns.includes(e.label)) columns.push(e.label); });
    const cells = new Map(); // "rowIndex|label" -> items
    for(const it of items){
      if(it.x + it.w >= b.x - 2 || it.x <= left) continue;        // not in this block's cell area
      if(DATE_RE.test(it.s)) continue;
      let row = -1, best = 5; b.rows.forEach((r,ri)=>{ const dy = Math.abs(r.y-it.y); if(dy < best){ best = dy; row = ri; } });
      if(row<0) continue;
      if(/^[א-ו]$/.test(it.s) && b.x - (it.x+it.w) < 16) continue; // the day letter next to the date
      const right = it.x + it.w;
      const e = edges.filter(e=>e.r >= right - 3).sort((a,c)=>a.r-c.r)[0] || edges[0];
      const k = row+"|"+e.label; if(!cells.has(k)) cells.set(k, []); cells.get(k).push(it);
    }
    for(const [k, its] of cells){ const [ri, label] = k.split("|"); const date = iso(b.rows[+ri].m);
      for(const raw of splitAlts(joinCell(its))) entries.push({ date, col: columns.indexOf(label), raw }); }
  });
  entries.sort((a,b)=>a.date.localeCompare(b.date) || a.col-b.col);
  return { columns, entries };
}

const SUBJ_RE = Object.entries(SUBJ).flatMap(([key,s])=>s.aliases.map(a=>[a,key])).sort((a,b)=>b[0].length-a[0].length);
const NOT_EXAM = /סיור|הרצא|סדנ|יום ה|יום בחירות|כנס|ערב הורים|שבוע |צו |חג |צום|חנוכה|מועדי|ראש השנה|ימי גשר|העשרה|מנהיגות|חופש/;
export const normKey = s => s.replace(/["'׳״.,()\-\s]/g,"");

/** raw cell text -> { kind:'exam'|'other', subtype, subject, title, mine } ; `mine` = looks like it belongs to this student */
export function classify(raw, { gush = "ב", clusters = {} } = {}){
  const subject = (SUBJ_RE.find(([a])=>raw.includes(a)) || [])[1] || null;
  const cluster = (raw.match(/אשכול ([א-ד])/) || [])[1] || null;
  let subtype = /בגרות|מתכונת/.test(raw) ? "bagrut" : /בוחן/.test(raw) ? "quiz" : /הגשת|הגשה|פרוייקט|פרויקט|בוק ריפורט|פוסט רידינג|עבודה/.test(raw) ? "project" : /מבחן|מסכם/.test(raw) ? "test" : null;
  const bare = !subtype;
  if(bare && !NOT_EXAM.test(raw) && (subject || cluster)) subtype = "test";
  if(!subtype) return { kind:"other", subtype:null, subject, title: raw, mine:false };
  const otherGush = new RegExp(`גוש [א-ד]`).test(raw) && !raw.includes("גוש "+gush);
  let title = raw;
  if(cluster && bare) title = `מבחן אשכול ${cluster}${clusters[cluster] ? ` (${clusters[cluster]})` : ""}`;
  else if(bare) title = "מבחן ב" + raw;
  return { kind:"exam", subtype, subject, title, mine: !otherGush && !!(subject || cluster) };
}
