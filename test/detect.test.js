// Run with: node --test
const test = require("node:test");
const assert = require("node:assert");
const D = require("../detect.js");

const panel = (body) => ({
  contents: [
    {
      howThisWasMadeSectionViewModel: {
        sectionTitle: { content: "How this was made" },
        bodyText: { content: body },
      },
    },
  ],
});

test("AI disclosure is detected", () => {
  assert.ok(D.hasAiDisclosure(panel("Sounds or visuals were altered or fully generated. Learn more")));
  assert.ok(D.hasAiDisclosure(panel("Altered or synthetic content")));
});

test("non-AI uses of the same panel are ignored", () => {
  assert.ok(!D.hasAiDisclosure(panel("Audio tracks for some languages were automatically generated. Learn more")));
  assert.ok(!D.hasAiDisclosure(panel("Captured with a camera")));
  assert.ok(!D.hasAiDisclosure({}));
});

test("AI words outside the panel don't count", () => {
  assert.ok(!D.hasAiDisclosure({ title: "This was made with AI", related: [{ text: "altered or fully generated" }] }));
});

test("default title regex", () => {
  const re = D.compileTitleRegex(D.DEFAULT_TITLE_REGEX);
  const hits = [
    "Cat saves baby (AI generated)",
    "Made with AI: epic battle",
    "Lofi beats | AI Music",
    "Dragon fight #aiart #shorts",
    "Puppy surprise #ai",
    "Godzilla vs Kong trailer - Veo 3",
    "Sora 2 street interview",
    "AI-generated grandma",
  ];
  const misses = [
    "How AI is changing medicine",
    "I tried ChatGPT for a week",
    "Kingdom Hearts: Sora vs Riku",
    "Rainforest documentary",
    "Why AI art is controversial",
  ];
  for (const t of hits) assert.ok(re.test(t), `should match: ${t}`);
  for (const t of misses) assert.ok(!re.test(t), `should not match: ${t}`);
});

test("bad or empty regex compiles to null", () => {
  assert.strictEqual(D.compileTitleRegex("("), null);
  assert.strictEqual(D.compileTitleRegex("  "), null);
});

test("channel blocklist", () => {
  const set = D.normalizeChannels(["@SlopFactory", " Daily AI Cats ", "# comment", ""]);
  assert.ok(D.channelBlocked(set, "@slopfactory", ""));
  assert.ok(D.channelBlocked(set, "", "daily ai cats"));
  assert.ok(!D.channelBlocked(set, "@other", "Other"));
  assert.ok(!D.channelBlocked(new Set(), "@x", "x"));
});

test("video IDs and handles from hrefs", () => {
  assert.strictEqual(D.videoIdFromHref("/watch?v=_cpcedLsdZA&t=3"), "_cpcedLsdZA");
  assert.strictEqual(D.videoIdFromHref("/shorts/k43pJvIN6p4"), "k43pJvIN6p4");
  assert.strictEqual(D.videoIdFromHref("/@chan"), null);
  assert.strictEqual(D.handleFromHref("/@SlopFactory/videos"), "@SlopFactory");
  assert.strictEqual(D.handleFromHref("https://www.youtube.com/@x?si=1"), "@x");
  assert.strictEqual(D.handleFromHref("/channel/UC123/featured"), "/channel/UC123");
  assert.strictEqual(D.handleFromHref("/watch?v=x"), "");
});
