// Original casting artwork and ROOSTER ads edited from licensed Mixkit footage.
// Footage rights and source links: assets/slots-ads/SOURCES.json.
export const GIRL_GROUP_CAMPAIGN = Object.freeze({
  id:'girl-group-casting-v1',
  poster:'/assets/slots-ads/girl-group-casting-v1.png',
  campaign:true,
  category:'CASTING CALL',
  sponsor:'MORE HITS ON THE WAY',
  title:'Four voices. One new group.',
  copy:'J.White Did It is looking for 3 female rappers + 1 female R&B singer. Ages 18+. Bring your voice, movement, and personality.',
  narration:'J. White Did It and More Hits On The Way are building a new girl group. Three female rappers and one female R and B singer. Ages eighteen and up. Bring your voice, movement, and personality. Tap Apply for the group to show us what you do. No invite code needed.',
  href:'/apply.html?opportunity=jspace-female-group-2026',
  action:'Apply for the group',
});
export const SLOTS_PROMOS = [
  GIRL_GROUP_CAMPAIGN,
  {id:'hair-v1',video:'/assets/slots-ads/hair-v1.mp4',poster:'/assets/slots-ads/hair-v1.jpg',category:'HAIR & BEAUTY',title:'Your next look starts here.',copy:'Meet the people behind the styles you love.',narration:'Your next look starts here. Meet the people behind the styles you love on ROOSTER.',href:'/booking',action:'Explore beauty',footage:true},
  {id:'barber-v1',video:'/assets/slots-ads/barber-v1.mp4',poster:'/assets/slots-ads/barber-v1.jpg',category:'BARBERS & STYLISTS',title:'Fresh cut. New connection.',copy:'Discover barbers and stylists on ROOSTER.',narration:'Fresh cut. New connection. Discover barbers and stylists on ROOSTER.',href:'/booking',action:'Find your barber',footage:true},
  {id:'sports-v1',video:'/assets/slots-ads/sports-v1.mp4',poster:'/assets/slots-ads/sports-v1.jpg',category:'SPORTS & COMMUNITY',title:'Your game. Your people.',copy:'Share the highlights. Start the conversation.',narration:'Your game. Your people. Share the highlights and start the conversation on ROOSTER.',href:'/?view=board',action:'Join the conversation',footage:true},
  {id:'podcast-v1',video:'/assets/slots-ads/podcast-v1.mp4',poster:'/assets/slots-ads/podcast-v1.jpg',category:'ROOMS & PODCASTS',title:'Give your voice a room.',copy:'Find your people. Start something worth talking about.',narration:'Give your voice a room. Find your people and start something worth talking about on ROOSTER.',href:'/live.html',action:'Explore Rooms',footage:true},
  {id:'fashion-v1',video:'/assets/slots-ads/fashion-v1.mp4',poster:'/assets/slots-ads/fashion-v1.jpg',category:'CULTURE & STYLE',title:'Your style. Your people.',copy:'Meet creators with a point of view.',narration:'Your style. Your people. Meet creators with a point of view on ROOSTER.',href:'/people.html',action:'Meet creators',footage:true},
  {id:'orbit-v1',video:'/roster-promo-radio.mp4',poster:'/assets/slots-ads/rooster-radio.jpg',category:'MUSIC & RADIO',title:'Turn the day into a station.',copy:'Find music, conversation, and new sounds on ORBIT.',narration:'Turn the day into a station. Find music, conversation, and new sounds on ORBIT radio.',href:'/radio.html',action:'Open ORBIT',footage:true},
  {id:'create-v1',video:'/roster-promo-create.mp4',poster:'/assets/slots-ads/rooster-create.jpg',category:'CREATORS',title:'Make something people remember.',copy:'Post the idea. Share the moment. Find your people.',narration:'Make something people remember. Post the idea, share the moment, and find your people on ROOSTER.',href:'/?compose=post',action:'Post now',footage:true},
  {id:'booking-v1',video:'/roster-promo-book.mp4',poster:'/assets/slots-ads/rooster-book.jpg',category:'BUSINESS & BOOKING',title:'Turn your work into appointments.',copy:'Give clients one simple place to discover and book you.',narration:'Turn your work into appointments. Give clients one simple place to discover and book you on ROOSTER.',href:'/booking',action:'Open Booking',footage:true},
];
export function rotatePromos(promos, visit=0) {
  if (!Array.isArray(promos) || !promos.length) return [];
  const offset=Math.abs(Math.trunc(Number(visit)||0))%promos.length;
  return [...promos.slice(offset),...promos.slice(0,offset)];
}
export function nextPromoOrder(storage) {
  // Keep the open casting call in the first promotion slot on each visit,
  // while giving the other house ads a different order. mixSlots limits it
  // to one appearance per first page and excludes promotions from Following.
  const rotating = SLOTS_PROMOS.filter(promo => !promo.campaign);
  let visit=0;
  try {
    const store=storage??globalThis.localStorage;
    visit=Number(store?.getItem('roster-promo-visit-v1'))||0;
    store?.setItem('roster-promo-visit-v1',String((visit+1)%rotating.length));
  } catch {}
  return [GIRL_GROUP_CAMPAIGN,...rotatePromos(rotating,visit)];
}
