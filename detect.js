// Pure detection helpers, shared by content.js, popup.js and the Node tests.

(function (root) {
  // Titles that say the video itself is AI-made (not videos *about* AI).
  const DEFAULT_TITLE_REGEX = [
    "\\bai[- ]?generated\\b",
    "\\bmade (?:with|by|using) ai\\b",
    "\\bai (?:animation|music|songs?|covers?|movies?|films?|trailers?)\\b",
    "#ai(?:art|video|generated|animation|music|shorts?)?\\b",
    "\\b(?:sora ?2|sora ai|veo ?3|midjourney|kling ?ai|suno ?ai)\\b",
    "#(?:sora|veo3?|midjourney|kling)\\b",
  ].join("|");

  const DEFAULTS = {
    enabled: true,
    mode: "hide", // "hide" removes matches, "flag" only marks them
    useLabel: true, // YouTube's "Made with AI" disclosure
    useTitle: true,
    titleRegex: DEFAULT_TITLE_REGEX,
    channels: [], // "@handle" or channel display name, one per entry
  };

  // The "How this was made" panel is also used for auto-dubbed audio and
  // "Captured with a camera", so only AI-specific phrases count.
  const DISCLOSURE_KEY = "howThisWasMadeSectionViewModel";
  const AI_PHRASES = [
    "made with ai",
    "altered or fully generated",
    "altered or synthetic",
    "synthetically generated",
    "significantly edited or digitally generated",
  ];

  function collectText(node) {
    const out = [];
    const stack = [node];
    while (stack.length) {
      const c = stack.pop();
      if (typeof c === "string") out.push(c);
      else if (Array.isArray(c)) stack.push(...c);
      else if (c && typeof c === "object") stack.push(...Object.values(c));
    }
    return out.join(" ").toLowerCase();
  }

  // True when a /youtubei/v1/next response carries an AI disclosure.
  function hasAiDisclosure(json) {
    const stack = [json];
    while (stack.length) {
      const cur = stack.pop();
      if (Array.isArray(cur)) {
        stack.push(...cur);
      } else if (cur && typeof cur === "object") {
        for (const k in cur) {
          if (k === DISCLOSURE_KEY) {
            const text = collectText(cur[k]);
            if (AI_PHRASES.some((p) => text.includes(p))) return true;
          } else {
            stack.push(cur[k]);
          }
        }
      }
    }
    return false;
  }

  // Returns a RegExp, or null if the pattern is empty or invalid.
  function compileTitleRegex(pattern) {
    if (!pattern || !pattern.trim()) return null;
    try {
      return new RegExp(pattern, "i");
    } catch {
      return null;
    }
  }

  function normalizeChannels(list) {
    return new Set(
      (list || []).map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith("#")),
    );
  }

  // handle is "@name" (or "/channel/UC..."), name is the display name.
  function channelBlocked(set, handle, name) {
    if (!set.size) return false;
    return (
      (!!handle && set.has(handle.toLowerCase())) ||
      (!!name && set.has(name.trim().toLowerCase()))
    );
  }

  // "/watch?v=ID", "/shorts/ID" or full URLs -> "ID" (or null).
  function videoIdFromHref(href) {
    if (!href) return null;
    const m =
      href.match(/[?&]v=([A-Za-z0-9_-]{11})/) || href.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // "/@name/videos" -> "@name", "/channel/UC..." -> "/channel/UC...".
  function handleFromHref(href) {
    if (!href) return "";
    let path = href.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, "");
    try {
      path = decodeURIComponent(path);
    } catch {}
    const m = path.match(/^\/(@[^/]+)/) || path.match(/^(\/channel\/[^/]+)/);
    return m ? m[1] : "";
  }

  const api = {
    DEFAULTS,
    DEFAULT_TITLE_REGEX,
    hasAiDisclosure,
    compileTitleRegex,
    normalizeChannels,
    channelBlocked,
    videoIdFromHref,
    handleFromHref,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AIB = api;
})(globalThis);
