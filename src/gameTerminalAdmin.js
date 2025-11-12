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

  // ===== スクロールロック（強化版） =====
  // ・iOS含め確実に縦スクロールを止める
  // ・スクロールバーも非表示
  let __lockApplied = false;
  let __scrollY = 0;
  let __wheelHandler = null;
  let __touchHandler = null;
  let __keydownHandler = null;

  function applyGlobalScrollLock() {
    if (__lockApplied) return;
    __lockApplied = true;

    // 現在のスクロール位置を保持
    __scrollY = window.scrollY || document.documentElement.scrollTop || 0;

    // body固定（ページ全体のスクロールを物理的に止める）
    // これがもっとも効きます（iOS含む）
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${__scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    // スクロールバー非表示（各ブラウザ）
    document.documentElement.classList.add("fes-scrollbar-hide");
    body.classList.add("fes-scrollbar-hide");

    // touchmove / wheel をグローバルに阻止（iOS対応には passive:false が重要）
    const noscroll = (e) => e.preventDefault();
    __wheelHandler = (e) => {
      // 横スクロールしたいケースでも、ここでは完全ブロックが要件
      e.preventDefault();
    };
    __touchHandler = (e) => {
      e.preventDefault();
    };
    __keydownHandler = (e) => {
      // キー操作によるスクロールをブロック（Space / PgUp/Down / Home/End / Arrow）
      const keys = [" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (keys.includes(e.key)) e.preventDefault();
    };

    document.addEventListener("wheel", __wheelHandler, { passive: false, capture: true });
    document.addEventListener("touchmove", __touchHandler, { passive: false, capture: true });
    document.addEventListener("keydown", __keydownHandler, { passive: false, capture: true });
  }

  function releaseGlobalScrollLock() {
    if (!__lockApplied) return;
    __lockApplied = false;

    // リスナー解除
    if (__wheelHandler) document.removeEventListener("wheel", __wheelHandler, { capture: true });
    if (__touchHandler) document.removeEventListener("touchmove", __touchHandler, { capture: true });
    if (__keydownHandler) document.removeEventListener("keydown", __keydownHandler, { capture: true });
    __wheelHandler = __touchHandler = __keydownHandler = null;

    // スクロールバー表示を戻す
    document.documentElement.classList.remove("fes-scrollbar-hide");
    document.body.classList.remove("fes-scrollbar-hide");

    // body固定解除＆元の位置へ戻す
    const body = document.body;
    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.width = "";
    window.scrollTo(0, __scrollY || 0);
  }

  // 画面に入ったらロック（この機能画面中は上下に動かない要件）
  applyGlobalScrollLock();

  // 他画面へ戻った時に解除できるよう、念のためグローバル関数も用意
  window.__fes_unlock_scroll = releaseGlobalScrollLock;

  // ====== 画面の骨組み ======
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

  // ===== スタイル注入（あなたの最新数値を維持）=====
  if (!document.getElementById("terminalStyles")) {
    const style = document.createElement("style");
    style.id = "terminalStyles";
    style.textContent = `
      /* スクロールバー非表示（ロック中に付与するクラス） */
      .fes-scrollbar-hide {
        scrollbar-width: none;          /* Firefox */
        -ms-overflow-style: none;       /* IE/Edge */
      }
      .fes-scrollbar-hide::-webkit-scrollbar { display: none; } /* Chrome/Safari */

      /* この画面でのオーバースクロール抑止 */
      .feature-view[data-screen="games"] { overscroll-behavior: none; }

      .terminal-root {
        display:flex;
        flex-direction:column;
        height:100%;
        padding:24px 6px 10px;
        overscroll-behavior: none;
      }
      .terminal-header {
        font-size:20px;        /* 維持 */
        font-weight:600;
        margin:20 4px 10px;    /* 維持（記法上は '20px 4px 10px' 推奨だが値はそのまま） */
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
        touch-action: pan-x; /* 横スワイプのみ許可（縦禁止） */
        min-height:330px;    /* 維持 */
        margin-top:12px;     /* 維持 */
        margin-bottom:16px;  /* 維持 */
      }
      .terminal-slide {
        position:absolute;
        top:65%;             /* 維持 */
        left:50%;
        transform:translate(-50%,-50%);
        transition:transform .28s ease-out, opacity .28s ease-out;
        width:70%;           /* 維持 */
        max-width:460px;     /* 維持 */
        pointer-events:none;
      }
      .terminal-slide.is-center { pointer-events:auto; }

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
        height:300px;        /* 維持（縦長） */
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
        padding:100px 4px 12px; /* 維持（ボタンを下へ） */
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

  // ===== スライド（クリップ）生成 =====
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

      // 平面スライド：奥行き・縮尺なし（あなたの調整値を維持）
      const baseX = wrappedOffset * 100; // 維持
      const scale = 1;
      const opacity = wrappedOffset === 0 ? 1 : 0.35;

      el.style.transitionDuration = animate ? ".28s" : "0s";
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

  // iOS等の保険：タッチ移動を常に抑止（横スワイプ以外のスクロールを防ぐ）
  carousel.addEventListener("touchmove", (e) => {
    e.preventDefault();
  }, { passive: false });

  // PCデバッグ用：クリック位置が真ん中より右か左かでスライド（ループ）
  carousel.addEventListener("click", (ev) => {
    const rect = carousel.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    if (ev.clientX > centerX) shift(1);
    else shift(-1);
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
