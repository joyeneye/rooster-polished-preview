(function () {
  'use strict';
  if (document.querySelector('[data-roster-guide]')) return;

  const lessons = {
    post: ['Post on WYD', 'Go to WYD, tap Post at the top, choose what you are sharing, then tap Post. Your newest post appears in the FYP.'],
    picture: ['Take a picture', 'Go to WYD and tap Take Pic at the top. Allow camera access, choose a look, then tap the big round camera button. Review it and continue when you like it.'],
    message: ['Send a private message', 'Tap Messages, then New. Pick one person, write your message, and tap Send Privately. Only you and that person can read it.'],
    profile: ['Set up your page', 'Open Account, then Profile. Choose what you do, add your photo, bio and location, then save. ROOSTER changes the page to fit your work. Music is optional.'],
    slots: ['Understand WYD', 'WYD is your home feed. For You shows things you may like, Following shows your people, and Replies shows posts as a simple list.'],
    rooms: ['Join or start a Room', 'Tap Rooms. Pick a room and tap Join, or tap Start a Room. Allow microphone access so people can hear you.'],
    booking: ['Use booking', 'Open More, then Booking. Browse services to book someone, or open your provider tools to add services and times for your own clients.'],
  };

  const root = document.createElement('div');
  root.className = 'roster-guide';
  root.dataset.rosterGuide = '';
  root.innerHTML = `
    <button class="roster-guide-open" type="button" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true">M</span> Ask MONA</button>
    <dialog class="roster-guide-dialog" aria-labelledby="roster-guide-title">
      <div class="roster-guide-head"><div><small>MONA · MONEY · OWNERSHIP · NUMBERS · ANALYTICS</small><h2 id="roster-guide-title">What do you need help with?</h2></div><button class="roster-guide-close" type="button" aria-label="Close MONA">×</button></div>
      <p class="roster-guide-intro">I’m MONA, your ROOSTER manager. What’s next for you?</p>
      <a class="roster-guide-business" href="/mona"><strong>Help me get clients</strong><span>Find opportunities, plan a reply and manage bookings →</span></a>
      <button class="roster-guide-replay" type="button" data-roster-reset-tips>Show first-time tips again</button>
      <div class="roster-guide-quick">
        <button type="button" data-lesson="post">Post on WYD</button><button type="button" data-lesson="picture">Take a picture</button>
        <button type="button" data-lesson="message">Message someone</button><button type="button" data-lesson="profile">Set up my page</button>
        <button type="button" data-lesson="slots">Learn the FYP</button><button type="button" data-lesson="rooms">Use Rooms</button>
        <button type="button" data-lesson="booking">Use booking</button>
      </div>
      <section class="roster-guide-answer" aria-live="polite" hidden><h3></h3><p></p></section>
      <form class="roster-guide-form"><label for="roster-guide-question">Ask MONA anything about the app</label><div><input id="roster-guide-question" maxlength="300" placeholder="How do I add my location?" autocomplete="off"><button type="submit">Ask MONA</button></div><p class="roster-guide-status" role="status" aria-live="polite"></p></form>
    </dialog>`;
  document.body.appendChild(root);

  const open = root.querySelector('.roster-guide-open');
  const dialog = root.querySelector('dialog');
  const close = root.querySelector('.roster-guide-close');
  const answer = root.querySelector('.roster-guide-answer');
  const title = answer.querySelector('h3');
  const copy = answer.querySelector('p');
  const form = root.querySelector('form');
  const input = root.querySelector('input');
  const status = root.querySelector('.roster-guide-status');

  function showAnswer(heading, text) {
    title.textContent = heading;
    copy.textContent = text;
    answer.hidden = false;
    answer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  open.addEventListener('click', () => { dialog.showModal(); open.setAttribute('aria-expanded', 'true'); });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { open.setAttribute('aria-expanded', 'false'); open.focus(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  root.querySelectorAll('[data-lesson]').forEach(button => button.addEventListener('click', () => {
    const lesson = lessons[button.dataset.lesson];
    if (lesson) showAnswer(lesson[0], lesson[1]);
  }));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (question.length < 2) { status.textContent = 'Type a question first.'; input.focus(); return; }
    const button = form.querySelector('button');
    button.disabled = true; status.textContent = 'MONA is thinking…';
    try {
      const response = await fetch('/api/roster-guide', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ question, page: location.pathname }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.answer !== 'string') throw new Error(data.message || 'AI help is unavailable right now.');
      showAnswer('MONA', data.answer);
      status.textContent = '';
    } catch {
      status.textContent = 'MONA is taking a break. The quick help buttons above still work.';
    } finally { button.disabled = false; }
  });
})();
