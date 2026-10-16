import {startingBase} from './dungeon-core.mjs';
const DB='magia-dungeon-v1';
export function openStore(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{q.result.createObjectStore('circles',{keyPath:'id'});q.result.createObjectStore('settings');};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function request(db,store,mode,op){return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),q=op(tx.objectStore(store));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
export const allCircles=db=>request(db,'circles','readonly',s=>s.getAll());
export const putCircle=(db,circle)=>request(db,'circles','readwrite',s=>s.put(circle));
export const deleteCircle=(db,id)=>request(db,'circles','readwrite',s=>s.delete(id));
export const saveProfile=(db,p)=>request(db,'settings','readwrite',s=>s.put(p,'profile'));
export async function getProfile(db){let p=await request(db,'settings','readonly',s=>s.get('profile'));if(!p){p={level:1,xp:0,base:startingBase(),returns:0,attempts:0,inventory:[],collection:{},highest:0,run:null};await saveProfile(db,p);}return p;}
