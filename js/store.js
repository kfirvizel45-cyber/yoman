// Local storage: settings in localStorage, notes + photos in IndexedDB (stay on the phone).
const P = "yoman.";
export const settings = {
  get(k, def){ try{ const v = localStorage.getItem(P+k); return v==null ? def : JSON.parse(v); }catch{ return def; } },
  set(k, v){ try{ localStorage.setItem(P+k, JSON.stringify(v)); }catch{} },
  del(k){ try{ localStorage.removeItem(P+k); }catch{} },
};

let dbp = null;
function db(){
  if(dbp) return dbp;
  dbp = new Promise((res, rej)=>{
    if(!("indexedDB" in self)) return rej(new Error("no-idb"));
    const r = indexedDB.open("yoman", 1);
    r.onupgradeneeded = () => { const d = r.result;
      if(!d.objectStoreNames.contains("notes")) d.createObjectStore("notes", { keyPath:"id" });
      if(!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath:"id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn){
  return db().then(d => new Promise((res, rej)=>{
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    let out; const r = fn(s); if(r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export const notes = {
  get: id => tx("notes","readonly", s=>s.get(id)).catch(()=>null),
  all: () => tx("notes","readonly", s=>s.getAll()).catch(()=>[]),
  put: n => tx("notes","readwrite", s=>s.put({ ...n, updatedAt: Date.now() })),
  del: id => tx("notes","readwrite", s=>s.delete(id)),
};
export const photos = {
  get: id => tx("photos","readonly", s=>s.get(id)).then(r=>r?.blob||null).catch(()=>null),
  put: (blob) => { const id = "p"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    return tx("photos","readwrite", s=>s.put({ id, blob })).then(()=>id); },
  del: id => tx("photos","readwrite", s=>s.delete(id)),
};
