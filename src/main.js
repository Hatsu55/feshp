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

  // stampだけ取り除いてURLをきれいにする（viewは残す）
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
    card.className = "game-card";
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
// 5. 機能画面オーバーレイ（Games / Stamps / Clubs）
// =============================
const SCREEN_TITLES = {
  games: "ミニゲーム一覧",
  stamps: "スタンプ",
  clubs: "部展紹介",
};

function getInitialScreen() {
  const p = new URLSearchParams(location.search);
  const v = p.get("view");
  if (v === "games" || v === "stamps" || v === "clubs") return v;
  return null; // デフォルトはホームのみ表示
}

function openScreen(screen, fromCircleEl) {
  const overlay = document.getElementById("featureOverlay");
  const titleEl = document.getElementById("featureTitle");
  if (!overlay || !titleEl) return;

  // タイトル切り替え
  titleEl.textContent = SCREEN_TITLES[screen] ?? "機能";

  // 対応するviewだけ表示
  const views = document.querySelectorAll(".feature-view");
  views.forEach((v) => {
    const s = v.getAttribute("data-screen");
    if (s === screen) {
      v.classList.add("feature-view--active");
    } else {
      v.classList.remove("feature-view--active");
    }
  });

  // transform-origin を押したボタンの位置に寄せる（ボタン→画面が広がる感じ）
  const appShell = document.querySelector(".app-shell");
  if (fromCircleEl && appShell) {
    const circleRect = fromCircleEl.getBoundingClientRect();
    const appRect = appShell.getBoundingClientRect();
    const cx = circleRect.left + circleRect.width / 2 - appRect.left;
    const cy = circleRect.top + circleRect.height / 2 - appRect.top;
    overlay.style.transformOrigin = `${cx}px ${cy}px`;
  } else {
    overlay.style.transformOrigin = "50% 50%";
  }

  // オーバーレイ表示
  overlay.classList.add("feature-overlay--active");

  // URLにもviewを反映
  const params = new URLSearchParams(location.search);
  params.set("view", screen);
  const q = params.toString();
  const newUrl = q ? `${location.pathname}?${q}` : location.pathname;
  history.replaceState(null, "", newUrl);

  // ナビの見た目
  updateNavActive(screen);
}

function closeScreen() {
  const overlay = document.getElementById("featureOverlay");
  if (!overlay) return;
  overlay.classList.remove("feature-overlay--active");

  // URLからviewを削除（ホームのみの状態に戻す）
  const params = new URLSearchParams(location.search);
  params.delete("view");
  const q = params.toString();
  const newUrl = q ? `${location.pathname}?${q}` : location.pathname;
  history.replaceState(null, "", newUrl);

  updateNavActive(null);
}

function updateNavActive(screen) {
  const circles = document.querySelectorAll(".nav-circle");
  circles.forEach((c) => {
    const v = c.dataset.view;
    if (screen && v === screen) {
      c.classList.add("nav-circle--active");
    } else {
      c.classList.remove("nav-circle--active");
    }
  });
}

function setupNavAndOverlay() {
  const circles = document.querySelectorAll(".nav-circle");
  const backBtn = document.getElementById("backBtn");

  circles.forEach((c) => {
    c.addEventListener("click", () => {
      const screen = c.dataset.view;
      if (!screen) return;
      openScreen(screen, c);
    });
  });

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      closeScreen();
    });
  }
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
  // 1) スタンプURL (?stamp=s1) 対応
  const fromUrl = applyStampFromURL();

  // 2) スタンプ描画＋リセットボタン
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

  // 5) ヒーロースライド
  startHeroLoop();

  // 6) 機能画面オーバーレイ
  setupNavAndOverlay();
  const initialScreen = getInitialScreen();
  if (initialScreen) {
    // URLに view=stamps 等があれば初期表示で開く
    openScreen(initialScreen, null);
  }

  if (fromUrl) {
    console.log(`スタンプ「${fromUrl}」を取得しました`);
  }
});
