import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {getStore,getDeployStore} from '@netlify/blobs';
import type {Context} from '@netlify/functions';
import { MemberError, memberJSON, assertSameOrigin, MEMBER_ID, type MemberResolver } from './member-auth.mts';
import {normalizeMessagePhoto} from './private-message-photos.mts';
import {boundedBytes} from './video-transfers.mts';
import {MEDIA_UNDO_SECONDS,withinUndoWindow} from './media-undo.mts';
import { requireCommunityMember } from "./roster-access.mts";
export const MAX_ALBUM_PHOTOS=10;
export const MAX_ALBUM_IMAGE_BYTES=800*1024;
export const MAX_CAPTION_LENGTH=500;
const LEGACY_MAX_ALBUM_PHOTOS=1000;
const HASH=/^[a-f0-9]{64}$/;
export function albumStore(context:Context):any {const options={name:'member-photo-albums',consistency:'strong' as const};return context.deploy.context==='production'?getStore(options):getDeployStore({...options,deployID:context.deploy.id});}
const failure=(e:any)=>memberJSON({error:e instanceof MemberError?e.message:'Your photo album could not connect. Try again.'},e instanceof MemberError?e.status:503);
const validId=(v:unknown):v is string=>typeof v==='string'&&MEMBER_ID.test(v);
function caption(value:unknown):string {if(value===null||value===undefined)return '';if(typeof value!=='string'||value.length>MAX_CAPTION_LENGTH||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new MemberError(400,'Use a caption of 500 characters or less.');return value.trim();}
async function allStoredPhotos(store:any,id:string) {const photos:any[]=[];for await(const page of store.list({prefix:`slots/${id}/`,paginate:true})) {
 for(let start=0;start<page.blobs.length;start+=16) {const items=await Promise.all(page.blobs.slice(start,start+16).map((b:any)=>store.get(b.key,{type:'json'})));for(const item of items)if(item?.member_id===id&&HASH.test(item.id)&&Number.isInteger(item.slot)&&item.slot>=0&&item.slot<LEGACY_MAX_ALBUM_PHOTOS&&typeof item.created_at==='string')photos.push(item);}
 }return photos.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.slot-b.slot);}
async function list(store:any,id:string) {return (await allStoredPhotos(store,id)).slice(0,MAX_ALBUM_PHOTOS);}
export const listAlbumPhotos=(store:any,id:string)=>list(store,id);
const present=(p:any,text='')=>({id:p.id,url:`/api/member-album-photo/${p.member_id}/${p.slot}/${p.id}`,caption:text,created_at:p.created_at,width:p.width,height:p.height});
export async function findAlbumPhoto(store:any,memberId:string,photoId:string) {const photo=(await list(store,memberId)).find(p=>p.id===photoId);return photo?present(photo,await readCaption(store,memberId,photo.id)):null;}
async function readCaption(store:any,member:string,id:string):Promise<string> {const value=await store.get(`captions/${member}/${id}`,{type:'json'});return typeof value?.caption==='string'?value.caption:'';}
export const readAlbumCaption=(store:any,member:string,id:string)=>readCaption(store,member,id);
export const presentAlbumPhoto=(photo:any,caption='')=>present(photo,caption);
async function normalizeAlbumPhoto(value:FormDataEntryValue) {const prepared=await normalizeMessagePhoto(value);if(prepared.bytes.byteLength<=MAX_ALBUM_IMAGE_BYTES&&Math.max(prepared.width,prepared.height)<=1200)return prepared;
 try {const source=Buffer.from(prepared.bytes),base=sharp(source,{failOn:'warning',limitInputPixels:16000000}).resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'});let output=await base.clone().jpeg({quality:78,progressive:false,mozjpeg:true}).toBuffer({resolveWithObject:true});if(output.data.byteLength>MAX_ALBUM_IMAGE_BYTES)output=await base.clone().jpeg({quality:58,progressive:false,mozjpeg:true}).toBuffer({resolveWithObject:true});if(!output.data.byteLength||output.data.byteLength>MAX_ALBUM_IMAGE_BYTES)throw new MemberError(413,'This picture is still too large. Try a smaller photo.');return {bytes:new Uint8Array(output.data).buffer,mime:'image/jpeg' as const,width:output.info.width,height:output.info.height,digest:createHash('sha256').update(output.data).digest('hex'),sourceDigest:prepared.sourceDigest};
 }catch(e){if(e instanceof MemberError)throw e;throw new MemberError(415,'That picture could not open. Try another JPG, PNG or WebP photo.');}}
export async function getAlbum(req:Request,store:any,resolve:MemberResolver=requireCommunityMember) {try {
 if(req.method!=='GET')throw new MemberError(405,'Method not allowed.');const query=new URL(req.url).searchParams;let id=query.get('member');if(!id)id=(await resolve()).id;if(!validId(id))throw new MemberError(400,'Open a member photo album.');id=id.toLowerCase();
 const offset=Number(query.get('offset')||0),pageSize=Number(query.get('limit')||24);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50)throw new MemberError(400,'Check your photo page and try again.');
 const photos=await list(store,id),selected=photos.slice(offset,offset+pageSize);const cards=await Promise.all(selected.map(async p=>present(p,await readCaption(store,id!,p.id))));
 return memberJSON({member_id:id,limit:MAX_ALBUM_PHOTOS,total:photos.length,next_offset:offset+pageSize<photos.length?offset+pageSize:null,photos:cards});
 }catch(e){return failure(e);}}
export async function uploadAlbumPhoto(req:Request,store:any,resolve:MemberResolver=requireCommunityMember) {try {
 if(req.method!=='POST')throw new MemberError(405,'Method not allowed.');assertSameOrigin(req);const member=await resolve();if(!validId(member.id))throw new MemberError(401,'Log in to add photos.');if(!(req.headers.get('content-type')||'').startsWith('multipart/form-data;'))throw new MemberError(415,'Choose photos from your library.');
 const bytes=await boundedBytes(req,3*1024*1024+65536);const form=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')!},body:bytes}).formData();if(form.getAll('photo').length!==1||form.getAll('caption').length>1)throw new MemberError(400,'Upload one photo and caption per request.');
 const text=caption(form.get('caption')),photo=await normalizeAlbumPhoto(form.get('photo')!),current=await list(store,member.id);const existing=current.find(p=>p.id===photo.digest);if(existing)return memberJSON({photo:present(existing,await readCaption(store,member.id,existing.id)),duplicate:true});
 if(current.length>=MAX_ALBUM_PHOTOS)throw new MemberError(409,`Your album has ${MAX_ALBUM_PHOTOS} photos. Remove one before adding another.`);
 await store.set(`images/${member.id}/${photo.digest}`,photo.bytes,{onlyIfNew:true});
 // Initialize once: retrying the same upload must not replace an edited caption.
 await store.setJSON(`captions/${member.id}/${photo.digest}`,{caption:text},{onlyIfNew:true});
 const occupied=new Set(current.map(p=>p.slot));for(let slot=0;slot<MAX_ALBUM_PHOTOS;slot++) {if(occupied.has(slot))continue;
  const value={member_id:member.id,slot,id:photo.digest,width:photo.width,height:photo.height,created_at:new Date().toISOString()};
  if((await store.setJSON(`slots/${member.id}/${slot}`,value,{onlyIfNew:true})).modified)return memberJSON({photo:present(value,await readCaption(store,member.id,value.id))},201);
 }throw new MemberError(409,`Your album has ${MAX_ALBUM_PHOTOS} photos. Remove one before adding another.`);
 }catch(e){return failure(e);}}
export async function updateAlbumCaption(req:Request,store:any,resolve:MemberResolver=requireCommunityMember) {try {
 if(req.method!=='POST')throw new MemberError(405,'Method not allowed.');assertSameOrigin(req);const member=await resolve();if(!req.headers.get('content-type')?.startsWith('application/json'))throw new MemberError(415,'The caption could not be read.');
 let input:any;try{input=JSON.parse(new TextDecoder().decode(await boundedBytes(req,4096)));}catch(e){if(e instanceof MemberError)throw e;throw new MemberError(400,'The caption could not be read.');}
 if(!HASH.test(input?.photo_id||''))throw new MemberError(400,'Choose a photo to caption.');const text=caption(input.caption);const photo=(await list(store,member.id)).find(p=>p.id===input.photo_id);if(!photo)throw new MemberError(404,'This photo is not in your album.');
 // A separate caption record cannot recreate a photo deleted concurrently.
 await store.setJSON(`captions/${member.id}/${photo.id}`,{caption:text});return memberJSON({photo:present(photo,text)});
 }catch(e){return failure(e);}}
// A removal record holds everything needed to put the picture back: where it
// sat in the album, its caption and its size. The picture file stays until the
// undo window has passed, so Undo never has to re-upload anything.
type AlbumTrash={member_id:string;photo_id:string;slots:number[];caption:string;created_at:string;width:number;height:number;removed_at:string;removed_by:string};
function readAlbumTrash(value:any,member:string,id:string):AlbumTrash|null {
 if(!value||value.kind!=='photo'||value.member_id!==member||value.photo_id!==id||!Array.isArray(value.slots)||!value.slots.length||
  !value.slots.every((slot:any)=>Number.isInteger(slot)&&slot>=0&&slot<LEGACY_MAX_ALBUM_PHOTOS)||
  typeof value.removed_at!=='string'||!Number.isFinite(Date.parse(value.removed_at)))return null;
 return {member_id:member,photo_id:id,slots:[...new Set(value.slots as number[])],caption:typeof value.caption==='string'?value.caption:'',
  created_at:typeof value.created_at==='string'&&Number.isFinite(Date.parse(value.created_at))?value.created_at:value.removed_at,
  width:Number.isInteger(value.width)?value.width:0,height:Number.isInteger(value.height)?value.height:0,
  removed_at:value.removed_at,removed_by:typeof value.removed_by==='string'?value.removed_by:''};
}
/** Takes the photo off the album immediately and keeps the picture for Undo. */
export async function removeAlbumPhoto(store:any,memberId:string,photoId:string,removedBy:string) {
 if(!validId(memberId)||!HASH.test(photoId))throw new MemberError(400,'Choose a photo to remove.');
 const photos=(await allStoredPhotos(store,memberId)).filter(p=>p.id===photoId);
 if(!photos.length)throw new MemberError(404,'This photo is no longer in the album.');
 const text=await readCaption(store,memberId,photoId);
 // The removal record is written first. A failure here leaves the album alone.
 await store.setJSON(`trash/${memberId}/${photoId}`,{kind:'photo',member_id:memberId,photo_id:photoId,slots:photos.map(p=>p.slot),
  caption:text,created_at:photos[0].created_at,width:photos[0].width,height:photos[0].height,removed_at:new Date().toISOString(),removed_by:removedBy});
 for(const photo of photos)await store.delete(`slots/${memberId}/${photo.slot}`);
 return {kind:'photo' as const,id:photoId,member_id:memberId,label:text||'Photo'};
}
/** Puts a removed photo back, as long as the undo window has not passed. */
export async function restoreAlbumPhoto(store:any,memberId:string,photoId:string) {
 if(!validId(memberId)||!HASH.test(photoId))throw new MemberError(400,'Choose a photo to bring back.');
 const record=readAlbumTrash(await store.get(`trash/${memberId}/${photoId}`,{type:'json'}),memberId,photoId);
 if(!record)throw new MemberError(404,'This photo can no longer be brought back.');
 if(!withinUndoWindow(record.removed_at)) {await purgeAlbumPhoto(store,memberId,photoId,{force:true});throw new MemberError(410,'The undo time has passed, so this photo was removed for good.');}
 if(!(await store.get(`images/${memberId}/${photoId}`,{type:'arrayBuffer'}) instanceof ArrayBuffer))throw new MemberError(404,'This photo can no longer be brought back.');
 const stored=await allStoredPhotos(store,memberId),existing=stored.find(p=>p.id===photoId);
 if(existing) {await store.delete(`trash/${memberId}/${photoId}`);return present(existing,await readCaption(store,memberId,photoId));}
 if(stored.length>=MAX_ALBUM_PHOTOS)throw new MemberError(409,`Your album has ${MAX_ALBUM_PHOTOS} photos. Remove one before bringing this photo back.`);
 const occupied=new Set(stored.map(p=>p.slot));
 // Its own slot first, then any free slot, so a full album never blocks Undo.
 const order=[...record.slots.filter(slot=>slot<MAX_ALBUM_PHOTOS)];
 for(let slot=0;slot<MAX_ALBUM_PHOTOS;slot++)if(!order.includes(slot))order.push(slot);
 for(const slot of order) {
  if(occupied.has(slot))continue;
  const value={member_id:memberId,slot,id:photoId,width:record.width,height:record.height,created_at:record.created_at};
  if(!(await store.setJSON(`slots/${memberId}/${slot}`,value,{onlyIfNew:true})).modified)continue;
  await store.setJSON(`captions/${memberId}/${photoId}`,{caption:record.caption},{onlyIfNew:true});
  await store.delete(`trash/${memberId}/${photoId}`);
  return present(value,record.caption);
 }
 throw new MemberError(409,`Your album has ${MAX_ALBUM_PHOTOS} photos. Remove one before bringing this photo back.`);
}
/** Deletes the picture file and its records once Undo is no longer offered. */
export async function purgeAlbumPhoto(store:any,memberId:string,photoId:string,{force=false}={}):Promise<boolean> {
 if(!validId(memberId)||!HASH.test(photoId))return false;
 const record=readAlbumTrash(await store.get(`trash/${memberId}/${photoId}`,{type:'json'}),memberId,photoId);
 if(!record)return false;
 if(!force&&withinUndoWindow(record.removed_at))return false;
 // A photo that was brought back keeps its picture. Only the record goes.
 if(!(await allStoredPhotos(store,memberId)).some(p=>p.id===photoId)) {
  await store.delete(`images/${memberId}/${photoId}`);
  await store.delete(`captions/${memberId}/${photoId}`);
 }
 await store.delete(`trash/${memberId}/${photoId}`);
 return true;
}
/** Every album removal record still waiting, for the scheduled cleanup. */
export async function listAlbumTrash(store:any):Promise<{member_id:string;photo_id:string}[]> {
 const found:{member_id:string;photo_id:string}[]=[];
 for await(const page of store.list({prefix:'trash/',paginate:true})) {
  for(const blob of page.blobs) {
   const parts=String(blob.key||'').split('/');
   if(parts.length===3&&validId(parts[1])&&HASH.test(parts[2]))found.push({member_id:parts[1].toLowerCase(),photo_id:parts[2]});
   if(found.length>=1000)return found;
  }
 }
 return found;
}
export async function deleteAlbumPhoto(req:Request,store:any,resolve:MemberResolver=requireCommunityMember) {try {
 if(req.method!=='POST')throw new MemberError(405,'Method not allowed.');assertSameOrigin(req);const member=await resolve();const id=new URL(req.url).searchParams.get('photo_id');if(!id||!HASH.test(id))throw new MemberError(400,'Choose a photo to remove.');
 // Removing a photo that is already gone stays a success, so a repeated tap
 // never shows an error.
 try {await removeAlbumPhoto(store,member.id,id,member.id);}
 catch(e){if(!(e instanceof MemberError)||e.status!==404)throw e;}
 return memberJSON({removed:true,undo_seconds:MEDIA_UNDO_SECONDS});
 }catch(e){return failure(e);}}
export async function getAlbumPhoto(req:Request,store:any) {try {
 if(req.method!=='GET')throw new MemberError(405,'Method not allowed.');const parts=new URL(req.url).pathname.split('/'),id=parts.at(-3)!,slot=parts.at(-2)!,hash=parts.at(-1)!;
 if(!validId(id)||!/^\d{1,3}$/.test(slot)||Number(slot)>=LEGACY_MAX_ALBUM_PHOTOS||!HASH.test(hash))throw new MemberError(404,'Photo unavailable.');const value=await store.get(`slots/${id}/${Number(slot)}`,{type:'json'});if(!value||value.id!==hash||value.member_id!==id)throw new MemberError(404,'Photo unavailable.');const data=await store.get(`images/${id}/${hash}`,{type:'arrayBuffer'});if(!(data instanceof ArrayBuffer))throw new MemberError(404,'Photo unavailable.');
 return new Response(data,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});
 }catch(e){return failure(e);}}
