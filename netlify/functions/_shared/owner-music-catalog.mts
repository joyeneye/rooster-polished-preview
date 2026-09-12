export const OWNER_MUSIC_CATALOG = [
    {title:'Spend Dat', artist:'Yung Miami', video:'NSZ26l3DIKE'},
    {title:'What It Is (Block Boy)', artist:'Doechii feat. Kodak Black', video:'phtcAd8j6Ro'},
    {title:'YOU', artist:'SiR', video:'GEsObsmLS8U'},
    {title:'Money', artist:'Cardi B', video:'Zj2cK8wymIA'},
    {title:'Able', artist:'Kirk Franklin', video:'iMQKzsOIFbM'},
    {title:'Pretty Eyes', artist:'sunkis feat. FLO', video:'fioIdmPrQIg'},
    {title:'Big Booty', artist:'Gucci Mane feat. Megan Thee Stallion', video:'b_Kx8tx88oQ'},
    {title:'Love Thru The Computer', artist:'Gucci Mane feat. Justin Bieber', video:'XvinPCCGSxc'},
    {title:'A Thousand Times', artist:'Honey Bxby & JID', video:'M5ApFrZSFh0'},
    {title:'High Key', artist:'Ari Lennox', video:'is7I3xqVnQo'},
    {title:'Stop By', artist:'Ari Lennox', video:'cyhbvJtNqv4'},
    {title:'Blackberry Sap', artist:'Dreamville & Ari Lennox', video:'1nq1ZLYYxx4'},
    {title:'Plays of the Week', artist:'BossMan Dlow', video:'jUEyjE92fG4'},
    {title:'Is It The Way', artist:'Saweetie', video:'kjfSPX3JW_4'},
    {title:'boffum', artist:'Saweetie & J.White Did It', video:'2BMZNs_BQDo'},
    {title:'Bodak Yellow', artist:'Cardi B', video:'PEGccV-NOm8'},
    {title:'I Like It', artist:'Cardi B, Bad Bunny & J Balvin', video:'xTlNMmZKwpA'},
    {title:'Savage Remix', artist:'Megan Thee Stallion feat. Beyoncé', video:'lEIqjoO0-Bs'},
    {title:'a lot', artist:'21 Savage feat. J. Cole', video:'DmWWqogr_r8'},
    {title:'30 For 30', artist:'SZA feat. Kendrick Lamar', video:'NEnephbahLA'},
    {title:'Muwop', artist:'Latto feat. Gucci Mane', video:'meFxq3-mNEc'},
    {title:'Sally Walker', artist:'Iggy Azalea', video:'2Gy8eGr7AfM'},
    {title:'Started', artist:'Iggy Azalea', video:'flPCk8Z5XS0'},
    {title:'Weak', artist:'Flo Milli', video:'8B2iv-7bNDQ'},
    {title:'Valet', artist:'Eric Bellinger feat. Fetty Wap & 2 Chainz', video:'qONfVYziSZw'},
    {title:'Ooh La La', artist:'Tinashe', video:'LtCfBdmxR_M'}
  ];

// Existing published J.White catalog, shared by reference. No media is copied.
export function ownerCatalogSongs() {
  return OWNER_MUSIC_CATALOG.map((track, index) => ({
    slot: index + 1, revision: `catalog:${track.video}`, status: 'approved', source: 'link',
    title: `${track.title} · ${track.artist}`, provider: 'youtube',
    external_url: `https://www.youtube.com/watch?v=${track.video}`, catalog_video_id: track.video,
    origin: { member_id: 'owner', name: 'J.White Did It', slot: index + 1, revision: `catalog:${track.video}` },
  }));
}
