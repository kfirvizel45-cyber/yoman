// Study-time scheduler: places prep sessions for a deadline into free time.
// Approach (like Motion/Reclaim auto-scheduling): find open blocks inside study hours, score every
// candidate slot, pick greedily with spacing between sessions, and fall back step by step when it can't fit.
import { schoolEnd } from "./school.js";
import { toMin, fromMin, ymd } from "./parser.js";

export const DEFAULT_PREFS = {
  earliest: "15:00",      // never before this
  latest: "21:30",        // sessions must end by this
  afterSchool: 45,        // minutes of rest after the last lesson
  buffer: 15,             // gap kept around other events
  sweetSpot: "17:00",     // preferred start time
  avoidFriEve: true,      // Friday after 16:00
  avoidSat: true,
  maxStudyPerDay: 150,    // minutes of planned study per day before it counts as "heavy"
};

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
const DAY = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];

/** busy: [{start:Date, end:Date, kind?:'prep'|'due'|..., allDay?:bool, title?}] */
function freeIntervals(day, busy, prefs, now, relax, offDays){
  const dow = day.getDay();
  if(dow===6 && prefs.avoidSat && !relax.weekend) return [];
  let start = toMin(prefs.earliest);
  const se = offDays && offDays.has(ymd(day)) ? null : schoolEnd(dow);
  if(se) start = Math.max(start, toMin(se) + prefs.afterSchool);
  if(!se) start = Math.min(start, toMin("10:00")); // free days start earlier
  let end = toMin(prefs.latest) + (relax.late ? 60 : 0);
  if(dow===5 && prefs.avoidFriEve && !relax.weekend) end = Math.min(end, toMin("16:00"));
  if(ymd(day)===ymd(now)){
    const n = now.getHours()*60 + now.getMinutes();
    start = Math.max(start, Math.ceil((n+20)/15)*15);
  }
  if(end - start < 30) return [];
  const dayStart = day.getTime();
  const blocks = busy.filter(b=>!b.allDay).map(b=>[
    Math.round((b.start - dayStart)/60000) - prefs.buffer,
    Math.round((b.end - dayStart)/60000) + prefs.buffer]).filter(([a,b])=>b>start && a<end).sort((x,y)=>x[0]-y[0]);
  const out = []; let cur = start;
  for(const [a,b] of blocks){ if(a>cur) out.push([cur, Math.min(a,end)]); cur = Math.max(cur,b); if(cur>=end) break; }
  if(cur<end) out.push([cur,end]);
  return out.filter(([a,b])=>b-a>=30);
}

function dayLoad(day, busy){
  const a = day.getTime(), b = a + 864e5;
  let mins = 0, study = 0;
  for(const ev of busy){ if(ev.allDay) continue; const s = Math.max(ev.start.getTime(), a), e = Math.min(ev.end.getTime(), b);
    if(e<=s) continue; const m = (e-s)/60000; const startMin = (s-a)/60000;
    if(startMin >= 14*60) mins += m; if(ev.kind==="prep") study += m; }
  return { mins, study };
}

/**
 * plan({ due:Date (deadline start, or midnight for all-day), dueAllDay, sessions, minutes, windowDays, kind }, busy, opts)
 * returns { sessions:[{date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', reasons:[...] }], warnings:[...] }
 */
export function plan(task, busy, { now = new Date(), prefs = DEFAULT_PREFS, otherDeadlines = [], offDays = null } = {}){
  const want = Math.max(0, task.sessions|0);
  const res = { sessions: [], warnings: [] };
  if(!want) return res;
  const today = midnight(now);
  const dueDay = midnight(task.due);
  // last day to study: day before the deadline; if the deadline is in the evening, the same day works too
  const dueMin = task.dueAllDay ? 0 : task.due.getHours()*60 + task.due.getMinutes();
  const lastDay = dueMin >= 17*60 ? dueDay : addDays(dueDay, -1);
  let firstDay = addDays(dueDay, -Math.max(1, task.windowDays || 1));
  if(firstDay < today) firstDay = today;
  if(lastDay < firstDay){ res.warnings.push("אין זמן לפני המועד לשבץ הכנה"); return res; }

  const deadlineDays = new Set(otherDeadlines.map(d=>ymd(midnight(d))));
  const attempts = [
    { minutes: task.minutes, relax:{} },
    { minutes: Math.max(45, task.minutes-30), relax:{} },
    { minutes: Math.max(45, task.minutes-30), relax:{ late:true } },
    { minutes: 45, relax:{ late:true, weekend:true } },
  ];
  for(const att of attempts){
    const chosen = [];
    const busyAll = [...busy];
    for(let k=0;k<want;k++){
      let best = null;
      for(let d = new Date(firstDay); d <= lastDay; d = addDays(d,1)){
        const free = freeIntervals(d, busyAll, prefs, now, att.relax, offDays);
        const load = dayLoad(d, busyAll);
        const daysBefore = Math.round((dueDay - d)/864e5);
        for(const [a,b] of free){
          for(let s=a; s+att.minutes<=b; s+=15){
            const sc = score({ d, s, len:att.minutes, a, b, load, daysBefore, chosen, task, prefs, deadlineDays, want });
            if(!best || sc.v < best.v) best = { ...sc, d:new Date(d), s };
          }
        }
      }
      if(!best) break;
      const start = new Date(best.d); start.setMinutes(best.s);
      const end = new Date(start.getTime() + att.minutes*60000);
      chosen.push({ date: ymd(best.d), start: fromMin(best.s), end: fromMin(best.s+att.minutes), reasons: best.reasons, d: best.d });
      busyAll.push({ start, end, kind:"prep" });
    }
    if(chosen.length===want || att===attempts[attempts.length-1]){
      res.sessions = chosen.sort((x,y)=> (x.date+x.start).localeCompare(y.date+y.start)).map(({d,...r})=>r);
      if(att.minutes < task.minutes) res.warnings.push(`קיצרתי ל־${att.minutes} דקות כדי שייכנס`);
      if(att.relax.late) res.warnings.push("חלק מהזמנים מאוחרים מהרגיל");
      if(att.relax.weekend && chosen.some(c=>c.d.getDay()>=5)) res.warnings.push("נאלצתי להשתמש בסוף השבוע");
      if(chosen.length < want) res.warnings.push(chosen.length ? `נכנסו רק ${chosen.length} מתוך ${want} זמני הכנה` : "לא מצאתי זמן פנוי לפני המועד");
      return res;
    }
  }
  return res;
}

function score({ d, s, len, a, b, load, daysBefore, chosen, task, prefs, deadlineDays, want }){
  let v = 0; const reasons = [];
  const sweet = toMin(prefs.sweetSpot);
  // time of day: focus is best late afternoon, falls off later at night
  const dist = Math.abs(s - sweet)/60;
  v += dist * 1.6;
  if(s + len > 20*60 + 30) v += 2.5;
  if(dist <= 1) reasons.push("שעה טובה לריכוז");
  // busy days cost more
  v += (load.mins/60) * 1.4 + (load.study/60) * 2;
  if(load.study + len > prefs.maxStudyPerDay) v += 6;
  if(load.mins < 60 && load.study===0) reasons.push(`יום ${DAY[d.getDay()]} פנוי יחסית`);
  // breathing room around other events
  const roomBefore = s - a, roomAfter = b - (s+len);
  if(roomBefore < 15) v += 0.6; if(roomAfter < 15) v += 0.6;
  // weekend
  if(d.getDay()===5) v += 3; if(d.getDay()===6) v += 6;
  // protect the evening before another deadline
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1);
  if(deadlineDays.has(ymd(next))) { v += 5; }
  // spacing between sessions (spaced repetition)
  const sameDay = chosen.filter(c=>c.date===ymd(d)).length;
  v += sameDay * 9;
  for(const c of chosen){ const gap = Math.abs(Math.round((c.d - d)/864e5)); if(gap===1) v += 1.2; }
  if(chosen.length && !sameDay) reasons.push("מרווח מהמפגש הקודם");
  // tests: last review the day before; projects: start early
  const key = task.kind;
  if((key==="test"||key==="quiz"||key==="bagrut") && daysBefore===1 && want>1 && !chosen.some(c=>Math.round((midnight(task.due)-c.d)/864e5)===1)){ v -= 3; reasons.unshift("חזרה אחרונה יום לפני"); }
  if((key==="project"||key==="submit") && chosen.length===0){ v += Math.max(0, 3 - daysBefore) * 1.5; if(daysBefore>=3) reasons.unshift("מתחילים מוקדם, לא ברגע האחרון"); }
  // tiny tie-breaker toward earlier slots so plans are stable
  v += (s/60)*0.01 + (7-Math.min(7,daysBefore))*0.02;
  return { v, reasons: [...new Set(reasons)].slice(0,2) };
}

/** Free blocks of a day (for showing "פנוי" gaps), given busy events. */
export function freeBlocks(day, busy, { now = new Date(), from = "08:00", to = "22:00", min = 45 } = {}){
  const dayStart = midnight(day).getTime();
  let start = toMin(from), end = toMin(to);
  if(ymd(day)===ymd(now)) start = Math.max(start, Math.ceil((now.getHours()*60+now.getMinutes())/15)*15);
  const blocks = busy.filter(b=>!b.allDay).map(b=>[Math.round((b.start-dayStart)/60000), Math.round((b.end-dayStart)/60000)])
    .filter(([a,b])=>b>start && a<end).sort((x,y)=>x[0]-y[0]);
  const out=[]; let cur=start;
  for(const [a,b] of blocks){ if(a-cur>=min) out.push([cur,a]); cur=Math.max(cur,b); }
  if(end-cur>=min) out.push([cur,end]);
  return out;
}
