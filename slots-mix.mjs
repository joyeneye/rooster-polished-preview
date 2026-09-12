const DAY = 24 * 60 * 60 * 1000;

// Keys are namespaced so a publisher's story ID cannot hide a member's post.
function itemKey(type, value) {
  const id = value.id ?? (type === 'news' ? value.url : undefined);
  if (id !== undefined && id !== null && String(id).length) return `${type}-${id}`;
  // Older posts may have no ID. Keep their key deterministic across rerenders.
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${type}-legacy-${(hash >>> 0).toString(36)}`;
}

function uniqueItems(type, values, seen) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') continue;
    const key = itemKey(type, value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type, value, key });
  }
  return result;
}

function safeStory(story, now) {
  if (story.category !== 'music' && story.category !== 'sports') return false;
  const date = Date.parse(story.published_at);
  if (!Number.isFinite(date) || date > now + 5 * 60 * 1000 || date < now - 7 * DAY) return false;
  try {
    const url = new URL(story.url);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function balancedStories(items) {
  const music = items.filter(({ value }) => value.category === 'music');
  const sports = items.filter(({ value }) => value.category === 'sports');
  const result = [];
  for (let i = 0; i < Math.max(music.length, sports.length); i += 1) {
    if (music[i]) result.push(music[i]);
    if (sports[i]) result.push(sports[i]);
  }
  return result;
}

/**
 * Mix first-page discovery into WYD without changing member order or inputs.
 * usedIds contains keys from earlier mixSlots results, not unprefixed record IDs.
 * Following and appended pages contain member posts only.
 */
export function mixSlots(posts, stories, promos, { view = 'for_you', append = false, usedIds = new Set() } = {}) {
  const seen = new Set(usedIds);
  const members = uniqueItems('post', posts, seen);
  if (view !== 'for_you' || append) return members;

  const now = Date.now();
  const eligible = (Array.isArray(stories) ? stories : []).filter(story => story && safeStory(story, now));
  const news = balancedStories(uniqueItems('news', eligible, seen));
  const promotions = uniqueItems('promo', promos, seen);
  const result = [];

  if (members.length < 4) {
    let memberIndex = 0;
    let newsIndex = 0;
    let promoIndex = 0;
    // A quiet FYP opens with visible motion. Put one clearly-labelled ROOSTER
    // promo first, then preserve every member in its original order while
    // alternating the remaining promos with music and sports discovery.
    if (promotions[promoIndex]) result.push(promotions[promoIndex++]);
    for (let group = 0; group < 8 && (newsIndex < news.length || promotions[promoIndex]); group += 1) {
      if (members[memberIndex]) result.push(members[memberIndex++]);
      if (group > 0 && promotions[promoIndex]) result.push(promotions[promoIndex++]);
      let groupNews = 0;
      while (groupNews < 2 && newsIndex < news.length && newsIndex < 8) {
        result.push(news[newsIndex++]);
        groupNews += 1;
      }

    }
    result.push(...members.slice(memberIndex));
    return result;
  }

  let newsIndex = 0;
  let promoIndex = 0;
  let discoveryIndex = 0;
  // A casting campaign gets the first discovery space after three members.
  // It replaces a house-ad space, rather than adding a second ad stream.
  const campaignFirst = promotions[0]?.value.campaign === true;
  const maxPromos = Math.max(campaignFirst ? 1 : 0, Math.floor(members.length / 6));
  members.forEach((member, index) => {
    result.push(member);
    if ((index + 1) % 3 !== 0) return;
    discoveryIndex += 1;
    const isPromoTurn = discoveryIndex % 2 === (campaignFirst ? 1 : 0);
    if (isPromoTurn && promoIndex < maxPromos && promotions[promoIndex]) {
      result.push(promotions[promoIndex++]);
    } else if (news[newsIndex]) {
      result.push(news[newsIndex++]);
    }
  });
  return result;
}
