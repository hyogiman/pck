/* Thought Garden local cache policy · 2026-08-15
   Firebase/Firestore is the source of truth.
   When Firebase mode is active, localStorage keeps only a small 3-day emergency
   snapshot. In true local-only mode, the original full local save is preserved
   so user-authored data is never silently discarded. */
(function installThoughtGardenStorageFix(){
  if(typeof localSave!=="function"){
    console.warn("[storage-fix] localSave not found; patch skipped.");
    return;
  }

  const originalLocalSave=localSave;
  const LOCAL_KEY="thoughtGarden_v02";
  const RETENTION_DAYS=3;
  const RETENTION_MS=RETENTION_DAYS*86400000;

  function firebaseConnected(){
    try{return !!(state&&state.firebase&&state.firebase.connected&&state.firebase.db&&state.firebase.uid)}
    catch(_){return false}
  }

  function toMillis(value){
    if(!value)return NaN;
    try{
      if(typeof value.toDate==="function")return value.toDate().getTime();
      if(typeof value==="object"&&Number.isFinite(value.seconds))return value.seconds*1000;
      const ms=Date.parse(String(value));
      return Number.isFinite(ms)?ms:NaN;
    }catch(_){return NaN}
  }

  function recordMillis(record){
    if(!record)return NaN;
    for(const value of [record.updatedAt,record.deletedAt,record.createdAt,record.date]){
      const ms=toMillis(value);if(Number.isFinite(ms))return ms;
    }
    return NaN;
  }

  function isRecent(record){
    const ms=recordMillis(record);
    return Number.isFinite(ms)&&ms>=Date.now()-RETENTION_MS;
  }

  function derivedDataReplacer(key,value){
    // These fields are generated from cloud data and can be restored/recreated.
    if(key==="aiIndex"||key==="updatedAtServer"||/embedding/i.test(key))return undefined;
    return value;
  }

  function recentSnapshotFromState(){
    const all=typeof allFragments==="function"?allFragments():[];
    const fragments=(Array.isArray(all)?all:[]).filter(isRecent);

    // Keep only the small amount of metadata needed to make those recent records
    // readable while offline. Old Library/Thread/Studio data stays in Firestore.
    const sourceIds=new Set(fragments.map(f=>f&&f.sourceId).filter(Boolean));
    const threadIds=new Set();
    for(const f of fragments){
      for(const id of (Array.isArray(f&&f.threadIds)?f.threadIds:[]))if(id)threadIds.add(id);
    }

    const sources=(Array.isArray(state.sources)?state.sources:[])
      .filter(s=>sourceIds.has(s.id)||isRecent(s));
    const threads=(Array.isArray(state.threads)?state.threads:[])
      .filter(t=>threadIds.has(t.id)||isRecent(t));
    const projects=(Array.isArray(state.projects)?state.projects:[])
      .filter(isRecent);

    return {sources,fragments,threads,projects};
  }

  function stringifyRecentSnapshot(){
    return JSON.stringify(recentSnapshotFromState(),derivedDataReplacer);
  }

  function quotaError(error){
    return !!error&&(
      error.name==="QuotaExceededError"||
      error.name==="NS_ERROR_DOM_QUOTA_REACHED"||
      /quota|exceeded/i.test(String(error.message||""))
    );
  }

  localSave=function thoughtGardenSafeLocalSave(){
    // No Firebase account/data mode: localStorage is still the user's real storage,
    // so keep the original full-save behavior rather than pruning their only copy.
    if(!firebaseConnected())return originalLocalSave();

    const payload=stringifyRecentSnapshot();
    try{
      localStorage.setItem(LOCAL_KEY,payload);
      return true;
    }catch(error){
      if(!quotaError(error))throw error;

      // An old oversized snapshot may still be occupying the quota. It is only a
      // cache in Firebase mode, so remove it and retry once with the 3-day payload.
      try{
        localStorage.removeItem(LOCAL_KEY);
        localStorage.setItem(LOCAL_KEY,payload);
        console.info("[storage-fix] oversized legacy cache replaced with 3-day cache.");
        return true;
      }catch(retryError){
        console.warn("[storage-fix] cloud data is safe; local emergency cache could not be written.",retryError);
        return false;
      }
    }
  };

  // The injected patch can run while Firebase login is still starting. Once the
  // connection becomes active, rewrite the old full snapshot down to 3 days even
  // if the user does not immediately create/edit a record.
  [500,1500,4000].forEach(ms=>setTimeout(()=>{
    if(!firebaseConnected())return;
    try{localSave()}catch(error){console.warn("[storage-fix] cache compaction failed",error)}
  },ms));

  console.info(`[storage-fix] Firebase mode local cache limited to ${RETENTION_DAYS} days.`);
})();
