# YouTube AI Blocker (Firefox)

Hides or flags AI-generated videos and Shorts on YouTube.

## Install

Clone just the extension (shallow, latest commit only — the smallest copy):

```sh
git clone --depth 1 https://github.com/Benjamin-Yu-Sheng-Chang/youtube-ai-blocker.git
```

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` in the cloned folder.

Temporary add-ons are removed when Firefox restarts, so repeat after a restart.

## Use

Open YouTube. AI videos are hidden from Home, Search, the sidebar and Shorts.

Click the extension's button in the toolbar (or in the Extensions menu) to change settings:

- **Matches: Hide / Flag only.** *Hide* removes AI videos, pauses AI videos you open directly, and skips AI Shorts. *Flag only* keeps everything visible and marks matches with a badge saying why:
  - purple: YouTube labels it "Made with AI"
  - red: the title matched the title filter (shows the matched words)
  - orange: the channel is on your blocklist
- **YouTube label.** Turn matching on YouTube's own "Made with AI" label on or off.
- **Title filter.** Turn the title filter on or off, and edit its pattern. **Reset to default** restores the original pattern.
- **Blocked channels.** Add one channel per line, as `@handle` or channel name.

Click **Save** after editing the title filter or channel list. The popup also shows how many videos were hidden or flagged on the current page.

If an AI video gets blocked when you open it, click **Watch anyway** to watch it.

## For testing

Tests live on the `test` branch. Clone the whole repo and check it out:

```sh
git clone https://github.com/Benjamin-Yu-Sheng-Chang/youtube-ai-blocker.git
cd youtube-ai-blocker
git checkout test
npm install
```

Unit tests (Node.js only, no install needed):

```sh
node --test test/
```

End-to-end test (needs Playwright from `npm install`):

```sh
npm run test:e2e
```
