import { MONEY_CURRENCIES, INCOME_TYPES, normalizeMoneyData, summarizeMoney, parseMoneyAmount, formatMoney, currencyDigits } from './rcm-money.mjs?v=20260911-comanager-v2';

(function () {
  'use strict';

  const state = {
    tool: '',
    example: false,
    records: [],
    authenticated: true,
    loading: true,
    recordId: null,
    loadError: '',
    moneyRecords: [],
    moneyLoading: true,
    moneyError: '',
    currency: '',
    asking: false,
  };

  const els = {
    home: document.getElementById('manager-home'),
    workspace: document.getElementById('manager-workspace'),
    stuff: document.getElementById('manager-stuff'),
    help: document.getElementById('manager-help'),
    money: document.getElementById('manager-money'),
    workspaceBody: document.getElementById('workspace-body'),
    workspaceTitle: document.getElementById('workspace-title'),
    workspaceKicker: document.getElementById('workspace-kicker'),
    exampleBanner: document.getElementById('example-banner'),
    savedList: document.getElementById('saved-list'),
    savedStatus: document.getElementById('saved-status'),
    printSheet: document.getElementById('print-sheet'),
    toast: document.getElementById('manager-toast'),
  };

  const titles = {
    song: 'Add a Song',
    split: 'Make a Split Sheet',
    show: 'Add a Show',
    person: 'Add a Person',
    money: 'Add Income',
  };

  const examples = {
    song: {
      title: 'After Midnight',
      artist: 'Kori Miles',
      collaborators: 'Kori Miles, Marcus Vale, Jae Rivers',
      isrc: 'US-ABC-26-00123',
      notes: 'Alternative R&B single. Final mix approved.',
    },
    show: {
      title: 'The Foundry Live', date: '2026-09-26', venue: 'The Foundry',
      city: 'Atlanta, GA', fee: '4000', contact: 'Taylor at The Foundry',
      notes: 'Soundcheck at 6:30 PM. Deposit due before show day.',
    },
    person: {
      name: 'Marcus Vale', role: 'Producer', company: 'Vale Sound',
      email: 'marcus@example.com', phone: '(555) 010-2026', notes: 'Worked together on After Midnight.',
    },
    split: {
      song_title: 'After Midnight', artist: 'Kori Miles', date: '2026-09-10',
      contributors: [
        {name: 'Kori Miles', role: 'Writer / Artist', share: 50},
        {name: 'Marcus Vale', role: 'Producer / Composer', share: 25},
        {name: 'Jae Rivers', role: 'Writer', share: 25},
      ],
    },
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function slug(value) {
    return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 180);
  }

  function notify(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => { els.toast.hidden = true; }, 3600);
  }

  function setPage(page) {
    els.home.hidden = page !== 'home';
    els.workspace.hidden = page !== 'workspace';
    els.stuff.hidden = page !== 'stuff';
    els.help.hidden = page !== 'help';
    els.money.hidden = page !== 'money';
    if (page === 'money') renderMoney();
    history.replaceState(null, '', page === 'home' ? location.pathname : '#' + (page === 'workspace' ? 'new-' + state.tool : page));
    document.querySelectorAll('[data-manager-view]').forEach((button) => {
      const view = button.dataset.managerView;
      const current = view === page || (page === 'workspace' && view === state.tool);
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const section = page === 'workspace' ? els.workspace : els[page];
    const heading = section?.querySelector('h1, h2');
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll: true}); }
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function blankFor(tool) {
    if (tool === 'money') return {source: '', song_title: '', currency: 'USD', income_type: 'Publishing', earned_cents: 0, paid_cents: 0, expected_date: '', paid_date: '', period: '', territory: '', statement_reference: '', notes: ''};
    if (tool === 'split') return {song_title: '', artist: '', date: '', contributors: [{name: '', role: 'Writer', share: ''}]};
    if (tool === 'song') return {title: '', artist: '', collaborators: '', isrc: '', notes: ''};
    if (tool === 'show') return {title: '', date: '', venue: '', city: '', fee: '', contact: '', notes: ''};
    return {name: '', role: '', company: '', email: '', phone: '', notes: ''};
  }

  function normalizeRecord(tool, record) {
    if (!record) return blankFor(tool);
    const data = record.data && typeof record.data === 'object' ? record.data : {};
    if (tool === 'money') return {...blankFor('money'), ...data};
    if (tool === 'song') return {
      title: record.title || data.title || '', artist: data.artist || '',
      collaborators: data.collaborators || (Array.isArray(data.contributors) ? data.contributors.join(', ') : ''),
      isrc: data.isrc || '', notes: data.notes || '',
    };
    if (tool === 'show') return {
      title: record.title || data.title || '', date: data.date || '', venue: data.venue || '',
      city: data.city || data.location || '', fee: data.fee || '', contact: data.contact || '', notes: data.notes || '',
    };
    if (tool === 'person') return {
      name: record.title || data.name || '', role: data.role || '', company: data.company || '',
      email: data.email || '', phone: data.phone || '', notes: data.notes || '',
    };
    const contributors = Array.isArray(data.contributors) && data.contributors.length
      ? data.contributors.map((person) => ({name: person.name || '', role: person.role || 'Writer', share: person.share ?? person.percent ?? ''}))
      : [{name: '', role: 'Writer', share: ''}];
    return {
      song_title: data.song_title || data.songTitle || String(record.title || '').replace(/\s+Split Sheet$/i, ''),
      artist: data.artist || '', date: data.date || '', contributors,
    };
  }

  function contributorRow(person = {}) {
    const roles = ['Writer', 'Producer', 'Artist', 'Composer', 'Writer / Artist', 'Producer / Composer', 'Other'];
    return `<div class="contributor">
      <label><span class="sr-only">Person's name</span><input class="contributor-name" maxlength="100" placeholder="Person's name" value="${esc(person.name || '')}" required></label>
      <label><span class="sr-only">Role</span><select class="contributor-role">${roles.map((role) => `<option${role === person.role ? ' selected' : ''}>${esc(role)}</option>`).join('')}</select></label>
      <label><span class="sr-only">Ownership percent</span><input class="contributor-share" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="0%" value="${esc(person.share ?? '')}" required></label>
      <button type="button" class="remove-person" data-remove-person aria-label="Remove this person">×</button>
    </div>`;
  }

  function decimalAmount(value, currency) {
    const digits = currencyDigits(currency), scale = 10n ** BigInt(digits), units = BigInt(value);
    return `${units / scale}${digits ? '.' + (units % scale).toString().padStart(digits, '0') : ''}`;
  }

  function moneyForm(data) {
    const amount = (value) => decimalAmount(value, data.currency);
    const options = (values, selected) => values.map(value => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('');
    return `<form id="tool-form" class="form-card">
      <p class="form-tip">Add your share from a statement, invoice, or payment record. Enter each item once. Updating “Paid so far” keeps the same record.</p>
      <div class="field-grid">
        <label class="field">Who pays you?<input name="source" maxlength="120" value="${esc(data.source)}" placeholder="Publisher, distributor, client…" required></label>
        <label class="field">Song or project <span class="optional">optional</span><input name="song_title" maxlength="180" value="${esc(data.song_title)}" placeholder="Song title or project name" list="money-song-options"><datalist id="money-song-options">${state.records.filter(record => record.kind === 'song').map(record => `<option value="${esc(record.title)}"></option>`).join('')}</datalist></label>
        <label class="field">Income type<select name="income_type">${options(INCOME_TYPES, data.income_type)}</select></label>
        <label class="field">Currency<select name="currency">${options(MONEY_CURRENCIES, data.currency)}</select></label>
        <label class="field">Your earnings<input name="earned" inputmode="decimal" maxlength="24" value="${state.recordId ? amount(data.earned_cents) : ''}" placeholder="0.00" required><span class="optional">Your amount after any agreed splits or fees.</span></label>
        <label class="field">Paid so far<input name="paid" inputmode="decimal" maxlength="24" value="${data.paid_cents ? amount(data.paid_cents) : '0'}" placeholder="0.00" required><span class="optional">Already received. Leave at 0 if unpaid.</span></label>
        <label class="field">Expected payment date <span class="optional">optional</span><input name="expected_date" type="date" value="${esc(data.expected_date)}"></label>
        <label class="field">Last payment date <span class="optional">optional</span><input name="paid_date" type="date" value="${esc(data.paid_date)}"></label>
      </div>
      <details class="money-details"><summary>Add statement details <span class="optional">optional</span></summary><div class="field-grid">
        <label class="field">Earning period<input name="period" maxlength="80" value="${esc(data.period)}" placeholder="Example: July–September 2026"></label>
        <label class="field">Territory<input name="territory" maxlength="100" value="${esc(data.territory)}" placeholder="Example: United States or Worldwide"></label>
        <label class="field full">Statement or invoice reference<input name="statement_reference" maxlength="180" value="${esc(data.statement_reference)}" placeholder="A reference to find this payment later"></label>
        <label class="field full">Notes<textarea name="notes" maxlength="2000" placeholder="Anything you want to remember">${esc(data.notes)}</textarea></label>
      </div></details>
      <p class="form-tip">Changing the currency labels the amounts you enter; it does not convert them. Use whole amounts for JPY.</p>
      <div class="form-actions"><button type="submit" class="primary-button">Save Income</button></div>
    </form>`;
  }

  async function loadMoney() {
    state.moneyLoading = true; state.moneyError = ''; renderMoney();
    try {
      const response = await fetch('/api/rcm/workspace?view=money', {credentials: 'same-origin', headers: {Accept: 'application/json'}});
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || 'Your money records could not load. Please try again.'), {status: response.status});
      if (!Array.isArray(body.records)) throw new Error('Your money records could not load. Please try again.');
      state.moneyRecords = body.records;
    } catch (error) {
      state.moneyError = error.status === 401 || error.status === 403 ? 'Log in to see your private money records.' : error.message;
    } finally {
      state.moneyLoading = false; renderMoney();
    }
  }

  function renderMoney() {
    const status = document.getElementById('money-status');
    const content = document.getElementById('money-content');
    status.hidden = false; content.hidden = true; status.replaceChildren();
    if (state.moneyLoading) { status.textContent = 'Checking your money records…'; return; }
    if (state.moneyError) {
      status.textContent = state.moneyError;
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'small-button'; retry.textContent = 'Try Again'; retry.onclick = () => void loadMoney();
      const login = document.createElement('a'); login.href = '/members.html'; login.textContent = 'Open Account';
      status.append(' ', retry, ' ', login); return;
    }
    let summary;
    try { summary = summarizeMoney(state.moneyRecords); } catch { status.textContent = 'These totals could not be calculated. Review your income records before relying on a balance.'; return; }
    if (!summary.entries.length) {
      status.textContent = summary.unrecognized_count ? 'Your older royalty notes are still saved. Add confirmed income amounts here to start tracking your money.' : 'Your money story starts here. Add your first income record to see earnings, payments, and what’s still owed.';
      const add = document.createElement('button'); add.type = 'button'; add.className = 'primary-button'; add.textContent = 'Add My First Income'; add.onclick = () => openTool('money'); status.append(document.createElement('br'), add); return;
    }
    status.hidden = true; content.hidden = false;
    if (!summary.currencies.some(group => group.currency === state.currency)) state.currency = summary.currencies[0].currency;
    const currency = state.currency;
    document.getElementById('money-currency').innerHTML = summary.currencies.map(group => `<option${group.currency === currency ? ' selected' : ''}>${esc(group.currency)}</option>`).join('');
    const totals = summary.currencies.find(group => group.currency === currency);
    document.getElementById('money-totals').innerHTML = [
      ['Recorded earnings', totals.earned_cents, 'Your share entered in ROOSTER'],
      ['Paid to you', totals.paid_cents, 'Marked as received by you'],
      ['Still owed', totals.outstanding_cents, 'Earnings minus paid so far'],
    ].map(([label, amount, detail]) => `<article><span>${label}</span><strong>${esc(formatMoney(amount, currency))}</strong><small>${detail}</small></article>`).join('');
    const attention = document.getElementById('money-attention');
    attention.textContent = totals.overdue_cents > 0 ? `${formatMoney(totals.overdue_cents, currency)} is past the expected payment date you entered. Check the records below and follow up with the payer.` : 'No past-due payments in these records. Add an expected date to keep track of follow-ups.';
    attention.dataset.overdue = String(totals.overdue_cents > 0);
    if (summary.unrecognized_count) attention.append(` ${summary.unrecognized_count} older or incomplete royalty record(s) are excluded from totals.`);
    function breakdown(id, rows, key) {
      document.getElementById(id).innerHTML = rows.slice().sort((a,b) => b.earned_cents - a.earned_cents).map(row => `<li><div><strong>${esc(row[key] || 'No song linked')}</strong><span>${esc(formatMoney(row.earned_cents, currency))}</span></div><progress max="${Math.max(1, totals.earned_cents)}" value="${row.earned_cents}" aria-label="${esc(row[key] || 'No song linked')} share of recorded earnings"></progress><small>${esc(formatMoney(row.outstanding_cents, currency))} still owed</small></li>`).join('');
    }
    breakdown('money-sources', totals.sources, 'source'); breakdown('money-songs', totals.songs, 'song_title');
    const filter = document.getElementById('money-filter').value;
    const entries = summary.entries.filter(entry => entry.currency === currency && (filter === 'all' || filter === 'paid' && entry.status === 'paid' || filter === 'overdue' && entry.status === 'overdue' || filter === 'outstanding' && entry.earned_cents > entry.paid_cents));
    const list = document.getElementById('money-list');
    const labels = {paid: 'Paid', 'part-paid': 'Part paid', unpaid: 'Unpaid', overdue: 'Past due'};
    list.innerHTML = entries.length ? entries.map(entry => `<li class="income-card"><div class="income-copy"><span class="income-status" data-status="${entry.status}">${labels[entry.status]}</span><strong>${esc(entry.song_title || entry.source)}</strong><span>${esc(entry.source)} · ${esc(entry.income_type)}</span><small>${esc([entry.period, entry.territory, entry.expected_date ? 'Expected ' + entry.expected_date : '', entry.statement_reference ? 'Ref: ' + entry.statement_reference : ''].filter(Boolean).join(' · '))}</small><small>Record #${esc(entry.id)}</small></div><div class="income-amount"><strong>${esc(formatMoney(entry.earned_cents, currency))}</strong><small>${esc(formatMoney(entry.paid_cents, currency))} paid</small><small>${esc(formatMoney(entry.earned_cents - entry.paid_cents, currency))} still owed</small></div><button type="button" class="small-button" data-edit-money="${esc(entry.id)}">Update</button></li>`).join('') : '<li class="empty-state">No records match this filter.</li>';
    list.querySelectorAll('[data-edit-money]').forEach(button => button.addEventListener('click', () => {
      const record = state.moneyRecords.find(record => String(record.id) === button.dataset.editMoney);
      if (record) openTool('money', {record});
    }));
  }

  function exportMoney() {
    if (state.moneyLoading || state.moneyError) return;
    const entries = summarizeMoney(state.moneyRecords).entries;
    if (!entries.length) return;
    const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, char => "'" + char).replace(/"/g, '""') + '"';
    const columns = ['Record ID', 'Song or project', 'Payer', 'Income type', 'Currency', 'Recorded earnings', 'Paid so far', 'Still owed', 'Expected date', 'Last payment date', 'Earning period', 'Territory', 'Statement reference', 'Status'];
    const rows = entries.map(entry => { const amount = value => decimalAmount(value, entry.currency); return [entry.id, entry.song_title, entry.source, entry.income_type, entry.currency, amount(entry.earned_cents), amount(entry.paid_cents), amount(entry.earned_cents-entry.paid_cents), entry.expected_date, entry.paid_date, entry.period, entry.territory, entry.statement_reference, entry.status]; });
    const blob = new Blob(['\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'ROOSTER-My-Money.csv'; document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function songForm(data) {
    return `<form id="tool-form" class="form-card">
      <div class="field-grid">
        <label class="field full">Song title<input name="title" maxlength="180" value="${esc(data.title)}" placeholder="What is the song called?" required></label>
        <label class="field">Main artist<input name="artist" maxlength="100" value="${esc(data.artist)}" placeholder="Artist name"></label>
        <label class="field">Writers and producers<input name="collaborators" maxlength="400" value="${esc(data.collaborators)}" placeholder="Type their names"></label>
        <label class="field">ISRC <span class="optional">optional</span><input name="isrc" maxlength="40" value="${esc(data.isrc)}" placeholder="Add it later if needed"></label>
        <label class="field full">Notes <span class="optional">optional</span><textarea name="notes" maxlength="2000" placeholder="Anything you want to remember">${esc(data.notes)}</textarea></label>
      </div>
      <p class="form-tip">That is enough to start. You can add more later.</p>
      <div class="form-actions"><button class="primary-button" type="submit">Save Song</button></div>
    </form>`;
  }

  function showForm(data) {
    return `<form id="tool-form" class="form-card">
      <div class="field-grid">
        <label class="field full">Show name<input name="title" maxlength="180" value="${esc(data.title)}" placeholder="What is the show called?" required></label>
        <label class="field">Date<input name="date" type="date" value="${esc(data.date)}"></label>
        <label class="field">Venue<input name="venue" maxlength="120" value="${esc(data.venue)}" placeholder="Where is it?"></label>
        <label class="field">City<input name="city" maxlength="100" value="${esc(data.city)}" placeholder="City, State"></label>
        <label class="field">Pay<input name="fee" maxlength="30" inputmode="decimal" value="${esc(data.fee)}" placeholder="$0"></label>
        <label class="field full">Contact person<input name="contact" maxlength="120" value="${esc(data.contact)}" placeholder="Who booked it?"></label>
        <label class="field full">Notes <span class="optional">optional</span><textarea name="notes" maxlength="2000" placeholder="Soundcheck, deposit, travel, or anything else">${esc(data.notes)}</textarea></label>
      </div>
      <div class="form-actions"><button class="primary-button" type="submit">Save Show</button></div>
    </form>`;
  }

  function personForm(data) {
    return `<form id="tool-form" class="form-card">
      <div class="field-grid">
        <label class="field full">Name<input name="name" maxlength="180" value="${esc(data.name)}" placeholder="Person or company name" required></label>
        <label class="field">What do they do?<input name="role" maxlength="80" value="${esc(data.role)}" placeholder="Producer, manager, venue…"></label>
        <label class="field">Company <span class="optional">optional</span><input name="company" maxlength="120" value="${esc(data.company)}" placeholder="Company name"></label>
        <label class="field">Email <span class="optional">optional</span><input name="email" type="email" maxlength="180" value="${esc(data.email)}" placeholder="name@example.com"></label>
        <label class="field">Phone <span class="optional">optional</span><input name="phone" type="tel" maxlength="40" value="${esc(data.phone)}" placeholder="Phone number"></label>
        <label class="field full">Notes <span class="optional">optional</span><textarea name="notes" maxlength="2000" placeholder="How do you know them?">${esc(data.notes)}</textarea></label>
      </div>
      <div class="form-actions"><button class="primary-button" type="submit">Save Person</button></div>
    </form>`;
  }

  function splitForm(data) {
    return `<form id="tool-form" class="form-card split-card">
      <div class="split-main">
        <div class="field-grid">
          <label class="field full">Song title<input name="song_title" maxlength="180" value="${esc(data.song_title)}" placeholder="What is the song called?" required></label>
          <label class="field">Main artist<input name="artist" maxlength="100" value="${esc(data.artist)}" placeholder="Artist name"></label>
          <label class="field">Date<input name="date" type="date" value="${esc(data.date)}"></label>
        </div>
        <div class="stack" style="margin-top:20px">
          <span class="field-label">Who made the song?</span>
          <p class="form-tip">Add every writer and producer, then enter each person's ownership.</p>
          <div id="contributors" class="contributors">${data.contributors.map(contributorRow).join('')}</div>
          <button type="button" id="add-person" class="small-button">+ Add Another Person</button>
        </div>
        <div class="split-tools">
          <button class="primary-button" type="submit">Save Split Sheet</button>
          <button class="secondary-button" type="button" id="print-pdf">Download PDF / Print</button>
        </div>
      </div>
      <aside id="split-side" class="split-side" data-valid="false">
        <small>TOTAL OWNERSHIP</small>
        <strong id="split-total" class="split-total">0%</strong>
        <div class="split-meter"><i id="split-meter"></i></div>
        <p id="split-message" class="split-message">Enter the percentages. They must equal 100%.</p>
      </aside>
    </form>`;
  }

  function openTool(tool, {example = false, record = null} = {}) {
    if (!titles[tool]) return;
    state.tool = tool;
    state.example = example;
    state.recordId = record?.id || null;
    els.workspaceTitle.textContent = record && tool === 'money' ? 'Update Income' : titles[tool];
    els.workspaceKicker.textContent = example ? 'TRY THIS EXAMPLE' : 'ONE EASY STEP';
    els.exampleBanner.hidden = !example;
    const data = example ? examples[tool] : normalizeRecord(tool, record);
    els.workspaceBody.innerHTML = tool === 'money' ? moneyForm(data) : tool === 'song' ? songForm(data)
      : tool === 'show' ? showForm(data)
        : tool === 'person' ? personForm(data)
          : splitForm(data);
    bindToolForm(tool);
    setPage('workspace');
  }

  function formDataObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function splitData() {
    const form = document.getElementById('tool-form');
    const base = formDataObject(form);
    base.contributors = [...document.querySelectorAll('.contributor')].map((row) => ({
      name: row.querySelector('.contributor-name').value.trim(),
      role: row.querySelector('.contributor-role').value,
      share: Number(row.querySelector('.contributor-share').value || 0),
    })).filter((person) => person.name || person.share);
    return base;
  }

  function splitTotal() {
    return [...document.querySelectorAll('.contributor-share')]
      .reduce((total, input) => total + (Number(input.value) || 0), 0);
  }

  function updateSplit() {
    const total = Math.round(splitTotal() * 100) / 100;
    const number = document.getElementById('split-total');
    const meter = document.getElementById('split-meter');
    const message = document.getElementById('split-message');
    const side = document.getElementById('split-side');
    if (!number || !meter || !message || !side) return;
    number.textContent = `${total}%`;
    meter.style.width = `${Math.min(Math.max(total, 0), 100)}%`;
    const valid = Math.abs(total - 100) < 0.001;
    side.dataset.valid = String(valid);
    message.textContent = valid ? 'Perfect. Everything adds up to 100%.'
      : total < 100 ? `${Math.round((100 - total) * 100) / 100}% is still left.`
        : `Take away ${Math.round((total - 100) * 100) / 100}%.`;
  }

  function bindToolForm(tool) {
    const form = document.getElementById('tool-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveCurrent(tool, form);
    });
    if (tool !== 'split') return;
    const contributors = document.getElementById('contributors');
    contributors.addEventListener('input', updateSplit);
    contributors.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-remove-person]');
      if (!remove) return;
      const rows = contributors.querySelectorAll('.contributor');
      if (rows.length === 1) {
        rows[0].querySelectorAll('input').forEach((input) => { input.value = ''; });
      } else remove.closest('.contributor').remove();
      updateSplit();
    });
    document.getElementById('add-person').addEventListener('click', () => {
      contributors.insertAdjacentHTML('beforeend', contributorRow());
      contributors.lastElementChild.querySelector('.contributor-name').focus();
      updateSplit();
    });
    document.getElementById('print-pdf').addEventListener('click', printSplit);
    updateSplit();
  }

  function recordFrom(tool, form) {
    if (tool === 'money') {
      const fields = formDataObject(form);
      const data = normalizeMoneyData({...fields, record_type: 'money-v1', earned_cents: parseMoneyAmount(fields.earned, fields.currency), paid_cents: parseMoneyAmount(fields.paid || '0', fields.currency)});
      return {id: state.recordId || undefined, kind: 'royalty', title: [data.source, data.song_title].filter(Boolean).join(' — ').slice(0, 180), status: data.paid_cents === data.earned_cents ? 'completed' : 'open', data, relation_key: slug(data.song_title), due_at: data.expected_date ? `${data.expected_date}T12:00:00.000Z` : null};
    }
    const data = tool === 'split' ? splitData() : formDataObject(form);
    const title = tool === 'person' ? data.name : tool === 'split' ? `${data.song_title} Split Sheet` : data.title;
    return {
      id: state.recordId || undefined,
      kind: tool === 'split' ? 'document' : tool,
      title: title.slice(0, 180),
      status: 'draft',
      relation_key: slug(tool === 'split' ? data.song_title : title),
      data: tool === 'split' ? {...data, document_type: 'split-sheet'} : data,
      due_at: tool === 'show' && data.date ? `${data.date}T12:00:00.000Z` : null,
    };
  }

  async function saveCurrent(tool, form) {
    if (state.example) {
      notify('This is an example. Press Clear Page to start your own.');
      return;
    }
    if (tool === 'split' && Math.abs(splitTotal() - 100) > 0.001) {
      notify('The ownership must add up to exactly 100% before you save it.');
      return;
    }
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const response = await fetch('/api/rcm/workspace', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({action: 'record', ...recordFrom(tool, form)}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || 'That could not be saved.'), {status: response.status});
      state.records = [body.record, ...state.records.filter((record) => record.id !== body.record.id)];
      if (tool === 'money') {
        state.moneyRecords = [body.record, ...state.moneyRecords.filter(record => record.id !== body.record.id)];
        state.currency = body.record.data.currency;
        await loadMoney();
      }
      renderSaved();
      notify(`Saved “${body.record.title}”.`);
      setPage(tool === 'money' ? 'money' : 'stuff');
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        state.authenticated = false;
        notify('Log in to ROOSTER first, then your work can be saved.');
      } else notify(error.message || 'That could not be saved. Please try again.');
    } finally {
      button.disabled = false;
      button.textContent = tool === 'money' ? 'Save Income' : tool === 'song' ? 'Save Song' : tool === 'show' ? 'Save Show' : tool === 'person' ? 'Save Person' : 'Save Split Sheet';
    }
  }

  function printSplit() {
    const form = document.getElementById('tool-form');
    if (!form.reportValidity()) return;
    const data = splitData();
    const total = splitTotal();
    if (!data.contributors.length || Math.abs(total - 100) > 0.001) {
      notify('Make the percentages equal 100% before you download or print it.');
      return;
    }
    const rows = data.contributors.map((person) => `<tr><td>${esc(person.name)}</td><td>${esc(person.role)}</td><td>${esc(person.share)}%</td></tr>`).join('');
    const signatures = data.contributors.map((person) => `<div class="signature-line">${esc(person.name)} — signature / date</div>`).join('');
    els.printSheet.innerHTML = `
      <header class="print-head"><h1>Song Split Sheet</h1><strong>ROOSTER</strong></header>
      ${state.example ? '<p><strong>EXAMPLE ONLY — NOT A SIGNED AGREEMENT</strong></p>' : ''}
      <section class="print-meta">
        <div><small>Song title</small><strong>${esc(data.song_title)}</strong></div>
        <div><small>Main artist</small><strong>${esc(data.artist || '—')}</strong></div>
        <div><small>Date</small><strong>${esc(data.date || '—')}</strong></div>
      </section>
      <table class="print-table"><thead><tr><th>Contributor</th><th>Role</th><th>Ownership</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="print-total">Total ownership: ${esc(total)}%</p>
      <p class="print-agreement">We confirm that the information above accurately represents the ownership percentages agreed for this composition.</p>
      <section class="print-signatures">${signatures}</section>
      <p class="print-foot">Created with ROOSTER Manager. This template is a business organization tool and is not legal advice.</p>`;
    els.printSheet.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(() => window.print());
  }

  function recordTool(record) {
    if (record.kind === 'document' && (record.data?.document_type === 'split-sheet' || /split/i.test(record.title || ''))) return 'split';
    return ['song', 'show', 'person'].includes(record.kind) ? record.kind : '';
  }

  function renderSaved() {
    els.savedList.replaceChildren();
    const useful = state.records.filter((record) => recordTool(record));
    if (state.loading) {
      els.savedStatus.hidden = false;
      els.savedStatus.textContent = 'Checking your saved work…';
      return;
    }
    if (!state.authenticated) {
      els.savedStatus.hidden = false;
      els.savedStatus.innerHTML = 'Log in to see and save your private ROOSTER Manager work. <a href="/members.html">Open Account</a>';
      return;
    }
    if (state.loadError) {
      els.savedStatus.hidden = false;
      els.savedStatus.textContent = state.loadError;
      const retry = document.createElement('button'); retry.className = 'small-button'; retry.textContent = 'Try Again'; retry.onclick = () => void loadWorkspace(); els.savedStatus.append(' ', retry);
      return;
    }
    if (!useful.length) {
      els.savedStatus.hidden = false;
      els.savedStatus.textContent = 'Nothing saved yet. Tap Home and choose one easy button.';
      return;
    }
    els.savedStatus.hidden = true;
    useful.forEach((record) => {
      const tool = recordTool(record);
      const item = document.createElement('li');
      item.className = 'saved-card';
      const icon = document.createElement('span');
      icon.className = 'saved-type';
      icon.textContent = tool === 'split' ? '%' : tool === 'song' ? '♪' : tool === 'show' ? '□' : '+';
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = record.title;
      const type = document.createElement('small');
      type.textContent = tool === 'split' ? 'Split sheet' : tool;
      copy.append(name, type);
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      open.addEventListener('click', () => openTool(tool, {record}));
      item.append(icon, copy, open);
      els.savedList.appendChild(item);
    });
  }

  async function loadWorkspace() {
    state.loading = true; state.loadError = '';
    renderSaved();
    try {
      const response = await fetch('/api/rcm/workspace', {credentials: 'same-origin', headers: {Accept: 'application/json'}});
      if (response.status === 401 || response.status === 403) {
        state.authenticated = false;
        state.records = [];
      } else {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not load your saved work.');
        state.authenticated = true;
        state.records = Array.isArray(body.records) ? body.records : [];
        if (body.truncated) notify('My Stuff shows your 250 most recent records. My Money includes all income records.');
        const messages = document.getElementById('help-messages');
        if (Array.isArray(body.messages) && body.messages.length && !state.asking) {
          messages.replaceChildren();
          body.messages.forEach(message => { const p = document.createElement('p'); p.className = message.role === 'user' ? 'help-question' : 'help-answer'; p.textContent = message.content; messages.append(p); });
        }
      }
    } catch {
      state.loadError = 'Your saved work could not load. Please try again.';
      notify('ROOSTER could not check your saved work yet. You can still start a blank page.');
    } finally {
      state.loading = false;
      renderSaved();
    }
  }

  async function askRoster(prompt) {
    if (state.asking) return;
    state.asking = true;
    const send = document.querySelector('#help-form [type=submit]'); send.disabled = true; send.textContent = 'Thinking…';
    document.querySelectorAll('[data-ask], .quick-questions button').forEach(button => { button.disabled = true; });
    const messages = document.getElementById('help-messages');
    const question = document.createElement('p');
    question.className = 'help-question';
    question.textContent = prompt;
    const answer = document.createElement('p');
    answer.className = 'help-answer';
    answer.textContent = 'ROOSTER is thinking…';
    messages.append(question, answer);
    answer.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    try {
      const response = await fetch('/api/rcm/manager', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || 'ROOSTER could not answer right now.'), {status: response.status});
      answer.textContent = body.answer || 'ROOSTER could not answer right now.';
      const actions = {MY_MONEY: ['See My Money', () => setPage('money')], ADD_INCOME: ['Add Income', () => openTool('money')], CREATE_SONG: ['Add a Song', () => openTool('song')], CREATE_SPLIT: ['Make a Split Sheet', () => openTool('split')]};
      if (actions[body.workflow]) { const [label, action] = actions[body.workflow]; const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button'; button.textContent = label; button.onclick = action; messages.append(button); }
    } catch (error) {
      answer.textContent = error.status === 401 || error.status === 403
        ? 'Log in to ROOSTER so the manager can use your private workspace.'
        : (error.message || 'ROOSTER could not answer right now. Please try again.');
    } finally {
      state.asking = false; send.disabled = false; send.textContent = 'Ask MONA';
      document.querySelectorAll('[data-ask], .quick-questions button').forEach(button => { button.disabled = false; });
    }
  }

  document.querySelectorAll('[data-open-tool]').forEach((button) => {
    button.addEventListener('click', () => openTool(button.dataset.openTool));
  });
  document.getElementById('show-example').addEventListener('click', () => openTool('split', {example: true}));
  document.getElementById('workspace-back').addEventListener('click', () => setPage('home'));
  document.getElementById('clear-page').addEventListener('click', () => {
    openTool(state.tool || 'song');
    notify('Page cleared. Start fresh.');
  });
  document.querySelectorAll('[data-manager-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.managerView;
      if (page === 'split') openTool('split');
      else setPage(page);
    });
  });
  document.querySelectorAll('.quick-questions button').forEach((button) => {
    button.addEventListener('click', () => {
      void askRoster(button.textContent);
    });
  });
  document.getElementById('help-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('help-input');
    const prompt = input.value.trim();
    if (!prompt) { input.focus(); return; }
    input.value = '';
    void askRoster(prompt);
  });
  window.addEventListener('afterprint', () => els.printSheet.setAttribute('aria-hidden', 'true'));

  document.getElementById('money-currency').addEventListener('change', event => { state.currency = event.target.value; renderMoney(); });
  document.getElementById('money-filter').addEventListener('change', renderMoney);
  document.getElementById('money-refresh').addEventListener('click', () => void loadMoney());
  document.getElementById('money-export').addEventListener('click', exportMoney);
  document.querySelectorAll('[data-ask]').forEach(button => button.addEventListener('click', () => { setPage('help'); void askRoster(button.dataset.ask); }));
  renderSaved();
  const initialPage = location.hash.slice(1);
  if (['money', 'help', 'stuff'].includes(initialPage)) setPage(initialPage);
  else if (initialPage.startsWith('new-') && titles[initialPage.slice(4)]) openTool(initialPage.slice(4));
  void loadWorkspace();
  void loadMoney();
})();
