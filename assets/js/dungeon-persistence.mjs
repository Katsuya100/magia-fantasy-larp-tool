// Persistent storage protects the existing origin-scoped IndexedDB from
// automatic eviction where the browser grants the request. It does not move data.
export async function storagePersistenceStatus(storage=globalThis.navigator?.storage){
 if(typeof storage?.persisted!=='function')return 'unsupported';
 try{return await storage.persisted()===true?'persistent':'best-effort';}
 catch{return 'error';}
}
export async function requestPersistentStorage(storage=globalThis.navigator?.storage){
 if(typeof storage?.persist!=='function')return 'unsupported';
 try{return await storage.persist()===true?'persistent':'denied';}
 catch{return 'error';}
}
