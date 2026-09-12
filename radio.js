(() => {
  const channels = Object.freeze({
    all: {
      station: 'a41301',
      format: 'ALL MUSIC',
      name: 'THE MIX',
      title: 'The Mix live radio player from Live365',
      description: 'A wide mix of real songs across genres, playing as one continuous broadcast.',
      source: 'Cool Music Variety',
    },
    hiphop: {
      station: 'a41306',
      format: 'HIP-HOP + R&B',
      name: 'WIRE 2 WIRE',
      title: 'WIRE 2 WIRE Hip-Hop and R&B live radio player from Live365',
      description: 'Hip-hop, R&B, and throwbacks from today and the 90s and 2000s.',
      source: 'WIRE 2 WIRE RADIO',
    },
    pop: {
      station: 'a67989',
      format: 'POP',
      name: 'POPPIN TOP 40',
      title: 'Poppin Top 40 live radio player from Live365',
      description: 'Current pop, Top 40 hits, and familiar sing-along records in one live stream.',
      source: 'Best Net Radio - Poppin Top 40',
    },
    sports: {
      station: 'a83286',
      format: 'SPORTS RADIO',
      name: 'SPORTS RAP NETWORK',
      title: 'Sports Rap Network live radio player from Live365',
      description: 'Urban sports talk and culture, with music between scheduled shows.',
      source: 'Sports Rap Network',
    },
    throwbacks: {
      station: 'a30553',
      format: 'THROWBACKS',
      name: 'THAT THROWBACK CHANNEL',
      title: 'That Throwback Channel live radio player from Live365',
      description: 'Old-school R&B, hip-hop, 80s, 90s, and classic records.',
      source: 'That Throwback Channel',
    },
    gospel: {
      station: 'a45349',
      format: 'GOSPEL',
      name: 'GOSPEL 365',
      title: 'Gospel 365 live radio player from Live365',
      description: 'Gospel music playing around the clock.',
      source: 'Gospel 365',
    },
    jazz: {
      station: 'a74112',
      format: 'JAZZ',
      name: 'THE JAZZ STATION',
      title: 'The Jazz Station live radio player from Live365',
      description: 'Modern, classic, Latin, and new jazz all day.',
      source: 'The Jazz Station',
    },
    country: {
      station: 'a01458',
      format: 'COUNTRY',
      name: 'COUNTRY VIBE RADIO',
      title: 'Country Vibe Radio live player from Live365',
      description: 'Modern country, roots, acoustic favorites, and classics.',
      source: 'Country Vibe Radio',
    },
  });

  const buttons = [...document.querySelectorAll('[data-radio-channel]')];
  const player = document.querySelector('#radio-player');
  const panel = document.querySelector('#radio-station-panel');
  const formatLabel = document.querySelector('#radio-format-label');
  const heading = document.querySelector('#radio-mix-heading');
  const description = document.querySelector('#radio-description-copy');
  const popout = document.querySelector('#radio-popout');
  const sourceName = document.querySelector('#radio-source-name');
  if (!buttons.length || !player || !panel || !formatLabel || !heading || !description || !popout || !sourceName) return;

  function selectChannel(key, options = {}) {
    const selectedKey = Object.hasOwn(channels, key) ? key : 'all';
    const channel = channels[selectedKey];
    const selectedButton = buttons.find(button => button.dataset.radioChannel === selectedKey);

    for (const button of buttons) {
      const isSelected = button === selectedButton;
      button.classList.toggle('is-active', isSelected);
      button.setAttribute('aria-selected', String(isSelected));
      button.tabIndex = isSelected ? 0 : -1;
    }

    if (player.dataset.station !== channel.station) {
      player.src = `https://live365.com/embed/player.html?station=${encodeURIComponent(channel.station)}&s=md&m=dark`;
      player.dataset.station = channel.station;
    }
    player.title = channel.title;
    panel.setAttribute('aria-labelledby', selectedButton.id);
    formatLabel.textContent = channel.format;
    heading.textContent = channel.name;
    description.textContent = channel.description;
    popout.href = `https://player.live365.com/${encodeURIComponent(channel.station)}?l=`;
    sourceName.textContent = channel.source;

    if (options.updateUrl !== false) {
      const url = new URL(window.location.href);
      if (selectedKey === 'all') url.searchParams.delete('station');
      else url.searchParams.set('station', selectedKey);
      window.history.replaceState(null, '', url);
    }
    if (options.focus) selectedButton.focus();
  }

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => selectChannel(button.dataset.radioChannel));
    button.addEventListener('keydown', event => {
      let nextIndex = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = buttons.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      selectChannel(buttons[nextIndex].dataset.radioChannel, {focus: true});
    });
  });

  const requestedChannel = new URLSearchParams(window.location.search).get('station');
  selectChannel(requestedChannel || 'all', {updateUrl: false});
})();
