// src/main.js

// =============================
// 0. 共通ベースURL（GitHub Pages対応）
// =============================
const base = import.meta.env.BASE_URL || "./"; // 例: /feshp/
const absoluteBase = location.origin + base;

// =============================
// 1. スタンプまわり
// =============================
// 今回のHTMLでは #stampSlots の中に <div data-stamp="s1">... がある前提
const STAMP_KEY = "fes:stamps:v1";

// 今回は3つ固定（前と同じID）
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
    // 定義の色を探す
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

  // 知らないIDは無視
  const known = STAMP_DEFS.some((s) => s.id === id);
  if (!known) return null;

  const current = new Set(loadStamps());
  current.add(id);
  saveStamps([...current]);
  renderStampsDOM();

  // URLをきれいに戻す
  history.replaceState(null, "", location.pathname);

  return id;
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
// ← ここが「games.jsonを取得できませんでした」の原因だったので修正
async function loadGames() {
  // BASE_URLに依存させることで /feshp/games.json が読めるようにする
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
    // 今は起動してもiframeがないので説明だけ。将来ここで起動
    card.addEventListener("click", () => {
      alert(`「${g.title}」を起動する処理をここに入れます（後で）`);
    });
    wrap.appendChild(card);
  });
}

// =============================
// 4. ヒーローエリア（スライドしてる白いところ）
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
// 5. ナビボタン（丸のやつ）
// =============================
function setupNavCircles() {
  const circles = document.querySelectorAll(".nav-circle");
  const lower = document.getElementById("lowerPanel");
  circles.forEach((c) => {
    c.addEventListener("click", () => {
      circles.forEach((x) => x.classList.remove("nav-circle--active"));
      c.classList.add("nav-circle--active");

      // 今はまだ1画面なので非表示にはしないでそのまま
      const view = c.dataset.view;
      console.log("switch view ->", view);
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

  // 6) ナビ
  setupNavCircles();

  if (fromUrl) {
    // 簡易トースト代わりにconsole
    console.log(`スタンプ「${fromUrl}」を取得しました`);
  }
});
