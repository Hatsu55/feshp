// game.js
const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;
let defendTimeoutId = null;
let resultTimeoutId = null;
let currentDefendWindow = 300; // ms, スライダーで変更
let enemyReactionMode = "normal"; // fast / normal / slow / random

// DOM取得
const gameStateEl = document.getElementById("game-state");
const alertSymbolEl = document.getElementById("alert-symbol");
const alertTextEl = document.getElementById("alert-text");
const logAreaEl = document.getElementById("log-area");
const attackBtn = document.getElementById("attack-btn");
const fakeEnemyAttackBtn = document.getElementById("fake-enemy-attack-btn");
const enemySpeedSelect = document.getElementById("enemy-speed-select");
const defendWindowRange = document.getElementById("defend-window-range");
const defendWindowLabel = document.getElementById("defend-window-label");
const timerBarWrap = document.getElementById("timer-bar-wrap");
const timerBar = document.getElementById("timer-bar");

// ===== util =====
function setState(next) {
  state = next;
  gameStateEl.textContent = `state: ${next}`;
}

function log(msg) {
  const time = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  logAreaEl.innerHTML = `[${time}] ${msg}<br>` + logAreaEl.innerHTML;
}

function showAlert(symbol, text, color) {
  alertSymbolEl.textContent = symbol || "";
  alertTextEl.textContent = text || "";
  if (color) {
    alertTextEl.style.color = color;
  } else {
    alertTextEl.style.color = "inherit";
  }
}

function enableAttackBtn(enabled) {
  attackBtn.disabled = !enabled;
}

// ===== 攻撃処理（自分が斬る） =====
function onAttack() {
  if (state !== STATE.IDLE) {
    return;
  }
  // ここで本来なら sendSlash() する（RTDBに書き込む）
  mockSendSlash();
  setState(STATE.ATTACK_WAIT);
  showAlert("斬", "相手の反応を待っています…", "#e2e8f0");
  enableAttackBtn(false);

  // タイムアウト監視（450msで結果が来なかったら中止）
  const TIMEOUT_MS = 450;
  setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      // 相手から帰ってこなかったので中止
      onRemoteTimeout();
    }
  }, TIMEOUT_MS);
}

// ===== 防御モードに入る（相手が斬ってきた） =====
function enterDefendMode() {
  clearTimers();
  setState(STATE.DEFEND);
  showAlert("！", "斬り返せ！", "#f97316");
  enableAttackBtn(true); // 同じボタンでカウンターできる

  // タイマーバー表示
  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  // 0.3s以内に押されなかったら被弾判定
  defendTimeoutId = setTimeout(() => {
    // ここで自分は "hit" を返す（本来ならRTDBに書く）
    mockSendSlashResult("hit");
    showResult("hit");
  }, windowMs);

  // バーをアニメーションさせる
  function tick(now) {
    if (state !== STATE.DEFEND) return;
    const elapsed = now - start;
    const remain = Math.max(windowMs - elapsed, 0);
    const ratio = remain / windowMs;
    timerBar.style.width = `${ratio * 100}%`;
    if (remain > 0) {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
}

// ===== 防御時のタップ（カウンター） =====
function onDefendTap() {
  if (state !== STATE.DEFEND) return;
  // 間に合った！
  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  // ここで "counter" を返す
  mockSendSlashResult("counter");
  showResult("counter");
}

// ===== 結果表示 → idleに戻す =====
function showResult(type) {
  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  if (type === "counter") {
    showAlert("◎", "カウンター成功！", "#22c55e");
    log("あなたのカウンター成功");
  } else if (type === "hit") {
    showAlert("×", "被弾…", "#ef4444");
    log("あなたは被弾しました");
  } else if (type === "draw") {
    showAlert("＝", "相打ち", "#e2e8f0");
    log("相打ち");
  } else if (type === "timeout") {
    showAlert("…", "通信中止（timeout）", "#f97316");
    log("通信中止（timeout）");
  }

  // 1秒後にidleに戻す
  resultTimeoutId = setTimeout(() => {
    toIdle();
  }, 1000);
}

function toIdle() {
  clearTimers();
  setState(STATE.IDLE);
  showAlert("", "待機中です。あなたか相手が斬ると始まります。");
  enableAttackBtn(true);
}

function clearTimers() {
  if (defendTimeoutId) clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  if (resultTimeoutId) clearTimeout(resultTimeoutId);
  resultTimeoutId = null;
}

// ====== モック通信層 ======
// 本番ではここをFirebaseに差し替えればOKなようにしておく
function mockSendSlash() {
  log("あなたが斬りました（mockSendSlash）");

  // ここで「敵が結果を返すまでの時間」を決める
  const enemyDelay = getEnemyReactionMs();

  setTimeout(() => {
    // もしこっちも同時に敵のslashを受けてたら → 相打ちにする
    if (state !== STATE.ATTACK_WAIT) {
      // もう他の状態（DEFENDとか）になっていたら相打ち扱い
      return;
    }
    // ダミーでは 50%でcounter、50%でhit にしてみる
    const isCounter = Math.random() < 0.5;
    if (isCounter) {
      onRemoteSlashResult("counter");
    } else {
      onRemoteSlashResult("hit");
    }
  }, enemyDelay);
}

function mockSendSlashResult(result) {
  log(`あなたが結果を返しました（mockSendSlashResult: ${result}）`);
  // 本来はここでRTDBに書く
}

// ====== モックで相手から来るイベント群 ======

// 相手が“あなたに斬ってきた”とき
function onRemoteSlash() {
  log("相手があなたに斬ってきました（onRemoteSlash）");
  // もし自分も今ATTACK_WAITなら → 同時斬り（相打ち）
  if (state === STATE.ATTACK_WAIT) {
    showResult("draw");
    return;
  }
  // それ以外なら普通に防御へ
  enterDefendMode();
}

// 相手が“結果”を返してきたとき（自分が先に斬ったとき）
function onRemoteSlashResult(result) {
  if (state !== STATE.ATTACK_WAIT) return;
  showResult(result);
}

// タイムアウトされたとき
function onRemoteTimeout() {
  if (state !== STATE.ATTACK_WAIT) return;
  showResult("timeout");
}

// 敵の反応時間を決める
function getEnemyReactionMs() {
  switch (enemyReactionMode) {
    case "fast":
      return 150;
    case "normal":
      return 250;
    case "slow":
      return 400;
    case "random":
    default: {
      const min = 150;
      const max = 450;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
  }
}

// ====== イベントバインド ======
attackBtn.addEventListener("click", () => {
  if (state === STATE.DEFEND) {
    onDefendTap();
  } else {
    onAttack();
  }
});

fakeEnemyAttackBtn.addEventListener("click", () => {
  onRemoteSlash();
});

enemySpeedSelect.addEventListener("change", (e) => {
  enemyReactionMode = e.target.value;
  log(`敵の反応速度モードを ${enemyReactionMode} にしました`);
});

defendWindowRange.addEventListener("input", (e) => {
  currentDefendWindow = Number(e.target.value);
  defendWindowLabel.textContent = `${currentDefendWindow}ms`;
});

// PCデバッグ用のキー入力
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (state === STATE.DEFEND) {
      onDefendTap();
    } else {
      onAttack();
    }
  }
});

// 初期表示
toIdle();
log("ゲームを開始しました。斬るボタンまたはSpaceで攻撃できます。");
