import { parse } from "../js/parser.js";
import { plan } from "../js/scheduler.js";

const NOW = new Date(2026, 9, 12, 16, 30); // Monday 12.10.2026 16:30
let fail = 0, pass = 0;
function check(text, exp){
  const r = parse(text, NOW);
  const bad = [];
  for(const [k,v] of Object.entries(exp)){
    const got = k==="prepCount" ? r.prep?.count : k==="subtype" ? r.subtype?.key : r[k];
    if(JSON.stringify(got)!==JSON.stringify(v)) bad.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(got)}`);
  }
  if(bad.length){ fail++; console.log("FAIL", text, "\n   ", bad.join("\n    "), "\n    title:", r.title, "| warnings:", r.warnings); }
  else { pass++; }
}

check("מבחן בהיסטוריה ביום חמישי הבא", { kind:"deadline", subtype:"test", subject:"hist", date:"2026-10-15", start:"10:10", end:"11:00", title:"מבחן בהיסטוריה" });
check("עבודה באנגלית להגשה ב־25.10, תזכיר 3 ימים לפני", { kind:"deadline", subtype:"project", subject:"eng", date:"2026-10-25", remindDays:3 });
check("רכיבה עם אבא בשבת ב־7 בבוקר", { kind:"event", date:"2026-10-17", start:"07:00", end:"08:00", title:"רכיבה עם אבא" });
check("תרגיל במתמטיקה למחר", { kind:"deadline", subtype:"homework", subject:"math", date:"2026-10-13", start:"12:00" });
check("ארוחת ערב עם סבתא מחר ב-8", { date:"2026-10-13", start:"20:00", title:"ארוחת ערב עם סבתא" });
check("פגישה ביום רביעי בשעה 17:30", { date:"2026-10-14", start:"17:30", end:"18:30", title:"פגישה" });
check("כדורגל כל יום שלישי ב-6", { recurrence:"weekly", rrule:"RRULE:FREQ=WEEKLY;BYDAY=TU", date:"2026-10-13", start:"18:00", title:"כדורגל" });
check("רופא שיניים ב-3.11 בשעה 9:30", { date:"2026-11-03", start:"09:30", title:"רופא שיניים" });
check("בוחן בתנ\"ך בשיעור הבא", { kind:"deadline", subtype:"quiz", subject:"tanach", date:"2026-10-18", start:"12:45" });
check("מבחן במתמטיקה בעוד שבוע", { date:"2026-10-19", subject:"math", start:"08:15" });
check("יום הולדת לדנה ב-20 באוקטובר", { date:"2026-10-20", allDay:true, title:"יום הולדת לדנה" });
check("אימון מ-5 עד 7 ביום ראשון", { date:"2026-10-18", start:"17:00", end:"19:00", title:"אימון" });
check("מסיבה בשישי בערב", { date:"2026-10-16", start:"19:00", title:"מסיבה" });
check("בגרות באנגלית ב-10.12", { subtype:"bagrut", date:"2026-12-10", prepCount:5 });
check("מבחן בפסיכולוגיה ביום ה' בלי הכנה", { date:"2026-10-15", prepCount:0, subject:"psy" });
check("מצגת בהיסטוריה לשבוע הבא ביום שלישי, 4 מפגשים", { date:"2026-10-20", prepCount:4, subtype:"project" });
check("ללכת לספרייה מחרתיים אחה\"צ", { date:"2026-10-14", start:"16:00" });
check("שיחה עם המורה היום ב-18:15", { date:"2026-10-12", start:"18:15" });
check("קולנוע עם חברים בשבת ב-9 בערב לשעתיים", { date:"2026-10-17", start:"21:00", end:"23:00" });
check("מבחן בעברית ביום ראשון בשיעור 4", { date:"2026-10-18", start:"11:00", end:"11:45", subject:"heb" });
check("להתקשר לסבא בעוד יומיים", { date:"2026-10-14", allDay:true, title:"להתקשר לסבא" });
check("נסיעה לאילת 1/1/27", { date:"2027-01-01" });
check("ספרייה ב-10", { date:"2026-10-13", start:"10:00" });
check("עבודה בהיסטוריה לשיעור הבא, תזכיר לי יומיים לפני", { date:"2026-10-13", subject:"hist", remindDays:2 });

// scheduler sanity
const r = parse("מבחן בהיסטוריה ביום חמישי הבא", NOW);
const due = new Date(r.date+"T"+r.start+":00");
const busy = [
  { start:new Date(2026,9,13,15,0), end:new Date(2026,9,13,17,0), title:"ערן" },
  { start:new Date(2026,9,14,16,0), end:new Date(2026,9,14,22,0), title:"busy wed" },
];
const p = plan({ due, dueAllDay:false, sessions:r.prep.count, minutes:r.prep.minutes, windowDays:r.prep.windowDays, kind:r.subtype.key }, busy, { now:NOW });
console.log("plan:", JSON.stringify(p));
const ok = p.sessions.length===r.prep.count && p.sessions.every(s=> s.date>="2026-10-12" && s.date<"2026-10-15")
  && !p.sessions.some(s=> s.date==="2026-10-13" && s.start<"17:15" && s.end>"14:45")
  && !p.sessions.some(s=> s.date==="2026-10-14" && s.end>"15:45");
if(ok) pass++; else { fail++; console.log("FAIL scheduler"); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
