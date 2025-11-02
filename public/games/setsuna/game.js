// game.js（役割ごとに結果表示を分けた版）

const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;

// いま自分がどちら側なのかを覚えておく
// "attacker" | "defender" | null
let currentRole = null;

let defendTimeoutId = null;
let resultTimeoutId = null;
let currentDefendWindow = 300; // ms
let enemyReactionMode = "normal"; // fast / normal / slow / random

// DOM
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

// ===== あなたが攻撃する時 =====
function onAttack() {
  if (state !== STATE.IDLE) {
    return;
  }

  // あなたは「攻撃側」
  currentRole = "attacker";

  // 本来はここでRTDBにslashを書く
  mockSendSlash();

  setState(STATE.ATTACK_WAIT);
  showAlert("斬", "相手の反応を待っています…", "#e2e8f0");
  enableAttackBtn(false);

  // 450ms待っても帰ってこなかったらtimeout
  const TIMEOUT_MS = 450;
  setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      onRemoteTimeout();
    }
  }, TIMEOUT_MS);
}

// ===== 相手が斬ってきた（防御に入る） =====
function enterDefendMode() {
  clearTimers();

  // あなたは「防御側」
  currentRole = "defender";

  setState(STATE.DEFEND);
  showAlert("！", "斬り返せ！", "#f97316");
  enableAttackBtn(true); // 同じボタンでカウンターできる

  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  // 0.3s以内に押されなかったら被弾
  defendTimeoutId = setTimeout(() => {
    // 防御に失敗したので "hit" を返す
    mockSendSlashResult("hit");
    showResult("hit", "defender");
  }, windowMs);

  // バーのアニメ
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

// ===== 防御中にタップ（カウンター成功） =====
function onDefendTap() {
  if (state !== STATE.DEFEND) return;

  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;

  // 相手に「カウンターしたよ」と返す
  mockSendSlashResult("counter");

  showResult("counter", "defender");
}

// ===== 結果表示 =====
function showResult(type, role = currentRole) {
  // role が渡されなかったら、最後に覚えている役割で表示する

  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  // 攻撃側のときのメッセージ
  if (role === "attacker") {
    if (type === "counter") {
      // 相手が0.3s以内に斬り返した
      showAlert("防", "相手に防がれた！（カウンター）", "#ef4444");
      log("あなたの攻撃は相手に防がれました");
    } else if (type === "hit") {
      showAlert("◎", "命中！", "#22c55e");
      log("あなたの攻撃が命中しました");
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("相打ち");
    } else if (type === "timeout") {
      showAlert("…", "相手の反応がありません（中止）", "#f97316");
      log("相手の反応がなく中止になりました");
    }
  }
  // 防御側のときのメッセージ
  else if (role === "defender") {
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
  }
  // どちらでもないとき（保険）
  else {
    showAlert("＝", "結果: " + type, "#e2e8f0");
  }

  // 1秒後にidleへ
  resultTimeoutId = setTimeout(() => {
    toIdle();
  }, 1000);
}

function toIdle() {
  clearTimers();
  currentRole = null;
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

// ===== モック通信層 =====
function mockSendSlash() {
  log("あなたが斬りました（mockSendSlash）");

  const enemyDelay = getEnemyReactionMs();

  setTimeout(() => {
    // もし自分も同時に相手のslashを受けてDEFENDになってたら → 相打ち扱い
    if (state !== STATE.ATTACK_WAIT) {
      return;
    }
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
}

// 相手があなたに slash を送ってきた想定
function onRemoteSlash() {
  log("相手があなたに斬ってきました（onRemoteSlash）");

  // あなたがいま攻撃中なら → 同時斬り
  if (state === STATE.ATTACK_WAIT) {
    showResult("draw", null);
    return;
  }

  // 普通に防御へ
  enterDefendMode();
}

// あなたが先に斬って、相手が結果を返してきたとき
function onRemoteSlashResult(result) {
  if (state !== STATE.ATTACK_WAIT) return;
  // このときは必ず「攻撃側としての結果表示」
  showResult(result, "attacker");
}

function onRemoteTimeout() {
  if (state !== STATE.ATTACK_WAIT) return;
  showResult("timeout", "attacker");
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

// ===== イベントバインド =====
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

// PCデバッグ用
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

// 初期化
toIdle();
log("ゲームを開始しました。斬るボタンまたはSpaceで攻撃できます。");
