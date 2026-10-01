// Admin page: settings, players, judging and the money check.

const KEY_STORAGE = "feature-market-admin-key";
const FEATURES_REFRESH_MS = 5000;
const TOAST_MS = 3500;
const DEFAULT_REWARD = 200;

// Editable settings, in the order and with the labels shown on the page.
const SETTING_FIELDS = [
  ["starting_balance", "Starting balance", "1"],
  ["max_posts_per_player", "Posts per player", "1"],
  ["max_votes_per_player", "Votes per player", "1"],
  ["vote_cap_per_feature", "Vote cap per feature", "1"],
  ["base_vote_price", "Vote price", "1"],
  ["poster_stake", "Poster stake", "1"],
  ["upvote_reward_ratio", "Upvote reward (x price)", "any"],
  ["downvote_reward_ratio", "Downvote reward (x price)", "any"],
  ["dynamic_pricing", "Dynamic pricing (0 or 1)", "1"],
  ["num_inputs", "Black box inputs", "1"],
  ["input_min", "Test input min", "any"],
  ["input_max", "Test input max", "any"],
  ["duplicate_threshold", "Duplicate similarity (0 to 1)", "any"],
];

let adminKey = readKey();
let featuresTimer = null;
let toastTimer = null;
let players = [];

const $ = (id) => document.getElementById(id);

// ---------- Storage ----------

function readKey() {
  try {
    return sessionStorage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function saveKey(value) {
  adminKey = value;
  try {
    if (value) sessionStorage.setItem(KEY_STORAGE, value);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Works for this page load anyway.
  }
}

// ---------- Helpers ----------

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formulaHtml(text) {
  return escapeHtml(text).replaceAll("*", "·").replaceAll("-", "−");
}

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.textContent = "";
  }, TOAST_MS);
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-admin-key": adminKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON response.
  }
  if (response.status === 401) disconnect();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Quotes a CSV cell when it contains a comma, quote or line break.
function csvCell(value) {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// ---------- Connect ----------

function disconnect() {
  saveKey("");
  clearInterval(featuresTimer);
  featuresTimer = null;
  $("admin-panels").classList.add("hidden");
  $("key-status").textContent = "";
  $("key-error").textContent = "Wrong admin key.";
}

async function connect() {
  $("key-error").textContent = "";
  try {
    const settings = await api("GET", "/api/admin/settings");
    $("admin-panels").classList.remove("hidden");
    $("key-status").textContent = "Connected.";
    renderSettings(settings);
    await Promise.all([loadPlayers(), loadFeatures()]);
    clearInterval(featuresTimer);
    featuresTimer = setInterval(() => {
      // Don't wipe a reward the admin is typing.
      if (!$("judge-area").contains(document.activeElement)) loadFeatures();
    }, FEATURES_REFRESH_MS);
  } catch (err) {
    $("key-error").textContent = err.message;
  }
}

$("key-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveKey($("key-input").value.trim());
  $("key-input").value = "";
  connect();
});

// ---------- Status and settings ----------

function renderSettings(settings) {
  const isOpen = settings.status === "open";
  $("status-line").innerHTML = isOpen
    ? "The game is <strong>open</strong>. Players can post and vote."
    : "The game is <strong>paused</strong>. Players can look but not post or vote.";
  $("open-game").disabled = isOpen;
  $("pause-game").disabled = !isOpen;

  $("settings-grid").innerHTML = SETTING_FIELDS.map(
    ([key, label, step]) => `
      <label>${label}
        <input type="number" name="${key}" step="${step}" value="${escapeHtml(settings[key])}" required>
      </label>`,
  ).join("");
}

async function setStatus(status) {
  $("status-error").textContent = "";
  try {
    renderSettings(await api("POST", "/api/admin/settings", { status }));
    showToast(status === "open" ? "The game is open." : "The game is paused.");
  } catch (err) {
    $("status-error").textContent = err.message;
  }
}

$("open-game").addEventListener("click", () => setStatus("open"));
$("pause-game").addEventListener("click", () => setStatus("closed"));

$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("settings-error").textContent = "";
  const changes = {};
  for (const [key] of SETTING_FIELDS) {
    const input = $("settings-grid").querySelector(`input[name="${key}"]`);
    changes[key] = input.value === "" ? "" : Number(input.value);
  }
  try {
    renderSettings(await api("POST", "/api/admin/settings", changes));
    showToast("Settings saved.");
  } catch (err) {
    $("settings-error").textContent = err.message;
  }
});

// ---------- Players ----------

async function loadPlayers() {
  players = await api("GET", "/api/admin/players");
  $("players-body").innerHTML = players
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td><code>${escapeHtml(p.login_code)}</code></td>
        <td class="num">${p.balance}</td>
        <td class="num">${p.posts_used}</td>
        <td class="num">${p.votes_used}</td>
      </tr>`,
    )
    .join("");
}

$("add-players").addEventListener("click", async () => {
  $("players-error").textContent = "";
  const names = $("names-input").value.split("\n");
  try {
    const added = await api("POST", "/api/admin/players", { names });
    $("names-input").value = "";
    showToast(`Added ${added.length} ${added.length === 1 ? "player" : "players"}.`);
    await loadPlayers();
  } catch (err) {
    $("players-error").textContent = err.message;
  }
});

$("download-codes").addEventListener("click", async () => {
  try {
    await loadPlayers();
    const lines = ["name,code", ...players.map((p) => `${csvCell(p.name)},${csvCell(p.login_code)}`)];
    download("player-codes.csv", lines.join("\n") + "\n", "text/csv");
  } catch (err) {
    $("players-error").textContent = err.message;
  }
});

// ---------- Judging ----------

const STATUS_LABELS = { open: "Open", closed: "Voting closed", correct: "Correct", wrong: "Wrong" };

async function loadFeatures() {
  try {
    const features = await api("GET", "/api/admin/features");
    renderFeatures(features);
  } catch (err) {
    $("judge-error").textContent = err.message;
  }
}

function renderFeatures(features) {
  if (features.length === 0) {
    $("features-body").innerHTML = '<tr><td colspan="8" class="muted">No features yet.</td></tr>';
    return;
  }
  $("features-body").innerHTML = features
    .map((f) => {
      const judged = f.status === "correct" || f.status === "wrong";
      const reward = judged
        ? f.status === "correct" ? String(f.payout_y) : "–"
        : `<input class="reward-input" type="number" min="0" step="1" value="${DEFAULT_REWARD}" data-reward="${f.id}" aria-label="Reward for #${f.id}">`;
      const actions = judged
        ? ""
        : `<div class="row">
             <button type="button" class="btn btn-up" data-judge="correct" data-id="${f.id}">Correct</button>
             <button type="button" class="btn btn-down" data-judge="wrong" data-id="${f.id}">Wrong</button>
           </div>`;
      return `
        <tr>
          <td>${f.id}</td>
          <td class="math">${formulaHtml(f.formula)}</td>
          <td>${escapeHtml(f.poster_name)}</td>
          <td class="num">${f.up_count}</td>
          <td class="num">${f.down_count}</td>
          <td>${STATUS_LABELS[f.status]}</td>
          <td>${reward}</td>
          <td>${actions}</td>
        </tr>`;
    })
    .join("");
}

$("features-body").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-judge]");
  if (!button) return;
  $("judge-error").textContent = "";
  const featureId = Number(button.dataset.id);
  const correct = button.dataset.judge === "correct";
  const rewardInput = $("features-body").querySelector(`input[data-reward="${featureId}"]`);
  const payoutY = rewardInput ? Number(rewardInput.value) : 0;

  const question = correct
    ? `Mark #${featureId} correct and pay the poster ${payoutY} coins? This can't be undone.`
    : `Mark #${featureId} wrong? This can't be undone.`;
  if (!confirm(question)) return;

  try {
    await api("POST", "/api/admin/judge", { featureId, correct, payoutY });
    showToast(`Judged #${featureId} ${correct ? "correct" : "wrong"}.`);
    button.blur();
    await Promise.all([loadFeatures(), loadPlayers()]);
  } catch (err) {
    $("judge-error").textContent = err.message;
  }
});

// ---------- Audit and backup ----------

$("run-audit").addEventListener("click", async () => {
  $("audit-error").textContent = "";
  try {
    const audit = await api("GET", "/api/admin/audit");
    $("audit-line").textContent = audit.allCorrect
      ? "All balances match their payment history."
      : "Some balances don't match. See mismatches.";
    $("audit-output").textContent = JSON.stringify(audit, null, 2);
    $("audit-output").classList.remove("hidden");
  } catch (err) {
    $("audit-error").textContent = err.message;
  }
});

$("download-backup").addEventListener("click", async () => {
  $("audit-error").textContent = "";
  try {
    const backup = await api("GET", "/api/admin/export");
    const stamp = backup.exportedAt.replaceAll(":", "-");
    download(`feature-market-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json");
  } catch (err) {
    $("audit-error").textContent = err.message;
  }
});

// ---------- Start ----------

if (adminKey) connect();
