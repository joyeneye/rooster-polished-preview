import type {Config,Context} from '@netlify/functions';
import OpenAI from 'openai';
import {and,desc,eq} from 'drizzle-orm';
import {db} from '../../db/index.js';
import {liveMessages,liveModerators,liveParticipants,liveRooms} from '../../db/schema.js';
import {assertSameOrigin,MemberError,memberJSON} from './_shared/member-auth.mts';
import {resolveCommunityProfileMember} from './_shared/roster-access.mts';
import {normalizeRoomKey} from './_shared/roster-live.mts';

const clean=(value:unknown,limit:number)=>{const text=typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,'').trim():'';if(text.length>limit)throw new MemberError(400,'Keep the live context short.');return text};
const fallback=(title:string)=>[title?`Restate the heart of “${title}” in one sentence.`:'Welcome people and name today’s topic.','Ask viewers what part they want to hear next.','Pause, recap the last point, then transition.'];

export default async(req:Request,_context:Context):Promise<Response>=>{
 try{
  if(req.method!=='POST')throw new MemberError(405,'Use the Mona cues control while live.');
  assertSameOrigin(req);const member=await resolveCommunityProfileMember();
  if(Number(req.headers.get('content-length')||0)>2048)throw new MemberError(413,'Keep the live context short.');
  const body=await req.json().catch(()=>null);if(!body||typeof body!=='object'||Array.isArray(body))throw new MemberError(400,'Choose a live room.');
  const key=normalizeRoomKey(body.key),mode=body.mode==='moderation'?'moderation':'cues';
  const [room]=await db.select().from(liveRooms).where(and(eq(liveRooms.roomKey,key),eq(liveRooms.status,'live'))).limit(1);if(!room)throw new MemberError(404,'That room has ended.');
  const host=room.hostId===member.id;
  const [mod]=host?[]:await db.select({id:liveModerators.id}).from(liveModerators).where(and(eq(liveModerators.roomId,room.id),eq(liveModerators.memberId,member.id),eq(liveModerators.active,true))).limit(1);
  if(mode==='cues'&&!host)throw new MemberError(403,'Mona cues are private to the broadcaster.');
  if(mode==='moderation'&&!host&&!mod)throw new MemberError(403,'Only this room’s host or moderator can review comments.');
  const context=clean(body.context,500),selected=Number(body.message_id||0);
  const messages=mode==='moderation'||selected?await db.select({id:liveMessages.id,body:liveMessages.body,memberId:liveMessages.memberId,createdAt:liveMessages.createdAt}).from(liveMessages).where(and(eq(liveMessages.roomId,room.id),eq(liveMessages.removed,false))).orderBy(desc(liveMessages.createdAt)).limit(mode==='moderation'?40:10):[];
  const chosen=selected?messages.find(row=>row.id===selected):null;if(selected&&!chosen)throw new MemberError(404,'That visible comment is no longer available.');
  try{
   const ai=new OpenAI({timeout:12_000,maxRetries:0});
   const instructions=mode==='cues'?'Return 3 short private broadcaster cues. Use only the live title, host context, and selected public comment supplied. Never mention private data. A suggested reply is only a draft and must not be posted.':'Review only supplied public room comments for likely spam, scams, flooding, threats, or harassment. Do not flag profanity, sentiment, identity terms, or uncertain context alone. Return suggestion-only flags; never claim an action was taken.';
   const schema=mode==='cues'
    ?{type:'object',additionalProperties:false,required:['cues'],properties:{cues:{type:'array',minItems:3,maxItems:3,items:{type:'string',maxLength:140}}}}
    :{type:'object',additionalProperties:false,required:['flags'],properties:{flags:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['message_id','category','reason','confidence','suggested_action'],properties:{message_id:{type:'integer'},category:{type:'string',enum:['spam','scam','flooding','threat','harassment']},reason:{type:'string',maxLength:140},confidence:{type:'string',enum:['low','medium','high']},suggested_action:{type:'string',enum:['review','hide','mute','timeout','block','report']}}}}}};
   const response=await ai.responses.create({model:'gpt-5.6-luna',max_output_tokens:350,instructions,input:JSON.stringify({title:room.title,context,selected_comment:chosen?.body||null,comments:mode==='moderation'?messages.map(row=>({id:row.id,text:row.body})):undefined}),text:{format:{type:'json_schema',name:'live_mona',strict:true,schema}}} as any);
   const parsed=JSON.parse(response.output_text||'{}');
   if(mode==='cues'){const cues=Array.isArray(parsed.cues)?parsed.cues.map((v:unknown)=>clean(v,140)).filter(Boolean).slice(0,3):[];if(cues.length!==3)throw new Error('invalid');return memberJSON({cues,fallback:false});}
   const ids=new Set(messages.map(row=>row.id));const flags=Array.isArray(parsed.flags)?parsed.flags.filter((flag:any)=>ids.has(flag?.message_id)&&['spam','scam','flooding','threat','harassment'].includes(flag.category)&&['low','medium','high'].includes(flag.confidence)&&typeof flag.reason==='string'&&flag.reason.length<=140):[];return memberJSON({flags,fallback:false,suggestion_only:true});
  }catch{
   if(mode==='cues')return memberJSON({cues:fallback(room.title),fallback:true});
   const seen=new Map<string,number[]>();for(const row of messages){const key=row.body.toLowerCase().replace(/\s+/g,' ');seen.set(key,[...(seen.get(key)||[]),row.id]);}const flags=[...seen.entries()].filter(([,ids])=>ids.length>=3).flatMap(([,ids])=>ids.slice(2).map(message_id=>({message_id,category:'flooding',reason:'The same public comment was repeated several times.',confidence:'high',suggested_action:'review'})));return memberJSON({flags,fallback:true,suggestion_only:true});
  }
 }catch(error){return error instanceof MemberError?memberJSON({error:error.message},error.status):memberJSON({error:'Mona is unavailable right now.'},503)}
};

export const config:Config={path:'/api/live/mona',method:'POST',rateLimit:{windowLimit:12,windowSize:3600,aggregateBy:['ip','domain']}};
