(() => {
  'use strict';
  const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const labels={musician:'Artist',producer:'Producer',songwriter:'Songwriter',engineer:'Audio engineer',a_and_r:'A&R',dj:'DJ',barber:'Barber',hairstylist:'Hair specialist',beauty_products:'Hair & beauty products',journalist:'Journalist',podcaster:'Podcaster',photographer:'Photographer',designer:'Designer',model:'Model',creator:'Content creator',business:'Business owner',speaker:'Speaker',ministry:'Ministry / church leadership',logistics:'Trucking / logistics',other:'Other work'};
  const groups={music:['musician','producer','songwriter','engineer','a_and_r','dj'],beauty:['barber','hairstylist','beauty_products','model'],content:['creator','photographer','designer','model','podcaster','journalist'],brand:['business','creator','designer','photographer','beauty_products'],services:['business','speaker','ministry','logistics']};
  const pairs={musician:['producer','songwriter','engineer','dj','a_and_r','photographer'],producer:['musician','songwriter','engineer','dj','podcaster'],songwriter:['musician','producer','a_and_r'],engineer:['producer','musician','podcaster'],a_and_r:['musician','producer','songwriter'],dj:['producer','musician','business'],barber:['creator','photographer','beauty_products'],hairstylist:['beauty_products','creator','photographer','model'],beauty_products:['hairstylist','creator','photographer','model','barber'],creator:['photographer','designer','beauty_products','business','podcaster'],photographer:['creator','model','hairstylist','barber','musician','business'],designer:['business','creator','musician'],model:['photographer','hairstylist','beauty_products','designer'],podcaster:['journalist','producer','engineer','creator'],journalist:['podcaster','photographer','creator'],business:['creator','designer','photographer','dj','speaker','logistics'],speaker:['business','podcaster','journalist','ministry'],ministry:['speaker','photographer','business'],logistics:['business']};
  const goalLabels={music:'Make music',beauty:'Build in hair & beauty',content:'Create content',brand:'Build a brand',services:'Grow services & events'};
  function city(value){
    if(typeof value!=='string'||/[\d@<>]/.test(value))return '';
    const place=value.split(/[,\n|/]/)[0].trim().toLocaleLowerCase().replace(/\s+/g,' ');
    return place.length>=3&&place.length<=50&&!['united states','usa','us','united kingdom','worldwide','online','remote'].includes(place)?place:'';
  }
  function rank(members,viewer,goal='all',dismissed=new Set()){
    if(!ID.test(viewer?.id||''))return [];
    const own=labels[viewer.profession]?viewer.profession:'';
    const ownCity=city(viewer.location);
    const seen=new Set();
    return (Array.isArray(members)?members:[]).slice(0,120).flatMap((member,index)=>{
      if(!ID.test(member?.id||'')||member.id===viewer.id||seen.has(member.id)||dismissed.has(member.id)||member.relationship!=='none'||member.blocked===true||member.muted===true||member.approved===false)return [];
      seen.add(member.id);
      const work=labels[member.profession]?member.profession:'';
      if(!work||work==='other')return [];
      let score=0,reason='';
      if(goal!=='all'){
        if(!groups[goal]?.includes(work))return [];
        score=40;reason=`${labels[work]} · matches your “${goalLabels[goal]}” goal`;
      }else if(pairs[own]?.includes(work)){
        score=40;reason=`${labels[own]} + ${labels[work]}: complementary work`;
      }else if(own===work){score=25;reason=`You both work in ${labels[work].toLocaleLowerCase()}`;}
      else if(own&&Object.values(groups).some(group=>group.includes(own)&&group.includes(work))){score=15;reason=`${labels[work]} in your creative field`;}
      const sameCity=ownCity&&ownCity===city(member.location);
      if(sameCity){score+=8;if(!reason)reason=`You both list ${member.location.split(/[,\n|/]/)[0].trim()}`;}
      if(!score)return [];
      return [{member,reason,score,sameCity:Boolean(sameCity),index}];
    }).sort((a,b)=>b.score-a.score||a.index-b.index);
  }
  function create(root){
    const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
    const section=el('section',null,'people-build');section.hidden=true;section.setAttribute('aria-labelledby','people-build-title');
    const heading=el('h2','People to build with');heading.id='people-build-title';
    const eyebrow=el('p','YOUR NEXT CONNECTION','people-build-eyebrow');
    const intro=el('p','Find the people who bring something to what you do.','people-build-intro');
    const controls=el('div',null,'people-build-controls');
    const label=el('label','What are you building?');label.htmlFor='people-build-goal';
    const goal=el('select');goal.id='people-build-goal';
    for(const [value,text]of Object.entries({all:'For you',...goalLabels})){const option=el('option',text);option.value=value;goal.append(option);}
    goal.value='all';controls.append(label,goal);
    const grid=el('div',null,'people-build-grid');
    const status=el('p',null,'people-build-status');status.setAttribute('role','status');
    const tune=el('a','Add what you do to improve your matches','people-build-tune');tune.href='/members.html#member-profile-panel';
    section.append(eyebrow,heading,intro,controls,grid,status,tune);root.append(section);
    let members=[],viewer=null,dismissed=new Set(),active=true;
    function render(){
      if(!viewer||!active){section.hidden=true;grid.replaceChildren();return;}
      section.hidden=false;grid.replaceChildren();
      const matches=rank(members,viewer,goal.value,dismissed),selected=matches.slice(0,3);
      tune.hidden=Boolean(viewer.profession&&viewer.profession!=='other');
      status.textContent=selected.length?'Based on the work and location people share on their profiles. A connection starts with a request.':!viewer.profession&&goal.value==='all'?'Choose a goal above or add what you do to find people with relevant skills.':'No new matches in these results yet. Try another goal or load more people below.';
      for(const {member,reason,sameCity}of selected){
        const card=el('article',null,'people-build-card');
        const identity=el('a',null,'people-build-identity');identity.href=`/profile.html?id=${encodeURIComponent(member.id)}`;
        const avatar=el('span',null,'people-build-avatar');
        if(typeof member.photo_url==='string'&&/^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(member.photo_url)){
          const img=el('img');img.src=member.photo_url;img.alt='';img.loading='lazy';img.addEventListener('error',()=>avatar.replaceChildren(el('span',(member.name||'M')[0])));avatar.append(img);
        }else avatar.textContent=(member.name||'M')[0];
        const name=el('strong',member.name),work=el('span',labels[member.profession]);
        const who=el('span',null,'people-build-who');who.append(name,work);identity.append(avatar,who);
        const match=el('p',reason,'people-build-reason');
        card.append(identity,match);
        if(sameCity)card.append(el('p','Same area on your profiles','people-build-nearby'));
        const actions=el('div',null,'people-build-actions');
        const connect=el('a','View & connect','people-build-connect');connect.href=identity.href+'#friend-space';connect.setAttribute('aria-label',`View ${member.name} and connect`);
        const pass=el('button','Not now','people-build-pass');pass.type='button';pass.setAttribute('aria-label',`Skip ${member.name} for now`);pass.addEventListener('click',()=>{dismissed.add(member.id);render();});
        actions.append(connect,pass);card.append(actions);grid.append(card);
      }
    }
    goal.addEventListener('change',render);
    return {
      update(data,list,{append=false,searching=false}={}){
        if(data?.connection_context?.ready!==true||!ID.test(data.connection_context.viewer?.id||'')){this.clear();return;}
        const next=data.connection_context.viewer;
        if(viewer?.id!==next.id){dismissed=new Set();goal.value='all';members=[];}
        viewer=next;active=!searching;
        members=(append?[...members,...list]:list).slice(-120);render();
      },
      clear(){viewer=null;members=[];section.hidden=true;grid.replaceChildren();},
    };
  }
  window.RoosterConnections={rank,create};
})();
