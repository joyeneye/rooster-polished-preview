import {bookingURL, dateLabel, leadType, matchingLeads, memberID, money, moneyGroups, paymentPreferences, paymentStatusLabel, platformFeeLabel, replyDraft, reserveEstimate, sourceURL, taxCheckIn} from './mona-model.mjs';

export function createMonaWorkspace({document: doc = document, window: win = window, fetch: requestFetch = (...args) => window.fetch(...args)} = {}) {
  const byId = id => doc.getElementById(id);
  if (!byId('mona-root')) return null;
  let epoch = 0, workspace = null, profile = {}, bookings = null, results = [], busy = false, conflicted = false, dead = false, preciseLocation = null;
  const controllers = new Set(), listeners = [], locks = new Map();
  const app = byId('mona-app'), gate = byId('mona-gate'), form = byId('mona-find-form'), notice = byId('mona-notice');
  function el(tag, text, className) { const node = doc.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; }
  function listen(node, event, callback) { node.addEventListener(event, callback); listeners.push(() => node.removeEventListener(event, callback)); }
  function button(text, handler, className = '') { const node = el('button', text, `mona-button ${className}`.trim()); node.type = 'button'; node.addEventListener('click', handler); return node; }
  function link(text, href, className = '', external = false) { const node = el('a', text, className); node.href = href; if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; } return node; }
  function setBusy(value) {
    busy = value;
    app.setAttribute('aria-busy', String(value));
    if (value) for (const node of app.querySelectorAll('input,textarea,select,button:not([data-mona-tab])')) { locks.set(node, node.disabled); node.disabled = true; }
    else { for (const [node, disabled] of locks) node.disabled = disabled; locks.clear(); }
  }
  function clearPrivate() {
    epoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear(); setBusy(false);
    workspace = null; profile = {}; bookings = null; results = []; conflicted = false; preciseLocation = null;
    app.hidden = true; gate.hidden = false;
    form.reset(); form.dataset.edited = ''; byId('mona-find-button').textContent = 'Find opportunities ↗';
    byId('mona-results').replaceChildren(); byId('mona-saved').replaceChildren(); byId('mona-booking-content').replaceChildren();
    byId('mona-search-status').textContent = ''; byId('mona-search-status').dataset.loading = 'false';
    byId('mona-booking-status').textContent = ''; byId('mona-lead-count').textContent = '0';
    notice.replaceChildren(); notice.hidden = true;
  }
  function showGate(title, text, {login = false, retry = false} = {}) {
    gate.replaceChildren(el('h2', title), el('p', text)); gate.hidden = false; app.hidden = true;
    if (login) gate.append(link('Log in to Mona', '/members?next=%2Fmona', 'mona-button mona-primary'));
    if (retry) gate.append(button('Try again', () => void boot(), 'mona-primary'));
  }
  function authorization(status) {
    clearPrivate();
    if (status === 403) showGate('Your Mona is waiting.', 'Your ROOSTER membership needs approval before you can open private work tools.', {login:true});
    else showGate('Your work deserves its own Mona.', 'Log in to find opportunities and keep your leads and bookings together.', {login:true});
  }
  function report(text, reload = false) {
    notice.replaceChildren(el('span', text)); notice.hidden = false;
    if (reload) notice.append(button('Refresh my leads', () => void refreshWorkspace(), 'mona-gold'));
  }
  async function request(path, options = {}) {
    const generation = epoch, controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), path.endsWith('/scout') ? 45000 : 18000);
    try {
      const response = await requestFetch(path, {credentials:'same-origin',cache:'no-store',...options,signal:controller.signal,headers:{Accept:'application/json',...(options.body ? {'Content-Type':'application/json'} : {}),...options.headers}});
      const data = await response.json().catch(() => ({}));
      if (generation !== epoch || dead) throw Object.assign(new Error('Stale session'), {stale:true});
      if (response.status === 401 || response.status === 403) { authorization(response.status); throw Object.assign(new Error('Membership required'), {stale:true}); }
      if (!response.ok) throw Object.assign(new Error(data.error || data.message || 'Mona could not finish that. Please try again.'), {status:response.status});
      const id = path === '/api/profile/me' ? data.profile?.id : data.memberId;
      if (!memberID(id) || workspace && id.toLowerCase() !== workspace.memberId.toLowerCase()) {
        clearPrivate(); showGate('Your session changed.', 'Open Mona again to continue with the current account.', {retry:true});
        throw Object.assign(new Error('Session changed'), {stale:true});
      }
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function tab(name) {
    for (const node of app.querySelectorAll('[data-mona-tab]')) node.setAttribute('aria-pressed', String(node.dataset.monaTab === name));
    for (const node of app.querySelectorAll('[data-mona-panel]')) node.hidden = node.dataset.monaPanel !== name;
  }
  function preferences() {
    const radius = byId('mona-radius')?.value || '25';
    return {profession:byId('mona-profession').value.trim(),location:byId('mona-location').value.trim(),offering:byId('mona-offering').value.trim(),goal:byId('mona-goal').value,radius:radius === 'remote' ? 'remote' : Number(radius)};
  }
  function fillPreferences(saved) {
    const described = win.RoosterProfileProfession?.describe(profile) || {};
    const defaults = {profession:described.label || profile.profession || '',location:profile.location || '',offering:'',goal:'clients',radius:25};
    for (const key of ['profession','location','offering','goal','radius']) {
      const node = byId(`mona-${key}`), value = saved?.[key] || defaults[key];
      if (!node) continue;
      node.value = String(value).replace(/\s+/g, ' ').slice(0, key === 'profession' ? 80 : key === 'location' ? 100 : key === 'offering' ? 240 : 20);
    }
  }
  function updateWorkspace(data, fill = false) {
    if (!data || !memberID(data.memberId) || !Array.isArray(data.leads) || !Object.hasOwn(data, 'revision')) throw new Error('Your saved work could not be opened. Please refresh Mona.');
    workspace = data;
    if (fill) fillPreferences(data.preferences);
    byId('mona-lead-count').textContent = String(data.leads.filter(lead => lead.status !== 'archived').length);
    renderSaved(); renderResults(); if (bookings) renderPaymentBeta();
  }
  async function refreshWorkspace() {
    if (busy || !workspace) return;
    setBusy(true); const generation = epoch;
    try { updateWorkspace(await request('/api/mona/workspace'), true); conflicted = false; report('Your saved leads are up to date. You can make your change now.'); }
    catch (error) { if (!error.stale && generation === epoch) report(error.message, true); }
    finally { if (generation === epoch) setBusy(false); }
  }
  async function mutate(payload, successMessage) {
    if (busy || !workspace) return false;
    if (conflicted) { report('Your leads changed in another window. Refresh before saving again.', true); return false; }
    const generation = epoch; setBusy(true);
    try {
      const data = await request('/api/mona/workspace', {method:'POST',body:JSON.stringify({...payload,revision:workspace.revision})});
      updateWorkspace(data); if (successMessage) report(successMessage); return true;
    } catch (error) {
      if (!error.stale && generation === epoch) { if (error.status === 409) conflicted = true; report(error.status === 409 ? 'Your leads changed in another window. Refresh before saving your change.' : error.message, conflicted); }
      return false;
    } finally { if (generation === epoch) setBusy(false); }
  }
  function safeBookingBusinesses() {
    return (bookings?.businesses || []).map(business => ({...business,url:business.published && business.servicesCount > 0 ? bookingURL(business.bookingUrl, win.location.origin) : null})).filter(business => business.url);
  }
  async function copyText(value, status) {
    try { if (!win.navigator.clipboard?.writeText) throw new Error('Copy unavailable'); await win.navigator.clipboard.writeText(value); status.textContent = 'Copied. Paste it when you’re ready.'; }
    catch { status.textContent = 'Copy is unavailable here. Select the text and copy it manually.'; }
  }
  function draftPanel(lead) {
    const panel = el('section', undefined, 'mona-draft'), label = el('label', 'Make this reply yours');
    const draft = el('textarea'); draft.rows = 7; draft.maxLength = 3000;
    const draftId = `mona-draft-${lead.id}`; draft.id = draftId; label.htmlFor = draftId;
    draft.value = replyDraft({profile,preferences:workspace?.preferences || {},lead});
    panel.append(label, el('p', 'A starter template you can edit. Nothing is sent for you.', 'mona-small'), draft);
    const businesses = safeBookingBusinesses();
    if (businesses.length) {
      const bookingLabel = el('label', 'Add my booking page', 'mona-draft-booking'), select = el('select');
      select.setAttribute('aria-label', 'Choose a booking page to add'); select.append(el('option', 'Choose a booking page…')); select.firstChild.value = '';
      for (const business of businesses) { const option = el('option', business.name); option.value = business.url; select.append(option); }
      bookingLabel.append(select); panel.append(bookingLabel);
      select.addEventListener('change', () => { if (businesses.some(business => business.url === select.value) && !draft.value.includes(select.value)) draft.value = `${draft.value.trim()}\n\nMy booking page: ${select.value}`; });
    }
    const status = el('p', '', 'mona-inline-status'); status.setAttribute('role','status');
    const actions = el('div', undefined, 'mona-card-actions'); actions.append(button('Copy reply', () => void copyText(draft.value, status), 'mona-gold'));
    const source = sourceURL(lead.sourceUrl); if (source) actions.append(link('Open opportunity ↗', source, 'mona-button', true));
    panel.append(actions, status); return panel;
  }
  function leadCard(lead, saved = false) {
    const card = el('article', undefined, 'mona-card'), source = sourceURL(lead.sourceUrl);
    const top = el('div', undefined, 'mona-card-top'); top.append(el('span',leadType(lead.type),'mona-tag'),el('span',lead.organization || '', 'mona-card-organization'));
    card.append(top,el('h3',lead.title),el('p',lead.location,'mona-card-location'),el('p',lead.summary));
    const fit = el('div',undefined,'mona-fit'); fit.append(el('strong','Why Mona picked this'),el('p',lead.whyItFits)); card.append(fit);
    const next = el('p'); next.append(el('strong','Your next step: '),doc.createTextNode(String(lead.nextStep || 'Check the source for current requirements.'))); card.append(next);
    const detail = el('div',undefined,'mona-card-details'); detail.append(el('span',`Terms: ${lead.compensation || 'Not stated'}`));
    if (lead.deadline) detail.append(el('span',`Deadline: ${dateLabel(`${lead.deadline}T12:00:00Z`)}`));
    card.append(detail);
    const actions = el('div',undefined,'mona-card-actions');
    if (source) actions.append(link('View opportunity ↗',source,'mona-button',true));
    if (!saved) {
      const exists = workspace?.leads.some(item => item.id === lead.id);
      const save = button(exists ? 'Saved ✓' : 'Save lead', () => void mutate({action:'save',leadId:lead.id,checkedAt:lead.checkedAt},'Lead saved. Find it in My leads.'),'mona-gold');
      save.disabled = Boolean(exists) || !source; actions.append(save);
    }
    const prepare = button('Prepare a reply', () => {
      const existing = card.querySelector('.mona-draft');
      if (existing) { existing.hidden = !existing.hidden; prepare.setAttribute('aria-expanded',String(!existing.hidden)); }
      else { card.append(draftPanel(lead)); prepare.setAttribute('aria-expanded','true'); }
    }); prepare.setAttribute('aria-expanded','false'); actions.append(prepare); card.append(actions);
    const attribution = el('div',undefined,'mona-source');
    if (source) attribution.append(link(lead.sourceTitle || new URL(source).hostname,source,'',true));
    else attribution.append(el('span','Source link unavailable. Refresh Mona before taking action.'));
    attribution.append(el('span',`Found ${dateLabel(lead.checkedAt)} · Check the source for current availability.`)); card.append(attribution);
    if (saved) {
      const tools = el('div',undefined,'mona-saved-tools'), statusLabel = el('label', 'My next step', 'mona-note-label'), status = el('select');
      status.setAttribute('aria-label',`Status for ${lead.title}`);
      for (const [value,text] of [['saved','Saved'],['contacted','Contacted'],['booked','Booked by me'],['archived','Archived']]) { const option = el('option',text); option.value = value; status.append(option); }
      status.value = lead.status || 'saved'; statusLabel.append(status);
      const notesLabel = el('label','My notes','mona-note-label'), notes = el('textarea'); notes.maxLength = 2000; notes.rows = 2; notes.value = lead.notes || ''; notes.placeholder = 'What do I want to remember?'; notes.setAttribute('aria-label',`Notes for ${lead.title}`); notesLabel.append(notes);
      const controls = el('div',undefined,'mona-card-actions');
      controls.append(button('Save update',() => void mutate({action:'update',leadId:lead.id,status:status.value,notes:notes.value},'Your lead is updated.')));
      const remove = button('Remove',() => {
        if (remove.dataset.confirm === 'true') { void mutate({action:'remove',leadId:lead.id},'Lead removed from your saved list.'); return; }
        remove.dataset.confirm = 'true'; remove.textContent = 'Remove this lead?';
        const cancel = button('Keep it',() => { remove.dataset.confirm = ''; remove.textContent = 'Remove'; cancel.remove(); }); controls.append(cancel);
      },'mona-text-button'); controls.append(remove); tools.append(statusLabel,notesLabel,controls); card.append(tools);
    }
    return card;
  }
  function empty(title, copy, action, handler) { const node = el('div',undefined,'mona-empty'); node.append(el('h3',title),el('p',copy)); if (action) node.append(button(action,handler,'mona-gold')); return node; }
  function renderResults() { byId('mona-results').replaceChildren(...results.map(lead => leadCard(lead))); }
  function renderSaved() {
    const leads = matchingLeads(workspace?.leads,byId('mona-lead-filter').value);
    byId('mona-saved').replaceChildren(...(leads.length ? leads.map(lead => leadCard(lead,true)) : [empty('Your next opportunity belongs here.', 'Save a match you like. Mona will keep its source, your notes and your next step together.', 'Find opportunities',() => tab('find'))]));
  }
  function renderPaymentBeta(wasOpen) {
    if (!workspace || !bookings) return;
    const root = byId('mona-booking-content'), previous = root.querySelector('.mona-payment-beta');
    const panel = el('details',undefined,'mona-payment-beta');
    panel.open = wasOpen ?? previous?.open ?? false; previous?.remove();
    const saved = paymentPreferences(workspace.paymentPreferences), checkIn = taxCheckIn(workspace);
    const heading = el('summary'); heading.append(el('span','Payments & tax check-in'),el('span','Beta','mona-tag'));
    if (checkIn?.due) heading.append(el('span','Review due','mona-checkin-badge'));
    const content = el('div',undefined,'mona-payment-content');
    content.append(el('p','Let’s get your money organized. Choose your preferences and keep an eye on what has actually been paid.','mona-small'));
    const paymentStatus = el('div',undefined,'mona-payment-status');
    const businesses = Array.isArray(bookings.businesses) ? bookings.businesses : [];
    for (const business of businesses) {
      const line = el('p'); line.append(el('strong',`${business.name}: `),doc.createTextNode(paymentStatusLabel(business.paymentStatus))); paymentStatus.append(line);
    }
    if (!businesses.length) paymentStatus.append(el('p','Set up a booking page to connect your services with payments.'));
    paymentStatus.append(el('p',platformFeeLabel(bookings.paymentInfo)));
    content.append(paymentStatus);
    const settings = el('form',undefined,'mona-form mona-payment-form');
    settings.setAttribute('aria-label','Payment beta preferences');
    function field(id, title, node, help) {
      const wrapper = el('div',undefined,'mona-field'), label = el('label',title); label.htmlFor = id; node.id = id;
      wrapper.append(label,node);
      if (help) { const hint = el('p',help,'mona-small'); hint.id = `${id}-help`; node.setAttribute('aria-describedby',hint.id); wrapper.append(hint); }
      return wrapper;
    }
    function select(options, selected) {
      const node = el('select');
      for (const [value,text] of options) { const item = el('option',text); item.value = value; node.append(item); }
      node.value = selected; return node;
    }
    const frequency = select([['','Choose when…'],['daily','Daily'],['weekly','Weekly']],saved.payoutFrequency || '');
    const day = select(['monday','tuesday','wednesday','thursday','friday'].map(value => [value,value[0].toUpperCase()+value.slice(1)]),saved.weeklyPayoutDay);
    const dayField = field('mona-payout-day','Preferred day',day);
    const updateDay = () => { dayField.hidden = frequency.value !== 'weekly'; };
    frequency.addEventListener('change',updateDay); updateDay();
    settings.append(field('mona-payout-frequency','Preferred payout schedule',frequency,'Beta preference only. Saving this does not activate or change bank transfers.'),dayField);
    const timing = el('p','Available funds, payment setup and your bank affect when money arrives. ','mona-small mona-wide');
    timing.append(link('How payout timing works ↗','https://docs.stripe.com/payouts','',true)); settings.append(timing);
    const percentage = el('input'); percentage.type = 'number'; percentage.min = '0'; percentage.max = '100'; percentage.step = '0.01'; percentage.inputMode = 'decimal'; percentage.placeholder = 'Choose your percentage'; percentage.value = saved.taxReservePercent === null ? '' : String(saved.taxReservePercent);
    const reminder = select([['off','Off'],['monthly','Every month'],['quarterly','Every 3 months']],saved.taxReminder);
    settings.append(field('mona-tax-reserve','My tax planning percentage',percentage,'Optional. Use a percentage that fits your circumstances; Mona does not choose a tax rate.'),field('mona-tax-reminder','Remind me to review my records',reminder,'A check-in inside Mona. This is not a tax deadline or an email reminder.'));
    const estimate = el('div',undefined,'mona-reserve-estimate mona-wide'); estimate.setAttribute('role','status'); estimate.setAttribute('aria-live','polite');
    const readPercentage = () => percentage.value.trim() === '' ? null : /^(?:\d{1,3})(?:\.\d{1,2})?$/.test(percentage.value.trim()) ? Number(percentage.value) : NaN;
    function updateEstimate() {
      const value = readPercentage(), rows = reserveEstimate(bookings?.recordedPayments,value);
      estimate.replaceChildren(el('strong','Your planning estimate'));
      if (value === null) estimate.append(el('p','Choose a percentage to estimate a share of this month’s recorded payments.'));
      else if (!Number.isFinite(value) || value < 0 || value > 100) estimate.append(el('p','Enter a percentage from 0 to 100, with up to two decimal places.'));
      else if (!rows) estimate.append(el('p','Recorded payments are unavailable. Open your bookings again to update the estimate.'));
      else if (!rows.length) estimate.append(el('p','No recorded payments this month to estimate from.'));
      else estimate.append(el('p',`${moneyGroups(rows)} at ${value}%`));
      estimate.append(el('p','This is a planning estimate of recorded charges before fees. It is not money set aside or your tax bill. Refunds and payments outside ROOSTER are not included.','mona-small'));
    }
    percentage.addEventListener('input',updateEstimate); updateEstimate(); settings.append(estimate);
    const save = el('button','Save preferences','mona-button mona-gold'); save.type = 'submit';
    const actions = el('div',undefined,'mona-card-actions mona-wide'); actions.append(save); settings.append(actions);
    settings.addEventListener('submit',async event => {
      event.preventDefault(); if (busy || !workspace || !settings.reportValidity()) return;
      const value = readPercentage();
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) { report('Enter a percentage from 0 to 100, with up to two decimal places.'); return; }
      await mutate({action:'payment-preferences',paymentPreferences:{payoutFrequency:frequency.value || null,weeklyPayoutDay:day.value,taxReservePercent:value,taxReminder:reminder.value}},'Preferences saved. Your payout choice is saved for the beta; no transfers were changed.');
    });
    content.append(settings);
    const review = el('section',undefined,'mona-tax-review'); review.append(el('h3','A little check-in with Mona'));
    if (workspace.taxReviewedAt) review.append(el('p',`You last marked your records reviewed on ${dateLabel(workspace.taxReviewedAt,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}.`));
    if (checkIn?.firstReview) review.append(el('p',`Review your records to start ${saved.taxReminder === 'monthly' ? 'monthly' : 'every-three-month'} check-ins.`));
    else if (checkIn) review.append(el('p',checkIn.due ? 'Your records check-in is due. Review your income, expenses and payment records.' : `Next records check-in: ${dateLabel(checkIn.nextReviewAt,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}.`));
    else review.append(el('p','Review your income and expenses whenever you need. Turn on a check-in above to keep a regular rhythm.'));
    review.append(button('I reviewed my records',() => void mutate({action:'tax-review'},'Your records review is saved. This does not confirm a tax filing or payment.')));
    const taxInfo = el('p','You are responsible for the taxes that apply to your income. Mona helps organize your records; it does not file or pay your taxes. ','mona-small');
    taxInfo.append(link('U.S. estimated tax guidance ↗','https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes','',true)); review.append(taxInfo);
    content.append(review); panel.append(heading,content); root.append(panel);
  }
  function renderBookings() {
    const root = byId('mona-booking-content'), paymentOpen = root.querySelector('.mona-payment-beta')?.open; root.replaceChildren();
    if (!bookings) return;
    const businessList = Array.isArray(bookings.businesses) ? bookings.businesses : [];
    if (!businessList.length) {
      const setup = empty('Make it easy to book you.', 'Add your services and available times. Then share your booking page with people who want to work with you.');
      setup.append(link('Set up my booking page','/booking/dashboard','mona-button mona-gold')); root.append(setup); renderPaymentBeta(paymentOpen); return;
    }
    const metrics = el('div',undefined,'mona-metrics');
    const paymentPeriod = bookings.paymentPeriod ? `${dateLabel(bookings.paymentPeriod.from,{month:'short',day:'numeric',timeZone:'UTC'})} – ${dateLabel(bookings.paymentPeriod.to,{month:'short',day:'numeric',timeZone:'UTC'})} · UTC` : 'This calendar month · UTC';
    const bookedPeriod = bookings.period ? `${dateLabel(bookings.period.from,{month:'short',day:'numeric'})} – ${dateLabel(bookings.period.to,{month:'short',day:'numeric'})}` : 'Next 30 days';
    for (const [label,value,copy] of [['Recorded payments',moneyGroups(bookings.recordedPayments),paymentPeriod],['Booked value',moneyGroups(bookings.bookedValue),`${bookedPeriod} · Not received income`],['Awaiting confirmation',Number.isSafeInteger(bookings.pendingCount) ? String(bookings.pendingCount) : 'Unavailable','Pending appointments · next 30 days']]) {
      const metric = el('article',undefined,'mona-metric'); metric.append(el('span',label,'mona-metric-label'),el('strong',value),el('small',copy)); metrics.append(metric);
    }
    root.append(metrics,el('p',bookings.summaryNote || 'Recorded payments and appointment values are shown separately. Your lead status does not change these totals.','mona-small'));
    root.append(el('h3','Your booking pages','mona-subheading'));
    for (const business of businessList) {
      const card = el('article',undefined,'mona-business'), copy = el('div'), actions = el('div',undefined,'mona-business-actions');
      copy.append(el('h3',business.name),el('p',business.published ? `${business.servicesCount} active ${business.servicesCount === 1 ? 'service' : 'services'}` : 'Finish setup to publish your page'));
      const management = Number.isSafeInteger(business.id) && business.id > 0 ? `/booking/dashboard?businessId=${business.id}` : '/booking/dashboard';
      const url = business.published && business.servicesCount > 0 ? bookingURL(business.bookingUrl,win.location.origin) : null;
      if (url) {
        const status = el('p','','mona-inline-status'); status.setAttribute('role','status'); copy.append(status);
        actions.append(button('Copy booking link',() => void copyText(url,status),'mona-gold'),link('View page ↗',url,'mona-button',true));
      } else actions.append(link('Finish setup',management,'mona-button mona-gold'));
      actions.append(link('Manage',management,'mona-button')); card.append(copy,actions); root.append(card);
    }
    const count = Number.isSafeInteger(bookings.upcomingCount) ? ` (${bookings.upcomingCount})` : '';
    root.append(el('h3',`Coming up${count} · next 30 days`,'mona-subheading'));
    const upcoming = Array.isArray(bookings.upcoming) ? bookings.upcoming : [];
    if (!upcoming.length) root.append(empty('Your calendar has room.', 'Share your booking page in a reply or on your profile. Appointments will appear here when they are booked.'));
    for (const appointment of upcoming) {
      const row = el('article',undefined,'mona-appointment'), date = new Date(appointment.startsAt), validDate = Number.isFinite(date.getTime());
      const copy = el('div'); copy.append(el('h4',appointment.serviceName || 'Appointment'),el('p',appointment.businessName || ''));
      copy.append(el('p',validDate ? date.toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}) : 'Time unavailable'));
      const status = String(appointment.status || '').replace(/_/g,' '); copy.append(el('p',status));
      row.append(el('div',dateLabel(appointment.startsAt,{month:'short',day:'numeric'}),'mona-date'),copy,el('span',money(appointment.priceCents,appointment.currency),'mona-appointment-price')); root.append(row);
    }
    renderPaymentBeta(paymentOpen);
  }
  async function loadBookings(generation = epoch) {
    byId('mona-booking-status').textContent = 'Opening your bookings…';
    try { const data = await request('/api/mona/bookings'); if (generation !== epoch) return; bookings = data; byId('mona-booking-status').textContent = ''; renderBookings(); }
    catch (error) {
      if (error.stale || generation !== epoch) return;
      bookings = null; byId('mona-booking-content').replaceChildren();
      const status = byId('mona-booking-status'); status.replaceChildren(el('p',error.message),button('Retry bookings',() => void loadBookings()));
    }
  }
  async function boot() {
    if (dead) return;
    clearPrivate(); const generation = epoch;
    showGate('Opening your Mona…','Your work, leads and next steps belong here.');
    try {
      updateWorkspace(await request('/api/mona/workspace'),true);
      if (generation !== epoch) return;
      gate.hidden = true; app.hidden = false;
      const savedRevision = workspace.revision;
      const pending = [request('/api/profile/me').then(data => {
        if (generation !== epoch) return;
        profile = data.profile;
        // The member may start typing while their profile is loading.
        if (workspace.revision === savedRevision && !form.dataset.edited) fillPreferences(workspace.preferences);
      }).catch(error => { if (!error.stale && generation === epoch) profile = {}; }),...(byId('mona-location-status') ? [request('/api/mona/scout').then(data => {
        if (generation !== epoch || form.dataset.edited) return;
        const parts = [data.area?.city,data.area?.subdivision,data.area?.country].filter(Boolean);
        if (!byId('mona-location').value && parts.length) byId('mona-location').value = parts.join(', ');
        byId('mona-location-status').textContent = parts.length ? `Approximate area: ${parts.join(', ')}. Confirm it or enter another city or ZIP.` : 'Enter a city or ZIP, or use your device location.';
      }).catch(() => {})] : []),loadBookings(generation)];
      await Promise.allSettled(pending);
    } catch (error) { if (!error.stale && generation === epoch) showGate('Mona couldn’t open your work yet.',error.message,{retry:true}); }
  }
  listen(form,'input',event => { form.dataset.edited = 'true'; if (event.target === byId('mona-location')) preciseLocation = null; if (results.length) { results = []; renderResults(); byId('mona-search-status').textContent = 'Your work details changed. Find opportunities again for fresh matches.'; } });
  if (byId('mona-use-location')) listen(byId('mona-use-location'),'click',() => {
    const status = byId('mona-location-status');
    if (!win.navigator.geolocation) { status.textContent = 'Device location is unavailable. Enter a city or ZIP instead.'; return; }
    status.textContent = 'Asking your device for this search location…';
    win.navigator.geolocation.getCurrentPosition(position => {
      preciseLocation = {latitude:position.coords.latitude,longitude:position.coords.longitude};
      status.textContent = 'Device location is ready for this search. Precise coordinates are discarded after the request.';
    },() => { preciseLocation = null; status.textContent = 'Location was not shared. Enter a city or ZIP instead.'; },{enableHighAccuracy:false,maximumAge:300000,timeout:8000});
  });
  listen(form,'submit',async event => {
    event.preventDefault();
    if (busy || !workspace || !form.reportValidity()) return;
    const values = preferences(), generation = epoch;
    if ([values.profession,values.location,values.offering].some(text => /[<>]|https?:\/\/|[^\s]+@[^\s]+\.[^\s]+/i.test(text))) { report('Use a short description of your work. Leave out links, email addresses and private contact details.'); return; }
    const saved = await mutate({action:'preferences',preferences:values});
    if (!saved || generation !== epoch) return;
    setBusy(true); results = []; renderResults();
    const status = byId('mona-search-status'); status.dataset.loading = 'true'; status.textContent = 'Mona is looking for relevant public opportunities. This can take a moment…';
    byId('mona-find-button').textContent = 'Mona is looking…';
    try {
      const data = await request('/api/mona/scout',{method:'POST',body:JSON.stringify({...values,...(preciseLocation || {})})});
      preciseLocation = null;
      if (data.status === 'ready' && Array.isArray(data.leads)) {
        results = data.leads.filter(lead => typeof lead.id === 'string' && sourceURL(lead.sourceUrl)).slice(0,3);
        status.textContent = results.length ? data.summary || 'Mona found a few possible fits. Open the source to see what comes next.' : 'Mona couldn’t verify a match for this search. Try a more specific offer or a wider area.';
      } else status.textContent = data.summary || 'No verified matches in this search. Try a more specific offer or a wider area.';
      renderResults();
    } catch (error) { if (!error.stale && generation === epoch) status.textContent = error.message; }
    finally { if (generation === epoch) { status.dataset.loading = 'false'; byId('mona-find-button').textContent = 'Find opportunities ↗'; setBusy(false); } }
  });
  listen(byId('mona-lead-filter'),'change',renderSaved);
  for (const node of app.querySelectorAll('[data-mona-tab]')) listen(node,'click',() => tab(node.dataset.monaTab));
  listen(win,'jwhite:session-changed',() => { void boot(); });
  listen(win,'storage',() => { void boot(); });
  listen(win,'pagehide',clearPrivate);
  listen(win,'pageshow',event => { if (event.persisted) void boot(); });
  const ready = boot();
  return {ready,refresh:boot,destroy() { dead = true; clearPrivate(); for (const remove of listeners) remove(); }};
}

if (typeof document !== 'undefined') createMonaWorkspace();
