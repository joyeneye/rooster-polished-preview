import { transferSong } from './song-upload-client.js';
export function createMemberDiscovery({onSessionExpired}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('member-discovery');
  const ownerPanel = byId('owner-discovery');
  const form = byId('discovery-submit-form');
  const status = byId('discovery-status');
  const song = byId('discovery-song');
  const title = byId('discovery-title');
  const note = byId('discovery-note');
  const send = byId('discovery-send');
  const list = byId('owner-discovery-list');
  const ownerStatus = byId('owner-discovery-status');
  let generation=0; let selectedFile=null; let uploadRequestId=null; let sentToday=false;
  let user = null; let busy = false; let owner = false; let controller = null;

  function report(message, tone='') { status.textContent = message; status.dataset.tone = tone; }
  async function request(path, options={}) {
    controller?.abort(); controller = new AbortController();
    const response = await fetch(path, {...options, credentials:'same-origin', cache:'no-store', signal:controller.signal, headers:{Accept:'application/json', ...options.headers}});
    const data = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(data?.error || 'Request failed'); error.status = response.status; throw error; }
    return data;
  }
  function controls(disabled=false) { song.disabled = disabled || busy || sentToday; title.disabled = disabled || busy || sentToday; note.disabled = disabled || busy || sentToday; send.disabled = disabled || busy || sentToday; }
  function clear() { generation++;busy=false;sentToday=false;selectedFile=null;uploadRequestId=null; user = null; owner = false; controller?.abort(); panel.hidden = true; ownerPanel.hidden = true; form.reset(); list.replaceChildren(); report(''); }
  function expired(error) { if ([401,403].includes(Number(error?.status))) { clear(); onSessionExpired(); return true; } return false; }
  function renderOwner(items) {
    list.replaceChildren();
    if (!items.length) { ownerStatus.textContent = 'No submissions yet. When somebody sends their best song, it will show up here.'; return; }
    ownerStatus.textContent = `${items.length} recent submission${items.length === 1 ? '' : 's'}.`;
    for (const item of items) {
      const li = document.createElement('li'); li.className = 'discovery-card';
      const top = document.createElement('div'); top.className = 'discovery-card-top';
      const who = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = item.member_name || 'Member';
      const songTitle = document.createElement('span'); songTitle.textContent = item.title || 'Untitled';
      who.append(name, songTitle);
      const date = document.createElement('time'); date.dateTime = item.created_at; date.textContent = new Date(item.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      top.append(who,date);
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = `/api/discovery/audio/${encodeURIComponent(item.id)}`;
      li.append(top,audio);
      if (item.note) { const p = document.createElement('p'); p.textContent = item.note; li.append(p); }
      const profile = document.createElement('a'); profile.href = `/profile.html?id=${encodeURIComponent(item.member_id)}`; profile.textContent = 'View Profile »'; li.append(profile);
      list.append(li);
    }
  }
  async function load() {
    if (!user) return;
    try {
      const data = await request('/api/discovery/status');
      if (!user) return;
      owner = data.is_owner === true;
      panel.hidden = owner;
      ownerPanel.hidden = !owner;
      if (owner) {
        const inbox = await request('/api/discovery');
        renderOwner(Array.isArray(inbox.submissions) ? inbox.submissions : []);
      } else if (data.submitted_today) {
        sentToday=true;
        controls(true);
        report("You already sent today's song. Come back tomorrow with your next best one.", 'success');
        send.textContent = 'Sent for Today';
      } else {
        controls(false); send.textContent = 'Send My Best Song';
        report('One song a day. Make it your best one.');
      }
    } catch (error) {
      if (expired(error)) return;
      report('Discovery could not load just now. Try again in a moment.', 'error');
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!user || owner || busy || !form.reportValidity()) return;
    const file = song.files?.[0];
    if (!file) return report('Choose one song from your phone first.', 'error');
    if (!file.size || file.size > 100 * 1024 * 1024) return report('Choose an MP3, M4A or WAV up to 100 MB.', 'error');
    if(selectedFile!==file){selectedFile=file;uploadRequestId=crypto.randomUUID();}
    const epoch=generation;
    busy = true; controls(true); send.textContent = 'Sending…'; report('Sending your best one to J.White…');
    let body = new FormData(); body.set('title', title.value.trim()); body.set('note', note.value.trim()); body.set('song', file, file.name);
    try {
      let headers;
      if(file.size>3*1024*1024) {
        const uploadId=await transferSong(file,{kind:'discovery',request,requestId:uploadRequestId,isCurrent:()=>Boolean(user&&generation===epoch),onProgress:percent=>report(`Uploading your song: ${percent}%. Keep this page open.`)});
        headers={'Content-Type':'application/json'};body=JSON.stringify({upload_id:uploadId,title:title.value.trim(),note:note.value.trim()});
      }
      const data = await request('/api/discovery/submit', {method:'POST', body, headers});
      if(!user || generation!==epoch)return;
      sentToday=true;
      form.reset(); send.textContent = 'Sent for Today'; controls(true); report(data.message || "Sent to J.White. That's your one for today.", 'success');
    } catch (error) {
      if(!user || generation!==epoch)return;
      if (expired(error)) return;
      if (error.status === 429 && /already sent/i.test(error.message)) { sentToday=true; send.textContent = 'Sent for Today'; controls(true); report(error.message, 'success'); }
      else { send.textContent = 'Send My Best Song'; controls(false); report(error.message || 'That song could not send. Try again.', 'error'); }
    } finally { if(generation===epoch){busy=false;controls(sentToday);} }
  });
  return { setUser(next) { clear(); user = next || null; if (user) void load(); }, clear };
}
