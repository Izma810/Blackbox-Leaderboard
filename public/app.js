// Player page. No framework: fetch state, build HTML strings (always escaped), repeat every 3 seconds.

const TOKEN_KEY = "feature-market-token";
const REFRESH_MS = 3000;
const TOAST_MS = 3500;

let token = readToken();
let latest = null; // last state from the server
let lastRendered = ""; // skip re-rendering when nothing changed, so focus isn't lost
let filter = "all";
let refreshTimer = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- Storage (can fail in private windows, so always guarded) ----------

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // The session still works until the tab closes.
  }
}

// ---------- Helpers ----------

// Every piece of user text goes through this before it touches innerHTML.
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Escaped formula with nicer multiply and minus signs.
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

// Calls the API. Returns the data, or throws an Error worded by the server.
async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON response; fall through with a generic message.
  }
  if (response.status === 401 && token) {
    logOut();
  }
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong. Try again.");
    error.status = response.status;
    throw error;
  }
  return data;
}

// ---------- Views ----------

function showLogin() {
  $("game-view").classList.add("hidden");
  $("login-view").classList.remove("hidden");
  $("code-input").focus();
}

function showGame() {
  $("login-view").classList.add("hidden");
  $("game-view").classList.remove("hidden");
}

function logOut() {
  saveToken(null);
  latest = null;
  lastRendered = "";
  clearInterval(refreshTimer);
  refreshTimer = null;
  showLogin();
}

// ---------- Rendering ----------

function render(state) {
  const snapshot = JSON.stringify([state, filter]);
  if (snapshot === lastRendered) return;
  lastRendered = snapshot;

  const { me, game } = state;
  const isOpen = game.status === "open";

  $("wallet-name").textContent = me.name;
  $("wallet-balance").textContent = me.balance.toLocaleString();
  $("wallet-left").textContent = `${me.postsLeft} ${me.postsLeft === 1 ? "post" : "posts"} left, ${me.votesLeft} ${me.votesLeft === 1 ? "vote" : "votes"} left`;
  $("paused-banner").classList.toggle("hidden", isOpen);

  const inputs = game.numInputs === 1 ? "x or x1" : `x1 to x${game.numInputs}`;
  $("post-hint").textContent =
    `Posting costs ${game.posterStake} coins, returned with a reward if your feature is correct. ` +
    `Use ${inputs}, + − * / ^, and sin, cos, tan, exp, log, sqrt, abs.`;
  $("post-button").disabled = !isOpen || me.postsLeft <= 0 || me.balance < game.posterStake;

  renderFeatures(state);
  renderLeaderboard(state);
}

function visibleFeatures(state) {
  return state.features.filter((f) => {
    if (filter === "open") return f.status === "open";
    if (filter === "judged") return f.status === "correct" || f.status === "wrong";
    if (filter === "mine") return f.poster_id === state.me.id || f.my_vote !== null;
    return true;
  });
}

function renderFeatures(state) {
  const features = visibleFeatures(state);
  if (features.length === 0) {
    const text = filter === "all" ? "No features yet. Post the first one above." : "Nothing here yet.";
    $("feature-list").innerHTML = `<p class="empty card">${text}</p>`;
    return;
  }
  $("feature-list").innerHTML = features.map((f) => featureCard(f, state)).join("");
}

const PILLS = {
  open: ["Open", "pill"],
  closed: ["Voting closed", "pill pill-closed"],
  correct: ["Correct", "pill pill-correct"],
  wrong: ["Wrong", "pill pill-wrong"],
};

function featureCard(f, state) {
  const mine = f.poster_id === state.me.id;
  const judged = f.status === "correct" || f.status === "wrong";
  const [pillText, pillClass] = PILLS[f.status];
  const total = f.up_count + f.down_count;
  const upShare = total === 0 ? 0 : (f.up_count / total) * 100;
  const downShare = total === 0 ? 0 : 100 - upShare;
  const cardClass = judged ? `card feature judged-${f.status}` : "card feature";

  return `
    <article class="${cardClass}">
      <div class="feature-head">
        <div class="feature-formula math">${formulaHtml(f.formula)}</div>
        <span class="${pillClass}">${pillText}</span>
      </div>
      <p class="feature-meta">#${f.id}, posted by ${escapeHtml(f.poster_name)}${mine ? " (you)" : ""}</p>
      <div class="tally">
        <span class="tally-up">${f.up_count} up</span>
        <div class="bar" aria-hidden="true">
          <div class="bar-up" style="width:${upShare}%"></div>
          <div class="bar-down" style="width:${downShare}%"></div>
        </div>
        <span class="tally-down">${f.down_count} down</span>
      </div>
      <div class="feature-actions">${featureActions(f, state, mine, judged)}</div>
    </article>`;
}

function featureActions(f, state, mine, judged) {
  if (judged) {
    const verdict =
      f.status === "correct"
        ? `Judged correct. Poster earned <strong>${f.payout_y ?? 0}</strong> coins.`
        : "Judged wrong.";
    const myVote = f.my_vote ? ` You voted ${f.my_vote}.` : "";
    return `<span>${verdict}${myVote}</span>`;
  }
  if (mine) return `<span>Your feature. You staked <strong>${f.poster_stake}</strong> coins on it.</span>`;
  if (f.my_vote) return `<span>You voted <strong>${f.my_vote}</strong>. Waiting for judging.</span>`;
  if (f.status === "closed") return "<span>Voting is full. Waiting for judging.</span>";

  const { me, game } = state;
  const blocked = game.status !== "open" || me.votesLeft <= 0;
  const upDisabled = blocked || me.balance < f.up_price ? "disabled" : "";
  const downDisabled = blocked || me.balance < f.down_price ? "disabled" : "";
  return `
    <button type="button" class="btn btn-up" data-vote="up" data-id="${f.id}" ${upDisabled}>Upvote for ${f.up_price}</button>
    <button type="button" class="btn btn-down" data-vote="down" data-id="${f.id}" ${downDisabled}>Downvote for ${f.down_price}</button>`;
}

function renderLeaderboard(state) {
  $("leaderboard").innerHTML = state.leaderboard
    .map((row) => {
      const me = row.id === state.me.id ? ' class="me"' : "";
      return `<li${me}><span class="rank">${row.rank}</span><span class="name">${escapeHtml(row.name)}</span><span class="coins">${row.balance.toLocaleString()}</span></li>`;
    })
    .join("");
}

// ---------- Data ----------

async function refresh() {
  if (!token) return;
  try {
    latest = await api("GET", "/api/state");
    showGame();
    render(latest);
  } catch (err) {
    if (err.status !== 401) console.warn("Refresh failed:", err.message);
  }
}

function startRefreshing() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_MS);
}

// ---------- Events ----------

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("login-error").textContent = "";
  const code = $("code-input").value.trim();
  try {
    const data = await api("POST", "/api/login", { code });
    saveToken(data.token);
    $("code-input").value = "";
    await refresh();
    startRefreshing();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout").addEventListener("click", logOut);

$("post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("post-error").textContent = "";
  const button = $("post-button");
  button.disabled = true;
  try {
    const data = await api("POST", "/api/features", { formula: $("formula-input").value });
    $("formula-input").value = "";
    showToast(`Posted feature #${data.id}.`);
  } catch (err) {
    $("post-error").textContent = err.message;
  }
  lastRendered = "";
  await refresh();
});

// One listener handles every vote button, even ones rendered later.
$("feature-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-vote]");
  if (!button || button.disabled) return;
  const direction = button.dataset.vote;
  const featureId = Number(button.dataset.id);
  button.disabled = true;
  try {
    await api("POST", "/api/votes", { featureId, direction });
    showToast(`Voted ${direction} on #${featureId}.`);
  } catch (err) {
    showToast(err.message, true);
  }
  lastRendered = "";
  await refresh();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    filter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach((c) => {
      c.setAttribute("aria-pressed", String(c === chip));
    });
    if (latest) render(latest);
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

// ---------- Start ----------

if (token) {
  refresh();
  startRefreshing();
} else {
  showLogin();
}
