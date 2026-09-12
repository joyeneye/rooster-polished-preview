import {preparePrivatePhoto} from './photo-helper.js';

// The public profile is presentation only. Editing is unlocked by the approved
// member endpoint, never by a display name, badge, URL parameter or DOM flag.
export function createInlineProfileEditor({doc = document, win = window, send = (...args) => fetch(...args), preparePhoto = preparePrivatePhoto} = {}) {
  const byId = id => doc.getElementById(id);
  const panel = byId('profile-inline-editor'), form = byId('profile-inline-form');
  if (!panel || !form) return null;
  const openers = [...doc.querySelectorAll('[data-profile-inline-open]')];
  const fields = {display_name:byId('profile-inline-name'),status:byId('profile-inline-status'),profession:byId('profile-inline-profession'),title_lines:byId('profile-inline-title-lines'),location:byId('profile-inline-location'),website_url:byId('profile-inline-website'),about_me:byId('profile-inline-about')};
  const feedback = byId('profile-inline-feedback'), upload = byId('profile-inline-photo'), preview = byId('profile-inline-photo-preview');
  const save = byId('profile-inline-save'), cancel = byId('profile-inline-cancel'), close = byId('profile-inline-close'), reload = byId('profile-inline-reload');
  const choosePhoto = byId('profile-inline-change-photo'), undoPhoto = byId('profile-inline-undo-photo');
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const requests = new Set();
  let viewed = null, saved = null, owner = false, epoch = 0, checking = false, saving = false, preparing = false, conflict = false;
  let selectedPhoto = null, photoURL = null, photoTask = null, photoEpoch = 0, photoVersion = 0, retry = null, opener = null, photoPickerOpen = false;
  const originalHost = panel.parentElement;
  const id = profile => UUID.test(profile?.id || '') ? profile.id.toLowerCase() : '';
  const value = (profile, key) => String(profile?.[key === 'display_name' ? 'name' : key] || '');
  function matches(data) {
    return data && id(data.profile) && id(data.profile) === id(viewed)
      && typeof data.profile.name === 'string' && typeof data.profile.status === 'string';
  }
  function report(text = '', tone = '') { feedback.textContent = text; feedback.dataset.tone = tone; }
  function controls() {
    const busy = checking || saving || preparing;
    for (const button of openers) { button.hidden = !saved; button.disabled = busy; button.setAttribute('aria-expanded', String(!panel.hidden)); }
    for (const input of Object.values(fields)) input.disabled = !saved || busy;
    upload.disabled = choosePhoto.disabled = !saved || busy;
    save.disabled = !saved || busy || conflict;
    cancel.disabled = close.disabled = saving;
    undoPhoto.disabled = saving;
    undoPhoto.hidden = !selectedPhoto && !preparing;
    reload.disabled = busy;
    panel.setAttribute('aria-busy', String(busy));
    save.textContent = saving ? 'Saving…' : 'Save changes';
  }
  function safePhoto(path) {
    if (typeof path !== 'string') return '';
    try { const url = new URL(path, win.location.origin); return url.origin === win.location.origin && /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(url.pathname) ? url.href : ''; } catch { return ''; }
  }
  function showPhoto() {
    const source = photoURL || safePhoto(saved?.photo_url);
    preview.hidden = !source;
    if (source) preview.src = source; else preview.removeAttribute('src');
    byId('profile-inline-initial').textContent = [...(saved?.name || 'M')][0].toUpperCase();
  }
  function clearPhoto() {
    photoEpoch += 1;
    photoTask?.abort(); photoTask = null; preparing = false;
    if (photoURL) win.URL.revokeObjectURL(photoURL);
    photoURL = null; selectedPhoto = null; photoPickerOpen = false; upload.value = '';
    photoVersion += 1;
    showPhoto();
  }
  function fill() {
    for (const [key,input] of Object.entries(fields)) input.value = value(saved,key);
    fields.title_lines.maxLength = owner ? 180 : 100;
    clearPhoto(); retry = null; conflict = false; reload.hidden = true; cancel.textContent = 'Cancel';
  }
  function clear() {
    epoch += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); saved = null; owner = false; checking = saving = false;
    panel.hidden = true; clearPhoto(); retry = null; conflict = false;
    for (const input of Object.values(fields)) input.value = '';
    byId('profile-inline-initial').textContent = '';
    reload.hidden = true; report(); controls();
  }
  async function request(path, options = {}) {
    const controller = new AbortController(); requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await send(path, {...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      const data = await response.json().catch(() => null);
      if (!response.ok) { const error = new Error(typeof data?.error === 'string' ? data.error.slice(0,300) : 'Your profile could not be updated.'); error.status = response.status; throw error; }
      return {data,status:response.status};
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  async function verify({open = false, replace = false} = {}) {
    if (!id(viewed) || checking || saving) return false;
    const generation = epoch; checking = true; controls();
    try {
      const {data} = await request('/api/profile/me');
      if (generation !== epoch) return false;
      if (!matches(data)) { clear(); return false; }
      if (!saved || panel.hidden || open || replace) saved = data.profile;
      owner = data.can_edit_owner === true;
      if (open || replace) {
        fill(); panel.hidden = false; report();
        // Reuse one editor beside whichever Edit button was pressed. This also
        // keeps Studio edits at the reader's current position on the page.
        if (opener?.id === 'public-profile-quick-edit') originalHost?.append(panel);
        else if (opener) opener.insertAdjacentElement('afterend', panel);
        fields.status.focus({preventScroll:true});
      }
      return true;
    } catch (error) {
      if (generation !== epoch) return false;
      if (error.status === 401 || error.status === 403) { clear(); return false; }
      if (!panel.hidden || open) { panel.hidden = false; report('Your profile could not load. Try again in a moment.', 'error'); reload.hidden = false; }
      return false;
    } finally { if (generation === epoch) { checking = false; controls(); } }
  }
  function ready(member) {
    if (!id(member)) { viewed = null; clear(); return; }
    if (id(member) === id(viewed)) { viewed = member; return; }
    clear(); viewed = member; void verify();
  }
  function dismiss() {
    if (saving) return;
    if (checking) { epoch += 1; for (const controller of requests) controller.abort(); requests.clear(); checking = false; }
    fill(); report(); panel.hidden = true; controls(); opener?.focus({preventScroll:true});
  }
  for (const button of openers) button.addEventListener('click', () => {
    if (!saved || checking || saving || preparing) return;
    opener = button;
    if (!panel.hidden) { fields.status.focus({preventScroll:true}); return; }
    void verify({open:true});
  });
  cancel.addEventListener('click', dismiss); close.addEventListener('click', dismiss);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !saving) { event.preventDefault(); dismiss(); } });
  reload.addEventListener('click', () => { void verify({replace:true}); });
  choosePhoto.addEventListener('click', () => { if (saved && !saving && !checking && !preparing) { photoPickerOpen = true; upload.click(); } });
  upload.addEventListener('change', async () => {
    const file = upload.files?.[0];
    if (!file || !saved || saving || checking) return;
    clearPhoto(); retry = null;
    const generation = epoch, selection = photoEpoch, controller = new AbortController();
    photoTask = controller; preparing = true; controls(); report('Getting your picture ready…');
    try {
      const prepared = await preparePhoto(file, {signal:controller.signal});
      if (generation !== epoch || selection !== photoEpoch || !saved || panel.hidden) return;
      if (!prepared?.size || prepared.size > 3 * 1024 * 1024 || prepared.type !== 'image/jpeg') throw new Error('Choose another picture. Your photo could not be prepared.');
      selectedPhoto = prepared; photoURL = win.URL.createObjectURL(prepared); photoVersion += 1;
      showPhoto(); report('Picture ready. Save changes to use it.');
    } catch (error) {
      if (generation === epoch && selection === photoEpoch) { clearPhoto(); report(error?.message || 'This picture could not open. Try another one.', 'error'); }
    } finally { if (generation === epoch && selection === photoEpoch) { photoTask = null; preparing = false; } controls(); }
  });
  undoPhoto.addEventListener('click', () => { if (!saving) { clearPhoto(); retry = null; controls(); report('Your current picture will stay.'); } });
  preview.addEventListener('error', () => {
    if (selectedPhoto) { clearPhoto(); controls(); report('That picture could not open. Choose another picture.', 'error'); }
    else preview.hidden = true;
  });
  form.addEventListener('input', () => { retry = null; cancel.textContent = 'Cancel'; if (feedback.dataset.tone === 'success') report(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    // Keep the actual form before awaiting; event.currentTarget is cleared by
    // browsers after event dispatch, which caused the old posting reset error.
    const submittedForm = event.currentTarget;
    if (!saved || panel.hidden || checking || saving || preparing || conflict || !submittedForm.reportValidity()) return;
    const values = Object.fromEntries(Object.entries(fields).map(([key,input]) => [key,input.value.trim().replace(/\r\n?/g,'\n')]));
    values.display_name = values.display_name.replace(/\s+/g,' ');
    if (!values.display_name || values.display_name.length > 60 || /[@\u0000-\u001f\u007f]/.test(values.display_name)) return report('Use a display name with 1–60 characters and no @ symbol.', 'error');
    if (!values.status || values.status.length > 160 || /[\u0000-\u001f\u007f]/.test(values.status)) return report('Use a status with 1–160 characters.', 'error');
    if (values.website_url) {
      try { const link = new URL(values.website_url); if (link.protocol !== 'https:' || link.username || link.password) throw new Error(); }
      catch { return report('Use a full https:// booking, shop or website link.', 'error'); }
    }
    const limits = {about_me:600,title_lines:owner?180:100,location:140};
    for (const [key,limit] of Object.entries(limits)) if (values[key].length > limit) return report(`Keep ${key === 'title_lines' ? 'Also known for' : key === 'about_me' ? 'About you' : 'Location'} to ${limit} characters.`, 'error');
    const changed = Object.entries(values).filter(([key,text]) => text !== value(saved,key));
    if (!changed.length && !selectedPhoto) { report('Your profile is already up to date.', 'success'); cancel.textContent = 'Done'; return; }
    const snapshot = JSON.stringify({values,photoVersion});
    if (!retry || retry.snapshot !== snapshot) retry = {snapshot,id:win.crypto.randomUUID()};
    const data = new FormData(); data.append('status', values.status);
    // Omission preserves fields we are not editing, including another window's
    // approved photo, credits and Top 8 order. Status is required by the API.
    for (const [key,text] of changed) if (key !== 'status') data.append(key,text);
    data.append('request_id', retry.id);
    if (selectedPhoto) data.append('photo',selectedPhoto,selectedPhoto.name || 'profile-photo.jpg');
    const generation = epoch, expectedId = id(saved); saving = true; controls(); reload.hidden = true;
    report('Checking and saving your changes…');
    try {
      const result = await request('/api/profile/update',{method:'POST',body:data});
      if (generation !== epoch || !saved || expectedId !== id(saved)) return;
      if (result.status === 202) { report('Your update is waiting for review. Your current profile is unchanged. Try Save changes again in a moment.'); return; }
      if (!matches(result.data) || id(result.data.profile) !== expectedId) throw new Error('Your saved profile could not be confirmed.');
      saved = result.data.profile; owner = result.data.can_edit_owner === true; fill();
      const updated = await win.RoosterProfileRenderer?.update(saved);
      if (generation !== epoch || !saved) return;
      report(updated ? 'Saved. Your page is updated right here.' : 'Your changes saved. The page preview could not refresh yet.', updated ? 'success' : '');
      cancel.textContent = 'Done';
    } catch (error) {
      if (generation !== epoch || !saved) return;
      if (error.status === 401 || error.status === 403) { clear(); return; }
      if (error.status === 409) { retry = null; conflict = true; reload.hidden = false; report('Your profile changed in another window. Load the latest version before saving again. This replaces the draft below.', 'error'); }
      else if (error.status === 422) report('That update was not approved. Your current profile is unchanged. Check your words or choose another picture.', 'error');
      else if ([400,413,415,429].includes(error.status)) report(error.message, 'error');
      else { reload.hidden = false; report('We could not confirm the save. Try Save changes again, or load the latest version to check.', 'error'); }
    } finally { if (generation === epoch) { saving = false; controls(); } }
  });
  function sessionChanged() { clear(); if (viewed) void verify(); }
  win.addEventListener('jwhite:profile-ready', event => ready(event.detail));
  win.addEventListener('jwhite:session-changed', sessionChanged);
  win.addEventListener('storage', event => { if (event.key === null || event.key === 'gotrue.user') sessionChanged(); });
  win.addEventListener('pagehide', clear);
  win.addEventListener('pageshow', event => { if (event.persisted && viewed) void verify(); });
  // A tab returning from background rechecks ownership without overwriting an
  // in-progress draft for the same member.
  win.addEventListener('focus', () => { if (photoPickerOpen) { photoPickerOpen = false; return; } if (viewed && !checking && !saving && !preparing) void verify(); });
  if (win.JWhitePublicProfile) ready(win.JWhitePublicProfile); else controls();
  return {clear,ready};
}
if (typeof document !== 'undefined') createInlineProfileEditor();
