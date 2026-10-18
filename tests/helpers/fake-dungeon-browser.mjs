import {readFile} from 'node:fs/promises';
import {fakeIndexedDB} from './fake-indexeddb.mjs';
export function fakeDungeonBrowser(config={}){
 const factory=config.factory||fakeIndexedDB(config.storage),dom=new Map(),listeners=new Map(),downloads=[],nativeShares=[];
 const make=(id)=>{
  const handlers=new Map();
  const element={id,hidden:['library','prepare','collection','battle','checkpoint','analyzing','result','cameraCanvas','cameraVideo','cameraCapture','cameraStop','pageError','battleError','cameraError','notice','tutorialOverlay','tutorialExample','tutorialPad','tutorialRetry','tutorialFinger'].includes(id),disabled:false,open:false,attributes:{},innerHTML:'',textContent:'',value:'',dataset:{},className:'',videoWidth:640,videoHeight:640,
   addEventListener(name,fn){handlers.set(name,fn);},
   fire(name,data={}){return handlers.get(name)?.({target:element,preventDefault(){this.defaultPrevented=true;},...data});},
   setAttribute(name,value){this.attributes[name]=String(value);},
   removeAttribute(name){delete this.attributes[name];},
   showModal(){this.open=true;},close(){this.open=false;},
   click(){return element.fire('click');},
   dispatchEvent(event){return element.fire(event.type);},
   closest(){return element;},
   focus(){},
   play:async()=>{},
   getContext:()=>({drawImage(...args){element.drawImageArgs=args;},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillRect(){},strokeRect(){},arc(){},closePath(){},fillText(){},createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};}}),
    getBoundingClientRect:()=>({left:0,top:0,width:320,height:320}),setPointerCapture(){},releasePointerCapture(){},
   toBlob:callback=>callback(new Blob(['camera-capture'],{type:'image/png'})),
   toDataURL:()=>'data:image/png;base64,ZmFrZQ=='
  };
  return element;
 };
 const document={
  getElementById(id){if(!dom.has(id))dom.set(id,make(id));return dom.get(id);},
  createElement(tag){if(tag!=='a')throw Error('Unsupported fake element '+tag);return {href:'',download:'',click(){downloads.push({href:this.href,download:this.download});}};},
  addEventListener(name,fn){listeners.set(name,fn);},
  click(button){return listeners.get('click')?.({target:button});}
 };
 const input=make('analyzer-input'),analyze=make('analyzer-button'),altar={hidden:true};
 input.addEventListener('change',()=>{analyze.disabled=false;});
 analyze.disabled=true;
 analyze.addEventListener('click',()=>{altar.hidden=false;});
 const analyzerState={attribute:'flame',role:'攻撃',power:'5000'};
 const analyzer={
  getElementById(id){return {fileInput:input,analyzeButton:analyze,altarSection:altar}[id]||null;},
  querySelector(query){return {
   '#attributeResult .altar-value':{textContent:analyzerState.attribute},
   '#shapeResult .altar-value':{textContent:analyzerState.role},
   '#powerResult .altar-value':{textContent:analyzerState.power}
  }[query]||null;}
 };
 const arena=document.getElementById('battleArena');arena.dataset={role:'idle',side:'none',attribute:'law'};
 const stage=document.getElementById('battleCeremony');stage.hidden=true;stage.dataset.event='idle';
 for(const id of ['heroCombatant','enemyCombatant'])document.getElementById(id).dataset={effect:'idle',attribute:'law',hit:'false',defeated:'false'};
 const iframe=document.getElementById('analyzerFrame');iframe.contentDocument=analyzer;
 const captureFrame=document.getElementById('captureAnalyzerFrame');captureFrame.contentDocument=analyzer;
 let frameSource='';
 Object.defineProperty(iframe,'src',{get(){return frameSource;},set(s){frameSource=s;if(s==='magia-circle.html'){analyze.disabled=true;altar.hidden=true;setImmediate(()=>iframe.onload?.());}}});
 let captureFrameSource='';
 Object.defineProperty(captureFrame,'src',{get(){return captureFrameSource;},set(s){captureFrameSource=s;if(s==='magia-circle.html'){analyze.disabled=true;altar.hidden=true;setImmediate(()=>captureFrame.onload?.());}}});
 const video=document.getElementById('cameraVideo');video.videoWidth=960;video.videoHeight=720;
 let mediaOpened=0,mediaClosed=0,imageSerial=0;
 const createdImageUrls=[],revokedImageUrls=[];
 const old={document:globalThis.document,window:globalThis.window,indexedDB:globalThis.indexedDB,fetch:globalThis.fetch,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL,DataTransfer:globalThis.DataTransfer,navigator:globalThis.navigator};
 globalThis.document=document;
 globalThis.window={addEventListener(){}};
 globalThis.indexedDB=factory;
 globalThis.fetch=async url=>{
  const file=String(url).replace(/^assets\/data\//,'');
  const body=await readFile(new URL('../../assets/data/'+file,import.meta.url),'utf8');
  return {ok:true,text:async()=>body};
 };
 URL.createObjectURL=blob=>{const url='blob:mock-'+(++imageSerial);createdImageUrls.push({blob,url});return url;};
 URL.revokeObjectURL=url=>{revokedImageUrls.push(url);};
 globalThis.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
 const mockedNavigator={mediaDevices:{getUserMedia:async()=>{mediaOpened++;if(config.cameraFailure)throw Error('Permission denied');return {getTracks:()=>[{stop(){mediaClosed++;}}]};}}};
 if(config.nativeShare){mockedNavigator.canShare=({files})=>Array.isArray(files)&&files.length===1;mockedNavigator.share=async data=>{nativeShares.push(data);};}
 Object.defineProperty(globalThis,'navigator',{value:mockedNavigator,configurable:true});
 function restore(){globalThis.document=old.document;globalThis.window=old.window;globalThis.indexedDB=old.indexedDB;globalThis.fetch=old.fetch;URL.createObjectURL=old.createObjectURL;URL.revokeObjectURL=old.revokeObjectURL;globalThis.DataTransfer=old.DataTransfer;Object.defineProperty(globalThis,'navigator',{value:old.navigator,configurable:true});}
 return {factory,document,dom,analyzerState,restore,createdImageUrls,revokedImageUrls,downloads,nativeShares,get opened(){return mediaOpened;},get closed(){return mediaClosed;},get iframe(){return iframe;}};
}
