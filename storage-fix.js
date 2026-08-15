/* Thought Garden storage compatibility patch · 2026-08-15
   Firestore remains the source of truth when connected. localStorage keeps only
   a lightweight offline snapshot so AI indexes / embeddings cannot exhaust the
   browser quota. User-authored content is preserved in both online/offline mode. */
(function installThoughtGardenStorageFix(){
  if(typeof localSave!=="function"){
    console.warn("[storage-fix] localSave not found; patch skipped.");
    return;
  }

  const LOCAL_KEY="thoughtGarden_v02";
  const HEAVY_FRAGMENT_FIELDS=new Set(["aiIndex","updatedAtServer"]);

  function firebaseConnected(){
    try{return !!(state&&state.firebase&&state.firebase.connected&&state.firebase.db&&state.firebase.uid)}
    catch(_){return false}
  }

  function leanFragment(fragment){
    const out={...fragment};
    for(const key of Object.keys(out)){
      // AI indexes / vectors are derived data. Firestore can restore them after
      // reconnecting, while the user's original text, links and attachments stay.
      if(HEAVY_FRAGMENT_FIELDS.has(key)||/embedding/i.test(key))delete out[key];
    }
    return out;
  }

  function leanSnapshotFromState(){
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

  function compactExistingSnapshot(){
    try{
      const raw=localStorage.getItem(LOCAL_KEY);
      if(!raw)return;
      const saved=JSON.parse(raw);
      if(Array.isArray(saved.fragments))saved.fragments=saved.fragments.map(leanFragment);
      localStorage.setItem(LOCAL_KEY,JSON.stringify(saved));
    }catch(error){
      // Keep an unreadable/unknown snapshot untouched. Future normal saves will
      // replace it after the app has successfully loaded its state.
      console.warn("[storage-fix] legacy cache compaction skipped",error);
    }
  }

  localSave=function thoughtGardenSafeLocalSave(){
    try{
      localStorage.setItem(LOCAL_KEY,JSON.stringify(leanSnapshotFromState()));
      return true;
    }catch(error){
      if(!quotaError(error))throw error;

      // If Firestore is connected, persist() has already attempted the cloud write
      // before localSave(). Do not misreport a cloud save as failed because only
      // the disposable browser cache is full.
      if(firebaseConnected()){
        try{localStorage.removeItem(LOCAL_KEY)}catch(_){}
        console.warn("[storage-fix] Firestore save succeeded; oversized local cache was cleared.",error);
        return false;
      }

      // In true offline/local-only mode this cache is the user's persistence layer,
      // so the quota error must remain visible rather than silently losing a note.
      throw error;
    }
  };

  // Free space immediately, even if Firebase connection is still racing with this
  // script or a previous startup already fell back to local mode.
  compactExistingSnapshot();

  // If state is already populated, rewrite once using the same lightweight shape.
  try{
    const hasState=(state.sources?.length||state.fragments?.length||state.trash?.length||state.threads?.length||state.projects?.length);
    if(hasState)localSave();
  }catch(error){console.warn("[storage-fix] initial lightweight snapshot failed",error)}

  console.info("[storage-fix] lightweight local cache enabled.");
})();
