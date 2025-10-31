// src/main.js

const STAMP_KEY = "fes:stamps:v1";
const COUNTER_KEY = "fes:counter:v1";

// =========================
// 1) スタンプのロード＆表示
// =========================
function loadStamps() {
  try {
    const raw = localStorage.getItem(STAMP_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.warn("stamp load failed", e);
    return [];
  }
}

function saveStamps(arr) {
  localStorage.setItem(STAMP_KEY, JSON.stringify(arr));
}

function renderStamps(stamps) {
  const slots = document.querySelectorAll("#stampSlots [data-stamp]");
  slots.forEach((el) => {
    const id = el.dataset.stamp;
    if (stamps.includes(id)) {
      el.style.background = "#76f7c5";
      el.style.color = "#000";
    } else {
      el.style.background = "#3a3f46";
      el.style.color = "#fff";
    }
  });
}

// =========================
// 2) カウンタのロード＆表示
// =========================
function loadCounter() {
  const raw = localStorage.getItem(COUNTER_KEY);
  return raw ? Number(raw) : 0;
}

function saveCounter(v) {
  localStorage.setItem(COUNTER_KEY, String(v));
}

function renderCounter(v) {
  const el = document.getElementById("counterValue");
  if (el) el.textContent = v;
}

// =========================
// 3) ゲーム一覧の読み込み
// =========================
async function loadGames() {
  try {
    const res = await fetch("/games.json"); // public/games.json
    if (!res.ok) throw new Error("games.json fetch failed");
    const data = await res.json();
    return data.games ?? [];
  } catch (e) {
    console.warn(e);
    return [];
  }
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
    const div = document.createElement("div");
    div.style.background = "rgba(255,255,255,0.015)";
    div.style.border = "1px solid rgba(255,255,255,0.015)";
    div.style.borderRadius = "10px";
    div.style.padding = "6px 8px";
    div.textContent = `${g.title} – ${g.desc ?? ""}`;
    wrap.appendChild(div);
  });
}

// =========================
// 4) ヒーロー画像の簡易スライド
// =========================
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
    lines: ["・新しく追加されたゲームをここに出す。", "・当日は1時間毎のイベントをここで告知。"],
  },
  {
    title: "スタンプラリー開催中",
    lines: ["・各部のQRを読み取ってスタンプを集めよう。", "・集まったら景品がもらえるかも？"],
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
        <div class="hero-title">${item.title}</div>
        <div class="hero-list">
          ${item.lines.map((l) => l).join("<br>")}
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

// =========================
// 5) 画面切り替え（今はダミー）
// =========================
function setupNavCircles() {
  const circles = document.querySelectorAll(".nav-circle");
  const lower = document.getElementById("lowerPanel");
  circles.forEach((c) => {
    c.addEventListener("click", () => {
      circles.forEach((x) => x.classList.remove("nav-circle--active"));
      c.classList.add("nav-circle--active");

      const view = c.dataset.view;
      // 今はまだ1画面なので、スタンプとカウンタだけ見せたり隠したりする
      if (view === "games") {
        lower.style.display = "flex";
      } else if (view === "stamps") {
        lower.style.display = "flex"; // 将来ここに stamps 専用を表示
      } else {
        lower.style.display = "flex";
      }
    });
  });
}

// =========================
// 起動
// =========================
document.addEventListener("DOMContentLoaded", async () => {
  // 1) スタンプ
  const stamps = loadStamps();
  renderStamps(stamps);

  // 2) カウンタ
  let counter = loadCounter();
  renderCounter(counter);

  const incBtn = document.getElementById("incBtn");
  const resetBtn = document.getElementById("resetBtn");
  if (incBtn) {
    incBtn.addEventListener("click", () => {
      counter += 1;
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

  // 3) ゲーム一覧
  const games = await loadGames();
  renderGames(games);

  // 4) スライド
  startHeroLoop();

  // 5) ナビ
  setupNavCircles();
});
