// Minimal asynchronous IndexedDB test double: preserves transactions, stores and Blobs.
export function fakeIndexedDB({onOpen='success'}={}){
 const databases=new Map();
 const schema=new Map();
 const factory={
  opens:0,databases,
  open(name,version){
   factory.opens++;
   if(onOpen==='throw')throw Error('Storage denied');
   const q={result:undefined,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
   setImmediate(()=>{
    if(onOpen==='blocked'){q.onblocked?.();return;}
    if(onOpen==='error'){q.error=Error('IndexedDB unavailable');q.onerror?.();return;}
    const maps=databases.get(name)||new Map(),keys=schema.get(name)||new Map();
    const db={
     objectStoreNames:{contains:id=>maps.has(id)},
     createObjectStore(id,options){maps.set(id,new Map());keys.set(id,options?.keyPath||null);return {};},
     close(){db.closed=true;},
     transaction(id,mode){
      const names=Array.isArray(id)?id:[id];
      if(!names.length||names.some(name=>!maps.has(name)))throw Error('Missing object store '+id);
      const tx={error:null,oncomplete:null,onabort:null,onerror:null};
      let pending=0,failed=false,complete=false;
      tx.objectStore=store=>{
       if(!names.includes(store))throw Error('Store not in transaction '+store);
       const table=maps.get(store),keyPath=keys.get(store);
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
           setImmediate(()=>tx.oncomplete?.());
          }
         }catch(e){failed=true;req.error=e;req.onerror?.();tx.error=e;tx.onerror?.();}
        });
        return req;
       };
       return {
        get:key=>request(()=>structuredClone(table.get(key))),
        getAll:()=>request(()=>structuredClone([...table.values()])),
        put:(value,key)=>request(()=>{const id=key??value[keyPath];if(id===undefined)throw Error('Missing key');table.set(id,structuredClone(value));return id;}),
        delete:key=>request(()=>{table.delete(key);return undefined;}),
        clear:()=>request(()=>{table.clear();})
       };
      };
      return tx;
     }
    };
    if(onOpen!=='undefined')q.result=db;
    if(!databases.has(name)){databases.set(name,maps);schema.set(name,keys);}
    if(onOpen!=='undefined'&&maps.size===0)q.onupgradeneeded?.({target:q});
    q.onsuccess?.({target:q});
   });
   return q;
  }
 };
 return factory;
}
