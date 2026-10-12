// Ministry of Education vacation calendar, 5787 (2026-2027), high school (חטיבה עליונה).
// Dates are the days with no school. Source: Ministry of Education calendar as published (edugo.co.il, mako.co.il).
import { lessonBlocks } from "./school.js";

export const SCHOOL_YEAR = { from: "2026-09-01", to: "2027-06-20" };

export const VACATIONS = [
  { name: "ראש השנה",            from: "2026-09-11", to: "2026-09-13" },
  { name: "יום כיפור וסוכות",     from: "2026-09-20", to: "2026-10-04" },
  { name: "יום הבחירות",          from: "2026-10-27", to: "2026-10-27" },
  { name: "חנוכה",               from: "2026-12-06", to: "2026-12-12" },
  { name: "פורים",               from: "2027-03-23", to: "2027-03-24" },
  { name: "פסח",                 from: "2027-04-13", to: "2027-04-28" },
  { name: "יום העצמאות",          from: "2027-05-12", to: "2027-05-12" },
  { name: "שבועות",              from: "2027-06-10", to: "2027-06-11" },
  { name: "חופשת הקיץ",           from: "2027-06-21", to: "2027-08-31" },
];
export const SHORT_DAYS = [ { date: "2027-05-11", until: "12:00", name: "יום הזיכרון" } ];

const pad = n => String(n).padStart(2,"0");
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);

export function vacationOn(day){
  const k = typeof day==="string" ? day : ymd(day);
  return VACATIONS.find(v => k>=v.from && k<=v.to) || null;
}
export function vacationDays(v){ return Math.round((parse(v.to)-parse(v.from))/864e5)+1; }
/** a day with lessons: inside the school year, has a timetable, and not a vacation */
export function isSchoolDay(day){
  const k = ymd(day);
  if(k < SCHOOL_YEAR.from || k > SCHOOL_YEAR.to) return false;
  if(vacationOn(k)) return false;
  return lessonBlocks(day.getDay()).length > 0;
}
export function upcomingVacations(now, n = 20){
  const k = ymd(now);
  return VACATIONS.filter(v => v.to >= k).slice(0, n);
}

/**
 * Bridge days ("גשרים"): short runs of school days squeezed between days off.
 * Same approach as bridge-day calculators: find runs of 1..maxSkip school days with days off on both sides,
 * count the continuous break you'd get, and rank by extra days off per day skipped. Only breaks that touch a
 * real vacation count (otherwise every Friday+Sunday around a Saturday would show up).
 */
export function findBridges(from, to, { maxSkip = 2, schoolDay = isSchoolDay } = {}){
  const days = []; for(let d = new Date(from); d <= to; d = addDays(d,1)) days.push(new Date(d));
  const off = days.map(d => !schoolDay(d));
  const out = [], seen = new Set();
  const push = (si, sj, a, b, already) => {  // skip days [si, sj), break spans days a..b
    const span = days.slice(a, b+1);
    const vac = span.map(vacationOn).find(Boolean);
    const used = sj - si, total = b - a + 1, gain = total - already;
    if(!vac || total < 4 || gain < 2 || gain/used < 1.5) return;
    const key = ymd(days[si])+"/"+used; if(seen.has(key)) return; seen.add(key);
    out.push({ skip: days.slice(si, sj).map(ymd), used, from: ymd(days[a]), to: ymd(days[b]), total, gain, already, ratio: gain/used, vacation: vac.name });
  };
  for(let i=1; i<days.length; i++){
    if(!off[i-1] || off[i]) continue;           // a run of school days starts at i
    let j = i; while(j < days.length && !off[j]) j++;
    if(j >= days.length) break;
    const runLen = j - i;
    let a = i-1; while(a > 0 && off[a-1]) a--;  // days off before the run: a..i-1
    let b = j; while(b < days.length-1 && off[b+1]) b++; // days off after: j..b
    // skipping the whole run joins the break before it with the break after it
    if(runLen <= maxSkip) push(i, j, a, b, Math.max(i - a, b - j + 1));
  }
  return out.sort((x,y)=> y.ratio - x.ratio || y.total - x.total);
}
