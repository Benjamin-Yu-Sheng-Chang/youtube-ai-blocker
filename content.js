// Hides AI-generated videos and Shorts on youtube.com.
//
// A video counts as AI when any enabled check matches:
//   1. YouTube's own "Made with AI" disclosure (looked up per video ID)
//   2. its title matches the title regex
//   3. its channel is on the blocklist
// In "hide" mode feed / search / sidebar cards are hidden, an AI video opened
// on the watch page is paused behind an overlay, and an AI Short is skipped.
// In "flag" mode everything stays visible and matches get a badge saying why.

(() => {
  const {
    DEFAULTS,
    hasAiDisclosure,
    compileTitleRegex,
    normalizeChannels,
    channelBlocked,
    videoIdFromHref,
    handleFromHref,
  } = globalThis.AIB;

  // Outermost container first: closest() is tried in this order.
  const CARD_SELECTORS = [
    "ytd-rich-item-renderer", // home, subscriptions, Shorts shelf on home
    ".ytGridShelfViewModelGridShelfItem", // Shorts grid slot in search
    "ytd-video-renderer", // search
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer", // old watch sidebar
    "ytd-playlist-video-renderer",
    "ytd-reel-item-renderer", // Shorts shelf (older layout)
    "ytm-shorts-lockup-view-model-v2",
    "ytm-shorts-lockup-view-model",
    "yt-lockup-view-model", // new watch sidebar / lockups
  ];
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href^="/shorts/"]';
  const TITLE_SELECTOR = [
    "#video-title",
    "h3",
    ".yt-lockup-metadata-view-model__title",
    "[class*='shortsLockupViewModelHostMetadataTitle']",
    "[class*='shortsLockupViewModelHostOutsideMetadataTitle']",
  ].join(",");
  const CHANNEL_LINK_SELECTOR = 'a[href^="/@"], a[href^="/channel/"]';
  const CHANNEL_NAME_SELECTOR = "ytd-channel-name #text, [class*='metadata-text']";

  const CACHE_KEY = "labelCache";
  const CACHE_CAP = 5000;
  const CONCURRENCY = 2;

  let settings = { ...DEFAULTS };
  let titleRe = null;
  let channelSet = new Set();
  let matchCount = 0;
  const allowOnce = new Set(); // video IDs the user chose to watch anyway

  // ---- settings -------------------------------------------------------------

  function applySettings(s) {
    settings = { ...DEFAULTS, ...s };
    titleRe = settings.useTitle ? compileTitleRegex(settings.titleRegex) : null;
    channelSet = normalizeChannels(settings.channels);
    // content.css hides or badges [data-aib-match] depending on this.
    document.documentElement.dataset.aibMode = settings.mode;
  }

  const flagMode = () => settings.mode === "flag";

  // ---- YouTube label lookup -------------------------------------------------

  const labels = new Map(); // videoId -> true / false
  const pending = new Map(); // videoId -> Promise<boolean>
  const queue = [];
  let active = 0;
  let pausedUntil = 0;
  let backoff = 0;

  function clientVersion() {
    for (const s of document.scripts) {
      const m = s.textContent.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
      if (m) return m[1];
    }
    return "2.20251120.00.00";
  }
  let version = null;

  async function fetchLabel(videoId) {
    version ||= clientVersion();
    const res = await fetch("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      // hl: "en" keeps the disclosure wording English whatever the UI language.
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: version, hl: "en", gl: "US" } },
        videoId,
      }),
    });
    if (res.status === 429 || res.status === 503) throw Object.assign(new Error("rate"), { rate: true });
    if (!res.ok) throw new Error("next " + res.status);
    const raw = await res.text();
    if (!raw.includes("howThisWasMadeSectionViewModel")) return false;
    return hasAiDisclosure(JSON.parse(raw));
  }

  function lookupLabel(videoId) {
    if (labels.has(videoId)) return Promise.resolve(labels.get(videoId));
    if (pending.has(videoId)) return pending.get(videoId);
    const p = new Promise((resolve) => queue.push({ videoId, resolve }));
    pending.set(videoId, p);
    pump();
    return p;
  }

  function pump() {
    const wait = pausedUntil - Date.now();
    if (wait > 0) return void setTimeout(pump, wait);
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift();
      active++;
      fetchLabel(job.videoId)
        .then((ai) => {
          backoff = 0;
          labels.set(job.videoId, ai);
          saveCacheSoon();
          pending.delete(job.videoId);
          job.resolve(ai);
        })
        .catch((err) => {
          if (err.rate) {
            backoff = Math.min((backoff || 15000) * 2, 600000);
            pausedUntil = Date.now() + backoff;
            queue.unshift(job); // retry later
          } else {
            pending.delete(job.videoId);
            job.resolve(false); // unknown: don't hide
          }
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  let saveTimer = null;
  function saveCacheSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const entries = [...labels.entries()].slice(-CACHE_CAP).map(([id, v]) => [id, v ? 1 : 0]);
      browser.storage.local.set({ [CACHE_KEY]: entries });
    }, 2000);
  }

  // ---- matching ---------------------------------------------------------------

  const LABEL_MATCH = { reason: "label", why: "AI: YouTube label" };

  // Returns { reason, why } for the first matching cheap check, or null.
  function quickMatch(title, handle, name) {
    if (channelBlocked(channelSet, handle, name)) {
      return { reason: "channel", why: `AI: channel ${handle || name}` };
    }
    const m = titleRe && title && title.match(titleRe);
    if (m) return { reason: "title", why: `AI: title "${m[0]}"` };
    return null;
  }

  // ---- feed cards -------------------------------------------------------------

  function findCard(link) {
    if (link.closest("#movie_player, ytd-player")) return null; // end-screen links
    for (const sel of CARD_SELECTORS) {
      const card = link.closest(sel);
      if (card) return card;
    }
    return null;
  }

  function cardInfo(card, link) {
    const titleEl = card.querySelector(TITLE_SELECTOR);
    const title = (
      titleEl?.getAttribute("title") ||
      titleEl?.textContent ||
      link.getAttribute("title") ||
      link.getAttribute("aria-label") ||
      ""
    ).trim();
    const chLink = card.querySelector(CHANNEL_LINK_SELECTOR);
    const handle = handleFromHref(chLink?.getAttribute("href"));
    const name = card.querySelector(CHANNEL_NAME_SELECTOR)?.textContent.trim() || "";
    return { title, handle, name };
  }

  function mark(card, match) {
    if (!card.hasAttribute("data-aib-match")) matchCount++;
    card.dataset.aibMatch = match.reason;
    card.dataset.aibWhy = match.why;
  }

  function unmark(card) {
    if (card.hasAttribute("data-aib-match")) matchCount--;
    delete card.dataset.aibMatch;
    delete card.dataset.aibWhy;
  }

  // Only look up labels for cards near the viewport.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        visibility.unobserve(e.target);
        const id = e.target.dataset.aibVid;
        lookupLabel(id).then((ai) => {
          // The card may have been recycled for another video meanwhile.
          if (ai && e.target.dataset.aibVid === id && settings.enabled) mark(e.target, LABEL_MATCH);
        });
      }
    },
    { rootMargin: "800px 0px" },
  );

  function processCard(card, link, id) {
    const info = cardInfo(card, link);
    // YouTube recycles card elements and fills them lazily, so re-check
    // whenever what we see changes.
    const key = `${id}|${info.title}|${info.handle}|${info.name}`;
    if (card.dataset.aibKey === key) return;
    card.dataset.aibKey = key;
    card.dataset.aibVid = id;
    unmark(card);
    visibility.unobserve(card);

    const match = quickMatch(info.title, info.handle, info.name);
    if (match) return mark(card, match);
    if (!settings.useLabel) return;
    if (labels.has(id)) {
      if (labels.get(id)) mark(card, LABEL_MATCH);
    } else {
      visibility.observe(card);
    }
  }

  function scanCards() {
    for (const link of document.querySelectorAll(LINK_SELECTOR)) {
      const id = videoIdFromHref(link.getAttribute("href"));
      if (!id) continue;
      const card = findCard(link);
      if (card) processCard(card, link, id);
    }
  }

  // ---- watch page and Shorts player -----------------------------------------

  let currentPageId = null;
  let shownFor = null; // video ID the overlay / flag banner is showing for
  let checking = false;
  const skipTries = new Map(); // Short ID -> skip attempts

  function removeOverlay() {
    document.getElementById("aib-overlay")?.remove();
    document.getElementById("aib-flag")?.remove();
    shownFor = null;
  }

  function showFlagBanner(id, match) {
    removeOverlay();
    const banner = document.createElement("div");
    banner.id = "aib-flag";
    banner.textContent = match.why;
    document.body.append(banner);
    shownFor = id;
  }

  function pauseMedia() {
    document.querySelectorAll("video").forEach((v) => v.pause());
  }

  // The player keeps trying to (auto)play; keep it paused under the overlay.
  document.addEventListener(
    "play",
    (e) => {
      if (document.getElementById("aib-overlay")) e.target.pause();
    },
    true,
  );

  function showWatchOverlay(id, reason) {
    removeOverlay();
    shownFor = id;
    const overlay = document.createElement("div");
    overlay.id = "aib-overlay";
    const box = document.createElement("div");
    box.className = "aib-box";
    const h = document.createElement("h2");
    h.textContent = "AI-generated video blocked";
    const p = document.createElement("p");
    p.textContent =
      reason === "label"
        ? "YouTube labels this video as made with AI."
        : reason === "channel"
          ? "This channel is on your blocklist."
          : "The title matches your AI title filter.";
    const back = document.createElement("button");
    back.className = "aib-back";
    back.textContent = "Go back";
    back.onclick = () => (history.length > 1 ? history.back() : location.assign("/"));
    const watch = document.createElement("button");
    watch.className = "aib-watch";
    watch.textContent = "Watch anyway";
    watch.onclick = () => {
      allowOnce.add(id);
      removeOverlay();
      document.querySelector("video")?.play();
    };
    box.append(h, p, back, watch);
    overlay.append(box);
    document.body.append(overlay);
    pauseMedia();
  }

  function skipShort() {
    pauseMedia();
    const next =
      document.querySelector("#navigation-button-down button") ||
      document.querySelector('button[aria-label="Next video"]');
    if (next) next.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
  }

  function pageInfo(isShort) {
    const root = isShort
      ? document.querySelector("ytd-reel-video-renderer[is-active]") ||
        document.querySelector("ytd-reel-video-renderer") ||
        document
      : document.querySelector("ytd-watch-metadata") || document;
    const title = isShort
      ? root.querySelector("yt-shorts-video-title-view-model")?.textContent.trim() || ""
      : root.querySelector("h1")?.textContent.trim() || "";
    const chLink = root.querySelector(CHANNEL_LINK_SELECTOR);
    const handle = handleFromHref(chLink?.getAttribute("href"));
    const name = root.querySelector("ytd-channel-name #text")?.textContent.trim() || "";
    return { title, handle, name };
  }

  async function checkPage() {
    if (checking) return;
    checking = true;
    try {
      await checkPageOnce();
    } finally {
      checking = false;
    }
  }

  async function checkPageOnce() {
    const isShort = location.pathname.startsWith("/shorts/");
    const id = location.pathname === "/watch" || isShort ? videoIdFromHref(location.href) : null;
    if (id !== currentPageId) {
      currentPageId = id;
      removeOverlay();
    }
    if (!id || !settings.enabled || allowOnce.has(id) || shownFor === id) return;

    const info = pageInfo(isShort);
    let match = quickMatch(info.title, info.handle, info.name);
    if (!match && settings.useLabel && (await lookupLabel(id))) match = LABEL_MATCH;
    if (!match || id !== currentPageId || shownFor === id) return;

    if (flagMode()) {
      showFlagBanner(id, match);
    } else if (isShort) {
      // Retry while still on this Short (the player may not be ready yet), but
      // give up eventually rather than fight the user scrolling back to it.
      const tries = skipTries.get(id) || 0;
      if (tries >= 5) return;
      skipTries.set(id, tries + 1);
      skipShort();
    } else {
      showWatchOverlay(id, match.reason);
    }
  }

  // ---- wiring ---------------------------------------------------------------

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (!settings.enabled) return;
      scanCards();
      checkPage();
    }, 250);
  }

  function resetAll() {
    document.querySelectorAll("[data-aib-key]").forEach((card) => {
      unmark(card);
      delete card.dataset.aibKey;
      delete card.dataset.aibVid;
      visibility.unobserve(card);
    });
    matchCount = 0;
    removeOverlay();
    scheduleScan();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    applySettings(changes.settings.newValue);
    resetAll();
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "aib-stats") return Promise.resolve({ matched: matchCount, mode: settings.mode });
  });

  browser.storage.local.get(["settings", CACHE_KEY]).then((stored) => {
    applySettings(stored.settings);
    for (const [id, v] of stored[CACHE_KEY] || []) labels.set(id, !!v);
    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("yt-navigate-finish", scheduleScan);
    setInterval(scheduleScan, 1500); // Shorts swipes don't always mutate much
    scheduleScan();
  });
})();
