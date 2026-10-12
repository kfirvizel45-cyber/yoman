// Google Calendar access: OAuth (redirect flow, works inside an iPhone home-screen app) + REST calls.
// Also a demo backend with the same interface, so the app can be tried without connecting.
import { settings } from "./store.js";
import { lessonBlocks } from "./school.js";

const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const HOLIDAY_CAL = "iw.jewish#holiday@group.v.calendar.google.com";
const TZ = (()=>{ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem"; }catch{ return "Asia/Jerusalem"; } })();

export class CalError extends Error { constructor(code, msg){ super(msg||code); this.code = code; } }

export const redirectUri = () => location.origin + location.pathname;

/* ---------------- auth ---------------- */
export const auth = {
  clientId(){ return settings.get("clientId", ""); },
  token(){ const t = settings.get("token", null); return t && t.exp > Date.now() ? t.access : null; },
  hadToken(){ return !!settings.get("token", null); },
  /** Call once at startup. Returns "ok" | "error:<code>" | null */
  handleRedirect(){
    const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
    if(!/access_token=|error=/.test(h)) return null;
    const q = new URLSearchParams(h);
    let expected = null; try{ expected = sessionStorage.getItem("yoman.state"); }catch{}
    history.replaceState(null, "", location.pathname + location.search);
    if(q.get("state") !== expected) return "error:state";
    if(q.get("error")) return "error:" + q.get("error");
    const scope = q.get("scope") || "";
    if(!scope.includes("calendar")) return "error:scope";
    settings.set("token", { access: q.get("access_token"), exp: Date.now() + (Number(q.get("expires_in"))||3600)*1000 - 120000 });
    try{ sessionStorage.removeItem("yoman.silent"); }catch{}
    return "ok";
  },
  connect({ silent = false } = {}){
    const id = this.clientId(); if(!id) throw new CalError("no_client");
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try{ sessionStorage.setItem("yoman.state", state); if(silent) sessionStorage.setItem("yoman.silent","1"); }catch{}
    const p = new URLSearchParams({ client_id:id, redirect_uri:redirectUri(), response_type:"token", scope:SCOPE,
      include_granted_scopes:"true", state });
    if(silent) p.set("prompt","none");
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
  },
  /** Silent re-login once per session when the 1-hour token ran out. Returns true if a redirect started. */
  trySilent(){
    let tried = false; try{ tried = sessionStorage.getItem("yoman.silent")==="1"; }catch{}
    if(tried || !this.clientId() || !this.hadToken()) return false;
    this.connect({ silent:true }); return true;
  },
  disconnect(){
    const t = settings.get("token", null);
    settings.del("token");
    if(t?.access) fetch("https://oauth2.googleapis.com/revoke?token="+encodeURIComponent(t.access), { method:"POST" }).catch(()=>{});
  },
};

/* ---------------- Google backend ---------------- */
async function g(path, { method="GET", body, query } = {}){
  const tok = auth.token(); if(!tok) throw new CalError("auth");
  const url = API + path + (query ? "?" + new URLSearchParams(query).toString() : "");
  let r;
  try{ r = await fetch(url, { method, headers:{ Authorization:"Bearer "+tok, ...(body?{"Content-Type":"application/json"}:{}) }, body: body?JSON.stringify(body):undefined }); }
  catch{ throw new CalError("network", "אין חיבור לאינטרנט"); }
  if(r.status===401){ settings.set("token", { ...settings.get("token",{}), exp:0 }); throw new CalError("auth"); }
  if(r.status===204 || r.status===410) return null;
  const j = await r.json().catch(()=>null);
  if(!r.ok) throw new CalError(r.status===403?"forbidden":r.status===404?"not_found":"api", j?.error?.message || ("HTTP "+r.status));
  return j;
}
const google = {
  mode: "google",
  ready(){ return !!auth.token(); },
  async list(from, to, { calendarId="primary", privateProp } = {}){
    const out = []; let pageToken;
    do{
      const query = { timeMin:from.toISOString(), timeMax:to.toISOString(), singleEvents:"true", orderBy:"startTime", maxResults:"2500" };
      if(privateProp) query.privateExtendedProperty = privateProp;
      if(pageToken) query.pageToken = pageToken;
      const j = await g(`/calendars/${encodeURIComponent(calendarId)}/events`, { query });
      out.push(...(j?.items||[])); pageToken = j?.nextPageToken;
    } while(pageToken);
    return out.filter(e=>e.status!=="cancelled");
  },
  insert(body){ return g(`/calendars/primary/events`, { method:"POST", body, query:{ sendUpdates:"none" } }); },
  patch(id, body){ return g(`/calendars/primary/events/${encodeURIComponent(id)}`, { method:"PATCH", body, query:{ sendUpdates:"none" } }); },
  remove(id){ return g(`/calendars/primary/events/${encodeURIComponent(id)}`, { method:"DELETE", query:{ sendUpdates:"none" } }).catch(e=>{ if(e.code==="not_found") return null; throw e; }); },
};

/* ---------------- demo backend ---------------- */
const pad = n => String(n).padStart(2,"0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const local = (d, hm) => { const [h,m] = hm.split(":").map(Number); const x = new Date(d); x.setHours(h,m,0,0); return x; };
const iso = d => { // local ISO with offset
  const off = -d.getTimezoneOffset(), s = off>=0?"+":"-", a = Math.abs(off);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${s}${pad(Math.floor(a/60))}:${pad(a%60)}`; };
function demoSeed(){
  const evs = []; const today = new Date(); today.setHours(0,0,0,0);
  const sun = new Date(today); sun.setDate(today.getDate()-today.getDay());
  for(let w=-2; w<10; w++) for(let dow=0; dow<6; dow++){
    const d = new Date(sun); d.setDate(sun.getDate()+w*7+dow);
    const b = lessonBlocks(dow); if(!b.length) continue;
    evs.push({ id:"school"+ymd(d).replace(/-/g,""), summary:"בית ספר", colorId:"3", start:{dateTime:iso(local(d,b[0].start))}, end:{dateTime:iso(local(d,b[b.length-1].end))} });
    if(dow===2) evs.push({ id:"eran"+ymd(d).replace(/-/g,""), summary:"ערן מתמטיקה", start:{dateTime:iso(local(d,"15:00"))}, end:{dateTime:iso(local(d,"17:00"))} });
    if(dow===4) evs.push({ id:"alex"+ymd(d).replace(/-/g,""), summary:"אלכס", colorId:"8", start:{dateTime:iso(local(d,"18:15"))}, end:{dateTime:iso(local(d,"19:15"))} });
  }
  return evs;
}
function demoLoad(){ const v = settings.get("demo.events", null); if(v) return v; const s = demoSeed(); settings.set("demo.events", s); return s; }
function expand(ev, from, to){
  const rule = (ev.recurrence||[]).find(r=>r.startsWith("RRULE:"));
  if(!rule) return [ev];
  const step = /FREQ=DAILY/.test(rule) ? 1 : 7;
  const s0 = new Date(ev.start.dateTime || ev.start.date+"T00:00:00"), e0 = new Date(ev.end.dateTime || ev.end.date+"T00:00:00");
  const out = []; const dur = e0 - s0;
  for(let i=0;i<400;i++){
    const s = new Date(s0); s.setDate(s0.getDate()+i*step); if(s >= to) break;
    const e = new Date(s.getTime()+dur); if(e <= from) continue;
    const inst = { ...ev, id: ev.id+"_"+ymd(s).replace(/-/g,""), recurringEventId: ev.id };
    if(ev.start.dateTime){ inst.start = { dateTime: iso(s) }; inst.end = { dateTime: iso(e) }; }
    else { inst.start = { date: ymd(s) }; inst.end = { date: ymd(e) }; }
    out.push(inst);
  }
  return out;
}
const demo = {
  mode: "demo",
  ready(){ return true; },
  async list(from, to, { calendarId="primary", privateProp } = {}){
    if(calendarId!=="primary") return [];
    let evs = demoLoad().flatMap(e=>expand(e, from, to));
    evs = evs.filter(e=>{ const s = new Date(e.start.dateTime || e.start.date+"T00:00:00"), en = new Date(e.end.dateTime || e.end.date+"T00:00:00"); return s < to && en > from; });
    if(privateProp){ const [k,v] = privateProp.split("="); evs = evs.filter(e=>e.extendedProperties?.private?.[k]===v); }
    return evs.sort((a,b)=> new Date(a.start.dateTime||a.start.date) - new Date(b.start.dateTime||b.start.date));
  },
  async insert(body){
    const ev = JSON.parse(JSON.stringify(body)); ev.id = "d"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    // store with offsets so Date parsing is unambiguous
    if(ev.start?.dateTime && !/[+-]\d\d:\d\d$|Z$/.test(ev.start.dateTime)){ ev.start = { dateTime: iso(new Date(ev.start.dateTime)) }; ev.end = { dateTime: iso(new Date(ev.end.dateTime)) }; }
    ev.htmlLink = null; const all = demoLoad(); all.push(ev); settings.set("demo.events", all); return ev;
  },
  async patch(id, body){ const all = demoLoad(); const base = id.split("_")[0]; const ev = all.find(e=>e.id===id||e.id===base); if(!ev) throw new CalError("not_found");
    const oldPriv = { ...(ev.extendedProperties?.private||{}) };
    Object.assign(ev, JSON.parse(JSON.stringify(body)));
    if(body.extendedProperties) ev.extendedProperties = { private: { ...oldPriv, ...(body.extendedProperties.private||{}) } };
    settings.set("demo.events", all); return ev; },
  async remove(id){ const base = id.split("_")[0]; settings.set("demo.events", demoLoad().filter(e=>e.id!==id && e.id!==base)); return null; },
  reset(){ settings.del("demo.events"); },
};

export function backend(){ return settings.get("demo", false) || !auth.clientId() ? demo : google; }
export { demo, google, TZ };
