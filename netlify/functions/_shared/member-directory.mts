import {listRegisteredMembers,type CommunityReader} from './community-members.mts';
import {getPublicProfile,type ProfileStore} from './member-profiles.mts';
import {memberJSON,MemberError} from './member-auth.mts';
import {onlineMembers,type PresenceStore} from './member-presence.mts';
type DirectoryOptions={viewerId?:string;excludedIds?:Set<string>;relationships?:Record<string,string>;approvedIds?:(ids:string[])=>Promise<Set<string>>};
export async function getMembers(req:Request,profiles:ProfileStore,directory:CommunityReader,presence:PresenceStore,options:DirectoryOptions={}):Promise<Response> {
 try {if(req.method!=='GET')return memberJSON({error:'Method not allowed.'},405);const q=new URL(req.url).searchParams;
  const search=(q.get('q')||'').trim().toLocaleLowerCase();const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||24);
  if(search.length>60||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>24)throw new MemberError(400,'Check your search and try again.');
  const registered=await listRegisteredMembers(profiles,directory);
  const approved=options.approvedIds?await options.approvedIds(registered.map(member=>member.id)):null;
  const all=registered.filter(member=>(!approved||approved.has(member.id))&&!options.excludedIds?.has(member.id));
  let viewer:any=options.viewerId?{id:options.viewerId,profession:'',title_lines:'',location:''}:null;
  const cards:any[]=[];
  for(let i=0;i<all.length;i+=12) {
   const part=await Promise.all(all.slice(i,i+12).map(async member=>{
    const response=await getPublicProfile(new Request(new URL(`/api/profile?id=${member.id}`,req.url)),profiles,{directory});if(!response.ok)return null;
    const {profile}=await response.json();
    const work={profession:profile.profession||'',title_lines:profile.title_lines||'',location:profile.location||''};
    if(member.id===options.viewerId)viewer={id:member.id,...work};
    if(!profile.name.toLocaleLowerCase().includes(search))return null;
    const registered=await profiles.get(`public-members/${member.id}`,{type:'json'});
    const joined=typeof registered?.joined_at==='string'&&Number.isFinite(Date.parse(registered.joined_at))?registered.joined_at:null;
    return {id:member.id,name:profile.name,photo_url:profile.photo_url,joined_at:joined,...work,...(options.viewerId?{relationship:options.relationships?.[member.id]||(member.id===options.viewerId?'self':'none')}:{}),profile_url:`/profile.html?id=${member.id}`};
   }));cards.push(...part.filter(Boolean));
  }
  cards.sort((a,b)=>(Date.parse(b.joined_at||'')||0)-(Date.parse(a.joined_at||'')||0)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const selected=cards.slice(offset,offset+limit);const online=await onlineMembers(selected.map(m=>m.id),presence).catch(()=>null);
  return memberJSON({members:selected.map(m=>({...m,online:online?online[m.id]:null})),...(viewer?{connection_context:{viewer,ready:true}}:{}),total:cards.length,next_offset:offset+limit<cards.length?offset+limit:null});
 }catch(e){return memberJSON({error:e instanceof MemberError?e.message:'Members could not load. Please try again.'},e instanceof MemberError?e.status:503);}
}
