import {TOP_EIGHT, readTopEightOrder} from './netlify/functions/_shared/top-eight-order.mts';

export function createTopEightEditor({onChange = () => {}} = {}) {
  const host = document.getElementById('owner-top-eight-editor');
  if (!host) return {setProfile(){},setDisabled(){},clear(){},getOrder(){return null;}};
  let order = null;
  let disabled = true;
  let buttons = [];
  const heading = document.createElement('h3');
  heading.textContent = 'Arrange your Top 8 Roster';
  const help = document.createElement('p');
  help.textContent = 'Move a song up or down, then tap Save Profile. All eight records stay on your Top 8 Roster.';
  help.className = 'top-eight-editor-help';
  const list = document.createElement('ol');
  list.className = 'top-eight-editor-list';
  list.setAttribute('aria-label', 'Your Top 8 Roster song order');
  const feedback = document.createElement('p');
  feedback.className = 'top-eight-editor-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  host.className = 'top-eight-editor';
  host.hidden = true;
  host.replaceChildren(heading, help, list, feedback);

  function controls() {
    buttons.forEach(({up, down, index}) => {
      up.disabled = disabled || index === 0;
      down.disabled = disabled || index === 7;
    });
  }
  function move(id, step) {
    if (disabled || !order || host.hidden) return;
    const index = order.indexOf(id), next = index + step;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    render();
    const row = buttons[next];
    const focus = step < 0 ? (row.up.disabled ? row.down : row.up) : (row.down.disabled ? row.up : row.down);
    focus.focus({preventScroll:true});
    const track = TOP_EIGHT.find(item => item.id === id);
    feedback.textContent = `${track.title} is now number ${next + 1}. Tap Save Profile to publish your order.`;
    onChange();
  }
  function render() {
    list.replaceChildren(); buttons = [];
    if (!order) return;
    order.forEach((id, index) => {
      const track = TOP_EIGHT.find(item => item.id === id);
      const row = document.createElement('li');
      row.className = 'top-eight-editor-row';
      const number = document.createElement('span'); number.className = 'top-eight-editor-number'; number.textContent = String(index + 1);
      const text = document.createElement('span'); text.className = 'top-eight-editor-song';
      const title = document.createElement('strong'); title.textContent = track.title;
      const artist = document.createElement('small'); artist.textContent = track.artist; text.append(title, artist);
      const actions = document.createElement('span'); actions.className = 'top-eight-editor-actions';
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑ Up'; up.setAttribute('aria-label', `Move ${track.title} up`);
      const down = document.createElement('button'); down.type = 'button'; down.textContent = '↓ Down'; down.setAttribute('aria-label', `Move ${track.title} down`);
      up.addEventListener('click', () => move(id, -1)); down.addEventListener('click', () => move(id, 1));
      actions.append(up, down); row.append(number, text, actions); list.append(row); buttons.push({up, down, index});
    });
    controls();
  }
  function clear() {order = null;disabled = true;host.hidden = true;feedback.textContent = '';render();}
  function setProfile(profile, canEditOwner) {
    clear();
    if (!canEditOwner) return;
    order = readTopEightOrder(profile?.top_eight_order) ?? TOP_EIGHT.map(track => track.id);
    host.hidden = false;render();
  }
  return {
    setProfile, clear,
    setDisabled(value) {disabled = value === true;controls();},
    getOrder() {return host.hidden || !order ? null : [...order];},
  };
}
