/* Thought Garden storage compatibility patch · 2026-08-15
   Firestore remains the source of truth. LocalStorage keeps only a lightweight
   offline snapshot so AI indexes / embeddings cannot exhaust the browser quota. */
(function installThoughtGardenStorageFix(){
  if(typeof localSave!=="function"){
    console.warn("[storage-fix] localSave not found; patch skipped.");
    return;
  }

  const originalLocalSave=localSave;
  const LOCAL_KEY="thoughtGarden_v02";
  const HEAVY_FRAGMENT_FIELDS=new Set(["aiIndex","updatedAtServer"]);

  function firebaseConnected(){
    try{return !!(state&&state.firebase&&state.firebase.connected&&state.firebase.db&&state.firebase.uid)}
    catch(_){return false}
  }

  function leanFragment(fragment){
    const out={...fragment};
    for(const key of Object.keys(out)){
      // Embeddings are derived server data and can be recreated from Firestore.
      if(HEAVY_FRAGMENT_FIELDS.has(key)||/embedding/i.test(key))delete out[key];
    }
    return out;
  }

  function leanSnapshot(){
    return {
      sources:Array.isArray(state.sources)?state.sources:[],
      fragments:(typeof allFragments==="function"?allFragments():[]).map(leanFragment),
      threads:Array.isArray(state.threads)?state.threads:[],
      projects:Array.isArray(state.projects)?state.projects:[]
    };
  }

  function quotaError(error){
    return !!error&&(
      error.name==="QuotaExceededError"||
      error.name==="NS_ERROR_DOM_QUOTA_REACHED"||
      /quota|exceeded/i.test(String(error.message||""))
    );
  }

  localSave=function thoughtGardenSafeLocalSave(){
    // In true local/offline mode, preserve the original behavior: localStorage is
    // the only source of truth, so a write failure must still surface to the user.
    if(!firebaseConnected())return originalLocalSave();

    try{
      localStorage.setItem(LOCAL_KEY,JSON.stringify(leanSnapshot()));
      return true;
    }catch(error){
      if(!quotaError(error))throw error;

      // Firestore has already been written before persist() calls localSave().
      // If an old oversized snapshot is blocking the browser quota, remove only
      // that derived cache instead of reporting the Firestore write as failed.
      try{localStorage.removeItem(LOCAL_KEY)}catch(_){}
      console.warn("[storage-fix] Firestore save succeeded; oversized local cache was cleared.",error);
      return false;
    }
  };

  // If the page has already finished connecting before this patch executes,
  // immediately replace any legacy full snapshot with the lightweight version.
  if(firebaseConnected()){
    try{localSave()}catch(error){console.warn("[storage-fix] initial cache compaction failed",error)}
  }

  console.info("[storage-fix] lightweight Firestore-backed local cache enabled.");
})();
