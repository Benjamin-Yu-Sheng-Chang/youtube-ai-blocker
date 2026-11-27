const { DEFAULTS, DEFAULT_TITLE_REGEX, compileTitleRegex } = globalThis.AIB;
const $ = (id) => document.getElementById(id);

async function load() {
  const { settings } = await browser.storage.local.get("settings");
  const s = { ...DEFAULTS, ...settings };
  $("enabled").checked = s.enabled;
  document.querySelector(`input[name="mode"][value="${s.mode}"]`).checked = true;
  $("useLabel").checked = s.useLabel;
  $("useTitle").checked = s.useTitle;
  $("titleRegex").value = s.titleRegex;
  $("channels").value = s.channels.join("\n");
  validateRegex();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  try {
    const { matched, mode } = await browser.tabs.sendMessage(tab.id, { type: "aib-stats" });
    const verb = mode === "flag" ? "flagged" : "hidden";
    $("stats").textContent = `${matched} AI video${matched === 1 ? "" : "s"} ${verb} on this page`;
  } catch {
    $("stats").textContent = "Open YouTube to see stats.";
  }
}

function validateRegex() {
  const v = $("titleRegex").value;
  const ok = !v.trim() || compileTitleRegex(v);
  $("regexError").textContent = ok ? "" : "Invalid regex";
  return !!ok;
}

async function save() {
  if (!validateRegex()) return;
  await browser.storage.local.set({
    settings: {
      enabled: $("enabled").checked,
      mode: document.querySelector('input[name="mode"]:checked').value,
      useLabel: $("useLabel").checked,
      useTitle: $("useTitle").checked,
      titleRegex: $("titleRegex").value.trim(),
      channels: $("channels")
        .value.split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  });
  $("saved").textContent = "Saved";
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

$("titleRegex").addEventListener("input", validateRegex);
$("resetRegex").addEventListener("click", (e) => {
  e.preventDefault();
  $("titleRegex").value = DEFAULT_TITLE_REGEX;
  validateRegex();
});
$("save").addEventListener("click", save);
for (const id of ["enabled", "useLabel", "useTitle"]) $(id).addEventListener("change", save);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", save));

load();
