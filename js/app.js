import { parse, ymd, toMin, fromMin } from "./parser.js";
import { plan, freeBlocks, DEFAULT_PREFS } from "./scheduler.js";
import { SUBJ, lessonBlocks, schoolStart, schoolEnd } from "./school.js";
import { auth, backend, demo, HOLIDAY_CAL, CalError, redirectUri, TZ } from "./gcal.js";
import { settings, notes as noteStore, photos as photoStore } from "./store.js";
import { VACATIONS, vacationOn, vacationDays, isSchoolDay, findBridges, upcomingVacations } from "./vacations.js";

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const DAYS = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
const DAYS_S = ["א׳","ב׳","ג׳","ד׳","ה׳","ו׳","ש׳"];
const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const MONTHS_S = ["ינו׳","פבר׳","מרץ","אפר׳","מאי","יוני","יולי","אוג׳","ספט׳","אוק׳","נוב׳","דצמ׳"];
const pad = n => String(n).padStart(2,"0");
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d,n) => new Date(d.getFullYear(), d.getMonth(), d.getDate()+n);
const weekStart = d => addDays(midnight(d), -d.getDay());
const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const at = (dateStr, t) => { const d = parseYmd(dateStr); const [h,m] = t.split(":").map(Number); d.setHours(h,m,0,0); return d; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const R = (a,b) => `<bdi dir="ltr">${a}–${b}</bdi>`;
const dur = m => m>=60 ? (m%60 ? `${Math.floor(m/60)}:${pad(m%60)} ש׳` : `${m/60} ש׳`) : `${m} דק׳`;
const pretty = d => `יום ${DAYS[d.getDay()]}, ${d.getDate()} ב${MONTHS[d.getMonth()]}`;
const shortDate = d => `${DAYS_S[d.getDay()]} ${d.getDate()}.${d.getMonth()+1}`;
function rel(d){ const n = Math.round((midnight(d) - midnight(new Date()))/864e5);
  return n===0?"היום":n===1?"מחר":n===2?"מחרתיים":n===-1?"אתמול":null; }
const I = {
  x:'<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  bell:'<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  book:'<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/></svg>',
  flag:'<svg viewBox="0 0 24 24"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
  repeat:'<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
  note:'<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
  cam:'<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  school:'<svg viewBox="0 0 24 24"><path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c3 2 7 2 10 0v-5"/></svg>',
  text:'<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  free:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
};

/* ================= state ================= */
const today0 = midnight(new Date());
const S = {
  view: "month",
  sel: today0,
  month: new Date(today0.getFullYear(), today0.getMonth(), 1),
  weeks: new Map(), loading: new Set(),
  notesIdx: {}, tasks: null, err: null,
};
const prefs = () => ({ ...DEFAULT_PREFS, ...settings.get("prefs", {}) });
let cal = backend();
const priv = ev => ev?.extendedProperties?.private || {};
const isApp = ev => priv(ev).sc==="1";
const kindOf = ev => priv(ev).scKind || null;
const evStart = ev => ev.start?.dateTime ? new Date(ev.start.dateTime) : ev.start?.date ? parseYmd(ev.start.date) : null;
const evEnd = ev => ev.end?.dateTime ? new Date(ev.end.dateTime) : ev.end?.date ? parseYmd(ev.end.date) : null;
const isAllDay = ev => !ev.start?.dateTime;
const isSchool = ev => (ev.summary||"").trim()==="בית ספר";

/* Google Calendar event colours */
const GC = {"1":"#7986CB","2":"#33B679","3":"#8E24AA","4":"#E67C73","5":"#F6BF26","6":"#F4511E","7":"#039BE5","8":"#616161","9":"#3F51B5","10":"#0B8043","11":"#D50000"};
const LIGHT = new Set(["#F6BF26","#33B679"]);
const DEFAULT_C = "#039BE5", HOLI_C = "#2E8B7E";
function evColor(ev){
  const k = kindOf(ev);
  if(k==="due") return GC["11"]; if(k==="prep") return GC["5"];
  if(ev._holiday) return HOLI_C;
  if(k==="vac") return GC["2"];
  return GC[ev.colorId] || (isSchool(ev) ? GC["3"] : DEFAULT_C);
}
const darkText = c => LIGHT.has(c);

/* ================= vacations ================= */
const OFF_DAYS = (()=>{ const s = new Set(); for(const v of VACATIONS){ for(let d = parseYmd(v.from); ymd(d) <= v.to; d = addDays(d,1)) s.add(ymd(d)); } return s; })();
let BRIDGES = null;
function bridges(){ if(!BRIDGES){ const t = midnight(new Date()); BRIDGES = findBridges(addDays(t,-1), addDays(t,300)).filter(b=>b.skip[0] > ymd(t)); } return BRIDGES; }
const bridgeFor = k => bridges().filter(b=>b.skip.includes(k));
const daysUntil = k => Math.round((parseYmd(k) - midnight(new Date()))/864e5);
const dm = k => { const d = parseYmd(k); return `${d.getDate()}.${d.getMonth()+1}`; };
const rangeTxt = (a,b) => a===b ? `יום ${DAYS[parseYmd(a).getDay()]} ${dm(a)}` : `${DAYS_S[parseYmd(a).getDay()]} ${dm(a)} – ${DAYS_S[parseYmd(b).getDay()]} ${dm(b)}`;
function lessonsMissed(keys){ return keys.reduce((n,k)=>n+lessonBlocks(parseYmd(k).getDay()).reduce((x,b)=>x+(b.to-b.from+1),0),0); }
function testsOn(keys){ return (S.tasks?.due||[]).filter(e=>priv(e).scDone!=="1" && keys.includes(ymd(evStart(e)))); }

/* ================= banner ================= */
function errText(e){
  switch(e?.code){
    case "auth": return "צריך להתחבר שוב ליומן גוגל.";
    case "network": return "אין חיבור לאינטרנט. מוצג מה שנטען קודם.";
    case "forbidden": return "גוגל דחה את הבקשה: "+(e.message||"");
    case "no_client": return "חסר מזהה החיבור של גוגל. אפשר להגדיר אותו בהגדרות.";
    default: return "משהו השתבש מול יומן גוגל: "+(e?.message||"");
  }
}
function showBanner(){
  const b = $("banner");
  if(S.err){
    b.hidden=false; b.className="banner err";
    b.innerHTML = `<span>${esc(errText(S.err))}</span>${S.err.code==="auth"?'<button class="tbtn" id="reconnect" type="button">התחבר</button>':'<button class="tbtn" id="retry" type="button">נסה שוב</button>'}`;
    $("reconnect")?.addEventListener("click", ()=>{ try{ auth.connect(); }catch(e){ toast(errText(e)); } });
    $("retry")?.addEventListener("click", ()=>{ S.err=null; refresh(); });
  } else b.hidden = true;
  $("demoPill").hidden = cal.mode!=="demo";
}

/* ================= data ================= */
async function loadWeek(ws, force){
  const key = ymd(ws);
  if(!force && (S.weeks.has(key) || S.loading.has(key))) return;
  if(cal.mode==="google" && !cal.ready()) return;
  S.loading.add(key);
  try{
    const to = addDays(ws,7);
    const [events, holidays] = await Promise.all([
      cal.list(ws, to),
      cal.list(ws, to, { calendarId: HOLIDAY_CAL }).catch(()=>[]),
    ]);
    holidays.forEach(h=>h._holiday = true);
    S.weeks.set(key, { events, holidays, at: Date.now() });
    S.err = null;
  }catch(e){ S.err = e; if(e.code==="auth" && auth.trySilent()) return; }
  finally{ S.loading.delete(key); }
  scheduleRender();
  showBanner();
}
let rTimer = null;
function scheduleRender(){ clearTimeout(rTimer); rTimer = setTimeout(renderView, 16); }
function gridStart(m){ return weekStart(new Date(m.getFullYear(), m.getMonth(), 1)); }
function loadVisible(force){
  if(S.view==="month"){ const g = gridStart(S.month); for(let i=0;i<6;i++) loadWeek(addDays(g,7*i), force); }
  else { loadWeek(weekStart(S.sel), force); loadWeek(addDays(weekStart(S.sel),7), force); }
}
function refresh(){ S.weeks.clear(); S.tasks = null; loadVisible(true); loadTasks(); }
function eventsOn(day){
  const w = S.weeks.get(ymd(weekStart(day))); if(!w) return null;
  const a = midnight(day), b = addDays(a,1), vac = OFF_DAYS.has(ymd(day));
  return w.events.filter(ev=>{ if(vac && isSchool(ev)) return false; if(kindOf(ev)==="vac") return false; const s=evStart(ev), e=evEnd(ev)||s; if(!s) return false; return isAllDay(ev) ? (s<b && e>a) : (s>=a && s<b); })
    .sort((x,y)=> (isAllDay(y)-isAllDay(x)) || evStart(x)-evStart(y));
}
function holidaysOn(day){
  const w = S.weeks.get(ymd(weekStart(day))); if(!w) return [];
  const a = midnight(day), b = addDays(a,1);
  return w.holidays.filter(ev=>{ const s=evStart(ev), e=evEnd(ev)||s; return s<b && e>a; });
}
async function loadTasks(){
  if(cal.mode==="google" && !cal.ready()) return;
  try{
    const now = new Date();
    const [due, prep] = await Promise.all([
      cal.list(addDays(now,-21), addDays(now,180), { privateProp:"scKind=due" }),
      cal.list(addDays(now,-60), addDays(now,180), { privateProp:"scKind=prep" }),
    ]);
    S.tasks = { due, prep };
  }catch(e){ S.tasks = S.tasks || { due:[], prep:[] }; }
  renderBadge(); if(S.view==="tasks") renderTasks(); if(S.view==="vac") renderVac(); else scheduleRender();
}
async function loadNotesIdx(){
  const all = await noteStore.all();
  S.notesIdx = Object.fromEntries(all.map(n=>[n.id, { text: !!(n.text||"").trim(), photos: (n.photos||[]).length }]));
}

/* ================= header ================= */
function renderBar(){
  const v = S.view;
  $("menuBtn").hidden = v==="day";
  $("backBtn").hidden = v!=="day";
  const ref = v==="day" ? S.sel : S.month;
  let t = v==="tasks" ? "מבחנים ומשימות" : v==="settings" ? "הגדרות" : v==="vac" ? "חופשות וגשרים" : MONTHS[ref.getMonth()];
  if((v==="month"||v==="day") && ref.getFullYear()!==new Date().getFullYear()) t += " " + ref.getFullYear();
  $("ttl").textContent = t;
  $("ttlBtn").querySelector(".caret").style.display = (v==="month"||v==="day") ? "" : "none";
  $("todayNum").textContent = new Date().getDate();
  $("todayBtn").hidden = !(v==="month"||v==="day");
  $("fab").hidden = !(v==="month"||v==="day"||v==="tasks");
  document.querySelectorAll(".dr-i").forEach(b=>b.classList.toggle("on", b.dataset.view===v));
}
function renderMonths(){
  const m = $("months"); if(m.hidden) return;
  const y = S.month.getFullYear(); let h = "";
  for(let k=-2;k<=13;k++){
    const d = new Date(y, S.month.getMonth()+k, 1);
    if(d.getMonth()===0 && k!==-2) h += `<span class="yr">${d.getFullYear()}</span>`;
    h += `<button type="button" class="mp${k===0?" on":""}" data-y="${d.getFullYear()}" data-m="${d.getMonth()}">${MONTHS_S[d.getMonth()]}</button>`;
  }
  m.innerHTML = h;
  m.querySelectorAll(".mp").forEach(b=>b.onclick=()=>{ S.month = new Date(+b.dataset.y, +b.dataset.m, 1); if(S.view==="day") S.sel = new Date(S.month); setView(S.view==="day"?"day":"month"); });
  m.querySelector(".mp.on")?.scrollIntoView({ inline:"center", block:"nearest" });
}

/* ================= month view ================= */
function renderMonth(){
  const now = new Date(), todayK = ymd(now), selK = ymd(S.sel);
  $("wkhead").innerHTML = DAYS_S.map((d,i)=>`<span class="${i===now.getDay() && sameMonth(now,S.month)?"on":""}">${d}</span>`).join("");
  const g = gridStart(S.month);
  // rows: 5 or 6 depending on month
  const last = new Date(S.month.getFullYear(), S.month.getMonth()+1, 0);
  const rows = Math.ceil((addDays(last,1) - g)/864e5/7);
  const avail = window.innerHeight - $("bar").offsetHeight - 34 - (S.err?52:0);
  const rowh = Math.max(84, Math.floor(avail/rows));
  const grid = $("mgrid"); grid.style.setProperty("--rowh", rowh+"px");
  const maxChips = Math.max(1, Math.floor((rowh - 30)/18));
  const dueDone = new Set((S.tasks?.due||[]).filter(e=>priv(e).scDone==="1").map(e=>e.id));
  let h = "";
  for(let i=0;i<rows*7;i++){
    const d = addDays(g,i), k = ymd(d);
    const all = [...holidaysOn(d), ...(eventsOn(d)||[])];
    const sch = all.find(isSchool);
    const evs = all.filter(e=>!isSchool(e));
    const show = evs.length > maxChips ? maxChips-1 : evs.length;
    let chips = (sch ? `<span class="sbar" style="--c:${evColor(sch)}" title="בית ספר"></span>` : `<span class="sbar none"></span>`) + evs.slice(0,show).map(ev=>{ const c = evColor(ev);
      return `<span class="chip${darkText(c)?" dark":""}${dueDone.has(ev.id)?" done":""}" style="--c:${c}">${esc(ev.summary||"")}</span>`; }).join("");
    if(evs.length > show) chips += `<span class="more">+${evs.length-show}</span>`;
    const vac = vacationOn(k), br = !vac && bridgeFor(k).length;
    if(vac && (k===vac.from || d.getDay()===0)) chips = `<span class="vlbl">${esc(vac.name)}</span>` + chips;
    if(br) chips += `<span class="blbl">גשר</span>`;
    h += `<div class="cell${d.getMonth()!==S.month.getMonth()?" out":""}${k===todayK?" today":""}${k===selK?" sel":""}${vac?" vac":""}${br?" bridge":""}" data-d="${k}" role="button" tabindex="0" aria-label="${esc(pretty(d))}"><span class="dn num">${d.getDate()}</span>${chips}</div>`;
  }
  grid.innerHTML = h;
  renderNextVac();
  grid.querySelectorAll(".cell").forEach(c=>{ c.onclick = ()=>{ S.sel = parseYmd(c.dataset.d); setView("day"); }; c.onkeydown = e=>{ if(e.key==="Enter") c.click(); }; });
}
function renderNextVac(){
  const el = $("nextvac"); const nowK = ymd(new Date());
  const v = upcomingVacations(new Date(), 1)[0];
  if(!v){ el.innerHTML = ""; return; }
  const n = daysUntil(v.from), on = v.from <= nowK;
  const br = bridges().filter(b=>b.vacation===v.name);
  el.innerHTML = `<button type="button" class="nv"><span class="nvd"></span><span>${on?`עכשיו חופשה: <b>${esc(v.name)}</b> עד ${dm(v.to)}`:`<b>${esc(v.name)}</b> בעוד ${n===1?"יום":n+" ימים"}`}</span>${br.length?`<span class="nvb">יש גשר</span>`:""}</button>`;
  el.querySelector(".nv").onclick = ()=>setView("vac");
}
const sameMonth = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth();

/* ================= day view ================= */
const HH = 56; // px per hour
function renderDayTop(){
  const ws = weekStart(S.sel), todayK = ymd(new Date()), selK = ymd(S.sel);
  let h = "";
  for(let i=0;i<7;i++){ const d = addDays(ws,i), k = ymd(d); const evs = eventsOn(d);
    const has = evs && evs.some(e=>!isSchool(e));
    h += `<button type="button" class="dw${k===todayK?" today":""}${k===selK?" sel":""}${OFF_DAYS.has(k)?" vac":""}" data-d="${k}"><span>${DAYS_S[i]}</span><b class="num">${d.getDate()}</b><i class="${has?"":"x"}"></i></button>`; }
  $("dweek").innerHTML = h;
  $("dweek").querySelectorAll(".dw").forEach(b=>b.onclick=()=>{ S.sel = parseYmd(b.dataset.d); renderView(); loadVisible(); });
}
function layoutCols(items){
  // items: {s,e} minutes; assign columns for overlaps (Google-style side by side)
  const sorted = [...items].sort((a,b)=>a.s-b.s || b.e-a.e);
  let cluster = [], clusterEnd = -1, out = [];
  const flush = () => { const cols = []; cluster.forEach(it=>{ let c = cols.findIndex(end=>end<=it.s); if(c<0){ c = cols.length; cols.push(0); } cols[c] = it.e; it.col = c; });
    cluster.forEach(it=>it.ncol = cols.length); out.push(...cluster); cluster = []; };
  for(const it of sorted){ if(it.s >= clusterEnd && cluster.length) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e); }
  if(cluster.length) flush();
  return out;
}
function renderDay(){
  renderDayTop();
  const day = S.sel, now = new Date(), isToday = ymd(day)===ymd(now);
  const evs = eventsOn(day);
  const holis = holidaysOn(day);
  const allDay = [...holis, ...(evs||[]).filter(isAllDay)];
  const timed = (evs||[]).filter(e=>!isAllDay(e));
  // summary pills
  const sum = [];
  const dueSoon = (S.tasks?.due||[]).filter(e=>priv(e).scDone!=="1" && evStart(e) > addDays(midnight(day),1) && evStart(e) < addDays(midnight(day),8))
    .sort((a,b)=>evStart(a)-evStart(b)).slice(0,2);
  dueSoon.forEach(e=>{ const n = Math.round((midnight(evStart(e))-midnight(day))/864e5); sum.push(`<button type="button" class="pill red" data-go="tasks">${esc(e.summary)} · ${n===1?"מחר":"עוד "+n+" ימים"}</button>`); });
  if(evs){
    const busy = timed.map(e=>({ start:evStart(e), end:evEnd(e) }));
    const gaps = freeBlocks(day, busy, { now, from:"08:00", to:"22:00", min:45 });
    const freeMin = gaps.reduce((a,[x,y])=>a+(y-x),0);
    if(freeMin) sum.push(`<span class="pill free">${I.free}פנוי ${dur(freeMin)}${isToday?" מעכשיו":""}</span>`);
  }
  const vacT = vacationOn(ymd(day)), brT = bridgeFor(ymd(day));
  if(vacT){ const i = Math.round((midnight(day)-parseYmd(vacT.from))/864e5)+1, n = vacationDays(vacT);
    sum.unshift(`<button type="button" class="pill vac" data-go="vac">אין לימודים · ${esc(vacT.name)}${n>1?` (יום ${i} מתוך ${n})`:""}</button>`); }
  else if(brT.length){ const b = brT[0];
    sum.unshift(`<button type="button" class="pill bridge" data-go="vac">יום גשר: ${b.total} ימי חופש רצוף אם תוותר על ${b.used===1?"יום אחד":b.used+" ימים"}</button>`); }
  $("dsum").innerHTML = sum.join("");
  $("dsum").querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>setView(b.dataset.go));
  $("dall").innerHTML = allDay.map((ev,i)=>{ const c = evColor(ev); return `<button type="button" class="adc${darkText(c)?" dark":""}" style="--c:${c}" data-i="${i}">${esc(ev.summary)}</button>`; }).join("");
  $("dall").querySelectorAll(".adc").forEach(b=>b.onclick=()=>{ const ev = allDay[+b.dataset.i]; if(!ev._holiday) openEvent(ev); });

  // hour grid
  const H = $("hours");
  let rows = ""; for(let h=0;h<24;h++) rows += `<div class="hr"><span class="num">${pad(h)}:00</span></div>`;
  H.style.setProperty("--hh", HH+"px");
  H.innerHTML = rows + `<div class="evs" id="evs"></div>`;
  const box = $("evs");
  const dayMs = midnight(day).getTime();
  const items = timed.map(ev=>{ const s = Math.max(0, (evStart(ev)-dayMs)/60000), e = Math.min(1440, (evEnd(ev)-dayMs)/60000); return { ev, s, e: Math.max(e, s+20) }; });
  if(!evs && lessonBlocks(day.getDay()).length){ // not loaded yet: show timetable so the screen is useful at once
    items.push({ ev:{ id:"_school", summary:"בית ספר", colorId:"3", start:{dateTime:at(ymd(day),schoolStart(day.getDay())).toISOString()}, end:{dateTime:at(ymd(day),schoolEnd(day.getDay())).toISOString()} },
      s: toMin(schoolStart(day.getDay())), e: toMin(schoolEnd(day.getDay())) });
  }
  layoutCols(items).forEach(it=>{
    const ev = it.ev, c = evColor(ev), k = kindOf(ev), n = S.notesIdx[ev.id];
    const el = document.createElement("div"); el.setAttribute("role","button"); el.tabIndex = 0;
    const school = isSchool(ev);
    el.className = `ev${darkText(c)?" dark":""}${school?" school":""}${evEnd(ev)<now?" past":""}`;
    el.style.setProperty("--c", c);
    el.style.top = (it.s/60*HH + 1) + "px";
    el.style.height = Math.max(22, (it.e-it.s)/60*HH - 3) + "px";
    const w = 100/it.ncol; el.style.right = `calc(${w*it.col}% + 0px)`; el.style.width = `calc(${w}% - 3px)`;
    const s = evStart(ev), e = evEnd(ev); const short = (it.e-it.s) < 45;
    let icons = "";
    if(n?.text) icons += I.note; if(n?.photos) icons += I.cam;
    if(school){
      let les = "";
      const st = toMin(hm(s));
      lessonBlocks(day.getDay()).forEach(b=>{ const top = (toMin(b.start)-st)/60*HH, hgt = (toMin(b.end)-toMin(b.start))/60*HH;
        const nm = now.getHours()*60+now.getMinutes(); const live = isToday && nm>=toMin(b.start) && nm<toMin(b.end);
        const t2 = Math.max(top, 22);
        les += `<div class="les${live?" now":""}" style="top:${t2}px;height:${Math.max(18,hgt-(t2-top))}px"><b>${esc(SUBJ[b.s].n)}</b><small class="num">${b.start} · ${b.from===b.to?"שיעור "+b.from:"שיעורים "+R(b.from,b.to)}</small></div>`; });
      el.innerHTML = `<div class="sh">בית ספר <span class="num" style="font-weight:400">${R(hm(s),hm(e))}</span><span class="ic">${icons}</span></div>${les}`;
    } else {
      const warn = k==="prep" && hasConflict(ev) ? `<span class="warn">התנגשות</span>` : "";
      const tag = k==="due" ? (priv(ev).scDone==="1" ? " ✓" : "") : "";
      el.innerHTML = short ? `<div class="et">${esc(ev.summary||"(ללא כותרת)")}${tag}, <span class="num" style="font-weight:400">${hm(s)}</span><span class="ic">${icons}</span>${warn}</div>`
        : `<div class="et">${esc(ev.summary||"(ללא כותרת)")}${tag}<span class="ic">${icons}</span>${warn}</div><div class="es num">${R(hm(s),hm(e))}</div>`;
    }
    el.onclick = e2 => { e2.stopPropagation(); if(ev.id!=="_school") openEvent(ev); };
    el.onkeydown = e2 => { if(e2.key==="Enter") el.click(); };
    box.appendChild(el);
  });
  if(isToday){ const nl = document.createElement("div"); nl.className="nowline"; nl.style.top = ((now.getHours()*60+now.getMinutes())/60*HH)+"px"; box.appendChild(nl); }
  // tap empty space -> add at that time
  box.onclick = e => {
    const r = box.getBoundingClientRect(); const y = e.clientY - r.top;
    let m = Math.floor(y/HH*2)*30; m = Math.max(0, Math.min(23*60+30, m));
    const hint = document.createElement("div"); hint.className="hint"; hint.style.top = (m/60*HH+1)+"px"; hint.style.height = (HH-3)+"px"; hint.textContent = `+ ${fromMin(m)}`; box.appendChild(hint);
    setTimeout(()=>{ hint.remove(); openComposer({ prefill: `${dayPhrase(day)} ב-${fromMin(m)} ` }); }, 140);
  };
}
function scrollDayToNow(){
  const now = new Date(), isToday = ymd(S.sel)===ymd(now);
  const m = isToday ? Math.max(7*60, now.getHours()*60+now.getMinutes()-60) : 7*60+30;
  const top = $("hours").getBoundingClientRect().top + scrollY - ($("bar").offsetHeight + $("dtop").offsetHeight);
  window.scrollTo(0, Math.max(0, top + m/60*HH - 8));
}
function hasConflict(ev){
  const evs = eventsOn(evStart(ev)) || []; const s = evStart(ev), e = evEnd(ev);
  return evs.some(o=>o.id!==ev.id && !isAllDay(o) && kindOf(o)!=="prep" && evStart(o)<e && evEnd(o)>s);
}
function dayPhrase(d){ const r = rel(d); if(r && r!=="אתמול") return r; return `ב-${d.getDate()}.${d.getMonth()+1}`; }

/* ================= tasks ================= */
function taskModel(dueEv){
  const p = priv(dueEv); const id = p.scTask;
  const sessions = (S.tasks?.prep||[]).filter(e=>priv(e).scTask===id).sort((a,b)=>evStart(a)-evStart(b));
  return { ev: dueEv, id, done: p.scDone==="1", due: evStart(dueEv), allDay: isAllDay(dueEv), sessions, subtype: p.scSubtype, subject: p.scSubject };
}
function renderBadge(){
  const now = new Date();
  const soon = (S.tasks?.due||[]).filter(e=>priv(e).scDone!=="1" && evEnd(e) > now && (evStart(e)-now) < 3*864e5).length;
  const b = $("tasksBadge"); b.hidden = !soon; b.textContent = soon;
}
function renderTasks(){
  const list = $("tasksList"), done = $("doneList");
  if(!S.tasks){ list.innerHTML = `<div class="empty">טוען…</div>`; done.innerHTML=""; loadTasks(); return; }
  const now = new Date();
  const models = S.tasks.due.map(taskModel).sort((a,b)=>a.due-b.due);
  const open = models.filter(m=>!m.done && evEnd(m.ev) > addDays(now,-1));
  const closed = models.filter(m=>m.done).reverse();
  list.innerHTML = open.length ? "" : `<div class="empty"><b>אין מבחנים או משימות פתוחים</b>לחץ על + וכתוב למשל "עבודה באנגלית ל-25.10"</div>`;
  open.forEach(m=>list.appendChild(taskRow(m)));
  $("doneHead").hidden = !closed.length; $("doneHead").textContent = `הושלמו (${closed.length})`;
  done.innerHTML = ""; closed.forEach(m=>done.appendChild(taskRow(m)));
}
function taskRow(m){
  const now = new Date();
  const days = Math.round((midnight(m.due) - midnight(now))/864e5);
  const total = m.sessions.length, past = m.sessions.filter(s=>evEnd(s) < now).length;
  const conflicts = m.sessions.filter(s=>evStart(s)>now && hasConflict(s)).length;
  const subj = m.subject && SUBJ[m.subject] ? ` · ${esc(SUBJ[m.subject].short||SUBJ[m.subject].n)}` : "";
  const el = document.createElement("div"); el.className = `ti${days<=2&&!m.done?" soon":""}${m.done?" done":""}`;
  el.innerHTML = `
    <div class="dd num">${m.done?"<b>✓</b>":days<=0?`<b>${days===0?"היום":"עבר"}</b>`:days===1?"<b>מחר</b>":`<b>${days}</b><span>ימים</span>`}</div>
    <div style="min-width:0">
      <div class="tt"><i style="--c:${GC["11"]}"></i>${esc(m.ev.summary)}</div>
      <div class="ts num">${esc(pretty(m.due))}${m.allDay?"":" · "+hm(m.due)}${subj}</div>
      ${total?`<div class="prog"><i style="width:${past/total*100}%"></i></div>
      <div class="ses">${m.sessions.map(s=>`<div class="${evEnd(s)<now?"past":""}"><span class="num">הכנה: ${esc(shortDate(evStart(s)))} · ${R(hm(evStart(s)),hm(evEnd(s)))}</span></div>`).join("")}</div>`:""}
      ${conflicts?`<div class="warn-l">${conflicts===1?"זמן הכנה אחד מתנגש":conflicts+" זמני הכנה מתנגשים"} עם אירוע אחר</div>`:""}
      <div class="acts">
        <button type="button" class="tb ok" data-a="done">${m.done?"החזר לפתוחות":"סיימתי"}</button>
        ${!m.done?`<button type="button" class="tb" data-a="replan">${total?"תכנן מחדש":"שבץ הכנה"}</button>`:""}
        <button type="button" class="tb" data-a="open">פרטים</button>
      </div>
    </div>`;
  el.querySelector('[data-a="done"]').onclick = ()=>toggleDone(m);
  el.querySelector('[data-a="replan"]')?.addEventListener("click", e=>replan(m, e.currentTarget));
  el.querySelector('[data-a="open"]').onclick = ()=>openEvent(m.ev);
  return el;
}
async function toggleDone(m){
  try{
    await cal.patch(m.ev.id, { extendedProperties:{ private:{ ...priv(m.ev), scDone: m.done?"0":"1" } } });
    toast(m.done?"הוחזר לפתוחות":"סומן כהושלם. כל הכבוד!");
    S.tasks = null; await loadTasks(); refresh();
  }catch(e){ toast(errText(e)); }
}

/* ================= vacations view ================= */
async function renderVac(){
  const v = $("view-vac"); const now = new Date(), nowK = ymd(now);
  const list = upcomingVacations(now, 12);
  let added = new Set();
  try{ if(!(cal.mode==="google" && !cal.ready())) (await cal.list(addDays(now,-1), addDays(now,330), { privateProp:"scKind=vac" })).forEach(e=>added.add(priv(e).scVac)); }catch{}
  const missing = list.filter(x=>!added.has(x.name) && x.from > nowK);
  let h = `<div class="vhead"><p>לפי לוח החופשות של משרד החינוך לשנת תשפ״ז (חטיבה עליונה). בימי חופשה בית הספר יורד מהיומן, והזמן נחשב פנוי לשיבוץ.</p>
    ${missing.length?`<button type="button" class="tb fill" id="vacRem">תזכיר לי לפני כל חופשה</button>`:`<span class="okline">${I.bell} התזכורות לחופשות כבר ביומן</span>`}</div>`;
  for(const x of list){
    const n = daysUntil(x.from), on = x.from <= nowK, len = vacationDays(x);
    const brs = bridges().filter(b=>b.vacation===x.name);
    h += `<div class="vi${on?" on":""}">
      <div class="vt"><b>${esc(x.name)}</b><span class="vc num">${on?"עכשיו":n===1?"מחר":`בעוד ${n} ימים`}</span></div>
      <div class="vs num">${rangeTxt(x.from,x.to)} · ${len===1?"יום אחד":len+" ימים"}</div>
      ${brs.map(b=>{ const tests = testsOn(b.skip), miss = lessonsMissed(b.skip);
        return `<div class="br"><div class="brh">גשר: ${b.total} ימים רצוף במקום ${b.already}</div>
          <div class="brs num">אם תוותר על ${b.skip.map(k=>`${DAYS_S[parseYmd(k).getDay()]} ${dm(k)}`).join(" ו־")} (${miss} שיעורים) תהיה בחופש ${rangeTxt(b.from,b.to)}.</div>
          ${tests.length?`<div class="warn-l">שים לב: ${tests.map(t=>esc(t.summary)).join(", ")} ביום הזה</div>`:""}</div>`; }).join("")}
    </div>`;
  }
  v.innerHTML = h;
  $("vacRem")?.addEventListener("click", async e=>{
    const b = e.currentTarget; b.disabled = true; b.textContent = "מוסיף…";
    try{
      for(const x of missing){
        const start = parseYmd(x.from);
        const rem = [minutesBefore(start, 7, "18:00"), minutesBefore(start, 1, "18:00")].filter(m=> start - m*60000 > now);
        await cal.insert({ summary:`חופשה: ${x.name}`, colorId:"2", start:{ date:x.from }, end:{ date: ymd(addDays(parseYmd(x.to),1)) }, transparency:"transparent",
          reminders: remindersFor(rem), description:"לפי לוח החופשות של משרד החינוך\n\nנוצר ביומן החכם",
          extendedProperties:{ private:{ sc:"1", scKind:"vac", scVac:x.name } } });
      }
      toast(`נוספו ${missing.length} תזכורות לחופשות`); refresh(); renderVac();
    }catch(err){ toast(errText(err)); b.disabled=false; b.textContent="תזכיר לי לפני כל חופשה"; }
  });
}

/* ================= planning ================= */
async function busyBetween(from, to, excludeTask){
  const evs = await cal.list(from, to);
  const busy = evs.filter(e=>!isAllDay(e) && !(isSchool(e) && OFF_DAYS.has(ymd(evStart(e)))) && !(excludeTask && priv(e).scTask===excludeTask && kindOf(e)==="prep"))
    .map(e=>({ start:evStart(e), end:evEnd(e), kind: kindOf(e), title:e.summary }));
  const deadlines = evs.filter(e=>kindOf(e)==="due" && priv(e).scDone!=="1" && priv(e).scTask!==excludeTask).map(evStart);
  return { busy, deadlines };
}
async function replan(m, btn){
  if(btn){ btn.disabled = true; btn.textContent = "מחשב…"; }
  try{
    const now = new Date();
    const future = m.sessions.filter(s=>evStart(s) > now);
    const pastN = m.sessions.length - future.length;
    const p = priv(m.ev);
    const want = Math.max(1, (Number(p.scPrep)||future.length||1) - pastN);
    const { busy, deadlines } = await busyBetween(now, addDays(m.due,1), m.id);
    const left = Math.max(1, Math.round((midnight(m.due)-midnight(now))/864e5));
    const days = Math.min(left, Math.max(1, Number(p.scWin)||left));
    const res = plan({ due:m.due, dueAllDay:m.allDay, sessions:want, minutes:Number(p.scMin)||60, windowDays:days, kind:m.subtype }, busy, { now, prefs:prefs(), otherDeadlines:deadlines, offDays:OFF_DAYS });
    if(!res.sessions.length){ toast(res.warnings[0]||"לא מצאתי זמן פנוי"); return; }
    for(const s of future) await cal.remove(s.id);
    for(const s of res.sessions) await cal.insert(prepBody(m.ev.summary, m.id, s, m.due));
    toast(res.sessions.length===1 ? "שובץ זמן הכנה חדש" : `שובצו ${res.sessions.length} זמני הכנה חדשים`);
    S.tasks = null; await loadTasks(); refresh();
  }catch(e){ toast(errText(e)); }
  finally{ if(btn){ btn.disabled=false; btn.textContent="תכנן מחדש"; } }
}
async function moveSession(ev){
  const p = priv(ev);
  const dueEv = (S.tasks?.due||[]).find(d=>priv(d).scTask===p.scTask);
  if(!dueEv){ toast("לא מצאתי את המשימה של זמן ההכנה הזה"); return; }
  const now = new Date(); const due = evStart(dueEv);
  const { busy, deadlines } = await busyBetween(now, addDays(due,1));
  const mine = busy.filter(b=>!(b.start.getTime()===evStart(ev).getTime() && b.kind==="prep"));
  mine.push({ start: evStart(ev), end: evEnd(ev), kind:"x" });
  const len = Math.round((evEnd(ev)-evStart(ev))/60000);
  const left = Math.max(1,Math.round((midnight(due)-midnight(now))/864e5));
  const res = plan({ due, dueAllDay:isAllDay(dueEv), sessions:1, minutes:len, windowDays:Math.min(left, Math.max(1, Number(priv(dueEv).scWin)||left)), kind:priv(dueEv).scSubtype }, mine, { now, prefs:prefs(), otherDeadlines:deadlines, offDays:OFF_DAYS });
  if(!res.sessions.length){ toast("לא מצאתי זמן אחר לפני המועד"); return; }
  const s = res.sessions[0];
  await cal.patch(ev.id, { start:{ dateTime:`${s.date}T${s.start}:00`, timeZone:TZ }, end:{ dateTime:`${s.date}T${s.end}:00`, timeZone:TZ } });
  const nd = parseYmd(s.date); toast(`הוזז ל${rel(nd)||"יום "+DAYS[nd.getDay()]} ${nd.getDate()}.${nd.getMonth()+1} ב־${s.start}`);
  closeSheet(); S.tasks=null; loadTasks(); refresh();
}

/* ================= creating events ================= */
function remindersFor(minutes){
  const list = [...new Set(minutes.filter(m=>Number.isFinite(m) && m>=0 && m<=40320).map(Math.round))].slice(0,5);
  return { useDefault:false, overrides: list.map(m=>({ method:"popup", minutes:m })) };
}
function minutesBefore(target, daysBefore, hhmm){
  const d = addDays(midnight(target), -daysBefore); const [h,m] = hhmm.split(":").map(Number); d.setHours(h,m,0,0);
  return Math.round((target - d)/60000);
}
function timeFields(date, start, end){
  if(!start) return { start:{ date }, end:{ date: ymd(addDays(parseYmd(date),1)) } };
  return { start:{ dateTime:`${date}T${start}:00`, timeZone:TZ }, end:{ dateTime:`${date}T${end}:00`, timeZone:TZ } };
}
function prepBody(title, taskId, s, due){
  return { summary:`הכנה: ${title}`, colorId:"5", ...timeFields(s.date, s.start, s.end),
    description: `זמן הכנה ל${title} (${pretty(due)})${s.reasons?.length?"\nלמה כאן: "+s.reasons.join(", "):""}\n\nנוצר ביומן החכם`,
    reminders: remindersFor([10]), extendedProperties:{ private:{ sc:"1", scKind:"prep", scTask:taskId } } };
}
async function createFromDraft(d){
  const created = [];
  const now = new Date();
  const target = d.start ? at(d.date, d.start) : parseYmd(d.date);
  try{
    if(d.kind==="deadline"){
      const taskId = "t"+Date.now().toString(36);
      const rem = [];
      if(!d.noRemind){
        if(d.remindDays>0) rem.push(minutesBefore(target, d.remindDays, "18:00"));
        rem.push(minutesBefore(target, 1, "18:00"));
        if(d.start) rem.push(60);
      }
      const futureRem = rem.filter(m=> target - m*60000 > now);
      const main = await cal.insert({ summary:d.title, colorId:"11", ...timeFields(d.date, d.start, d.end),
        description:`${d.note?d.note+"\n\n":""}נוצר ביומן החכם`, reminders: remindersFor(futureRem),
        extendedProperties:{ private:{ sc:"1", scKind:"due", scTask:taskId, scSubtype:d.subtype||"", scSubject:d.subject||"", scPrep:String(d.sessions.length), scMin:String(d.minutes||60), scWin:String(Math.max(1,d.windowDays||1)) } } });
      created.push(main.id);
      for(const s of d.sessions){ const ev = await cal.insert(prepBody(d.title, taskId, s, target)); created.push(ev.id); }
    } else {
      let rem = [];
      if(!d.noRemind){
        if(d.remindMinutes!=null) rem.push(d.remindMinutes);
        if(d.remindDays) rem.push(minutesBefore(target, d.remindDays, "18:00"));
        if(!rem.length) rem.push(d.start ? 30 : minutesBefore(target,1,"18:00"));
      }
      const body = { summary:d.title, ...timeFields(d.date, d.start, d.end), reminders: remindersFor(rem),
        description:"נוצר ביומן החכם", extendedProperties:{ private:{ sc:"1", scKind:"event" } } };
      if(d.rrule) body.recurrence = [d.rrule];
      const ev = await cal.insert(body); created.push(ev.id);
    }
  }catch(e){ if(created.length) e.partial = created; throw e; }
  return created;
}

/* ================= composer ================= */
let draft = null, busyCache = null, cmpTimer = null, overrides = {}, showPrepCtl = false;
const EXAMPLES = ["מבחן בהיסטוריה ביום חמישי הבא","עבודה באנגלית ל-25.10, תזכיר 5 ימים לפני","תרגיל במתמטיקה למחר","בוחן בתנ״ך בשיעור הבא","רכיבה עם אבא בשבת ב-7 בבוקר","כדורגל כל יום שלישי ב-6"];
function quickChips(r){
  const t = r ? r.tokens.map(x=>x.type) : [];
  const out = [];
  if(!r) return ["מבחן ב","עבודה ב","תרגיל ב","היום","מחר"];
  if(!t.includes("date")) out.push("היום","מחר","מחרתיים","ביום ראשון","בשבוע הבא");
  if(!t.includes("time") && r.kind!=="deadline") out.push("ב-16:00","ב-18:00","בערב");
  if(!t.includes("remind")) out.push(r.kind==="deadline" ? "תזכיר 3 ימים לפני" : "תזכיר שעה לפני");
  if(r.kind==="deadline" && !t.includes("prep")) out.push("בלי הכנה");
  return out.slice(0,7);
}
function openComposer({ prefill="" } = {}){
  overrides = {}; draft = null; showPrepCtl = false;
  openSheet(`
    <div class="sh-bar"><button class="ib" type="button" data-close aria-label="סגור">${I.x}</button><span class="grow"></span><button type="button" class="save" id="addBtn" disabled>שמור</button></div>
    <div class="cmp-body">
      <textarea class="nl" id="cmpIn" rows="1" placeholder="מה יש לך?" enterkeyhint="done" autocomplete="off"></textarea>
      <div class="echo" id="echo"></div>
      <div class="qchips" id="qch"></div>
      <div id="pv"></div>
      <div class="exs" id="exs"><div class="exl">לדוגמה</div>${EXAMPLES.map(x=>`<button type="button" class="ex">${esc(x)}</button>`).join("")}</div>
    </div>`, { full:true });
  const inp = $("cmpIn");
  inp.value = prefill;
  inp.addEventListener("input", ()=>{ overrides = {}; autosize(inp); clearTimeout(cmpTimer); cmpTimer = setTimeout(updateDraft, 120); });
  inp.addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); if(!$("addBtn").disabled) $("addBtn").click(); } });
  document.querySelectorAll("#exs .ex").forEach(b=>b.onclick=()=>{ inp.value = b.textContent; overrides={}; autosize(inp); updateDraft(); });
  $("addBtn").onclick = commitDraft;
  setTimeout(()=>{ inp.focus(); const n = inp.value.length; inp.setSelectionRange(n,n); }, 80);
  autosize(inp);
  busyCache = null;
  const now = new Date();
  busyBetween(now, addDays(now,75)).then(b=>{ busyCache = b; updateDraft(); }).catch(e=>{ busyCache = { busy:[], deadlines:[], error:e }; updateDraft(); });
  updateDraft();
}
function autosize(t){ t.style.height="auto"; t.style.height = Math.min(Math.max(t.scrollHeight, 44),160)+"px"; }
function appendText(s){
  const inp = $("cmpIn"); if(!inp) return;
  const v = inp.value.replace(/\s+$/,"");
  inp.value = (v ? v+" " : "") + s + (/ב$/.test(s) ? "" : " ");
  overrides = {}; autosize(inp); updateDraft(); inp.focus();
  const n = inp.value.length; inp.setSelectionRange(n,n);
}
function echoHtml(text, tokens){
  const tk = [...tokens].filter(t=>t.e>t.s && t.type!=="filler").sort((a,b)=>a.s-b.s);
  let out = "", pos = 0;
  for(const t of tk){ if(t.s < pos) continue; out += esc(text.slice(pos,t.s)) + `<mark class="${t.type}">${esc(text.slice(t.s,t.e))}</mark>`; pos = t.e; }
  return out + esc(text.slice(pos));
}
function updateDraft(){
  const inp = $("cmpIn"); if(!inp) return;
  const text = inp.value.trim();
  $("exs").hidden = !!text;
  const renderQ = r => { $("qch").innerHTML = quickChips(r).map(c=>`<button type="button" class="qc">${esc(c)}</button>`).join("");
    $("qch").querySelectorAll(".qc").forEach(b=>b.onclick=()=>appendText(b.textContent)); };
  if(!text){ $("echo").innerHTML = ""; $("pv").innerHTML = ""; $("addBtn").disabled = true; draft = null; renderQ(null); return; }
  const now = new Date();
  const r = parse(inp.value, now);
  $("echo").innerHTML = r.tokens.some(t=>t.type!=="filler") ? echoHtml(inp.value, r.tokens) : "";
  renderQ(r);
  const d = {
    title: r.title, kind: overrides.kind ?? r.kind, subtype: r.subtype?.key || (overrides.kind==="deadline"?"homework":null), subLabel: r.subtype?.label || "משימה",
    subject: r.subject, date: overrides.date ?? r.date, start: overrides.start !== undefined ? overrides.start : r.start, end: r.end,
    rrule: r.rrule || null, remindDays: overrides.remindDays ?? r.remindDays, remindMinutes: r.remindMinutes, noRemind: r.noRemind,
    sessions: [], warnings: [...r.warnings], ambiguous: r.ambiguousHour, recurrence: r.recurrence, note:"",
  };
  if(overrides.start !== undefined && d.start){ const len = r.start && r.end ? toMin(r.end)-toMin(r.start) : 60; d.end = fromMin(Math.min(toMin(d.start)+len, 23*60+59)); }
  if(!d.start) d.end = null;
  if(d.date && d.date !== r.date) d.warnings = d.warnings.filter(w=>!/תאריך/.test(w));
  if(d.kind==="deadline"){
    const base = r.prep || { count: 1, minutes: 45, windowDays: 2 };
    d.count = overrides.count ?? base.count;
    d.minutes = overrides.minutes ?? base.minutes;
    d.windowDays = overrides.remindDays ?? base.windowDays;
    if(d.date){
      const target = d.start ? at(d.date, d.start) : parseYmd(d.date);
      if(target < now) d.warnings.push("התאריך הזה כבר עבר");
      else if(d.count>0 && busyCache){
        const res = plan({ due:target, dueAllDay:!d.start, sessions:d.count, minutes:d.minutes, windowDays:Math.max(1,d.windowDays), kind:d.subtype }, busyCache.busy, { now, prefs:prefs(), otherDeadlines:busyCache.deadlines, offDays:OFF_DAYS });
        d.sessions = res.sessions; d.warnings.push(...res.warnings);
      }
    }
  }
  draft = d;
  renderPreview(d);
}
function remindText(d){
  if(d.noRemind) return "בלי תזכורת";
  if(d.kind==="deadline") return d.remindDays>1 ? `${d.remindDays} ימים לפני, וגם ערב לפני` : "ערב לפני ב־18:00";
  if(d.remindMinutes!=null) return d.remindMinutes>=60 ? `${d.remindMinutes===60?"שעה":d.remindMinutes/60+" שעות"} לפני` : `${d.remindMinutes} דקות לפני`;
  if(d.remindDays) return `${d.remindDays===1?"יום":d.remindDays+" ימים"} לפני`;
  return d.start ? "30 דקות לפני" : "ערב לפני ב־18:00";
}
function renderPreview(d){
  const pv = $("pv");
  const dt = d.date ? parseYmd(d.date) : null;
  const whenTxt = dt ? `${pretty(dt)}${rel(dt)?` (${rel(dt)})`:""}` : "בחר תאריך";
  let prep = "";
  if(d.kind==="deadline" && d.date){
    const head = d.count===0 ? "בלי זמני הכנה" : !busyCache ? "מחפש זמן פנוי…" : d.sessions.length===1 ? "זמן הכנה אחד ביומן" : `${d.sessions.length} זמני הכנה ביומן`;
    prep = `<div class="frow prep" style="display:block">
      <div class="prep-h"><span style="display:flex;gap:14px;align-items:center">${I.book}<b>${esc(head)}</b></span><button type="button" class="tlink" id="prepCtl">${showPrepCtl?"סגור":"שנה"}</button></div>
      ${showPrepCtl?`<div class="ctl">${stepper("c","כמה פעמים", d.count===0?"אף פעם":d.count)}${stepper("m","כמה זמן", d.minutes+" דק׳")}${stepper("w","מתחיל", d.windowDays+" ימים לפני")}</div>`:""}
      ${!busyCache && d.count>0 ? `<div class="thinking"><span class="spin"></span>בודק את היומן שלך…</div>` : ""}
      ${d.sessions.length?`<div class="slots">${d.sessions.map(s=>{ const sd = parseYmd(s.date);
        return `<div class="slot"><div><b class="num">${esc(rel(sd)||("יום "+DAYS[sd.getDay()]))} ${sd.getDate()}.${sd.getMonth()+1} · ${R(s.start,s.end)}</b>${s.reasons?.length?`<small>${esc(s.reasons.join(" · "))}</small>`:""}</div></div>`; }).join("")}</div>`:""}
    </div>`;
  }
  pv.innerHTML = `
    <div class="frow">${I.text}<div class="fv"><small>כותרת</small>${esc(d.title)}</div></div>
    <label class="frow">${I.clock}<div class="fv"><small>מתי</small>${esc(whenTxt)}</div><input type="date" id="chDate" value="${d.date||""}"></label>
    <div class="frow"><span style="width:24px"></span><label class="fv" style="position:relative"><small>שעה</small><span class="num">${d.start?R(d.start,d.end):"כל היום"}</span><input type="time" id="chTime" value="${d.start||""}"></label>
      ${d.start && d.ambiguous?`<button type="button" class="tlink" id="chFlip">${toMin(d.start)>=720?"התכוונת בבוקר?":"התכוונת בערב?"}</button>`:d.start?`<button type="button" class="tlink" id="chAllDay">כל היום</button>`:""}</div>
    <button type="button" class="frow" id="chKind">${I.flag}<div class="fv"><small>סוג</small>${d.kind==="deadline"?esc(d.subLabel)+" (צריך להתכונן)":"אירוע רגיל"}</div><span class="tlink">החלף</span></button>
    ${d.subject && SUBJ[d.subject]?`<div class="frow">${I.school}<div class="fv"><small>מקצוע</small>${esc(SUBJ[d.subject].short||SUBJ[d.subject].n)}</div></div>`:""}
    <div class="frow">${I.bell}<div class="fv"><small>תזכורת</small>${esc(remindText(d))}</div></div>
    ${d.recurrence?`<div class="frow">${I.repeat}<div class="fv"><small>חוזר</small>${d.recurrence==="daily"?"כל יום":"כל שבוע"}</div></div>`:""}
    ${prep}
    ${d.warnings.length?[...new Set(d.warnings)].map(w=>`<div class="warn-l">${esc(w)}</div>`).join(""):""}`;
  bindChips(d);
  $("addBtn").disabled = !d.date;
}
function stepper(id, label, val){
  return `<div class="stp"><span class="sl">${label}</span><div class="sr"><button type="button" id="${id}Plus" aria-label="יותר">+</button><span class="sv num">${val}</span><button type="button" id="${id}Minus" aria-label="פחות">−</button></div></div>`;
}
function bindChips(d){
  const on = (id, fn) => { const el = $(id); if(el) el.addEventListener(el.tagName==="INPUT"?"change":"click", fn); };
  on("chDate", e=>{ if(e.target.value){ overrides.date = e.target.value; updateDraft(); } });
  on("chTime", e=>{ overrides.start = e.target.value || null; updateDraft(); });
  on("chFlip", ()=>{ const m = toMin(d.start); overrides.start = fromMin(m>=720 ? m-720 : m+720); updateDraft(); });
  on("chAllDay", ()=>{ overrides.start = null; updateDraft(); });
  on("chKind", ()=>{ overrides.kind = d.kind==="deadline" ? "event" : "deadline"; updateDraft(); });
  on("prepCtl", ()=>{ showPrepCtl = !showPrepCtl; updateDraft(); });
  on("cMinus", ()=>{ overrides.count = Math.max(0, d.count-1); updateDraft(); });
  on("cPlus", ()=>{ overrides.count = Math.min(8, d.count+1); updateDraft(); });
  on("mMinus", ()=>{ overrides.minutes = Math.max(30, d.minutes-15); updateDraft(); });
  on("mPlus", ()=>{ overrides.minutes = Math.min(180, d.minutes+15); updateDraft(); });
  on("wMinus", ()=>{ overrides.remindDays = Math.max(1, d.windowDays-1); updateDraft(); });
  on("wPlus", ()=>{ overrides.remindDays = Math.min(28, d.windowDays+1); updateDraft(); });
}
async function commitDraft(){
  const d = draft; if(!d || !d.date) return;
  if(cal.mode==="google" && !cal.ready()){ toast("צריך להתחבר ליומן גוגל קודם"); return; }
  const btn = $("addBtn"); btn.disabled = true; btn.textContent = "שומר…";
  try{
    const ids = await createFromDraft(d);
    closeSheet();
    toast(d.kind==="deadline" && d.sessions.length ? (d.sessions.length===1 ? "נשמר, עם זמן הכנה אחד" : `נשמר, עם ${d.sessions.length} זמני הכנה`) : "נשמר",
      { undo: async()=>{ for(const id of ids) await cal.remove(id).catch(()=>{}); S.tasks=null; loadTasks(); refresh(); toast("בוטל"); } });
    S.sel = parseYmd(d.date); S.month = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1);
    S.tasks = null; loadTasks(); S.weeks.clear();
    if(S.view==="tasks") renderTasks(); else setView(S.view==="month"?"month":"day");
    refresh();
  }catch(e){
    btn.disabled = false; btn.textContent = "שמור";
    toast((e.partial?`חלק נשמר (${e.partial.length}). `:"") + errText(e));
  }
}

/* ================= event sheet ================= */
const objectUrls = [];
async function openEvent(ev){
  const k = kindOf(ev), p = priv(ev), s = evStart(ev), e = evEnd(ev);
  const when = isAllDay(ev) ? `${esc(pretty(s))} · כל היום` : `${esc(pretty(s))} · ${R(hm(s),hm(e))}`;
  if(!S.tasks && (k==="due"||k==="prep")) await loadTasks();
  const task = k==="due" ? taskModel(ev) : null;
  const userDesc = ev.description && !/נוצר ביומן החכם/.test(ev.description) ? ev.description.replace(/<[^>]+>/g," ") : (k==="prep" ? (ev.description||"").replace(/\n*נוצר ביומן החכם/,"") : "");
  const c = evColor(ev);
  const rems = (ev.reminders?.overrides||[]).map(r=>r.minutes).sort((a,b)=>b-a);
  const remTxt = rems.length ? rems.map(m=>{ const t = new Date(s.getTime()-m*60000);
    if(ymd(t)===ymd(s) && !isAllDay(ev)) return m>=60 ? `${m===60?"שעה":(m%60?dur(m):Math.round(m/60)+" שעות")} לפני` : `${m} דקות לפני`;
    const dd = Math.round((midnight(s)-midnight(t))/864e5);
    return `${dd===1?"ערב לפני":dd+" ימים לפני"} ב־${hm(t)}`; }).join(" · ") : "";
  openSheet(`
    <div class="grab"></div>
    <div class="sh-bar"><button class="ib" type="button" data-close aria-label="סגור">${I.x}</button><span class="grow"></span>${isApp(ev)?`<button class="ib" type="button" id="delBtn" aria-label="מחק">${I.trash}</button>`:""}</div>
    <div class="ev-title" style="--c:${c}"><i></i><h3>${esc(ev.summary||"(ללא כותרת)")}</h3></div>
    <div class="ev-when num">${when}</div>
    ${task && task.sessions.length?`<div class="srow">${I.book}<div class="sc"><div class="sl">זמני הכנה</div>${task.sessions.map(x=>`<div class="num">${esc(shortDate(evStart(x)))} · ${R(hm(evStart(x)),hm(evEnd(x)))}</div>`).join("")}</div></div>`:""}
    ${isSchool(ev)?`<div class="srow">${I.school}<div class="sc"><div class="sl">המערכת</div><div class="les-list">${lessonBlocks(s.getDay()).map(b=>`<div><span class="num">${b.start}</span>${esc(SUBJ[b.s].n)} <span style="min-width:0">${esc(SUBJ[b.s].t)}</span></div>`).join("")}</div></div></div>`:""}
    ${remTxt?`<div class="srow">${I.bell}<div class="sc"><div class="sl">תזכורות</div>${esc(remTxt)}</div></div>`:""}
    ${userDesc?`<div class="srow">${I.text}<div class="sc"><div class="desc">${esc(userDesc.trim())}</div></div></div>`:""}
    <div class="srow">${I.note}<div class="sc"><textarea class="note" id="noteBox" placeholder="הוסף הערה"></textarea><div class="saved" id="savedMsg"></div></div></div>
    <div class="srow">${I.cam}<div class="sc"><div class="photos" id="photoGrid"></div></div></div>
    <div class="sacts" id="evActs"></div>
  `);
  const n = await noteStore.get(ev.id) || { id: ev.id, text:"", photos:[] };
  const box = $("noteBox"); if(!box) return;
  box.value = n.text || "";
  let tmr = null;
  const save = async()=>{ clearTimeout(tmr); tmr=null; const cur = await noteStore.get(ev.id) || { id:ev.id, photos:[] };
    if((cur.text||"")===box.value) return; await noteStore.put({ ...cur, id:ev.id, text:box.value, title:ev.summary });
    const m = $("savedMsg"); if(m) m.textContent = "נשמר בטלפון"; await loadNotesIdx(); };
  box.addEventListener("input", ()=>{ $("savedMsg").textContent=""; clearTimeout(tmr); tmr=setTimeout(save,600); });
  sheetCleanup = ()=>{ if(tmr) save().then(scheduleRender); };
  renderPhotos(ev);
  const acts = $("evActs");
  const add = (label, cls, fn) => { const b = document.createElement("button"); b.type="button"; b.className="tb "+cls; b.textContent=label; b.onclick=()=>fn(b); acts.appendChild(b); return b; };
  if(task){
    add(task.done?"החזר לפתוחות":"סיימתי", "ok", async b=>{ b.disabled=true; await toggleDone(task); closeSheet(); });
    if(!task.done) add(task.sessions.length?"תכנן הכנה מחדש":"שבץ זמני הכנה", "", async b=>{ await replan(task, b); closeSheet(); });
  }
  if(k==="prep") add("הזז לזמן אחר", "", async b=>{ b.disabled=true; b.textContent="מחפש…"; try{ await moveSession(ev); }catch(e){ toast(errText(e)); b.disabled=false; b.textContent="הזז לזמן אחר"; } });
  if(!isApp(ev) && ev.htmlLink){ const a = document.createElement("a"); a.className="tb"; a.href=ev.htmlLink; a.target="_blank"; a.rel="noopener"; a.textContent="פתח ביומן גוגל"; a.style.textDecoration="none"; acts.appendChild(a); }
  if(!acts.children.length) acts.remove();
  const del = $("delBtn");
  if(del){ let armed = false;
    del.onclick = async()=>{
      if(!armed){ armed = true; toast(task&&task.sessions.length ? "לחץ שוב על הפח כדי למחוק, כולל זמני ההכנה" : "לחץ שוב על הפח כדי למחוק"); return; }
      del.disabled = true;
      try{
        const ids = [ev.recurringEventId || ev.id, ...(task ? task.sessions.map(x=>x.id) : [])];
        for(const id of ids) await cal.remove(id);
        await noteStore.del(ev.id).catch(()=>{});
        closeSheet(); toast("נמחק"); S.tasks=null; loadTasks(); refresh();
      }catch(e){ del.disabled=false; armed=false; toast("המחיקה נכשלה. "+errText(e)); }
    };
  }
}
async function renderPhotos(ev){
  const grid = $("photoGrid"); if(!grid) return;
  objectUrls.splice(0).forEach(u=>URL.revokeObjectURL(u));
  const n = await noteStore.get(ev.id) || { photos:[] };
  grid.innerHTML = "";
  for(const pid of (n.photos||[])){
    const blob = await photoStore.get(pid); if(!blob) continue;
    const url = URL.createObjectURL(blob); objectUrls.push(url);
    const b = document.createElement("button"); b.type="button"; b.className="ph"; b.innerHTML = `<img alt="" src="${url}">`;
    b.onclick = ()=>openLightbox(ev, pid, url); grid.appendChild(b);
  }
  const add = document.createElement("label"); add.className="addph";
  add.innerHTML = `${I.cam}<span>הוסף תמונה</span><input type="file" accept="image/*" multiple>`;
  add.querySelector("input").onchange = async e=>{
    const files = [...e.target.files]; e.target.value = "";
    add.querySelector("span").textContent = "שומר…";
    for(const f of files){
      try{ const blob = await shrink(f); const id = await photoStore.put(blob);
        const cur = await noteStore.get(ev.id) || { id:ev.id, text:"", photos:[] };
        await noteStore.put({ ...cur, id:ev.id, photos:[...(cur.photos||[]), id], title:ev.summary }); }
      catch{ toast("לא הצלחתי לשמור את התמונה"); }
    }
    await loadNotesIdx(); renderPhotos(ev); scheduleRender();
  };
  grid.appendChild(add);
}
async function shrink(file){
  try{
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800/Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width*k); c.height = Math.round(bmp.height*k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r=>c.toBlob(b=>r(b||file), "image/jpeg", .85));
  }catch{ return file; }
}
function openLightbox(ev, pid, url){
  const lb = $("lightbox");
  lb.innerHTML = `<img alt="" src="${url}"><div class="acts"><button type="button" class="tb" id="lbX">סגור</button><button type="button" class="tb danger" id="lbDel">מחק תמונה</button></div>`;
  lb.hidden = false;
  $("lbX").onclick = ()=>{ lb.hidden = true; };
  let armed = false;
  $("lbDel").onclick = async()=>{ const b = $("lbDel");
    if(!armed){ armed = true; b.textContent = "בטוח? לחץ שוב"; return; }
    const cur = await noteStore.get(ev.id); if(cur){ await noteStore.put({ ...cur, photos:(cur.photos||[]).filter(x=>x!==pid) }); }
    await photoStore.del(pid).catch(()=>{}); lb.hidden = true; await loadNotesIdx(); renderPhotos(ev); scheduleRender(); };
}

/* ================= settings ================= */
function renderSettings(){
  const v = $("view-settings"); const p = prefs();
  const hasClient = !!auth.clientId(), connected = cal.mode==="google" && cal.ready();
  const demoOn = cal.mode==="demo";
  v.innerHTML = `
  ${window.YOMAN_PREVIEW?`<div class="set"><h3>תצוגה מקדימה</h3><p>זו גרסת הדגמה שרצה בתוך Claude. החיבור ליומן גוגל וההתקנה במסך הבית עובדים בגרסה שתעלה ל־GitHub.</p></div>`:""}
  <div class="set" ${window.YOMAN_PREVIEW?"hidden":""}>
    <h3>יומן גוגל</h3>
    <div class="stat ${connected?"on":""}"><i></i>${connected?"מחובר":demoOn?"לא מחובר (מוצג מצב הדגמה)":"לא מחובר"}</div>
    ${hasClient?`<div class="acts">${connected?`<button type="button" class="tb" id="discBtn">התנתק</button>`:`<button type="button" class="tb fill" id="connBtn">התחבר ליומן גוגל</button>`}</div>`:`
      <p>כדי לחבר את היומן האמיתי צריך פעם אחת ליצור "מזהה חיבור" ב־Google Cloud. זה חינמי ולוקח בערך 15 דקות.</p>
      <ol>
        <li>היכנס ל־console.cloud.google.com וצור פרויקט חדש.</li>
        <li>הפעל את Google Calendar API.</li>
        <li>במסך ההסכמה (OAuth consent screen) בחר External, ובקהל (Audience) הוסף את עצמך כ־Test user.</li>
        <li>צור Credentials מסוג OAuth client ID ← Web application.</li>
        <li>בשדות Authorized JavaScript origins ו־Authorized redirect URIs הדבק את הכתובות שלמטה.</li>
        <li>העתק את ה־Client ID לכאן.</li>
      </ol>`}
    <div class="field"><label>Authorized redirect URI</label><div class="copy"><code id="ruri">${esc(redirectUri())}</code><button type="button" class="tbtn" data-copy="ruri">העתק</button></div></div>
    <div class="field"><label>Authorized JavaScript origin</label><div class="copy"><code id="orig">${esc(location.origin)}</code><button type="button" class="tbtn" data-copy="orig">העתק</button></div></div>
    <div class="field"><label for="cid">Client ID</label><input class="inp" id="cid" dir="ltr" placeholder="xxxx.apps.googleusercontent.com" value="${esc(auth.clientId())}" autocomplete="off" spellcheck="false"></div>
    <div class="acts"><button type="button" class="tb ${hasClient?"":"fill"}" id="saveCid">שמור</button></div>
  </div>
  <div class="set">
    <h3>הרגלי למידה</h3>
    <p>לפי זה המערכת בוחרת זמני הכנה.</p>
    <div class="row2">
      <div class="field"><label for="pE">הכי מוקדם</label><input class="inp num" type="time" id="pE" value="${p.earliest}"></div>
      <div class="field"><label for="pL">לסיים עד</label><input class="inp num" type="time" id="pL" value="${p.latest}"></div>
      <div class="field"><label for="pS">שעה מועדפת</label><input class="inp num" type="time" id="pS" value="${p.sweetSpot}"></div>
      <div class="field"><label for="pA">מנוחה אחרי בית ספר</label><select class="inp" id="pA">${[15,30,45,60,90].map(m=>`<option value="${m}" ${m===p.afterSchool?"selected":""}>${m} דקות</option>`).join("")}</select></div>
    </div>
    <label class="sw"><span>לא לשבץ ביום שישי אחרי 16:00</span><input type="checkbox" class="tog" id="pF" ${p.avoidFriEve?"checked":""}></label>
    <label class="sw"><span>לא לשבץ בשבת<small>רק אם אין ברירה אחרת</small></span><input type="checkbox" class="tog" id="pSat" ${p.avoidSat?"checked":""}></label>
  </div>
  <div class="set">
    <h3>מצב הדגמה</h3>
    <label class="sw"><span>הצג נתוני הדגמה<small>מאפשר לנסות את האפליקציה בלי לחבר את היומן</small></span><input type="checkbox" class="tog" id="demoT" ${settings.get("demo",false)||!hasClient?"checked":""} ${hasClient?"":"disabled"}></label>
    ${demoOn?`<div class="acts" style="margin-bottom:12px"><button type="button" class="tb" id="demoReset">אפס את נתוני ההדגמה</button></div>`:""}
  </div>
  <div class="set">
    <h3>התקנה במסך הבית באייפון</h3>
    <ol><li>פתח את האפליקציה בספארי.</li><li>לחץ על כפתור השיתוף.</li><li>בחר "הוסף למסך הבית".</li></ol>
    <p>ההתראות מגיעות מאפליקציית Google Calendar, אז כדאי שההתראות שלה יהיו פתוחות.</p>
  </div>
  <div class="foot">יומן חכם · גרסה 2.0 · ההערות והתמונות נשמרות רק בטלפון הזה</div>`;
  v.querySelectorAll("[data-copy]").forEach(b=>b.onclick=async()=>{ const t = $(b.dataset.copy).textContent; try{ await navigator.clipboard.writeText(t); toast("הועתק"); }catch{ const r = document.createRange(); r.selectNodeContents($(b.dataset.copy)); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } });
  $("saveCid").onclick = ()=>{ const v2 = $("cid").value.trim();
    if(v2 && !/\.apps\.googleusercontent\.com$/.test(v2)){ toast("זה לא נראה כמו Client ID של גוגל"); return; }
    settings.set("clientId", v2); if(v2) settings.set("demo", false);
    reinit(); toast(v2?"נשמר. עכשיו לחץ 'התחבר ליומן גוגל'":"נמחק"); };
  $("connBtn")?.addEventListener("click", ()=>{ try{ auth.connect(); }catch(e){ toast(errText(e)); } });
  $("discBtn")?.addEventListener("click", ()=>{ auth.disconnect(); reinit(); toast("התנתקת"); });
  const sp = (k, val) => { settings.set("prefs", { ...settings.get("prefs",{}), [k]: val }); };
  $("pE").onchange = e=>sp("earliest", e.target.value||DEFAULT_PREFS.earliest);
  $("pL").onchange = e=>sp("latest", e.target.value||DEFAULT_PREFS.latest);
  $("pS").onchange = e=>sp("sweetSpot", e.target.value||DEFAULT_PREFS.sweetSpot);
  $("pA").onchange = e=>sp("afterSchool", Number(e.target.value));
  $("pF").onchange = e=>sp("avoidFriEve", e.target.checked);
  $("pSat").onchange = e=>sp("avoidSat", e.target.checked);
  $("demoT").onchange = e=>{ settings.set("demo", e.target.checked); reinit(); };
  $("demoReset")?.addEventListener("click", ()=>{ demo.reset(); reinit(); toast("נתוני ההדגמה אופסו"); });
}
function reinit(){ cal = backend(); S.weeks.clear(); S.tasks = null; S.err = null;
  if(cal.mode==="google" && !cal.ready()) S.err = new CalError("auth");
  showBanner(); renderView(); loadVisible(true); loadTasks(); }

/* ================= sheets / drawer / toast / nav ================= */
let sheetCleanup = null;
function openSheet(html, { full=false } = {}){
  $("toast").hidden = true;
  const sh = $("sheet"); sh.className = "sheet"+(full?" full":""); sh.innerHTML = html; sh.hidden = false; $("scrim").hidden = false; sh.scrollTop = 0;
  sh.querySelectorAll("[data-close]").forEach(b=>b.onclick = closeSheet);
  document.body.style.overflow = "hidden";
}
function closeSheet(){
  if(sheetCleanup){ try{ sheetCleanup(); }catch{} sheetCleanup = null; }
  $("sheet").hidden = true; $("scrim").hidden = true; $("sheet").innerHTML = ""; document.body.style.overflow = "";
  objectUrls.splice(0).forEach(u=>URL.revokeObjectURL(u));
}
(function(){ const sh = $("sheet"); let y0=null, dy=0, dragging=false;
  sh.addEventListener("touchstart", e=>{ if(e.target.closest("textarea,input,.cmp-body")) return; if(sh.scrollTop>0 && !e.target.closest(".grab,.sh-bar")) return; y0 = e.touches[0].clientY; dy=0; dragging=false; }, { passive:true });
  sh.addEventListener("touchmove", e=>{ if(y0==null) return; dy = e.touches[0].clientY - y0; if(dy>8){ dragging=true; sh.style.transition="none"; sh.style.transform=`translateY(${dy}px)`; } }, { passive:true });
  sh.addEventListener("touchend", ()=>{ if(y0==null) return; y0=null; sh.style.transition="transform .2s"; if(dragging && dy>110){ sh.style.transform="translateY(100%)"; setTimeout(()=>{ sh.style.transform=""; sh.style.transition=""; closeSheet(); },180); } else sh.style.transform=""; });
})();
function openDrawer(){ $("drawer").hidden = false; $("drawerScrim").hidden = false; }
function closeDrawer(){ $("drawer").hidden = true; $("drawerScrim").hidden = true; }
let toastTimer = null;
function toast(msg, { undo } = {}){
  const t = $("toast"); clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(msg)}</span>${undo?'<button type="button" id="undoBtn">ביטול</button>':""}`; t.hidden = false;
  if(undo) $("undoBtn").onclick = ()=>{ t.hidden = true; undo(); };
  toastTimer = setTimeout(()=>{ t.hidden = true; }, undo ? 6000 : 3000);
}
function renderView(){
  renderBar(); renderMonths();
  if(S.view==="month") renderMonth();
  else if(S.view==="day") renderDay();
}
function setView(v){
  const prev = S.view; S.view = v;
  ["month","day","tasks","settings","vac"].forEach(x=>{ $("view-"+x).hidden = x!==v; });
  if(v!=="month" && v!=="day"){ $("months").hidden = true; $("ttlBtn").classList.remove("open"); }
  if(v==="day") S.month = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1);
  renderView();
  if(v==="tasks") renderTasks();
  if(v==="settings") renderSettings();
  if(v==="vac") renderVac();
  loadVisible();
  if(v==="day") requestAnimationFrame(scrollDayToNow); else if(prev!==v) window.scrollTo(0,0);
}

/* ================= wiring ================= */
$("menuBtn").onclick = openDrawer;
$("drawerScrim").onclick = closeDrawer;
document.querySelectorAll(".dr-i").forEach(b=>b.onclick = ()=>{ closeDrawer(); if(b.dataset.view==="day" && S.view!=="day"){ S.sel = sameMonth(S.month,new Date()) ? midnight(new Date()) : new Date(S.month); } setView(b.dataset.view); });
$("backBtn").onclick = ()=>{ S.month = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1); setView("month"); };
$("ttlBtn").onclick = ()=>{ if(S.view!=="month" && S.view!=="day") return; const m = $("months"); m.hidden = !m.hidden; $("ttlBtn").classList.toggle("open", !m.hidden); renderMonths(); if(S.view==="month") renderMonth(); };
$("todayBtn").onclick = ()=>{ S.sel = midnight(new Date()); S.month = new Date(S.sel.getFullYear(), S.sel.getMonth(), 1); setView(S.view); };
$("fab").onclick = ()=>openComposer({ prefill: S.view==="day" && ymd(S.sel)!==ymd(new Date()) ? `${dayPhrase(S.sel)} ` : "" });
$("scrim").onclick = closeSheet;
document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ if(!$("lightbox").hidden) $("lightbox").hidden = true; else if(!$("sheet").hidden) closeSheet(); else closeDrawer(); } });
function swipe(el, fn){ let x0=null,y0=null;
  el.addEventListener("touchstart", e=>{ x0=e.touches[0].clientX; y0=e.touches[0].clientY; }, { passive:true });
  el.addEventListener("touchend", e=>{ if(x0==null) return; const dx=e.changedTouches[0].clientX-x0, dy=e.changedTouches[0].clientY-y0; x0=null;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5) fn(dx>0?1:-1); }, { passive:true }); }
// RTL: swiping right moves forward in time
swipe($("view-month"), dir=>{ S.month = new Date(S.month.getFullYear(), S.month.getMonth()+dir, 1); renderView(); loadVisible(); });
swipe($("view-day"), dir=>{ S.sel = addDays(S.sel, dir); renderView(); loadVisible(); });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ const w = S.weeks.get(ymd(weekStart(S.sel))); if(!w || Date.now()-w.at > 60000) refresh(); else renderView(); } });
window.addEventListener("resize", ()=>{ if(S.view==="month") renderMonth(); });
setInterval(()=>{ if(!document.hidden && S.view==="day") renderDay(); }, 60000);

/* ================= start ================= */
(async function start(){
  const r = auth.handleRedirect();
  if(r==="ok"){ settings.set("demo", false); toast("מחובר ליומן גוגל"); }
  else if(r && r.startsWith("error:")){
    const code = r.slice(6);
    if(!/interaction_required|login_required|consent_required/.test(code)) toast(code==="access_denied" ? "לא אישרת גישה ליומן" : "ההתחברות לא הצליחה ("+code+")");
  }
  cal = backend();
  if(cal.mode==="google" && !cal.ready()){
    if(auth.trySilent()) return;
    S.err = new CalError("auth");
  }
  showBanner();
  await loadNotesIdx();
  setView("month");
  loadTasks();
  // deep link from a Siri shortcut: ?add=<spoken text>
  const q = new URLSearchParams(location.search).get("add");
  if(q){ history.replaceState(null, "", location.pathname); openComposer({ prefill: q.trim()+" " }); }
  if("serviceWorker" in navigator && location.protocol==="https:" && !window.YOMAN_PREVIEW){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
})();
