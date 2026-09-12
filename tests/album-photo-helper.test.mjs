import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {File} from 'node:buffer';

const source=fs.readFileSync(new URL('../album-photo-helper.js',import.meta.url),'utf8').replace(/^import .*;\n/,'const renderPhotoEffects=()=>{effectsRendered+=1;};\n').replace('export async function','async function');
function environment({width=4000,height=3000,outputBytes=100}={}){
 let closed=false;const qualities=[];const bitmap={width,height,close(){closed=true;}};
 const canvas={width:0,height:0,getContext(){return{fillRect(){},drawImage(image){assert.equal(image,bitmap);}};},toBlob(done,type,quality){qualities.push(quality);done(new Blob([new Uint8Array(outputBytes)],{type}));}};
 const context=vm.createContext({File,Blob,DOMException,effectsRendered:0,createImageBitmap:async()=>bitmap,document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}});
 vm.runInContext(source+'\nthis.prepare=prepareAlbumPhoto;',context);
 return{prepare:context.prepare,canvas,qualities,get closed(){return closed;},get effectsRendered(){return context.effectsRendered;}};
}

test('album photos are resized to 1200 pixels and encoded below the storage target',async()=>{
 const e=environment(),input=new File(['camera metadata and pixels'],'camera.jpg',{type:'image/jpeg'}),output=await e.prepare(input,{effects:{filter:'warm'}});
 assert.equal(output.type,'image/jpeg');assert.equal(output.name,'album-photo.jpg');assert.equal(e.canvas.width,1200);assert.equal(e.canvas.height,900);assert(output.size<=800*1024);assert.equal(e.effectsRendered,1);assert.equal(e.closed,true);
});

test('preview sizing stays smaller while final compression tries bounded qualities',async()=>{
 const preview=environment();await preview.prepare(new File(['pixels'],'photo.png',{type:'image/png'}),{maxSide:720});assert.equal(preview.canvas.width,720);assert.equal(preview.canvas.height,540);
 const large=environment({width:300,height:200,outputBytes:800*1024+1});await assert.rejects(large.prepare(new File(['pixels'],'photo.webp',{type:'image/webp'})),/too large to send/);assert.deepEqual(large.qualities,[0.82,0.68,0.52]);assert.equal(large.closed,true);
});
