import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {File} from 'node:buffer';

const source = fs.readFileSync(new URL('../photo-helper.js',import.meta.url),'utf8').replace('export async function','async function');
function environment({width=4000,height=3000,outputBytes=100,decode}={}) {
  let closed=false;let fills=0;let drawings=0;let decoded=0;const qualities=[];
  const bitmap={width,height,close(){closed=true;}};
  const canvas={width:0,height:0,getContext(){return {fillRect(){fills++;},drawImage(image){assert.equal(image,bitmap);drawings++;}};},toBlob(done,type,quality){qualities.push(quality);done(new Blob([new Uint8Array(outputBytes)],{type}));}};
  const context=vm.createContext({File,Blob,DOMException,createImageBitmap:async file=>{decoded++;return decode ? await decode(file,bitmap) : bitmap;},document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}}});
  vm.runInContext(source+'\nthis.prepare=preparePrivatePhoto;',context);
  return {prepare:context.prepare,canvas,qualities,get closed(){return closed;},get fills(){return fills;},get drawings(){return drawings;},get decoded(){return decoded;}};
}

test('phone picture is resized and re-encoded as a metadata-free JPEG rather than copying input bytes',async()=>{
  const e=environment();const input=new File(['camera EXIF GPS metadata and pixels'],'camera.jpg',{type:'image/jpeg'});
  const output=await e.prepare(input);
  assert.equal(output.type,'image/jpeg');assert.equal(output.name,'private-photo.jpg');
  assert.equal(e.canvas.width,1600);assert.equal(e.canvas.height,1200);
  assert.equal(e.fills,1);assert.equal(e.drawings,1);assert.equal(e.closed,true);
  assert.notEqual(await output.text(),await input.text());
});

test('unsupported, oversized and empty source pictures are refused before decoding',async()=>{
  for(const input of [{type:'image/heic',size:100},{type:'image/jpeg',size:21*1024*1024},{type:'image/png',size:0}]){
    const e=environment();await assert.rejects(e.prepare(input));assert.equal(e.decoded,0);
  }
});

test('enormous decoded images are rejected and decoder resources are closed',async()=>{
  const e=environment({width:10000,height:10000});
  await assert.rejects(e.prepare(new File(['pixels'],'large.webp',{type:'image/webp'})),/40 megapixels/);
  assert.equal(e.drawings,0);assert.equal(e.closed,true);
});

test('abort during decoding prevents canvas and closes decoded image',async()=>{
  const controller=new AbortController();const e=environment({decode:async(file,bitmap)=>{controller.abort();return bitmap;}});
  await assert.rejects(e.prepare(new File(['pixels'],'camera.png',{type:'image/png'}),{signal:controller.signal}),error=>error.name==='AbortError');
  assert.equal(e.drawings,0);assert.equal(e.closed,true);
});

test('small pictures keep their dimensions and output above send limit is never returned',async()=>{
  const e=environment({width:300,height:200,outputBytes:3*1024*1024+1});
  await assert.rejects(e.prepare(new File(['pixels'],'small.png',{type:'image/png'})),/too large to send/);
  assert.equal(e.canvas.width,300);assert.equal(e.canvas.height,200);
  assert.deepEqual(e.qualities,[0.86,0.7,0.5]);assert.equal(e.closed,true);
});
