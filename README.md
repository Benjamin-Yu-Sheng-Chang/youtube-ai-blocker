# YouTube AI Blocker (Firefox)

Hides AI-generated videos and Shorts on youtube.com.

A video is treated as AI when any enabled check matches:

1. **YouTube's AI label.** The video's "How this was made" panel says "Made with AI" or "altered or fully generated". The extension looks this up per video with YouTube's own `youtubei/v1/next` endpoint, only for cards near the screen, and caches the answer. Auto-dubbed and "Captured with a camera" videos use the same panel and are ignored.
2. **Title filter.** A regex on the title (`AI generated`, `#aiart`, `Veo 3`, ...). You can edit it in the popup.
3. **Channel blocklist.** `@handle` or channel name, one per line in the popup.

What happens to a match:

- Home, subscriptions, search, sidebar and Shorts shelf cards are hidden.
- An AI video opened directly on the watch page is paused behind an overlay with "Go back" / "Watch anyway".
- An AI Short in the Shorts player is skipped to the next one.

**Flag mode** (popup → Matches: Flag only) keeps everything visible so you can judge the checks:

- Matched cards get an outline and a badge saying why: purple = YouTube label, red = title filter (shows the matched words), orange = channel.
- The watch page and Shorts get a banner instead of the overlay or the skip.

All requests go to youtube.com only. No data is collected.

## Install (development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on...** and pick `manifest.json` in this folder.
3. Open YouTube. Click the toolbar icon for settings and the hidden count.

Temporary add-ons are removed when Firefox restarts.

## Test

```sh
npm install
npm test             # detection unit tests
npm run test:e2e     # real youtube.com in Playwright's Firefox (HEADED=1 to watch)
```

Playwright can't install Firefox add-ons, so the e2e test injects `detect.js`, `content.js` and `content.css` into each page with a fake `browser` storage API. It covers search hiding (label, title, blocklist), a normal search with nothing hidden, the watch-page overlay, a non-AI auto-dubbed video, skipping a Short, and flag mode (writes `e2e/flag-mode.png`). It doesn't cover the popup or the real extension install, so load it via `about:debugging` for that.

Known gap: Shorts cards in search results show no channel, so the channel blocklist can't hide them there (the AI label and title filter still do).

## Files

- `manifest.json`: MV3 manifest
- `detect.js`: pure detection helpers (label parsing, title regex, blocklist), shared with the tests
- `content.js`: finds cards, runs checks, hides cards, handles the watch page and Shorts
- `popup.*`: settings UI
- `test/`: unit tests, `e2e/`: Playwright test
