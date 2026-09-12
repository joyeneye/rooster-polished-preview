(function () {
  'use strict';
  var music = new Set(['musician', 'producer', 'songwriter', 'engineer', 'a_and_r', 'dj']);
  var labels = {musician:'Musician / Artist',producer:'Producer',songwriter:'Songwriter',engineer:'Audio Engineer',a_and_r:'A&R / Music Executive',dj:'DJ',barber:'Barber',hairstylist:'Hairstylist',beauty_products:'Hair & Beauty Brand',journalist:'Journalist / Media',podcaster:'Podcaster / Host',photographer:'Photographer',designer:'Designer / Stylist',model:'Model',creator:'Creator / Influencer',business:'Business Owner',speaker:'Speaker',ministry:'Ministry / Church Leadership',logistics:'Trucking / Logistics',other:'Creative Professional'};
  function describe(member) {
    member = member || {};
    // Account-specific presentations use the profile links supplied by the
    // site owner. They do not change saved profile fields.
    var alysa = String(member.id || '').toLowerCase() === '98ce8da4-4112-4c99-b1a2-d4aaf6027b14';
    var mrWilliams = String(member.id || '').toLowerCase() === '1e1f21a5-3768-407f-8a43-00212eabc764';
    var identity = `${member.name || ''} ${member.handle || ''} ${member.username || ''}`.toLowerCase();
    var crisp = !mrWilliams && !alysa && /crisp[.\s_-]*by[.\s_-]*j[.\s_-]*malone/.test(identity);
    var reallyfe = !mrWilliams && !alysa && /reallyfe[.\s_-]*jeffn/.test(identity);
    var profession = mrWilliams ? (['speaker','ministry','logistics'].includes(member.profession) ? member.profession : 'speaker') : alysa ? 'beauty_products' : crisp ? 'barber' : reallyfe ? 'podcaster' : member.profession;
    var isMusic = !mrWilliams && !alysa && !crisp && !reallyfe && (music.has(profession) || member.verified_owner === true);
    var kind = isMusic ? 'music' : profession === 'beauty_products' ? 'beauty' : ['barber','hairstylist'].includes(profession) ? 'service' : ['journalist','podcaster'].includes(profession) ? 'media' : ['business','speaker','ministry','logistics'].includes(profession) ? profession : 'creator';
    var copy = {
      beauty: ['HAIR · BEAUTY · LIFESTYLE', 'Hair, beauty & everyday life', 'Explore the looks, the routines and the person behind the brand.', 'Hair & beauty videos', 'Looks & products'],
      service: ['CRAFT · CLIENTS · COMMUNITY', 'The work speaks', 'Explore recent work and connect about a service or collaboration.', 'Watch the work', 'Portfolio photos'],
      media: ['CONVERSATIONS · CULTURE · COMMUNITY', 'Stories worth sharing', 'Explore interviews, conversations and the voice behind the stories.', 'Episodes & clips', 'Behind the scenes'],
      business: ['PRODUCTS · PEOPLE · IDEAS', 'Meet the brand', 'Explore the work and connect with the person behind the business.', 'Product & brand videos', 'Products & photos'],
      speaker: ['VOICE · STORIES · COMMUNITY', 'Meet the person behind the message', 'Explore talks and ideas, then start a conversation about your event.', 'Talks & clips', 'Events & photos'],
      ministry: ['SERVICE · STORIES · COMMUNITY', 'A life of service', 'Explore shared messages and community moments, and get in touch about an event.', 'Messages & clips', 'Community photos'],
      logistics: ['WORK · PEOPLE · THE ROAD', 'On the move', 'Explore life on the road and connect about trucking or logistics work.', 'Work & road videos', 'Work & photos'],
      creator: ['CREATE · CONNECT · COLLABORATE', 'A world of your own', 'Explore original work, everyday moments and the person behind the content.', 'Videos & stories', 'Portfolio & photos'],
      music: ['SOUND · STORIES · COMMUNITY', 'Behind the music', 'Explore the music and the person creating it.', 'Videos & stories', 'Photos']
    }[kind];
    if (mrWilliams) copy = [
      'SPEAKING · FAITH · LOGISTICS',
      'Faith, purpose & life on the road',
      'Speaker, COGIC church elder and truck driver. Connect about speaking engagements, community events, or trucking and logistics opportunities.',
      'Talks, messages & life on the road',
      'Community & life in pictures'
    ];
    return {
      alysa:alysa,crisp:crisp,reallyfe:reallyfe,mrWilliams:mrWilliams,
      profession:profession,kind:kind,music:isMusic,
      label:alysa ? 'Influencer · Hair Specialist' : String(member.title_lines || '').trim() || (mrWilliams ? 'Speaker · COGIC church elder · Trucking & logistics' : labels[profession] || ''),
      kicker:copy[0],title:copy[1],description:copy[2],videos:copy[3],photos:copy[4],
      inquiry:mrWilliams ? 'Speaking & work inquiries' : profession==='speaker'?'Speaking inquiry':profession==='ministry'?'Event inquiry':profession==='logistics'?'Logistics inquiry':"Let's collaborate",
      connectTitle:mrWilliams ? 'Start a conversation' : 'Make something together',
      connectDescription:mrWilliams ? 'Invite him to speak, connect about ministry, or ask about trucking and logistics work.' : 'For collaborations, product questions and new ideas.'
    };
  }
  window.RoosterProfileProfession = {describe:describe};
})();
