// School timetable (class 11-9) and bell schedule.
export const BELL = [null,
  ["08:15","09:00"],["09:00","09:50"],["10:10","11:00"],["11:00","11:45"],
  ["12:00","12:45"],["12:45","13:30"],["13:40","14:25"],["14:25","15:05"],["15:15","15:55"]];

export const SUBJ = {
  cs:    { n:"יסודות מדעי המחשב", short:"מדעי המחשב", t:"שטודינר יגאל", h:172, aliases:["יסודות מדעי המחשב","מדעי המחשב","מדמ\"ח","מדמח"] },
  math:  { n:"מתמטיקה", t:"דורון רונית", h:212, aliases:["מתמטיקה","מתימטיקה","מתמ","חשבון"] },
  hist:  { n:"היסטוריה", t:"בראן מני", h:288, aliases:["היסטוריה","הסטוריה","היסט"] },
  heb:   { n:"עברית", t:"זכריה טל", h:92, aliases:["עברית","לשון","הבעה"] },
  eng:   { n:"אנגלית", t:"כהן חגית", h:30, aliases:["אנגלית","אנגלי","בוק ריפורט","פוסט רידינג"] },
  tanach:{ n:"תנ״ך", t:"גביש אלה", h:50, aliases:["תנ\"ך","תנך","תנ'ך"] },
  psy:   { n:"פסיכולוגיה", t:"פוקס אב כרמית", h:180, aliases:["פסיכולוגיה","פסיכו"] },
  pe:    { n:"חנ״ג", t:"שמעוני אור", h:128, aliases:["חנ\"ג","חנג","חינוך גופני","ספורט"] },
  guide: { n:"הנחייה", t:"חדוות מירית", h:200, aliases:["הנחייה","הנחיה"] },
  swe:   { n:"הנדסת תוכנה", t:"דבאח דניאל", h:356, aliases:["הנדסת תוכנה","הנדסת תכנה"] },
  ds:    { n:"מבני נתונים", t:"שטודינר יגאל", h:110, aliases:["מבני נתונים"] },
};

// For the exam-schedule import: which גוש he is in, and what the אשכול exams are for him.
export const GUSH = "ב";
export const CLUSTERS = { "א":"מדעי המחשב", "ב":"מדעי החברה" };

// weekday (0=Sunday) -> period -> subject
export const TT = {
  0:{1:"cs",2:"cs",3:"cs",4:"heb",5:"eng",6:"tanach",7:"tanach",8:"math"},
  1:{1:"math",2:"math",3:"pe",4:"guide",5:"tanach",6:"hist",7:"psy",8:"psy",9:"psy"},
  2:{1:"hist",2:"hist",3:"heb",4:"heb",5:"math",6:"math"},
  3:{1:"psy",2:"psy",3:"psy",4:"heb",5:"heb",6:"eng",7:"swe",8:"swe",9:"swe"},
  4:{1:"eng",2:"eng",3:"hist",4:"heb",5:"heb",6:"math",7:"math",8:"guide",9:"pe"},
  5:{4:"ds",5:"ds",6:"ds"},
};

export function lessonBlocks(dow){
  const d = TT[dow]; if(!d) return [];
  const out = [];
  for(let p=1;p<=9;p++){
    const s = d[p]; if(!s) continue;
    const last = out[out.length-1];
    if(last && last.s===s && last.to===p-1){ last.to=p; last.end=BELL[p][1]; }
    else out.push({ s, from:p, to:p, start:BELL[p][0], end:BELL[p][1] });
  }
  return out;
}
export const schoolStart = dow => { const b=lessonBlocks(dow); return b.length?b[0].start:null; };
export const schoolEnd   = dow => { const b=lessonBlocks(dow); return b.length?b[b.length-1].end:null; };

/** Lesson blocks of `subject` on a weekday. */
export function subjectBlocks(subject, dow){ return lessonBlocks(dow).filter(b=>b.s===subject); }

/** Next lesson of a subject strictly after `from` (a Date). Returns {date: Date(midnight), start, end, from, to} */
export function nextLesson(subject, from){
  for(let i=0;i<15;i++){
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate()+i);
    for(const b of subjectBlocks(subject, d.getDay())){
      const [h,m] = b.start.split(":").map(Number);
      const at = new Date(d); at.setHours(h,m,0,0);
      if(at > from) return { date:d, ...b };
    }
  }
  return null;
}
