import {openPhotoFilterEditor} from './photo-filter-editor.js';
import {openRosterCamera} from './roster-camera.js?v=20260912-centered-camera-v5';
import photoCatalog from './photo-catalog.json';
import {createTopEightEditor} from './top-eight-editor.js';
import {preparePrivatePhoto as prepareProfilePhoto} from './photo-helper.js';

/** Early Member and the other membership badges, shown only once the server
 * says the new membership system is live. */
function renderMembership(target, membership) {
  if (!target) return;
  const names = [];
  if (membership?.early_member === true) names.push('Early Member');
  if (membership?.founding_member === true) names.push('Founding Member');
  if (membership?.approved_creator === true) names.push('Approved Creator');
  target.replaceChildren(...names.map((name) => {
    const badge = document.createElement('span');
    badge.className = 'member-membership-badge';
    badge.textContent = name;
    return badge;
  }));
  target.hidden = names.length === 0;
}

export function createMemberProfileEditor({onSessionExpired, onEditOpened = () => {}, onProfileState = () => {}}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('member-profile-panel');
  const form = byId('member-profile-form');
  const input = byId('member-profile-status');
  const displayName = byId('member-profile-display-name');
  const about = byId('member-profile-about');
  const profession = byId('member-profile-profession');
  const website = byId('member-profile-website');
  const titleLines = byId('member-profile-title-lines');
  const credentials = byId('member-profile-credentials');
  const locationInput = byId('member-profile-location');
  const ownerDetails = byId('owner-profile-details');
  const bioStyle = byId('member-profile-bio-style');
  const bioHelp = byId('member-profile-help-bio');
  const upload = byId('member-profile-upload');
  const camera = byId('member-profile-camera');
  const feedback = byId('member-profile-feedback');
  const photo = byId('member-profile-photo');
  const preview = byId('member-profile-preview');
  const filters = byId('member-profile-filters');
  let filterSource=null, filterSettings=null, filterController=null;
  const maxSize = 3 * 1024 * 1024;
  const allowedTypes = new Set(['image/jpeg','image/png','image/webp']);
  const controllers = new Set();
  let user = null;
  let generation = 0;
  let saved = null;
  let owner = false;
  let loading = false;
  let saving = false;
  let selectedFile = null;
  let previewUrl = null;
  let retry = null;
  let editRequested = false;
  let photoLoading = false;
  let photoGeneration = 0;
  let photoRequest = null;
  let selectedCatalogUrl = null;
  let photoButtons = [];
  const topEight = createTopEightEditor({onChange() {retry = null;}});

  function publishProfileState() {
    if (!saved) {
      onProfileState(null);
      return;
    }
    onProfileState({
      profile: saved,
      owner,
      firstLogin: !owner && saved.updated_at === null,
    });
  }

  function openRequestedEditor() {
    if (!editRequested || !user || !saved || loading || saving || input.disabled || panel.hidden) return;
    editRequested = false;
    byId('member-profile-editor').open = true;
    input.focus({preventScroll:true});
    input.scrollIntoView({block:'center',behavior:'auto'});
    onEditOpened();
  }

  function requestEdit() {
    editRequested = true;
    openRequestedEditor();
  }

  function report(message, tone = '') {
    feedback.textContent = message;
    feedback.dataset.tone = tone;
  }

  function controls() {
    const disabled = !user || !saved || loading || saving;
    input.disabled = disabled;
    if (displayName) displayName.disabled = disabled;
    if (about) about.disabled = disabled;
    if (profession) profession.disabled = disabled;
    if (website) website.disabled = disabled;
    if (bioStyle) bioStyle.disabled = disabled;
    if (titleLines) { titleLines.disabled = disabled; titleLines.maxLength = owner ? 180 : 100; }
    if (credentials) credentials.disabled = disabled || !owner;
    if (locationInput) locationInput.disabled = disabled;
    if (ownerDetails) ownerDetails.hidden = !owner;
    if (bioHelp) bioHelp.disabled = disabled;
    topEight.setDisabled(disabled);
    upload.disabled = disabled || Boolean(filterController);
    if (camera) camera.disabled = disabled || photoLoading || Boolean(filterController);
    if(filters)filters.disabled=disabled||photoLoading||!selectedFile||Boolean(filterController);
    byId('member-profile-save').disabled = disabled || photoLoading;
    byId('member-profile-save').textContent = saving ? 'Checking your update…' : photoLoading ? 'Loading picture…' : 'Save Profile';
    byId('member-profile-refresh').disabled = !user || loading || saving;
    byId('member-profile-remove-upload').disabled = saving;
    photoButtons.forEach(({button, failed}) => {button.disabled = disabled || failed;});
    form.setAttribute('aria-busy', String(saving || photoLoading));
  }

  function markPhotoChoice() {
    const choice = selectedCatalogUrl || (!selectedFile ? allowedPhoto(saved?.photo_url) : null);
    photoButtons.forEach(({button, url}) => button.setAttribute('aria-pressed', String(url === choice)));
  }

  function renderPhotoChoices() {
    const section = byId('member-profile-library');
    const grid = byId('member-profile-photo-grid');
    section.hidden = !owner || !saved;
    grid.replaceChildren();
    photoButtons = [];
    if (!owner || !saved) return;
    const choices = photoCatalog.map(item => ({...item, url:allowedPhoto(`/${item.src}`)}));
    const current = allowedPhoto(saved.photo_url);
    if (current && !choices.some(item => item.url === current)) choices.unshift({url:current,caption:'Current picture',alt:'Your current profile picture'});
    for (const item of choices) {
      if (!item.url) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'member-photo-choice';
      button.setAttribute('aria-label', `Use ${item.caption}`);
      button.title = item.caption;
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = item.alt;
      image.loading = 'lazy';
      const caption = document.createElement('span');
      caption.textContent = item.caption;
      button.append(image, caption);
      const choice = {button, url:item.url, failed:false};
      image.addEventListener('error', () => {choice.failed = true;button.disabled = true;});
      button.addEventListener('click', () => void selectExistingPhoto(item));
      photoButtons.push(choice);
      grid.append(button);
    }
    markPhotoChoice();
  }

  async function selectExistingPhoto(item) {
    if (!user || !owner || !saved || loading || saving) return;
    clearUpload();
    retry = null;
    if (item.url === allowedPhoto(saved.photo_url)) {
      report('Your current picture will stay.');
      controls();
      return;
    }
    // Only bundled album entries can be downloaded and sent to the upload API.
    if (!photoCatalog.some(entry => allowedPhoto(`/${entry.src}`) === item.url)) return;
    const epoch = generation;
    const selection = photoGeneration;
    const controller = new AbortController();
    photoRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    photoLoading = true;
    selectedCatalogUrl = item.url;
    preview.src = item.url;
    byId('member-profile-preview-wrap').hidden = false;
    markPhotoChoice();
    controls();
    report('Loading your picture…');
    try {
      const response = await fetch(item.url, {credentials:'same-origin',cache:'force-cache',signal:controller.signal,redirect:'error'});
      if (!response.ok) throw new Error('Photo could not load');
      const blob = await response.blob();
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      if (!allowedTypes.has(blob.type) || blob.size <= 0 || blob.size > maxSize) throw new Error('Invalid photo');
      selectedFile = new File([blob], item.src.split('/').pop(), {type:blob.type});
      filterSource=selectedFile;
      report('Picture selected. Tap Save Profile to make it your profile picture.');
    } catch {
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      clearUpload();
      report('That picture could not load. Try another one. Your current picture is unchanged.', 'error');
    } finally {
      clearTimeout(timeout);
      if (user && generation === epoch && photoGeneration === selection) {
        photoRequest = null;
        photoLoading = false;
      }
      controls();
    }
  }

  function allowedPhoto(value) {
    if (!value || typeof value !== 'string') return null;
    try {
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin && ['http:','https:'].includes(url.protocol) ? url.href : null;
    } catch {return null;}
  }

  function validProfile(profile, canEditOwner) {
    return profile && typeof profile.id === 'string'
      && (profile.id === user?.id || (canEditOwner && profile.id === 'owner'))
      && typeof profile.name === 'string' && typeof profile.status === 'string'
      && (typeof profile.about_me === 'string' || typeof profile.about_me === 'undefined')
      && (typeof profile.profession === 'string' || typeof profile.profession === 'undefined')
      && (typeof profile.website_url === 'string' || typeof profile.website_url === 'undefined')
      && (typeof profile.title_lines === 'string' || typeof profile.title_lines === 'undefined')
      && (typeof profile.credentials === 'string' || typeof profile.credentials === 'undefined')
      && (typeof profile.location === 'string' || typeof profile.location === 'undefined')
      && (profile.photo_url === null || typeof profile.photo_url === 'string')
      && (profile.updated_at === null || (typeof profile.updated_at === 'string' && Number.isFinite(Date.parse(profile.updated_at))));
  }

  function renderSaved() {
    if (!user || !saved) return;
    byId('member-profile-current').hidden = false;
    byId('member-profile-name').textContent = saved.name || 'Member';
    const badge = byId('member-profile-verified');
    const gold = saved.verified_owner === true;
    badge.hidden = !gold && saved.verified !== true;
    badge.className = gold ? 'official-gold-badge' : 'member-verified-badge';
    badge.setAttribute('aria-label', gold ? 'Official J.White Did It profile' : 'Verified on the ROOSTER');
    badge.title = gold ? 'Official J.White Did It profile' : 'Verified on the ROOSTER';
    byId('member-profile-initial').textContent = [...(saved.name || 'M')][0].toUpperCase();
    renderMembership(byId('member-profile-membership'), saved.membership);
    byId('member-profile-status-text').textContent = saved.status;
    const url = allowedPhoto(saved.photo_url);
    if (url) {photo.src = url;photo.hidden = false;}
    else {photo.removeAttribute('src');photo.hidden = true;}
    const link = byId('member-profile-link');
    link.href = owner ? '/#home' : `/profile.html?id=${encodeURIComponent(user.id)}`;
    link.hidden = false;
    byId('member-profile-owner-note').textContent = owner
      ? 'This updates your main profile.'
      : 'Your photo, status and About Me appear on your roster page.';
    renderPhotoChoices();
    topEight.setProfile(saved, owner);
  }

  function clearUpload(resetInput = true) {
    photoGeneration += 1;
    photoRequest?.abort();
    photoRequest = null;
    photoLoading = false;
    selectedCatalogUrl = null;
    filterController?.abort();filterController=null;filterSource=null;filterSettings=null;
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    selectedFile = null;
    if (resetInput) upload.value = '';
    byId('member-profile-preview-wrap').hidden = true;
    markPhotoChoice();
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(path, {...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error('Profile request failed');
        error.status = response.status;
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid profile response');
      return {status:response.status,data};
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  function handleError(error, epoch, action) {
    if (!user || generation !== epoch) return;
    if (error.status === 401 || error.status === 403) {
      clear();
      onSessionExpired();
      return;
    }
    if (error.status === 422) return report('That update was not approved. Keep your status and About Me positive and respectful, and choose an appropriate photo. Your current profile is unchanged.', 'error');
    if (error.status === 413) return report('That photo is too large. Choose a JPG, PNG or WEBP under 3 MB.', 'error');
    if (error.status === 400 || error.status === 415) return report('Check your status, About Me and photo. Status is 160 characters, About Me is 600, and photos must be JPG, PNG or WEBP under 3 MB.', 'error');
    if (error.status === 429) return report('Give it a minute before trying again.', 'error');
    if (action === 'save') return report("We couldn't confirm that your update saved. Refresh your profile to check, or try Save Profile again.", 'error');
    report("Your profile couldn't load just now. Tap Refresh Profile to try again.", 'error');
  }

  async function load() {
    if (!user || loading || saving) return;
    const epoch = generation;
    loading = true;
    report('Loading your profile…');
    controls();
    try {
      const {data} = await request('/api/profile/me');
      if (!user || generation !== epoch) return;
      if (!validProfile(data.profile, data.can_edit_owner === true)) throw new Error('Invalid profile response');
      saved = data.profile;
      owner = data.can_edit_owner === true;
      clearUpload();
      input.value = saved.status;
      if (displayName) displayName.value = saved.name || '';
      if (about) about.value = saved.about_me || '';
      if (profession) profession.value = saved.profession || '';
      if (website) website.value = saved.website_url || '';
      if (titleLines) titleLines.value = saved.title_lines || '';
      if (credentials) credentials.value = owner ? saved.credentials || '' : '';
      if (locationInput) locationInput.value = saved.location || '';
      renderSaved();
      publishProfileState();
      report('');
    } catch (error) {
      handleError(error, epoch, 'load');
    } finally {
      if (user && generation === epoch) {loading = false;controls();openRequestedEditor();}
    }
  }

  function clear() {
    generation += 1;
    user = null;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    saved = null;
    owner = false;
    publishProfileState();
    loading = false;
    saving = false;
    retry = null;
    editRequested = false;
    clearUpload();
    input.value = '';
    if (displayName) displayName.value = '';
    if (about) about.value = '';
    if (profession) profession.value = '';
    if (website) website.value = '';
    if (titleLines) titleLines.value = '';
    if (credentials) credentials.value = '';
    if (locationInput) locationInput.value = '';
    topEight.clear();
    const bioFeedback = byId('member-profile-bio-help-status');
    if (bioFeedback) bioFeedback.textContent = '';
    photo.removeAttribute('src');
    photo.hidden = true;
    byId('member-profile-name').textContent = '';
    byId('member-profile-verified').hidden = true;
    byId('member-profile-status-text').textContent = '';
    byId('member-profile-initial').textContent = '';
    byId('member-profile-current').hidden = true;
    byId('member-profile-link').hidden = true;
    byId('member-profile-link').removeAttribute('href');
    byId('member-profile-editor').open = false;
    renderPhotoChoices();
    report('');
    panel.hidden = true;
    controls();
  }

  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id) return;
    user = {id:member.id};
    panel.hidden = false;
    void load();
  }

  function bioDraft(style) {
    const name = (saved?.name || 'Member').trim();
    const statusText = input.value.trim();
    const current = statusText && statusText.toUpperCase() !== 'MORE!' ? ` Right now: ${statusText}` : '';
    if (style === 'confident') return `${name} here. I create with purpose, move with intention and let the work speak loud. I’m here to connect with people who take the craft seriously and keep building.${current}`.slice(0, 600);
    if (style === 'creative') return `${name}. Music, ideas and real connection live here. I’m building, creating and sharing the journey as it happens. Tap in, check out what I’m working on and stay close for what’s next.${current}`.slice(0, 600);
    return `I’m ${name}. I’m here to share what I do, connect with other creatives and keep building. Check out my page, my work and what I’m working on next.${current}`.slice(0, 600);
  }

  bioHelp?.addEventListener('click', () => {
    if (!about || !user || !saved || loading || saving) return;
    about.value = bioDraft(bioStyle?.value || 'simple');
    about.focus({preventScroll:true});
    const bioFeedback = byId('member-profile-bio-help-status');
    if (bioFeedback) bioFeedback.textContent = 'Draft added. Make it sound like you, then tap Save Profile.';
    retry = null;
  });

  about?.addEventListener('input', () => {
    retry = null;
    const bioFeedback = byId('member-profile-bio-help-status');
    if (bioFeedback) bioFeedback.textContent = '';
  });

  upload.addEventListener('change', () => void selectDevicePhoto());

  camera?.addEventListener('click', () => void takeProfilePhoto());

  async function takeProfilePhoto() {
    if (!user || !saved || loading || saving || photoLoading || filterController) return;
    clearUpload();
    retry = null;
    const epoch = generation;
    const selection = photoGeneration;
    const controller = new AbortController();
    photoRequest = controller;
    photoLoading = true;
    report('Opening the selfie camera. Your photo stays on this device until you save.');
    controls();
    try {
      const captured = await openRosterCamera({
        signal: controller.signal,
        title: 'Take Your Profile Photo',
        aspect: 1,
        applyLabel: 'Use Selfie',
      });
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      if (!captured) {
        report('Camera closed. Your current picture is unchanged.');
        return;
      }
      const prepared = await prepareProfilePhoto(captured.file, {signal: controller.signal});
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      if (prepared.type !== 'image/jpeg' || prepared.size <= 0 || prepared.size > maxSize) throw new Error('Your selfie could not be prepared. Try again or choose a photo.');
      selectedFile = new File([prepared], 'profile-photo.jpg', {type: 'image/jpeg', lastModified: Date.now()});
      filterSource = captured.sourceFile;
      filterSettings = captured.settings;
      markPhotoChoice();
      previewUrl = URL.createObjectURL(selectedFile);
      preview.src = previewUrl;
      byId('member-profile-preview-wrap').hidden = false;
      report('Selfie ready. Tap Filters for more edits, then Save Profile to publish it.');
    } catch (error) {
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      clearUpload();
      report(error?.name === 'AbortError'
        ? 'Camera closed. Your current picture is unchanged.'
        : (error?.message || 'The camera could not prepare that picture. Try again or choose a photo.'), error?.name === 'AbortError' ? '' : 'error');
    } finally {
      if (user && generation === epoch && photoGeneration === selection) {
        photoRequest = null;
        photoLoading = false;
      }
      controls();
    }
  }

  async function selectDevicePhoto() {
    if (!user || !saved || loading || saving) return;
    const file = upload.files?.[0] || null;
    clearUpload(false);
    retry = null;
    if (!file) { report(''); controls(); return; }
    const epoch = generation;
    const selection = photoGeneration;
    const controller = new AbortController();
    photoRequest = controller;
    photoLoading = true;
    report('Getting your picture ready…');
    controls();
    try {
      // Reuse the bounded phone-photo decoder. It strips camera metadata and
      // resizes supported photos locally; nothing is uploaded before Save.
      const prepared = await prepareProfilePhoto(file, {signal:controller.signal});
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      if (prepared.type !== 'image/jpeg' || prepared.size <= 0 || prepared.size > maxSize) throw new Error('Your picture could not be prepared. Try another JPG, PNG or WebP.');
      selectedFile = new File([prepared], 'profile-photo.jpg', {type:'image/jpeg'});
      filterSource=file;
      report('Opening the ROOSTER photo editor…');
      const edited=await openPhotoFilterEditor(file,{signal:controller.signal,title:'Edit Profile Photo',applyLabel:'Apply Photo'});
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      if(edited){selectedFile=edited.file;filterSettings=edited.settings;}
      markPhotoChoice();
      previewUrl = URL.createObjectURL(selectedFile);
      preview.src = previewUrl;
      byId('member-profile-preview-wrap').hidden = false;
      report(edited?'Edited picture ready. Tap Save Profile to use it.':'Original picture kept. Tap Save Profile to use it.');
    } catch (error) {
      if (!user || generation !== epoch || photoGeneration !== selection) return;
      clearUpload();
      report(error?.name === 'AbortError' ? 'Picture selection canceled. Your current picture is unchanged.' : (error?.message || 'This picture could not open. Choose another JPG, PNG or WebP.'), 'error');
    } finally {
      if (user && generation === epoch && photoGeneration === selection) {
        photoRequest = null;
        photoLoading = false;
      }
      controls();
    }
  }
  filters?.addEventListener('click',async()=>{
    if(!user||!saved||!selectedFile||loading||saving||photoLoading||filterController)return;
    const epoch=generation,selection=photoGeneration,controller=new AbortController();filterController=controller;photoLoading=true;controls();
    try{
      const result=await openPhotoFilterEditor(filterSource||selectedFile,{initial:filterSettings,signal:controller.signal,title:'Edit Profile Photo',applyLabel:'Apply Photo'});
      if(!result||!user||generation!==epoch||photoGeneration!==selection)return;
      selectedFile=result.file;filterSettings=result.settings;selectedCatalogUrl=null;retry=null;
      if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(result.file);preview.src=previewUrl;markPhotoChoice();
      report('Look selected. Tap Save Profile to publish it.');
    }catch(error){if(user&&generation===epoch)report(error?.message||'Could not prepare the photo. Your current picture is unchanged.','error');}
    finally{if(user&&generation===epoch&&photoGeneration===selection){filterController=null;photoLoading=false;controls();}}
  });
  byId('member-profile-remove-upload').addEventListener('click', () => {
    if (saving) return;
    clearUpload();
    retry = null;
    report('Your current picture will stay.');
    controls();
  });
  preview.addEventListener('error', () => {
    if (!selectedFile && !photoLoading) return;
    clearUpload();
    retry = null;
    report('That picture could not be opened. Choose another JPG, PNG or WEBP.', 'error');
    controls();
  });
  photo.addEventListener('error', () => {photo.hidden = true;});
  byId('member-profile-refresh').addEventListener('click', () => void load());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!user || !saved || loading || saving || photoLoading || !form.reportValidity()) return;
    const text = input.value.trim();
    const displayText = displayName ? displayName.value.trim().replace(/\s+/g, ' ') : (saved?.name || '').trim();
    const aboutText = about ? about.value.trim().replace(/\r\n?/g, '\n') : null;
    const professionText = profession ? profession.value : null;
    const websiteText = website ? website.value.trim() : null;
    const titleText = titleLines ? titleLines.value.trim().replace(/\r\n?/g, '\n') : null;
    const credentialsText = owner && credentials ? credentials.value.trim().replace(/\r\n?/g, '\n') : null;
    const locationText = locationInput ? locationInput.value.trim().replace(/\r\n?/g, '\n') : null;
    const topOrder = owner ? topEight.getOrder() : null;
    if (!displayText || displayText.length > 60 || /[@\u0000-\u001f\u007f]/.test(displayText)) return report('Choose a display name with 1 to 60 characters and no @ symbol.', 'error');
    if (!text || text.length > 160) return report('Write a status with 1 to 160 characters.', 'error');
    if (aboutText !== null && aboutText.length > 600) return report('Keep your About Me to 600 characters or less.', 'error');
    if (titleText !== null && titleText.length > (owner ? 180 : 100)) return report(`Keep what you do to ${owner ? 180 : 100} characters or less.`, 'error');
    if (credentialsText !== null && credentialsText.length > 240) return report('Keep credits and highlights to 240 characters or less.', 'error');
    if (locationText !== null && locationText.length > 140) return report('Keep your location to 140 characters or less.', 'error');
    const snapshot = JSON.stringify({display_name:displayText,status:text,about_me:aboutText,profession:professionText,website_url:websiteText,title_lines:titleText,credentials:credentialsText,location:locationText,top_eight_order:topOrder,file:selectedFile ? {name:selectedFile.name,type:selectedFile.type,size:selectedFile.size,lastModified:selectedFile.lastModified} : null});
    if (!retry || retry.snapshot !== snapshot) retry = {snapshot,id:crypto.randomUUID()};
    const data = new FormData();
    data.append('display_name', displayText);
    data.append('status', text);
    if (aboutText !== null) data.append('about_me', aboutText);
    if (professionText !== null) data.append('profession', professionText);
    if (websiteText !== null) data.append('website_url', websiteText);
    if (titleText !== null) data.append('title_lines', titleText);
    if (credentialsText !== null) data.append('credentials', credentialsText);
    if (locationText !== null) data.append('location', locationText);
    if (topOrder) data.append('top_eight_order', JSON.stringify(topOrder));
    data.append('request_id', retry.id);
    if (selectedFile) data.append('photo', selectedFile, selectedFile.name);
    const epoch = generation;
    saving = true;
    controls();
    report('Checking your update before it goes on your profile…');
    void (async () => {
      try {
        const result = await request('/api/profile/update', {method:'POST',body:data});
        if (!user || generation !== epoch) return;
        if (result.status === 202) {
          report('Your update could not be reviewed yet. Your current profile is unchanged. Try Save Profile again in a moment.');
          return;
        }
        if (!validProfile(result.data.profile, result.data.can_edit_owner === true || owner)) throw new Error('Invalid saved profile response');
        saved = result.data.profile;
        if (typeof result.data.can_edit_owner === 'boolean') owner = result.data.can_edit_owner;
        retry = null;
        clearUpload();
        input.value = saved.status;
        if (displayName) displayName.value = saved.name || '';
        if (about) about.value = saved.about_me || '';
        if (profession) profession.value = saved.profession || '';
        if (website) website.value = saved.website_url || '';
        if (titleLines) titleLines.value = saved.title_lines || '';
        if (credentials) credentials.value = owner ? saved.credentials || '' : '';
        if (locationInput) locationInput.value = saved.location || '';
        renderSaved();
        publishProfileState();
        report('Profile saved. Your new look is live.', 'success');
      } catch (error) {
        handleError(error, epoch, 'save');
      } finally {
        if (user && generation === epoch) {saving = false;controls();openRequestedEditor();}
      }
    })();
  });
  window.addEventListener('pagehide', clear);
  return {setUser, requestEdit};
}
