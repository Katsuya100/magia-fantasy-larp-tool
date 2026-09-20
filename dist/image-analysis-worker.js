const OPENCV_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@opencvjs/web@5.0.0-release.2/+esm';
let cvPromise = null;

function clamp(value,min=0,max=1){ return Math.max(min,Math.min(max,value)); }

async function ensureOpenCv(){
  if(!cvPromise){
    self.postMessage({type:'progress',stage:'画像処理の眼を呼び出しています…'});
    cvPromise=import(OPENCV_MODULE_URL).then(({loadOpenCV})=>loadOpenCV());
  }
  return cvPromise;
}

function detectCircles(cv,src){
  const maxSide=900,scale=Math.min(1,maxSide/Math.max(src.cols,src.rows)),small=new cv.Mat();
  try{
    cv.resize(src,small,new cv.Size(Math.max(1,Math.round(src.cols*scale)),Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
    const gray=new cv.Mat(),circles=new cv.Mat();
    try{
      cv.cvtColor(small,gray,cv.COLOR_RGBA2GRAY);cv.medianBlur(gray,gray,5);
      const shortSide=Math.min(gray.cols,gray.rows);
      cv.HoughCircles(gray,circles,cv.HOUGH_GRADIENT,1,Math.max(12,shortSide/35),90,20,Math.max(18,Math.round(shortSide*.05)),Math.round(shortSide*.68));
      const found=[];for(let i=0;i<circles.cols;i++){const x=circles.data32F[i*3]/scale,y=circles.data32F[i*3+1]/scale,r=circles.data32F[i*3+2]/scale;if(Number.isFinite(x+y+r))found.push({x,y,r});}
      found.sort((a,b)=>b.r-a.r);let best=null,bestScore=-Infinity;
      for(let i=0;i<found.length;i++) for(let j=i+1;j<found.length;j++){
        const outer=found[i],inner=found[j];if(outer.r<=inner.r*1.18)continue;
        const centerError=Math.hypot(outer.x-inner.x,outer.y-inner.y)/outer.r;if(centerError>.22)continue;
        const ratio=inner.r/outer.r;if(ratio<.22||ratio>.82)continue;
        const score=(1-centerError)*2+ratio;if(score>bestScore){bestScore=score;best={outer,inner,confidence:clamp((score-1)/2)};}
      }
      if(!best) throw new Error('二重円の姿をつかめなかった。外円全体が見えるよう、魔法陣を正面から写してください。');
      return best;
    }finally{gray.delete();circles.delete();}
  }finally{small.delete();}
}

function analyzeSigil(cv,src,circle){
  const x=Math.max(0,Math.round(circle.inner.x-circle.inner.r)),y=Math.max(0,Math.round(circle.inner.y-circle.inner.r));
  const size=Math.min(Math.round(circle.inner.r*2),src.cols-x,src.rows-y),roi=src.roi(new cv.Rect(x,y,size,size));
  const gray=new cv.Mat(),mask=new cv.Mat(),edges=new cv.Mat(),contours=new cv.MatVector(),hierarchy=new cv.Mat();
  try{
    cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);cv.threshold(gray,mask,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);
    const radius=size/2,center=new cv.Point(radius,radius),circleMask=cv.Mat.zeros(mask.rows,mask.cols,cv.CV_8UC1);
    cv.circle(circleMask,center,Math.max(2,radius-8),new cv.Scalar(255),-1);cv.bitwise_and(mask,circleMask,mask);circleMask.delete();
    cv.Canny(gray,edges,70,150);const edgeDensity=clamp(cv.countNonZero(edges)/(Math.PI*Math.max(1,radius-8)**2)*3.8);
    cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    let largest=null,largestArea=0,contourCount=0;
    for(let i=0;i<contours.size();i++){const c=contours.get(i),area=cv.contourArea(c);if(area>30)contourCount++;if(area>largestArea){if(largest)largest.delete();largest=c;largestArea=area;}else c.delete();}
    const inkRatio=clamp(cv.countNonZero(mask)/(mask.rows*mask.cols));let roundness=.2,angularity=.25,spiky=.2;
    if(largest){
      const perimeter=cv.arcLength(largest,true),approx=new cv.Mat();cv.approxPolyDP(largest,approx,Math.max(2,perimeter*.025),true);
      roundness=clamp((4*Math.PI*Math.max(1,largestArea))/(Math.max(1,perimeter*perimeter))*1.15);angularity=clamp((approx.rows-2)/12*.72+(1-roundness)*.28);
      const hullIndices=new cv.Mat(),defects=new cv.Mat();try{cv.convexHull(largest,hullIndices,false,false);if(hullIndices.rows>3){cv.convexityDefects(largest,hullIndices,defects);let deep=0;for(let i=0;i<defects.rows;i++){const depth=defects.data32S[i*4+3]/256;if(depth>perimeter*.018)deep++;}spiky=clamp(deep/8*.7+(1-roundness)*.3);}}catch{}hullIndices.delete();defects.delete();approx.delete();
    }
    const lineDensity=clamp(edgeDensity*.58+clamp(contourCount/18)*.22+inkRatio*.2),raw={attack:spiky*.62+edgeDensity*.22+(1-roundness)*.16,defense:angularity*.7+edgeDensity*.12+(1-roundness)*.18,support:roundness*.78+(1-edgeDensity)*.12+(1-angularity)*.1,debuff:lineDensity*.75+edgeDensity*.25},total=Object.values(raw).reduce((a,b)=>a+b,0)||1;
    return {attack:raw.attack/total,defense:raw.defense/total,support:raw.support/total,debuff:raw.debuff/total};
  }finally{roi.delete();gray.delete();mask.delete();edges.delete();contours.delete();hierarchy.delete();}
}

function makeGrayImage(buffer,width,height,maxSide=620){
  const scale=Math.min(1,maxSide/Math.max(width,height)),smallWidth=Math.max(1,Math.round(width*scale)),smallHeight=Math.max(1,Math.round(height*scale));
  const gray=new Uint8Array(smallWidth*smallHeight),source=new Uint8Array(buffer);
  for(let y=0;y<smallHeight;y++){
    const sy=Math.min(height-1,Math.round(y/scale));
    for(let x=0;x<smallWidth;x++){
      const sx=Math.min(width-1,Math.round(x/scale)),index=(sy*width+sx)*4;
      gray[y*smallWidth+x]=Math.round(source[index]*.299+source[index+1]*.587+source[index+2]*.114);
    }
  }
  return {gray,width:smallWidth,height:smallHeight,scale};
}

function makeEdgeImage(gray,width,height){
  const edge=new Uint8Array(width*height);
  for(let y=1;y<height-1;y++) for(let x=1;x<width-1;x++){
    const index=y*width+x,gx=gray[index+1]-gray[index-1],gy=gray[index+width]-gray[index-width];
    edge[index]=Math.min(255,Math.round(Math.hypot(gx,gy)));
  }
  return edge;
}

function circleEdgeScore(edge,width,height,cx,cy,r){
  if(cx-r<-width*.04||cy-r<-height*.04||cx+r>width*1.04||cy+r>height*1.04)return 0;
  const samples=160;let total=0,visible=0;
  for(let i=0;i<samples;i++){
    const theta=i/samples*Math.PI*2,x=Math.round(cx+Math.cos(theta)*r),y=Math.round(cy+Math.sin(theta)*r);
    if(x<1||y<1||x>=width-1||y>=height-1)continue;
    let local=0;for(let offset=-2;offset<=2;offset++){const px=Math.round(cx+Math.cos(theta)*(r+offset)),py=Math.round(cy+Math.sin(theta)*(r+offset));if(px>=1&&py>=1&&px<width-1&&py<height-1)local=Math.max(local,edge[py*width+px]);}
    total+=local;visible++;
  }
  return visible?total/visible/255:0;
}

function detectCirclesJs(buffer,width,height){
  const image=makeGrayImage(buffer,width,height),edge=makeEdgeImage(image.gray,image.width,image.height),shortSide=Math.min(image.width,image.height),candidates=[];
  const centerStep=Math.max(1,Math.round(shortSide*.045)),radiusStep=Math.max(3,Math.round(shortSide*.018));
  for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){
    const cx=image.width/2+dx*centerStep,cy=image.height/2+dy*centerStep;
    for(let r=Math.round(shortSide*.1);r<=Math.round(shortSide*.72);r+=radiusStep){
      const score=circleEdgeScore(edge,image.width,image.height,cx,cy,r);
      if(score>.06)candidates.push({x:cx,y:cy,r,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);const selected=[];
  for(const candidate of candidates){
    if(selected.some(other=>Math.hypot(candidate.x-other.x,candidate.y-other.y)<shortSide*.05&&Math.abs(candidate.r-other.r)<shortSide*.035))continue;
    selected.push(candidate);if(selected.length>=180)break;
  }
  let best=null,bestScore=-Infinity;
  for(let i=0;i<selected.length;i++) for(let j=i+1;j<selected.length;j++){
    const first=selected[i],second=selected[j],outer=first.r>=second.r?first:second,inner=outer===first?second:first;
    const ratio=inner.r/outer.r,centerError=Math.hypot(outer.x-inner.x,outer.y-inner.y)/outer.r;
    if(outer.r<shortSide*.35||inner.r<shortSide*.25||ratio<.35||ratio>.84||centerError>.24)continue;
    const score=outer.score+inner.score+(1-centerError)*.32+(outer.r/shortSide)*1.4;
    if(score>bestScore){bestScore=score;best={outer,inner,confidence:clamp(score/1.4)};}
  }
  if(!best)throw new Error('二重円の姿をつかめなかった。外円全体が見えるよう、魔法陣を正面から写してください。');
  const restore=circle=>({x:circle.x/image.scale,y:circle.y/image.scale,r:circle.r/image.scale});
  return {outer:restore(best.outer),inner:restore(best.inner),confidence:best.confidence};
}

function analyzeSigilJs(buffer,width,height,circle){
  const image=makeGrayImage(buffer,width,height),cx=circle.inner.x*image.scale,cy=circle.inner.y*image.scale,r=circle.inner.r*image.scale,samples=180,radii=[],darkRatio=[];
  for(let i=0;i<samples;i++){
    const theta=i/samples*Math.PI*2;let found=0,dark=0;
    for(let step=Math.round(r*.12);step<r*.94;step+=Math.max(1,r*.012)){
      const x=Math.round(cx+Math.cos(theta)*step),y=Math.round(cy+Math.sin(theta)*step);
      if(x<0||y<0||x>=image.width||y>=image.height)continue;
      if(image.gray[y*image.width+x]<150){found=step/r;dark++;}
    }
    radii.push(found);darkRatio.push(dark);
  }
  const valid=radii.filter(value=>value>0),mean=valid.reduce((sum,value)=>sum+value,0)/(valid.length||1),variance=valid.reduce((sum,value)=>sum+(value-mean)**2,0)/(valid.length||1);
  let roughness=0,turns=0;for(let i=0;i<samples;i++){const previous=radii[(i+samples-1)%samples],current=radii[i],next=radii[(i+1)%samples];roughness+=Math.abs(current-previous);if((current-previous)*(next-current)<-.002)turns++;}
  roughness/=samples;const dark=darkRatio.reduce((sum,value)=>sum+value,0)/(samples*Math.max(1,Math.round(r*.82)));const roundness=clamp(1-variance*14),spiky=clamp(roughness*5+variance*7),angularity=clamp(turns/48+roughness*2),lineDensity=clamp(dark*6+roughness*1.4);
  const raw={attack:spiky*.62+(1-roundness)*.2,defense:angularity*.7+(1-roundness)*.2,support:roundness*.78+(1-spiky)*.18,debuff:lineDensity*.72+roughness*.28},total=Object.values(raw).reduce((a,b)=>a+b,0)||1;
  return {attack:raw.attack/total,defense:raw.defense/total,support:raw.support/total,debuff:raw.debuff/total};
}

const handleWorkerMessage=async event=>{
  const {width,height,buffer,lightweight}=event.data;
  try{
    let circle,shape;
    if(lightweight){
      self.postMessage({type:'progress',stage:'画像処理の眼を軽く整えています…'});
      circle=detectCirclesJs(buffer,width,height);self.postMessage({type:'progress',stage:'二重円を読み取っています…'});
      shape=analyzeSigilJs(buffer,width,height,circle);
    }else{
      const cv=await ensureOpenCv();self.postMessage({type:'progress',stage:'二重円を読み取っています…'});
      const src=new cv.Mat(height,width,cv.CV_8UC4);src.data.set(new Uint8Array(buffer));
      try{circle=detectCircles(cv,src);self.postMessage({type:'progress',stage:'紋の輪郭を読み取っています…'});shape=analyzeSigil(cv,src,circle);}finally{src.delete();}
    }
    self.postMessage({type:'success',circle,shape});
  }catch(error){self.postMessage({type:'error',message:error?.message||String(error)});}
};

if(typeof self!=='undefined')self.onmessage=handleWorkerMessage;
export {detectCirclesJs,analyzeSigilJs};
