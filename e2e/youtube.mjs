// End-to-end check on real youtube.com in Playwright's Firefox.
//
// Playwright can't install Firefox add-ons, so this injects detect.js,
// content.js and content.css into each page (like the content script) with a
// small fake of the `browser` storage/messaging API.
//
// Run with: node e2e/youtube.mjs   (HEADED=1 to watch)

import { firefox } from "playwright";
import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (f) => fs.readFileSync(ROOT + f, "utf8");
const DEFAULTS = (await import(ROOT + "detect.js")).default.DEFAULTS;

// Videos known (checked against the API) to carry / not carry the AI label.
const AI_VIDEO = "_cpcedLsdZA";
const DUBBED_VIDEO = "1RWDA5Thx9s"; // pasta recipe; "How this was made" = auto-dubbed audio, not AI
const AI_SHORT = "2PIQg9i1hNE";
const SEARCH = "/results?search_query=ai+generated+cat+shorts";

function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!raw) return undefined;
  const u = new URL(raw);
  return {
    server: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
  };
}

function initScript(settings) {
  return `
    (() => {
      const data = { settings: ${JSON.stringify(settings)} };
      globalThis.browser = {
        storage: {
          local: {
            get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, data[k]])),
            set: async (o) => void Object.assign(data, o),
          },
          onChanged: { addListener() {} },
        },
        runtime: { onMessage: { addListener(fn) { globalThis.__aibOnMessage = fn; } } },
      };
    })();
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ${JSON.stringify(read("content.css"))};
      document.head.append(style);
      ${read("detect.js")}
      ;
      ${read("content.js")}
    });
  `;
}

const browser = await firefox.launch({ headless: !process.env.HEADED, proxy: proxyFromEnv() });

async function open(path, settings = DEFAULTS) {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript({ content: initScript(settings) });
  const page = await ctx.newPage();
  await page.goto("https://www.youtube.com" + path, { waitUntil: "domcontentloaded" });
  return page;
}

const state = (page) =>
  page.evaluate(() => {
    const parse = (c) => {
      // key is "id|title|handle|name"; titles may contain "|".
      const parts = (c.dataset.aibKey || "").split("|");
      const id = parts[0], handle = parts.at(-2), title = parts.slice(1, -2).join("|");
      const visible = getComputedStyle(c).display !== "none";
      const badge = getComputedStyle(c, "::before").content;
      const short = !!c.querySelector('a[href^="/shorts/"]');
      return { id, title, handle, reason: c.dataset.aibMatch, why: c.dataset.aibWhy, visible, badge, short, tag: c.tagName.toLowerCase() };
    };
    const cards = [...document.querySelectorAll("[data-aib-key]")].map(parse);
    return {
      url: location.href,
      cards,
      hidden: cards.filter((c) => c.reason),
      overlay: document.getElementById("aib-overlay")?.innerText || null,
      banner: document.getElementById("aib-flag")?.innerText || null,
      paused: [...document.querySelectorAll("video")].every((v) => v.paused),
    };
  });

async function scrollAndWait(page, ms) {
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(ms / 4);
  }
}

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

// 1. Search results: label + title checks hide cards.
{
  const page = await open(SEARCH);
  await page.waitForSelector("ytd-video-renderer, ytd-rich-item-renderer", { timeout: 30000 });
  await scrollAndWait(page, 12000);
  const s = await state(page);
  const byReason = s.hidden.reduce((m, c) => ((m[c.reason] = (m[c.reason] || 0) + 1), m), {});
  const tags = [...new Set(s.cards.map((c) => c.tag))].join(", ");
  check("search: cards are found", s.cards.length >= 10, `${s.cards.length} cards (${tags})`);
  check("search: AI cards are hidden", s.hidden.length > 0, JSON.stringify(byReason));
  check("search: cards have titles", s.cards.filter((c) => c.title).length >= s.cards.length * 0.8);
  // Shorts cards in search show no channel, so only count regular video cards.
  const videos = s.cards.filter((c) => c.tag === "ytd-video-renderer");
  check("search: video cards have channel handles", videos.filter((c) => c.handle).length >= videos.length * 0.8,
    `${videos.filter((c) => c.handle).length}/${videos.length}`);
  check("search: matches are actually hidden", s.hidden.every((c) => !c.visible));
  check("search: Shorts cards are processed", s.cards.some((c) => c.short), tags);
  // The whole grid slot must go, not just the Short inside it (no empty gaps).
  const gaps = await page.evaluate(() =>
    [...document.querySelectorAll(".ytGridShelfViewModelGridShelfItem")].filter(
      (slot) => getComputedStyle(slot).display !== "none" && slot.querySelector("[data-aib-match]"),
    ).length,
  );
  check("search: hidden Shorts leave no empty slot", gaps === 0, `${gaps} empty slots`);
  for (const c of s.hidden.slice(0, 8)) console.log(`        hidden [${c.reason}] ${c.handle} ${c.title.slice(0, 70)}`);

  // 2. Channel blocklist alone. Results vary between loads, so block every
  // unmatched channel from the first load and check whichever ones reappear.
  const targets = [...new Set(s.cards.filter((c) => !c.reason && c.handle).map((c) => c.handle.toLowerCase()))];
  await page.context().close();
  const p2 = await open(SEARCH, { ...DEFAULTS, useLabel: false, useTitle: false, channels: targets });
  await p2.waitForSelector("ytd-video-renderer, ytd-rich-item-renderer", { timeout: 30000 });
  await scrollAndWait(p2, 4000);
  const s2 = await state(p2);
  const theirs = s2.cards.filter((c) => targets.includes(c.handle.toLowerCase()));
  check("blocklist: blocked channels' cards hidden", theirs.length > 0 && theirs.every((c) => c.reason === "channel"),
    `${theirs.filter((c) => c.reason).length}/${theirs.length} hidden (${targets.length} channels blocked)`);
  check("blocklist: other cards untouched", s2.hidden.length === theirs.length);
  await p2.context().close();
}

// 2b. A normal search should keep (almost) everything.
{
  const page = await open("/results?search_query=pasta+recipe");
  await page.waitForSelector("ytd-video-renderer, ytd-rich-item-renderer", { timeout: 30000 });
  await scrollAndWait(page, 8000);
  const s = await state(page);
  check("normal search: nothing wrongly hidden", s.cards.length >= 10 && s.hidden.length <= 1,
    `${s.hidden.length}/${s.cards.length} hidden` + s.hidden.map((c) => ` [${c.reason}] ${c.title.slice(0, 50)}`).join(""));
  await page.context().close();
}

// 3. Watch page of a labelled AI video: overlay + paused.
{
  const page = await open(`/watch?v=${AI_VIDEO}`);
  const shown = await page.waitForSelector("#aib-overlay", { timeout: 25000 }).then(() => true, () => false);
  const s = await state(page);
  check("watch: AI video gets overlay", shown, s.overlay?.replace(/\n+/g, " / "));
  await page.waitForTimeout(1500);
  check("watch: AI video is paused", (await state(page)).paused);
  await page.click("#aib-overlay .aib-watch").catch(() => {});
  await page.waitForTimeout(3000);
  check("watch: 'Watch anyway' removes overlay and it stays gone", !(await state(page)).overlay);
  await page.context().close();
}

// 4. Watch page of an auto-dubbed (not AI) video: no overlay.
{
  const page = await open(`/watch?v=${DUBBED_VIDEO}`);
  await page.waitForSelector("ytd-watch-metadata h1", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(10000);
  const s = await state(page);
  check("watch: auto-dubbed non-AI video is NOT blocked", !s.overlay);
  await page.context().close();
}

// 5. Shorts player: an AI Short is skipped.
{
  const page = await open(`/shorts/${AI_SHORT}`);
  const moved = await page
    .waitForFunction((id) => !location.pathname.includes(id), AI_SHORT, { timeout: 30000 })
    .then(() => true, () => false);
  check("shorts: AI Short is skipped", moved, (await state(page)).url);
  await page.context().close();
}

// 6. Flag mode: matches stay visible with a badge; nothing is blocked.
{
  const FLAG = { ...DEFAULTS, mode: "flag" };
  const page = await open(SEARCH, FLAG);
  await page.waitForSelector("ytd-video-renderer, ytd-rich-item-renderer", { timeout: 30000 });
  await scrollAndWait(page, 10000);
  const s = await state(page);
  check("flag: search matches are flagged", s.hidden.length > 0, `${s.hidden.length}/${s.cards.length}`);
  check("flag: flagged cards stay visible", s.hidden.every((c) => c.visible));
  check("flag: badges show the reason", s.hidden.every((c) => c.badge.includes("AI:")), s.hidden[0]?.badge);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  const shot = new URL("flag-mode.png", import.meta.url).pathname;
  await page.screenshot({ path: shot });
  console.log("        screenshot:", shot);
  await page.context().close();

  const watch = await open(`/watch?v=${AI_VIDEO}`, FLAG);
  const banner = await watch.waitForSelector("#aib-flag", { timeout: 25000 }).then(() => true, () => false);
  const ws = await state(watch);
  check("flag: AI video shows banner, no overlay", banner && !ws.overlay, ws.banner);
  await watch.context().close();

  const short = await open(`/shorts/${AI_SHORT}`, FLAG);
  const sBanner = await short.waitForSelector("#aib-flag", { timeout: 25000 }).then(() => true, () => false);
  await short.waitForTimeout(4000);
  const ss = await state(short);
  check("flag: AI Short shows banner and is not skipped", sBanner && ss.url.includes(AI_SHORT), ss.banner);
  await short.context().close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
