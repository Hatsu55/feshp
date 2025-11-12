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

  // 画面の骨組み
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
        padding:12px 6px 10px;
      }
      .terminal-header {
        font-size:20px;
        font-weight:600;
        margin:0 4px 10px;
        opacity:.9;
        text-align:center;
      }
      .terminal-carousel {
        flex:1;
        position:relative;
        display:flex;
        align-items:center;
        justify-content:center;
        overflow:visible;
        touch-action:pan-y;
        /* 少し下めに配置するために高さ＆余白を多めに */
        min-height:330px;
        margin-top:12px;
        margin-bottom:16px;
      }
      .terminal-slide {
        position:absolute;
        top:70%; /* 50% より少し下に */
        left:50%;
        transform:translate(-50%,-50%);
        transition:transform .28s ease-out, opacity .28s ease-out;
        /* 縦長に近づけるために幅を細くする */
        width:55%;
        max-width:280px;
        pointer-events:none;
      }
      .terminal-slide.is-center {
        pointer-events:auto;
      }
      .terminal-card {
        position:relative;
        border-radius:26px;
        padding:12px;
        background:rgba(8,10,16,0.92);
        box-shadow:0 12px 26px rgba(0,0,0,0.6);
        overflow:visible;
      }
      .terminal-card-frame {
        border-radius:20px;
        border:2px solid #fff;
        padding:8px;
        position:relative;
        overflow:hidden;
        background:#11151f;
      }
      .terminal-card-bg {
        width:100%;
        /* より縦長にする */
        height:260px;
        border-radius:16px;
        background:linear-gradient(135deg,#3b82f6,#22c55e);
        background-size:cover;
        background-position:center;
      }
      .terminal-card-char {
        position:absolute;
        right:8px;
        bottom:24px;
        width:44%;
        max-width:120px;
        pointer-events:none;
      }
      .terminal-card-title {
        position:absolute;
        right:14px;
        bottom:12px;
        font-size:11px;
        font-weight:600;
        color:#111;
        background:rgba(255,255,255,0.9);
        border-radius:999px;
        padding:3px 9px;
        white-space:nowrap;
      }
      .terminal-footer {
        padding:4px 4px 40px;
        display:flex;
        justify-content:center;
      }
      .terminal-play-btn {
        min-width:70%;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.3);
        background:linear-gradient(135deg,#22c55e,#0ea5e9);
        color:#fff;
        font-size:13px;
        font-weight:600;
        padding:9px 18px;
        cursor:pointer;
        box-shadow:0 8px 18px rgba(0,0,0,0.55);
      }
    `;
    document.head.appendChild(style);
  }

  // スライド（クリップ）生成
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
    if (g.cardBg) {
      bg.style.backgroundImage = `url(${g.cardBg})`;
    }
    frame.appendChild(bg);
    card.appendChild(frame);

    if (g.charImage) {
      const img = document.createElement("img");
      img.className = "terminal-card-char";
      img.src = g.charImage;
      img.alt = g.title || "";
      card.appendChild(img);
    }

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
      // 無限ループ用に「一番近いオフセット」に丸める
      let wrappedOffset = offset;
      if (wrappedOffset > len / 2) wrappedOffset -= len;
      if (wrappedOffset < -len / 2) wrappedOffset += len;

        // 左右へのずらし量を少し大きくして、左右のカードは画面端に少しだけ見える程度に
        const baseX = wrappedOffset * 110;   // 70 → 95 に拡大

        // 奥行き感をなくす：常に同じスケール
        const scale = 1;
        const opacity = wrappedOffset === 0 ? 1 : 0.35;

        el.style.transitionDuration = animate ? ".28s" : "0s";
        // scaleは 1 固定だが、他に影響が出ないようそのまま式に残す
        el.style.transform = `translate(calc(-50% + ${baseX}%), -50%) scale(${scale})`;
        el.style.opacity = String(opacity);


      if (wrappedOffset === 0) el.classList.add("is-center");
      else el.classList.remove("is-center");
    });

    // 背景切り替え（中央ゲーム）
    if (overlay) {
      const g = list[current];
      if (g && g.bgImage) {
        overlay.style.backgroundImage =
          `radial-gradient(circle at 20% 0%, rgba(128,255,224,0.18), transparent 55%),` +
          `url(${g.bgImage})`;
        overlay.style.backgroundSize = "cover";
        overlay.style.backgroundPosition = "center";
      } else {
        overlay.style.backgroundImage =
          "radial-gradient(circle at 20% 0%, rgba(128,255,224,0.18), transparent 55%), linear-gradient(135deg,#020617,#0f172a)";
      }
    }
  }

  function shift(delta) {
    if (!len) return;
    current = (current + delta + len) % len;
    applyLayout();
  }

  // 初期レイアウト
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
    const threshold = 40;

    if (dx > threshold) {
      shift(-1);  // 右スワイプ → 1つ前
    } else if (dx < -threshold) {
      shift(1);   // 左スワイプ → 1つ次
    } else {
      applyLayout();
    }
  }

  carousel.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // PCデバッグ用：クリック位置が真ん中より右か左かでスライド（ループ）
  carousel.addEventListener("click", (ev) => {
    const rect = carousel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (ev.clientX > centerX) {
      shift(1);
    } else {
      shift(-1);
    }
  });

  // 「このゲームで遊ぶ」ボタン
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      const g = list[current];
      if (!g) return;
      const path = (g.path || "").replace(/^\//, "");
      const url = base + path;
      window.location.href = url;
    });
  }
}
