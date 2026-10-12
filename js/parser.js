// Hebrew natural-language event parser.
// parse("מבחן בהיסטוריה ביום חמישי הבא, תזכיר 4 ימים לפני", now) ->
//   { title, kind, subtype, subject, date, start, end, allDay, recurrence, remindDays, remindMinutes,
//     prep:{count, minutes, windowDays}, tokens:[{s,e,type}], warnings:[], ambiguousHour }
import { SUBJ, lessonBlocks, schoolEnd, nextLesson, subjectBlocks } from "./school.js";

const HEB = "\\u05D0-\\u05EA";
const L = `(?<![${HEB}A-Za-z0-9])`;
const R = `(?![${HEB}A-Za-z0-9])`;
const SEP = "[-\\s]?"; // optional maqaf/space after a prefix letter

export const DAY_NAMES = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const DAY_LETTERS = { "א":0,"ב":1,"ג":2,"ד":3,"ה":4,"ו":5 };
const RRULE_DAYS = ["SU","MO","TU","WE","TH","FR","SA"];
const MONTHS = [
  ["ינואר"],["פברואר"],["מרץ","מרס"],["אפריל"],["מאי"],["יוני"],
  ["יולי"],["אוגוסט"],["ספטמבר"],["אוקטובר"],["נובמבר"],["דצמבר"]];
const NUMW = { "אחד":1,"אחת":1,"שניים":2,"שנים":2,"שתיים":2,"שתים":2,"שני":2,"שתי":2,
  "שלושה":3,"שלוש":3,"ארבעה":4,"ארבע":4,"חמישה":5,"חמש":5,"שישה":6,"שש":6,
  "שבעה":7,"שבע":7,"שמונה":8,"תשעה":9,"תשע":9,"עשרה":10,"עשר":10,
  "אחת עשרה":11,"אחד עשר":11,"שתים עשרה":12,"שתיים עשרה":12,"שנים עשר":12 };
const NUMW_RE = Object.keys(NUMW).sort((a,b)=>b.length-a.length).join("|");
const NUM = `(\\d{1,2}|${NUMW_RE})`;
const ORD = { "ראשון":1,"שני":2,"שלישי":3,"רביעי":4,"חמישי":5,"שישי":6,"שביעי":7,"שמיני":8,"תשיעי":9 };
const num = s => /^\d+$/.test(s) ? Number(s) : (NUMW[s] ?? null);

// Deadline-type words -> subtype. Order matters (first match wins).
export const SUBTYPES = [
  { key:"bagrut",   re:"בגרות|מתכונת|מתכונות",                     label:"בגרות",   sessions:5, minutes:90, window:12 },
  { key:"test",     re:"מבחן|מבחנים|טסט",                           label:"מבחן",    sessions:3, minutes:75, window:6 },
  { key:"quiz",     re:"בוחן|בחנים|בוחנים",                          label:"בוחן",    sessions:1, minutes:45, window:2 },
  { key:"homework", re:"שיעורי בית|ש\"ב|תרגיל|תרגילים|דף עבודה|דפי עבודה|מטלה|שאלות|סיכום|קריאה", label:"שיעורי בית", sessions:1, minutes:45, window:2 },
  { key:"project",  re:"עבודת חקר|עבודה|עבודת|פרויקט|פרוייקט|מצגת|דו\"ח|דוח|עבודות", label:"עבודה", sessions:3, minutes:90, window:8 },
  { key:"submit",   re:"הגשה|להגיש|הגשת",                           label:"הגשה",    sessions:2, minutes:60, window:4 },
];

const pad = n => String(n).padStart(2,"0");
export const toMin = s => { const [h,m] = s.split(":").map(Number); return h*60+m; };
export const fromMin = m => `${pad(Math.floor(m/60)%24)}:${pad(m%60)}`;
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);

// Length-preserving normalisation so token offsets stay valid for highlighting.
function normalize(t){
  return t.replace(/[״”“]/g,'"').replace(/[׳’‘`]/g,"'").replace(/[־–—]/g,"-");
}

class Scan {
  constructor(text){ this.t = text; this.used = new Array(text.length).fill(false); this.tokens = []; }
  free(s,e){ for(let i=s;i<e;i++) if(this.used[i]) return false; return true; }
  take(s,e,type,keep=false){
    // trim whitespace / punctuation at the edges of the span
    while(s<e && /[\s,.]/.test(this.t[s])) s++;
    while(e>s && /[\s,]/.test(this.t[e-1])) e--;
    if(!keep) for(let i=s;i<e;i++) this.used[i]=true;
    this.tokens.push({ s, e, type, keep });
  }
  each(src, flags, fn){
    const re = new RegExp(src, "g"+(flags||""));
    let m;
    while((m = re.exec(this.t))){
      if(m[0].length===0){ re.lastIndex++; continue; }
      const s = m.index, e = s+m[0].length;
      if(!this.free(s,e)) continue;
      const r = fn(m, s, e);
      if(r && r.type) this.take(r.s ?? s, r.e ?? e, r.type, r.keep);
    }
  }
}

export function parse(input, now = new Date(), opts = {}){
  const text = normalize(input || "");
  const S = new Scan(text);
  const out = { title:"", kind:"event", subtype:null, subject:null, date:null, start:null, end:null, allDay:false,
    recurrence:null, remindDays:null, remindMinutes:null, noRemind:false, prep:null, tokens:S.tokens, warnings:[],
    ambiguousHour:false, dateSource:null, timeSource:null };
  const today = midnight(now);

  // ---- kind (keep words in the title) ----
  for(const st of SUBTYPES){
    let hit=false;
    S.each(`${L}(?:ו?(?:ה|ל|ב|של)?${SEP})?(${st.re})${R}`, "", (m,s,e)=>{ if(hit) return null; hit=true; return {type:"kind", keep:true}; });
    if(hit){ out.subtype = st; out.kind = "deadline"; break; }
  }
  // "הגשה" + "עבודה" -> project
  if(out.subtype?.key==="submit" && /עבודה|פרויקט|מצגת/.test(text)) out.subtype = SUBTYPES.find(x=>x.key==="project");

  // ---- subject (keep) ----
  outer: for(const [key, s] of Object.entries(SUBJ)){
    for(const a of [...s.aliases].sort((x,y)=>y.length-x.length)){
      const esc = a.replace(/["']/g, m=>m);
      let hit=false;
      S.each(`${L}(?:ו?(?:ב|ל|ה|של)?${SEP})?(${esc})${R}`, "", ()=>{ if(hit) return null; hit=true; return {type:"subject", keep:true}; });
      if(hit){ out.subject = key; break outer; }
    }
  }

  // ---- recurrence ----
  let recurDow = null;
  S.each(`${L}כל\\s+(?:יום\\s+)?(${DAY_NAMES.join("|")})${R}`, "", m=>{ recurDow = DAY_NAMES.indexOf(m[1]); out.recurrence = "weekly"; return {type:"recur"}; });
  if(!out.recurrence) S.each(`${L}כל\\s+(יום|ערב|בוקר|שבוע)${R}`, "", m=>{ out.recurrence = m[1]==="שבוע"?"weekly":"daily";
    if(m[1]==="ערב") out._period="ערב"; if(m[1]==="בוקר") out._period="בוקר"; return {type:"recur"}; });

  // ---- reminders ----
  const UNIT = "יום|יומיים|ימים|שבוע|שבועיים|שבועות|שעה|שעתיים|שעות|דקות|דק'";
  const unitVal = (n,u) => {
    if(u==="יומיים") return {days:2}; if(u==="שבועיים") return {days:14}; if(u==="שעתיים") return {min:120};
    const k = n ?? 1;
    if(/^יום|ימים/.test(u)) return {days:k}; if(/^שבוע/.test(u)) return {days:7*k};
    if(/^שע/.test(u)) return {min:60*k}; return {min:k};
  };
  const setRem = v => { if(v.days!=null) out.remindDays = v.days; else out.remindMinutes = v.min; };
  S.each(`${L}(?:ו?ש?)?(?:תזכיר|תזכירי|להזכיר|תזכורת|הזכר)(?:\\s+לי)?(?:\\s+(?:על\\s+זה|את\\s+זה))?\\s+(?:${NUM}\\s*)?(${UNIT})\\s+(?:לפני|מראש|קודם)${R}`, "", m=>{ setRem(unitVal(m[1]?num(m[1]):null, m[2])); return {type:"remind"}; });
  S.each(`${L}${NUM}?\\s*(${UNIT})\\s+(?:לפני|מראש)${R}`, "", m=>{ setRem(unitVal(m[1]?num(m[1]):null, m[2])); return {type:"remind"}; });
  S.each(`${L}(?:בלי|ללא|אין\\s+צורך\\s+ב)\\s*(?:תזכורת|תזכורות)${R}`, "", ()=>{ out.noRemind = true; return {type:"remind"}; });
  // leftover "תזכיר לי" with no amount — just a filler
  S.each(`${L}(?:ו?ש?)?(?:תזכיר|תזכירי)\\s+לי${R}`, "", ()=>({type:"filler"}));

  // ---- prep directives ----
  let prepCount=null, prepMinutes=null, noPrep=false;
  S.each(`${L}(?:בלי|ללא|לא\\s+צריך|אין\\s+צורך\\s+ב?)\\s*(?:זמן\\s+|זמני\\s+)?(?:הכנה|להתכונן|ללמוד|לשבץ)${R}`, "", ()=>{ noPrep=true; return {type:"prep"}; });
  S.each(`${L}${NUM}\\s+(?:פעמים|מפגשים|זמני\\s+הכנה|זמני\\s+למידה|סשנים)${R}`, "", m=>{ prepCount = num(m[1]); return {type:"prep"}; });
  S.each(`${L}(?:הכנה|למידה|ללמוד)\\s+(?:של\\s+)?(שעה\\s+וחצי|חצי\\s+שעה|שעתיים|שעה|(\\d{2,3})\\s*דקות)${R}`, "", m=>{
    prepMinutes = m[1]==="שעה וחצי"||/שעה\s+וחצי/.test(m[1])?90 : /חצי/.test(m[1])?30 : m[1]==="שעתיים"?120 : m[1]==="שעה"?60 : Number(m[2]);
    return {type:"prep"}; });

  // ---- duration ----
  let durMin = null;
  S.each(`${L}(?:ל|למשך\\s*)(שעה\\s+וחצי|חצי\\s+שעה|שעתיים|שעה|(\\d{1,3})\\s*(דקות|דק'|שעות))${R}`, "", m=>{
    const v = m[1];
    durMin = /שעה\s+וחצי/.test(v)?90 : /חצי/.test(v)?30 : v==="שעתיים"?120 : v==="שעה"?60 : (m[3]==="שעות"?Number(m[2])*60:Number(m[2]));
    return {type:"time"}; });

  // ---- school lesson references ----
  let lessonRef = null; // {period} or {next:true}
  S.each(`${L}(?:ב|ל|עד\\s*)?${SEP}שיעור\\s+(?:מספר\\s+)?(\\d)${R}`, "", m=>{ const p=Number(m[1]); if(p<1||p>9) return null; lessonRef={period:p}; return {type:"time"}; });
  S.each(`${L}(?:ב|ל|עד\\s*)?${SEP}שיעור\\s+ה?(${Object.keys(ORD).join("|")})${R}`, "", m=>{ lessonRef={period:ORD[m[1]]}; return {type:"time"}; });
  S.each(`${L}(?:ב|ל|עד\\s*)?${SEP}שיעור\\s+(?:ה)?(?:הבא|הקרוב)${R}`, "", ()=>{ lessonRef={next:true}; return {type:"date"}; });

  // ---- dates ----
  let dateObj = null, weekOffset = null, weekday = null, nextFlag = false;
  // relative words
  S.each(`${L}(?:ו?(?:עד|ל|מ)?${SEP})?(היום|הערב|הלילה|מחרתיים|מחר)${R}`, "", m=>{
    const w = m[1];
    dateObj = addDays(today, w==="מחר"?1:w==="מחרתיים"?2:0);
    if(w==="הערב") out._period = out._period||"ערב"; if(w==="הלילה") out._period = out._period||"לילה";
    out.dateSource="rel"; return {type:"date"}; });
  // "בעוד N ימים/שבועות"
  S.each(`${L}(?:ו?ב?)עוד\\s+(?:${NUM}\\s*)?(יום|יומיים|ימים|שבוע|שבועיים|שבועות|חודש|חודשיים|חודשים)${R}`, "", m=>{
    const n = m[1]?num(m[1]):1, u = m[2];
    let days = u==="יומיים"?2 : u==="שבועיים"?14 : /^שבוע/.test(u)?7*n : u==="חודשיים"?61 : /^חוד/.test(u)?30*n : n;
    if(/^חוד/.test(u) && u!=="חודשיים"){ dateObj = new Date(today.getFullYear(), today.getMonth()+n, today.getDate()); }
    else dateObj = addDays(today, days);
    out.dateSource="rel"; return {type:"date"}; });
  // "בשבוע הבא" / "שבוע הבא"
  S.each(`${L}(?:ב|ל)?${SEP}?(?:שבוע\\s+הבא|שבוע\\s+הבאה|השבוע\\s+הבא)${R}`, "", ()=>{ weekOffset=1; return {type:"date"}; });
  S.each(`${L}(?:ב|ל)?${SEP}?(?:השבוע|שבוע\\s+הזה)${R}`, "", ()=>{ weekOffset=0; return {type:"date"}; });
  // "סוף השבוע" / סופ"ש -> Friday
  S.each(`${L}(?:ב|ל|עד\\s*)?${SEP}?(?:סוף\\s+השבוע|סופ"ש|סופש)${R}`, "", ()=>{ weekday=5; return {type:"date"}; });
  // numeric date 25.10 / 25/10/26
  S.each(`${L}(?:ו?(?:ב|ל|עד|מ|ה)?${SEP}?)(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${R}`, "", m=>{
    const d = Number(m[1]), mo = Number(m[2]); if(mo<1||mo>12||d<1||d>31) return null;
    let y = m[3] ? Number(m[3]) : today.getFullYear(); if(y<100) y+=2000;
    let dt = new Date(y, mo-1, d);
    if(!m[3] && dt < today) dt = new Date(y+1, mo-1, d);
    dateObj = dt; out.dateSource="abs"; return {type:"date"}; });
  // "25 באוקטובר" / "25 לאוקטובר"
  const MON_RE = MONTHS.map(a=>a.join("|")).join("|");
  S.each(`${L}(?:ו?(?:ב|ל|עד|ה)?${SEP}?)(\\d{1,2})\\s*(?:ב|ל|-|ב-|ל-)?\\s*(${MON_RE})${R}`, "", m=>{
    const d = Number(m[1]); const mo = MONTHS.findIndex(a=>a.includes(m[2])); if(d<1||d>31) return null;
    let dt = new Date(today.getFullYear(), mo, d); if(dt<today) dt = new Date(today.getFullYear()+1, mo, d);
    dateObj = dt; out.dateSource="abs"; return {type:"date"}; });
  // weekday names
  S.each(`${L}(?:(ו?(?:ב|ל|עד|מ)?)${SEP}?(יום)\\s+|(ו?(?:ב|ל|עד\\s?|מ))${SEP}?)?(${DAY_NAMES.join("|")})(?:\\s+(הבא|הבאה|הקרוב|הקרובה|הזה|הזאת|בעוד\\s+שבוע|של\\s+שבוע\\s+הבא))?${R}`, "", m=>{
    const hasYom = !!m[2], prefix = m[3], suffix = m[5], name = m[4];
    if(!hasYom && !prefix && !suffix && name!=="שבת") return null;
    weekday = DAY_NAMES.indexOf(name);
    if(suffix && /הבא|הבאה|הקרוב|הקרובה/.test(suffix)) nextFlag = true;
    if(suffix && /שבוע/.test(suffix)) weekOffset = 1;
    return {type:"date"}; });
  // short weekday: יום ה' / ביום ה' / ה'
  S.each(`${L}(?:(?:ו?(?:ב|ל|עד)?)${SEP}?יום\\s+)?([אבגדהו])'(?![${HEB}])`, "", m=>{ weekday = DAY_LETTERS[m[1]]; return {type:"date"}; });

  // ---- times ----
  let hour=null, minute=0, endHour=null, endMinute=0, explicit24=false, hasTime=false, colonTime=false;
  const TIME = `(\\d{1,2})(?::(\\d{2}))?`;
  const timeFrom = (h,mm) => ({h:Number(h), m: mm?Number(mm):0});
  // range: 16:00-18:00 / מ-5 עד 7 / בין 5 ל-7
  S.each(`${L}(?:(?:ו?(?:מ|בין|משעה|בשעות|ב)${SEP}?)\\s*)?${TIME}\\s*(?:-|עד|ועד|ל-?|ל)\\s*(?:השעה\\s+)?${TIME}(?!\\s*(?:ימים|יום|שבועות|דקות|פעמים|[./]\\d))${R}`, "", m=>{
    const a = timeFrom(m[1],m[2]), b = timeFrom(m[3],m[4]);
    if(a.h>23||b.h>23||a.m>59||b.m>59) return null;
    if(!m[2] && !m[4] && !/^(?:ו?(?:מ|בין|משעה|בשעות|ב))/.test(m[0].trim())) return null; // "5-7" alone is too ambiguous
    hour=a.h; minute=a.m; endHour=b.h; endMinute=b.m; explicit24 = !!(m[2]||m[4]) && (a.h>=13||b.h>=13);
    hasTime=true; out.timeSource="range"; return {type:"time"}; });
  // HH:MM anywhere
  if(!hasTime) S.each(`${L}(?:ו?(?:ב|עד|מ|ל)?${SEP}?(?:שעה\\s+)?)(\\d{1,2}):(\\d{2})${R}`, "", m=>{
    const h=Number(m[1]), mm=Number(m[2]); if(h>23||mm>59) return null;
    hour=h; minute=mm; explicit24 = h>=13 || h===0 || /^0/.test(m[1]); colonTime=true; hasTime=true; return {type:"time"}; });
  // "בשעה 7" / "ב-7" / "ב7" (+ וחצי / ורבע)
  if(!hasTime) S.each(`${L}(?:בשעה\\s+|ב${SEP}|עד\\s+(?:השעה\\s+)?)${NUM}(\\s+וחצי|\\s+ורבע|\\s+ועשרים|\\s+וארבעים)?(?!\\s*(?:ימים|יום|שבועות|שבוע|דקות|פעמים|לפני|[./:]\\d|%))${R}`, "", m=>{
    const h = num(m[1]); if(h==null || h<0 || h>23) return null;
    // "ב2 מבחנים" style counts are rare; accept
    hour=h; minute = !m[2]?0 : /חצי/.test(m[2])?30 : /רבע/.test(m[2])?15 : /עשרים/.test(m[2])?20 : 40;
    hasTime=true; return {type:"time"}; });
  // "רבע ל-8"
  if(!hasTime) S.each(`${L}(?:ב)?רבע\\s+ל${SEP}?${NUM}${R}`, "", m=>{ const h=num(m[1]); if(h==null) return null; hour=(h+23)%24; minute=45; hasTime=true; return {type:"time"}; });
  // period words
  let period = out._period || null;
  S.each(`${L}(?:(?:ו?(?:ב|ל|עד\\s?|מ)${SEP}?)(בוקר|צהריים|צהרים|ערב|לילה)|(?:ו?(?:ב|ל|עד\\s?|מ)?${SEP}?)(אחה"צ|אחר\\s+הצהריים|אחרי\\s+הצהריים))${R}`, "", m=>{
    const w = m[1]||m[2]; period = /בוקר/.test(w)?"בוקר" : /אח/.test(w)?"אחה\"צ" : /צהר/.test(w)?"צהריים" : w; return {type:"time"}; });
  if(period && !hasTime){ out.timeSource = "period"; }

  // ---- resolve date ----
  if(weekday!=null){
    let d;
    if(weekOffset!=null){
      const sunday = addDays(today, -today.getDay() + 7*weekOffset);
      d = addDays(sunday, weekday);
      if(d < today) d = addDays(d,7);
    } else {
      let diff = (weekday - today.getDay() + 7) % 7; if(diff===0) diff = 7;
      d = addDays(today, diff);
    }
    dateObj = d; out.dateSource = out.dateSource || "weekday";
  } else if(weekOffset===1 && !dateObj){
    dateObj = addDays(today, 7 - today.getDay()); out.dateSource="week"; out.warnings.push("לא נאמר יום מדויק, שמתי ביום ראשון של השבוע הבא");
  }

  // lesson-based resolution (subject + "השיעור הבא", or explicit period)
  let lessonBlock = null;
  if(lessonRef?.next){
    if(out.subject){ const nl = nextLesson(out.subject, now); if(nl){ dateObj = nl.date; lessonBlock = nl; out.dateSource="lesson"; } }
    else out.warnings.push("באיזה מקצוע? כתוב למשל 'בשיעור הבא בהיסטוריה'");
  }
  if(lessonRef?.period){
    const d = dateObj || today;
    lessonBlock = { start: BELL_FALLBACK[lessonRef.period][0], end: BELL_FALLBACK[lessonRef.period][1] };
    if(!dateObj) dateObj = d;
  }

  // ---- resolve time ----
  const isSchoolDay = d => lessonBlocks(d.getDay()).length>0;
  if(hasTime){
    let h = hour;
    if(!explicit24 && h<=12){
      if(period){
        if(period==="בוקר"){ if(h===12) h=0; }
        else if(period==="צהריים"){ if(h<=4) h+=12; }
        else if(period==="אחה\"צ"){ if(h<12) h+=12; }
        else if(period==="ערב"){ if(h<12) h+=12; }
        else if(period==="לילה"){ if(h>=6 && h<12) h+=12; else if(h===12) h=0; }
      } else if(h>=1 && h<=6){ h+=12; }
      else if(h>=7 && h<=11){
        out.ambiguousHour = true;
        const nowM = now.getHours()*60+now.getMinutes();
        if(out.kind==="deadline" || colonTime){ /* morning */ }
        else if(!dateObj){
          // no day given: tonight if that is a normal evening hour, otherwise tomorrow morning
          if(h*60+minute > nowM){ /* later this morning */ }
          else if(h<=9 && (h+12)*60+minute > nowM) h+=12;
          else { dateObj = addDays(today,1); out.dateSource="implied"; }
        } else {
          const se = schoolEnd(dateObj.getDay());
          if(h<=9 && se && h*60+minute < toMin(se)) h+=12; // he is at school then -> evening
        }
      }
    }
    out.start = fromMin(h*60+minute);
    if(endHour!=null){
      let eh = endHour;
      if(!explicit24 && eh<=12 && toMin(fromMin(eh*60+endMinute)) <= h*60+minute) eh += 12;
      if(eh*60+endMinute <= h*60+minute && eh<12) eh+=12;
      out.end = fromMin(Math.min(eh*60+endMinute, 23*60+59));
    }
    if(!dateObj){ // time only -> today if still ahead, else tomorrow
      dateObj = (h*60+minute > now.getHours()*60+now.getMinutes()) ? today : addDays(today,1);
      out.dateSource = "implied";
    }
  } else if(lessonBlock){
    out.start = lessonBlock.start; out.end = lessonBlock.end; out.timeSource="lesson";
  } else if(period && out.kind!=="deadline"){
    const def = {"בוקר":"08:00","צהריים":"13:00","אחה\"צ":"16:00","ערב":"19:00","לילה":"21:00"}[period];
    out.start = def; out.timeSource = "period";
    if(!dateObj){ dateObj = today; out.dateSource="implied"; }
  }

  // recurrence anchor
  if(out.recurrence==="weekly" && recurDow!=null){
    if(!dateObj || dateObj.getDay()!==recurDow){ let diff=(recurDow-today.getDay()+7)%7; if(diff===0 && out.start && toMin(out.start) <= now.getHours()*60+now.getMinutes()) diff=7; dateObj = addDays(today,diff); }
  }
  if(out.recurrence && !dateObj) dateObj = today;
  if(out.recurrence==="weekly") out.rrule = `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAYS[dateObj.getDay()]}`;
  if(out.recurrence==="daily") out.rrule = "RRULE:FREQ=DAILY";

  // deadline with subject + date but no time -> the subject's lesson that day
  if(out.kind==="deadline" && out.subject && dateObj && !out.start){
    const blk = subjectBlocks(out.subject, dateObj.getDay())[0];
    if(blk){ out.start = blk.start; out.end = blk.end; out.timeSource = "lesson"; }
  }

  // ---- end time defaults ----
  if(out.start && !out.end){
    let dur = durMin;
    if(dur==null) dur = out.kind==="deadline" ? (out.subtype?.key==="homework"||out.subtype?.key==="submit"||out.subtype?.key==="project" ? 15 : 45) : 60;
    out.end = fromMin(Math.min(toMin(out.start)+dur, 23*60+59));
  }
  out.allDay = !out.start;
  out.date = dateObj ? ymd(dateObj) : null;
  if(!out.date) out.warnings.push("לא מצאתי תאריך. כתוב למשל 'מחר', 'ביום חמישי' או '25.10'");

  // ---- prep plan for deadlines ----
  if(out.kind==="deadline"){
    const st = out.subtype;
    let windowDays = out.remindDays ?? st.window;
    let count = prepCount ?? st.sessions;
    if(noPrep) count = 0;
    if(out.date){
      const daysAvail = Math.round((midnight(new Date(out.date+"T00:00:00")) - today)/864e5);
      windowDays = Math.max(0, Math.min(windowDays, daysAvail));
      if(prepCount==null) count = Math.min(count, Math.max(daysAvail>0?1:0, windowDays));
    }
    out.prep = { count, minutes: prepMinutes ?? st.minutes, windowDays };
    if(out.remindDays==null) out.remindDays = windowDays;
  }

  // ---- title ----
  out.title = buildTitle(text, S, out);
  return out;
}

const BELL_FALLBACK = [null,["08:15","09:00"],["09:00","09:50"],["10:10","11:00"],["11:00","11:45"],["12:00","12:45"],["12:45","13:30"],["13:40","14:25"],["14:25","15:05"],["15:15","15:55"]];

const FILLERS = [
  "יש לי","יש לנו","יהיה לי","אני צריך","אני צריכה","צריך ל","צריכה ל","תוסיף","תוסיפי","תכניס","תכניסי","תשבץ","תשבצי","לי","ביומן","ליומן","בבקשה","תרשום","תרשמי","תזכור","שיש","את","זה"
];
function buildTitle(text, S, out){
  let chars = text.split("").map((c,i)=> S.used[i] ? " " : c).join("");
  // cut at reminder-ish trailing clauses
  for(const f of FILLERS){
    chars = chars.replace(new RegExp(`${L}${f}${R}`,"g"), " ");
  }
  chars = chars.replace(/[,.;!?]+/g," ").replace(/\s+/g," ").trim();
  // strip dangling prepositions at edges
  const EDGE = /^(?:ו|ב|ל|של|עם|עד|ה|מ|על|בשעה|ב-|ל-|-)\s+|\s+(?:ו|ב|ל|של|עם|ביום|ליום|עד|ה|מ|על|בשעה|ב-|ל-|-)$/;
  for(let i=0;i<4;i++) chars = chars.replace(EDGE,"").trim();
  chars = chars.replace(/^-+|-+$/g,"").trim();
  if(!chars){
    if(out.subtype) chars = out.subtype.label + (out.subject?` ב${SUBJ[out.subject].short||SUBJ[out.subject].n}`:"");
    else chars = "אירוע";
  }
  return chars.length>80 ? chars.slice(0,80) : chars;
}
