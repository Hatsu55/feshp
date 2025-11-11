// src/gameTerminalAdmin.js

export function setupGameTerminalUI(games, opts = {}) {
  const base = opts.base || "./";
  const screen = document.querySelector('.feature-view[data-screen="games"]');
  if (!screen) return;

  // games.json のうち title と path があるものだけを使う
  const list = (games || []).filter((g) => g && g.path && g.title);
  if (!list.length) {
    screen.innerHTML =
      '<div class="sub-card"><div class="sub-card-title">ミニゲーム一覧</div><div>games.json にゲームが登録されていません。</div></div>';
    return;
  }

  // 画面の骨組みをJS側で構築
  screen.innerHTML = `
    <div class="terminal-root">
      <div class="terminal-header">どのゲームで遊びますか？</div>
      <div class="terminal-carousel" id="terminalCarousel"></div>
      <div class="terminal-footer">
        <button class="terminal-play-btn" id="terminalPlayBtn">このゲームで遊ぶ</button>
      </div>
    </div>
  `;

  const carousel = screen.querySelector("#terminalCarousel");
  const playBtn = screen.querySelector("#terminalPlayBtn");
  const overlay = document.getElementById("featureOverlay");

  // 必要なスタイルを1回だけ注入
  if (!document.getElementById("terminalStyles")) {
    const style = document.createElement("style");
    style.id = "terminalStyles";
    style.textContent = `
      .terminal-root {
        display:flex;
        flex-direction:column;
        height:100%;
        padding:4px 4px 8px;
      }
      .terminal-header {
        font-size:13px;
        font-weight:600;
        margin:4px 4px 8px;
        opacity:.9;
        text-align:left;
      }
      .terminal-carousel {
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        position:relative;
        overflow:visible;
        touch-action:pan-y;
        /* カードを少し下寄せにするための高さと余白 */
        height: 230px;
        margin-top: 4px;
        margin-bottom: 6px;
      }
      .terminal-slide {
        position:absolute;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        transition:transform .28s ease-out, opacity .28s ease-out;
        /* 幅を少し細めにして重なりを減らす */
        width:62%;
        max-width:230px;
        pointer-events:none;
      }
      .terminal-slide.is-center {
        pointer-events:auto;
      }
      .terminal-card {
        position:relative;
        border-radius:24px;
        padding:10px;
        background:rgba(8,10,16,0.9);
        box-shadow:0 12px 26px rgba(0,0,0,0.6);
        overflow:visible;
      }
      .terminal-card-frame {
        border-radius:18px;
        border:2px solid #fff;
        padding:8px;
        position:relative;
        overflow:hidden;
        background:#11151f;
      }
      .terminal-card-bg {
        width:100%;
        height:130px;
        border-radius:12px;
        background:linear-gradient(135deg,#3b82f6,#22c55e);
        background-size:cover;
        background-position:center;
      }
      .terminal-card-char {
        position:absolute;
        right:8px;
        bottom:20px;
        width:42%;
        max-width:120px;
        pointer-events:none;
      }
      .terminal-card-title {
        position:absolute;
        right:12px;
        bottom:10px;
        font-size:11px;
        font-weight:600;
        color:#111;
        background:rgba(255,255,255,0.86);
        border-radius:999px;
        padding:3px 7px;
      }
      .terminal-footer {
        padding:8px 4px 0;
        display:flex;
        justify-content:center;
      }
      .terminal-play-btn {
        min-width:60%;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.3);
        background:linear-gradient(135deg,#22c55e,#0ea5e9);
        color:#fff;
        font-size:13px;
        font-weight:600;
        padding:8px 16px;
        cursor:pointer;
        box-shadow:0 8px 18px rgba(0,0,0,0.55);
      }
    `;
    document.head.appendChild(style);
  }

  // スライド（クリップ）を生成
  list.forEach((g, index) => {
    const slide = document.createElement("div");
    slide.className = "terminal-slide";
    slide.dataset.index = String(index);

    const card = document.createElement("div");
    card.className = "terminal-card";

    const frame = document.createElement("div");
    frame.className = "terminal-card-frame";

    const bg = document.createElement("div");
    bg.className = "terminal-card-bg";
    // games.json に cardBg が設定されていれば使う（なければグラデ）
    if (g.cardBg) {
      bg.style.backgroundImage = `url(${g.cardBg})`;
    }

    frame.appendChild(bg);
    card.appendChild(frame);

    // キャラ画像：charImage があれば白枠から飛び出す感じで表示
    if (g.charImage) {
      const img = document.createElement("img");
      img.className = "terminal-card-char";
      img.src = g.charImage;
      img.alt = g.title || "";
      card.appendChild(img);
    }

    // 右下の短文（ゲームタイトル）
    const title = document.createElement("div");
    title.className = "terminal-card-title";
    title.textContent = g.title || "";
    card.appendChild(title);

    slide.appendChild(card);
    carousel.appendChild(slide);
  });

  let current = 0;
  const slideEls = Array.from(carousel.querySelectorAll(".terminal-slide"));
  const len = slideEls.length;

  function applyLayout(animate = true) {
    slideEls.forEach((el, i) => {
      const offset = i - current;
      // 無限ループ用に「近い方のオフセット」を計算
      let wrappedOffset = offset;
      if (wrappedOffset > len / 2) wrappedOffset -= len;
      if (wrappedOffset < -len / 2) wrappedOffset += len;

      const baseX = wrappedOffset * 70;   // 左右へのずらし量（％）
      const scale = wrappedOffset === 0 ? 1 : 0.8;
      const opacity = wrappedOffset === 0 ? 1 : 0.35;

      el.style.transitionDuration = animate ? ".28s" : "0s";
      el.style.transform = `translate(calc(-50% + ${baseX}%), -50%) scale(${scale})`;
      el.style.opacity = String(opacity);

      if (wrappedOffset === 0) el.classList.add("is-center");
      else el.classList.remove("is-center");
    });

    // 背景切り替え（中央のゲームに応じて）
    if (overlay) {
      const g = list[current];
      if (g && g.bgImage) {
        overlay.style.backgroundImage =
          `radial-gradient(circle at 20% 0%, rgba(128,255,224,0.18), transparent 55%),` +
          `url(${g.bgImage})`;
        overlay.style.backgroundSize = "cover";
        overlay.style.backgroundPosition = "center";
      } else {
        // 画像未設定時はグラデ背景
        overlay.style.backgroundImage =
          "radial-gradient(circle at 20% 0%, rgba(128,255,224,0.18), transparent 55%), linear-gradient(135deg,#020617,#0f172a)";
      }
    }
  }

  // 1つ進む／戻る（無限ループ）
  function shift(delta) {
    if (!len) return;
    current = (current + delta + len) % len;
    applyLayout();
  }

  // 初期表示
  applyLayout(false);

  // ===== スワイプ & クリック操作 =====
  let pointerActive = false;
  let startX = 0;
  let lastX = 0;

  function onPointerDown(ev) {
    pointerActive = true;
    const x =
      ev.clientX ??
      (ev.touches && ev.touches[0]?.clientX) ??
      0;
    startX = x;
    lastX = x;
  }

  function onPointerMove(ev) {
    if (!pointerActive) return;
    const x =
      ev.clientX ??
      (ev.touches && ev.touches[0]?.clientX) ??
      lastX;
    lastX = x;
  }

  function onPointerUp() {
    if (!pointerActive) return;
    pointerActive = false;
    const dx = lastX - startX;
    const threshold = 40; // 超えたら1枚分スライド

    if (dx > threshold) {
      // 右にスワイプ → ひとつ前へ
      shift(-1);
    } else if (dx < -threshold) {
      // 左にスワイプ → ひとつ先へ
      shift(1);
    } else {
      applyLayout();
    }
  }

  carousel.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // PCデバッグ用：クリック位置が真ん中より右か左かでスライド（無限ループ）
  carousel.addEventListener("click", (ev) => {
    const rect = carousel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (ev.clientX > centerX) {
      shift(1);   // 右側クリック → 次
    } else {
      shift(-1);  // 左側クリック → 前
    }
  });

  // 「このゲームで遊ぶ」ボタン
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      const g = list[current];
      if (!g) return;
      const path = (g.path || "").replace(/^\//, "");
      const url = base + path;
      // ここで実際にゲームページに遷移
      window.location.href = url;
    });
  }
}
