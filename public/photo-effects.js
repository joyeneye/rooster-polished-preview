// Pixel-based effects work without CanvasRenderingContext2D.filter, which is
// unavailable in some phone browsers. Previews and uploads share this renderer.
export const PHOTO_FILTERS = Object.freeze([
  {id:'original',name:'Original',category:'For You'},
  {id:'roster-clean',name:'ROOSTER CLEAN',category:'Clean'},
  {id:'main-character',name:'MAIN CHARACTER',category:'Creator'},
  {id:'rich',name:'RICH',category:'Creator'},
  {id:'golden',name:'GOLDEN',category:'Portrait'},
  {id:'soft-glow',name:'SOFT GLOW',category:'Portrait'},
  {id:'studio',name:'STUDIO',category:'Portrait'},
  {id:'spotlight',name:'SPOTLIGHT',category:'Creator'},
  {id:'after-dark',name:'AFTER DARK',category:'Night'},
  {id:'viral-pop',name:'VIRAL POP',category:'Creator'},
  {id:'beauty-clean',name:'BEAUTY CLEAN',category:'Portrait'},
  {id:'barber-fresh',name:'BARBER FRESH',category:'Business'},
  {id:'hair-glow',name:'HAIR GLOW',category:'Business'},
  {id:'product-pop',name:'PRODUCT POP',category:'Business'},
  {id:'street-luxe',name:'STREET LUXE',category:'Creator'},
  {id:'food-heat',name:'FOOD HEAT',category:'Business'},
  {id:'35mm',name:'35MM',category:'Film'},
  {id:'disposable',name:'DISPOSABLE',category:'Film'},
  {id:'vintage-fade',name:'VINTAGE FADE',category:'Film'},
  {id:'cinema',name:'CINEMA',category:'Film'},
  {id:'noir',name:'NOIR',category:'Black & White'},
  {id:'chrome',name:'CHROME',category:'Effects'},
  {id:'dream',name:'DREAM',category:'Effects'},
  {id:'vhs',name:'VHS',category:'Effects'},
  {id:'prism',name:'PRISM',category:'Effects'},
]);
export const PHOTO_OVERLAYS = Object.freeze([
  {id:'none',name:'None'}, {id:'sparkles',name:'Sparkles'}, {id:'hearts',name:'Hearts'},
]);
export function normalizePhotoEffects(value = {}) {
  // Keep previously saved edits safe while the current camera presents only
  // original ROOSTER names. Old IDs resolve to the nearest new treatment.
  const legacy = {mono:'noir',moon:'noir',clarendon:'main-character',juno:'viral-pop',lark:'roster-clean',ludwig:'studio',gingham:'vintage-fade',aden:'dream',valencia:'golden',crema:'35mm',reyes:'soft-glow',slumber:'vintage-fade',perpetua:'roster-clean',amaro:'beauty-clean',mayfair:'rich',rise:'golden',hudson:'chrome',xpro2:'cinema',lofi:'main-character',hefe:'street-luxe',warm:'golden'};
  const requested = legacy[value?.filter] || value?.filter;
  const filter = PHOTO_FILTERS.some(f => f.id === requested) ? requested : 'original';
  const overlay = PHOTO_OVERLAYS.some(f => f.id === value?.overlay) ? value.overlay : 'none';
  const n = value?.strength;
  const strength = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1,n)) : 1;
  return {filter, overlay, strength};
}
export function photoEffectsLabel(value) {
  const settings=normalizePhotoEffects(value);
  return [PHOTO_FILTERS.find(f=>f.id===settings.filter).name,
    ...(settings.overlay==='none'?[]:[PHOTO_OVERLAYS.find(f=>f.id===settings.overlay).name])].join(' + ');
}
// Returns a copy; moving the intensity slider never repeatedly edits the source.
export function filterPhotoPixels(source, value = {}) {
  if (!(source instanceof Uint8ClampedArray) || source.length % 4) throw new TypeError('Invalid photo pixels.');
  const {filter,strength}=normalizePhotoEffects(value), out=new Uint8ClampedArray(source);
  if(filter==='original'||strength===0)return out;
  for(let i=0;i<out.length;i+=4){
    const r=source[i],g=source[i+1],b=source[i+2],y=.2126*r+.7152*g+.0722*b;
    let rr=r,gg=g,bb=b;
    switch(filter){
      case 'roster-clean': rr=(r-128)*1.06+130;gg=(g-128)*1.05+129;bb=(b-128)*1.04+128;break;
      case 'main-character': rr=(r-128)*1.25+133;gg=(g-128)*1.2+127;bb=(b-128)*1.18+124;break;
      case 'rich': rr=(r-128)*1.28+132;gg=(g-128)*1.18+124;bb=(b-128)*1.15+120;break;
      case 'golden': rr=r*1.06+16;gg=g*1.02+8;bb=b*.92;break;
      case 'soft-glow': rr=r*.9+24;gg=g*.91+23;bb=b*.93+23;break;
      case 'studio': rr=(r-128)*1.12+132;gg=(g-128)*1.1+130;bb=(b-128)*1.09+130;break;
      case 'spotlight': rr=(r-128)*1.3+137;gg=(g-128)*1.16+127;bb=(b-128)*1.28+135;break;
      case 'after-dark': rr=(r-128)*1.18+140;gg=(g-128)*1.16+137;bb=(b-128)*1.2+144;break;
      case 'viral-pop': rr=y+(r-y)*1.3+7;gg=y+(g-y)*1.27+6;bb=y+(b-y)*1.25+5;break;
      case 'beauty-clean': rr=r*.95+13;gg=g*.96+12;bb=b*.97+11;break;
      case 'barber-fresh': rr=(r-128)*1.24+130;gg=(g-128)*1.2+128;bb=(b-128)*1.18+126;break;
      case 'hair-glow': rr=y+(r-y)*1.2+6;gg=y+(g-y)*1.18+5;bb=y+(b-y)*1.16+4;break;
      case 'product-pop': rr=(r-128)*1.17+132;gg=(g-128)*1.16+131;bb=(b-128)*1.15+131;break;
      case 'street-luxe': rr=(r-128)*1.25+127;gg=(g-128)*1.19+125;bb=(b-128)*1.2+128;break;
      case 'food-heat': rr=y+(r-y)*1.28+12;gg=y+(g-y)*1.18+5;bb=y+(b-y)*1.05-3;break;
      case '35mm': rr=r*.92+20;gg=g*.9+18;bb=b*.84+17;break;
      case 'disposable': rr=(r-128)*1.08+145;gg=(g-128)*1.04+135;bb=(b-128)*1.07+134;break;
      case 'vintage-fade': rr=r*.76+42;gg=g*.75+40;bb=b*.72+38;break;
      case 'cinema': rr=(r-128)*1.22+129;gg=(g-128)*1.15+127;bb=(b-128)*1.2+133;break;
      case 'noir': rr=gg=bb=(y-128)*1.2+134;break;
      case 'chrome': rr=(r-128)*1.16+124;gg=(g-128)*1.2+130;bb=(b-128)*1.3+143;break;
      case 'dream': rr=r*.84+35;gg=g*.86+33;bb=b*.95+34;break;
      case 'vhs': rr=(r-128)*1.08+134;gg=(g-128)*1.02+126;bb=(b-128)*1.12+139;break;
      case 'prism': rr=(r-128)*1.13+136;gg=(g-128)*1.08+128;bb=(b-128)*1.15+140;break;
    }
    out[i]=r+(Math.max(0,Math.min(255,rr))-r)*strength;
    out[i+1]=g+(Math.max(0,Math.min(255,gg))-g)*strength;
    out[i+2]=b+(Math.max(0,Math.min(255,bb))-b)*strength;
  }
  return out;
}
function renderTextureEffects(context,width,height,settings){
  const grainLooks=new Set(['35mm','disposable','vintage-fade','cinema','noir','vhs']);
  if(!grainLooks.has(settings.filter)&&settings.filter!=='prism')return;
  const image=context.getImageData(0,0,width,height),source=new Uint8ClampedArray(image.data),data=image.data;
  const amount=(settings.filter==='vhs'?10:settings.filter==='disposable'?7:4)*settings.strength;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(grainLooks.has(settings.filter)){
      const noise=(((x*17+y*131+(x*y)%97)%31)-15)/15*amount;
      data[i]+=noise;data[i+1]+=noise;data[i+2]+=noise;
    }
    if(settings.filter==='vhs'){
      const shift=Math.max(1,Math.round(width*.004)),left=(y*width+Math.max(0,x-shift))*4,right=(y*width+Math.min(width-1,x+shift))*4;
      data[i]=source[left];data[i+2]=source[right+2];
      if(y%6<2){data[i]*=.91;data[i+1]*=.91;data[i+2]*=.91;}
    }else if(settings.filter==='prism'){
      const shift=Math.max(1,Math.round(width*.003*settings.strength)),left=(y*width+Math.max(0,x-shift))*4,right=(y*width+Math.min(width-1,x+shift))*4;
      data[i]=source[left];data[i+2]=source[right+2];
    }
  }
  context.putImageData(image,0,0);
}
export function renderPhotoEffects(context,width,height,value={}){
  const settings=normalizePhotoEffects(value);
  if(settings.filter!=='original'&&settings.strength>0){
    const image=context.getImageData(0,0,width,height);
    image.data.set(filterPhotoPixels(image.data,settings));context.putImageData(image,0,0);
  }
  renderTextureEffects(context,width,height,settings);
  if(settings.overlay==='none'||settings.strength===0)return;
  const points=[[.08,.12,1],[.86,.14,.8],[.95,.38,.55],[.12,.72,.75],[.78,.89,.9],[.31,.08,.45],[.91,.75,.55]];
  context.save();context.globalAlpha=.85*settings.strength;
  for(const [x,y,scale]of points){
    const radius=Math.min(width,height)*.043*scale;
    context.save();context.translate(x*width,y*height);context.scale(radius,radius);
    context.beginPath();
    if(settings.overlay==='hearts'){
      context.moveTo(0,1);context.bezierCurveTo(-2,-.25,-.6,-1.75,0,-.75);
      context.bezierCurveTo(.6,-1.75,2,-.25,0,1);context.fillStyle='#ff6ca8';
    }else{
      context.moveTo(0,-1.3);context.lineTo(.28,-.28);context.lineTo(1.1,0);
      context.lineTo(.28,.28);context.lineTo(0,1.3);context.lineTo(-.28,.28);
      context.lineTo(-1.1,0);context.lineTo(-.28,-.28);context.closePath();context.fillStyle='#fff5bc';
    }
    context.fill();context.restore();
  }
  context.restore();
}
