// Minimal asynchronous IndexedDB test double: preserves transactions, stores and Blobs.
export function fakeIndexedDB({onOpen='success',rejectBlobRewrite=false,rejectProfileBlobRewrite=false}={}){
 const containsBlob=value=>{
  if(value instanceof Blob)return true;
  if(!value||typeof value!=='object')return false;
  return Object.values(value).some(containsBlob);
 };
 const databases=new Map();
 const schema=new Map();
 const versions=new Map();
 const connections=new Map();
 const factory={
  opens:0,databases,connections,failNextTransactions:0,failProfileBlobWrites:false,failIntegrityWrites:false,failMigrationBackupWrites:false,transactions:[],
  closeConnections(name='magia-dungeon-v1'){
   for(const db of [...(connections.get(name)||[])]){db.onclose?.();db.close();}
  },
  open(name,version){
   factory.opens++;
   if(onOpen==='throw')throw Error('Storage denied');
   const q={result:undefined,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
   setImmediate(()=>{
    if(onOpen==='blocked'){q.onblocked?.();return;}
    if(onOpen==='error'){q.error=Error('IndexedDB unavailable');q.onerror?.();return;}
    const maps=databases.get(name)||new Map(),keys=schema.get(name)||new Map();
    const previousVersion=versions.get(name)||0,requestedVersion=version||Math.max(1,previousVersion);
    if(requestedVersion<previousVersion){q.error=Error('VersionError: database version is newer');q.error.name='VersionError';q.onerror?.();return;}
    if(requestedVersion>previousVersion){
     for(const old of connections.get(name)||[]){old.onversionchange?.();if(!old.closed){q.onblocked?.();return;}}
    }
    const db={
     objectStoreNames:{contains:id=>maps.has(id)},
     createObjectStore(id,options){maps.set(id,new Map());keys.set(id,options?.keyPath||null);return {};},
     close(){db.closed=true;connections.get(name)?.delete(db);},
     transaction(id,mode){
      if(db.closed||factory.failNextTransactions>0){
       if(factory.failNextTransactions>0)factory.failNextTransactions--;
       const error=new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.");
       error.name='InvalidStateError';
       throw error;
      }
      const names=Array.isArray(id)?id:[id];
      if(!names.length||names.some(name=>!maps.has(name)))throw Error('Missing object store '+id);
      // Stage writes until commit just like a real IndexedDB transaction.
      // Failed or aborted transactions must never leak half a save.
      const staged=new Map(names.map(n=>[n,mode==='readwrite'
       ?new Map([...maps.get(n)].map(([k,v])=>[k,structuredClone(v)])):maps.get(n)]));
      const tx={error:null,oncomplete:null,onabort:null,onerror:null};
      const trace={mode,stores:[...names],writes:[]};
      factory.transactions.push(trace);
      let pending=0,failed=false,complete=false;
      tx.abort=()=>{if(failed||complete)return;failed=true;setImmediate(()=>tx.onabort?.());};
      tx.objectStore=store=>{
       if(!names.includes(store))throw Error('Store not in transaction '+store);
       const table=staged.get(store),keyPath=keys.get(store);
       const request=(action)=>{
        const req={result:undefined,error:null,onsuccess:null,onerror:null};
        pending++;
        setImmediate(()=>{
         if(failed)return;
         try{
          req.result=action();req.onsuccess?.({target:req});
          pending--;
          if(!pending&&!complete){
           complete=true;
           setImmediate(()=>{
            if(failed)return;
            if(mode==='readwrite')for(const name of names){
             const destination=maps.get(name);destination.clear();
             for(const [key,value] of staged.get(name))destination.set(key,value);
            }
            tx.oncomplete?.();
           });
          }
         }catch(e){failed=true;req.error=e;req.onerror?.();tx.error=e;tx.onerror?.();}
        });
        return req;
       };
       return {
        get:key=>request(()=>structuredClone(table.get(key))),
        getKey:key=>request(()=>table.has(key)?key:undefined),
        getAll:()=>request(()=>structuredClone([...table.values()])),
        put:(value,key)=>request(()=>{const id=key??value[keyPath];if(id===undefined)throw Error('Missing key');trace.writes.push({store,key:id,kind:'put'});if(store==='settings'&&id==='integrity'&&factory.failIntegrityWrites)throw Error('Injected integrity write failure');if(store==='settings'&&id==='xpMigrationBackupV1'&&factory.failMigrationBackupWrites)throw Error('Injected migration backup quota error');if(rejectBlobRewrite&&store==='circles'&&table.has(id)&&value?.image instanceof Blob)throw Error('Error preparing Blob/File data to be stored in object store');if(store==='settings'&&id==='profile'&&(rejectProfileBlobRewrite||factory.failProfileBlobWrites)&&containsBlob(value))throw Error('Error preparing Blob/File data to be stored in object store');table.set(id,structuredClone(value));return id;}),
        delete:key=>request(()=>{trace.writes.push({store,key,kind:'delete'});table.delete(key);return undefined;}),
        clear:()=>request(()=>{trace.writes.push({store,kind:'clear'});table.clear();})
       };
      };
      return tx;
     }
    };
    if(onOpen!=='undefined')q.result=db;
    if(!databases.has(name)){databases.set(name,maps);schema.set(name,keys);}
    if(!connections.has(name))connections.set(name,new Set());
    connections.get(name).add(db);
    if(onOpen!=='undefined'&&requestedVersion>previousVersion){versions.set(name,requestedVersion);q.onupgradeneeded?.({target:q});}
    q.onsuccess?.({target:q});
   });
   return q;
  }
 };
 return factory;
}
