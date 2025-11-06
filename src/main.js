// src/main.js

// =============================
// 0. 共通ベースURL（GitHub Pages対応）
// =============================
const base = import.meta.env.BASE_URL || "./"; // 例: /feshp/

// =============================
// 1. スタンプまわり
// =============================
const STAMP_KEY = "fes:stamps:v1";

const STAMP_DEFS = [
  { id: "s1", color: "#4ade80", label: "s1" },
  { id: "s2", color: "#60a5fa", label: "s2" },
  { id: "s3", color: "#f472b6", label: "s3" },
];

function loadStamps() {
  try {
    const raw = localStorage.getItem(STAMP_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("loadStamps failed", e);
    return [];
  }
}

function saveStamps(arr) {
  try {
    localStorage.setItem(STAMP_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn("saveStamps failed", e);
  }
}

function renderStampsDOM() {
  const owned = new Set(loadStamps());
  const slots = document.querySelectorAll("#stampSlots [data-stamp]");
  if (!slots.length) return;

  slots.forEach((el) => {
    const id = el.dataset.stamp;
    const def = STAMP_DEFS.find((d) => d.id === id);
    if (owned.has(id)) {
      el.style.background = def?.color || "#76f7c5";
      el.style.color = "#000";
      el.textContent = id.toUpperCase();
    } else {
      el.style.background = "#3a3f46";
      el.style.color = "#fff";
      el.textContent = id;
    }
  });
}

// URL (?stamp=s1) で開かれたときに取得して保存
function applyStampFromURL() {
  const p = new URLSearchParams(location.search);
  const id = p.get("stamp");
  if (!id) return null;

  const known = STAMP_DEFS.some((s) => s.id === id);
  if (!known) return null;

  const current = new Set(loadStamps());
  current.add(id);
  saveStamps([...current]);
  renderStampsDOM();

  // URLをきれいに戻す（viewパラメータなどは残すかどうかは必要に応じて調整）
  p.delete("stamp");
  const q = p.toString();
  const newUrl = q ? `${location.pathname}?${q}` : location.pathname;
  history.replaceState(null, "", newUrl);

  return id;
}

// デバッグ用スタンプリセットボタンを追加
function injectStampResetButton() {
  const area = document.getElementById("stampArea");
  if (!area) return;
  if (area.querySelector(".stamp-reset-btn")) return;

  const btn = document.createElement("button");
  btn.textContent = "スタンプをリセット";
  btn.className = "stamp-reset-btn";
  btn.style.marginTop = "8px";
  btn.style.background = "rgba(255,255,255,0.03)";
  btn.style.border = "1px solid rgba(255,255,255,0.05)";
  btn.style.borderRadius = "8px";
  btn.style.color = "inherit";
  btn.style.padding = "5px 10px";
  btn.style.fontSize = "12px";
  btn.style.cursor = "pointer";

  btn.addEventListener("click", () => {
    saveStamps([]);
    renderStampsDOM();
    console.log("stamps reset");
  });

  area.appendChild(btn);
}

// =============================
// 2. デバッグカウンタ（自動保存）
// =============================
const COUNTER_KEY = "fes:counter:v1";

function loadCounter() {
  const raw = localStorage.getItem(COUNTER_KEY);
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function saveCounter(v) {
  localStorage.setItem(COUNTER_KEY, String(v));
}

function renderCounter(v) {
  const el = document.getElementById("counterValue");
  if (el) el.textContent = String(v);
}

function setupCounterUI() {
  let counter = loadCounter();
  renderCounter(counter);

  const incBtn = document.getElementById("incBtn");
  const resetBtn = document.getElementById("resetBtn");

  if (incBtn) {
    incBtn.addEventListener("click", () => {
      counter = counter + 1;
      renderCounter(counter);
      saveCounter(counter);
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      counter = 0;
      renderCounter(counter);
      saveCounter(counter);
    });
  }
}

// =============================
// 3. ゲーム一覧の読み込み（games.json）
// =============================
async function loadGames() {
  const url = `${base}games.json?ts=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`games.jsonを取得できません (${res.status})`);
  }
  const data = await res.json();
  return data.games ?? [];
}

function renderGames(list) {
  const wrap = document.getElementById("gamesList");
  if (!wrap) return;
  if (!list.length) {
    wrap.textContent = "games.json を取得できませんでした。";
    return;
  }
  wrap.innerHTML = "";
  list.forEach((g) => {
    const card = document.createElement("div");
    card.style.background = "rgba(255,255,255,0.015)";
    card.style.border = "1px solid rgba(255,255,255,0.015)";
    card.style.borderRadius = "10px";
    card.style.padding = "6px 8px";
    card.style.cursor = "pointer";
    card.innerHTML = `<strong>${escapeHtml(g.title)}</strong><br><span style="opacity:.65">${escapeHtml(g.desc || "")}</span>`;
    card.addEventListener("click", () => {
      alert(`「${g.title}」を起動する処理をここに入れます（後で）`);
    });
    wrap.appendChild(card);
  });
}

// =============================
// 4. ヒーローエリア（スライド）
// =============================
const HERO_ITEMS = [
  {
    title: "画像が遷移する画面",
    lines: [
      "・adminで設定した4種類の画像が一定時間ごとにループで切り替わっていく。",
      "・開始が近いイベントや目玉ゲームの画像を表示する予定。",
    ],
  },
  {
    title: "ミニゲーム速報",
    lines: ["・新しく追加されたゲームをここに出す。", "・当日はイベントをここで告知。"],
  },
  {
    title: "スタンプラリー開催中",
    lines: ["・部活のQRを読み取るとスタンプが貯まります。"],
  },
  {
    title: "お知らせ",
    lines: ["・このスペースは後でadminから差し替えます。"],
  },
];

function startHeroLoop() {
  const hero = document.getElementById("heroArea");
  const badge = document.getElementById("heroBadge");
  if (!hero) return;

  let idx = 0;
  const apply = () => {
    const item = HERO_ITEMS[idx % HERO_ITEMS.length];
    const inner = hero.querySelector(".hero-inner");
    if (inner) {
      inner.innerHTML = `
        <div class="hero-title">${escapeHtml(item.title)}</div>
        <div class="hero-list">
          ${item.lines.map((l) => escapeHtml(l)).join("<br>")}
        </div>
      `;
    }
    if (badge) {
      badge.textContent = `${(idx % HERO_ITEMS.length) + 1} / ${HERO_ITEMS.length}`;
    }
    idx++;
  };

  apply();
  setInterval(apply, 4000);
}

// =============================
// 5. ビュー切り替え（Games / Stamps / Clubs）
// =============================
const VIEW_DEFAULT = "games";

function getInitialView() {
  const p = new URLSearchParams(location.search);
  const v = p.get("view");
  if (v === "games" || v === "stamps" || v === "clubs") return v;
  return VIEW_DEFAULT;
}

function applyView(view) {
  // navの見た目
  const circles = document.querySelectorAll(".nav-circle");
  circles.forEach((c) => {
    const v = c.dataset.view;
    if (v === view) c.classList.add("nav-circle--active");
    else c.classList.remove("nav-circle--active");
  });

  // パネル表示
  const panels = document.querySelectorAll(".view-panel");
  panels.forEach((p) => {
    const v = p.getAttribute("data-view-panel");
    if (v === view) p.classList.add("view-panel--active");
    else p.classList.remove("view-panel--active");
  });

  // URLにも反映（リロードはされない）
  const params = new URLSearchParams(location.search);
  params.set("view", view);
  const q = params.toString();
  const newUrl = q ? `${location.pathname}?${q}` : location.pathname;
  history.replaceState(null, "", newUrl);
}

function setupNavCircles() {
  const circles = document.querySelectorAll(".nav-circle");
  circles.forEach((c) => {
    c.addEventListener("click", () => {
      const view = c.dataset.view;
      if (!view) return;
      applyView(view);
    });
  });
}

// =============================
// 6. ユーティリティ
// =============================
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}

// =============================
// 7. 起動
// =============================
document.addEventListener("DOMContentLoaded", async () => {
  // 1) URLからスタンプ取得（iPhone標準カメラ対応）
  const fromUrl = applyStampFromURL();

  // 2) スタンプ描画
  renderStampsDOM();
  injectStampResetButton();

  // 3) カウンタ
  setupCounterUI();

  // 4) ゲーム一覧
  try {
    const games = await loadGames();
    renderGames(games);
  } catch (e) {
    console.warn(e);
    const wrap = document.getElementById("gamesList");
    if (wrap) wrap.textContent = String(e.message || e);
  }

  // 5) ヒーロー開始
  startHeroLoop();

  // 6) ビュー切り替え初期化
  setupNavCircles();
  const initialView = getInitialView();
  applyView(initialView);

  if (fromUrl) {
    console.log(`スタンプ「${fromUrl}」を取得しました`);
  }
});
