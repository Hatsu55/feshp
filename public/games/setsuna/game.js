// game.js（共通ゲージ＋HP付き）

const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;
// 攻撃側 or 防御側
let currentRole = null;

// ゲージ・HP（ローカル版）-------------------------
let commonGauge = 0; // 0〜100
const COMMON_GAUGE_MAX = 100;
// 斬るのに最低必要なゲージ量（あとで調整可）
const COMMON_GAUGE_COST = 30;

// HPはとりあえず10で持つ（1ヒットで-3くらい）
let hpYou = 10;
let hpEnemy = 10;
const HP_MAX = 10;

// タイマー
let defendTimeoutId = null;
let resultTimeoutId = null;
let commonGaugeTimerId = null;
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
// 新しく追加したDOM
const commonGaugeFill = document.getElementById("common-gauge-fill");
const commonGaugeValue = document.getElementById("common-gauge-value");
const hpYouEl = document.getElementById("hp-you");
const hpEnemyEl = document.getElementById("hp-enemy");

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

// ===== ゲージ・HPの更新表示 =====
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}

function updateHpView() {
  const youPct = Math.max(0, (hpYou / HP_MAX) * 100);
  const enemyPct = Math.max(0, (hpEnemy / HP_MAX) * 100);
  hpYouEl.style.width = `${youPct}%`;
  hpEnemyEl.style.width = `${enemyPct}%`;
}

// ===== 共通ゲージを時間で増やす =====
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    // 0.1秒に1%増える → 約10秒で満タン
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1;
      updateCommonGaugeView();
    }
  }, 100);
}

function stopCommonGaugeLoop() {
  if (commonGaugeTimerId) {
    clearInterval(commonGaugeTimerId);
    commonGaugeTimerId = null;
  }
}

// ===== あなたが攻撃する時 =====
function onAttack() {
  if (state !== STATE.IDLE) {
    return;
  }

  // ★ ゲージ足りないときは攻撃させない
  if (commonGauge < COMMON_GAUGE_COST) {
    showAlert("×", "ゲージ不足！", "#facc15");
    log(`ゲージが足りません (${Math.floor(commonGauge)}% / 必要${COMMON_GAUGE_COST}%)`);
    return;
  }

  // 攻撃するのでゲージを消費
  commonGauge = Math.max(0, commonGauge - COMMON_GAUGE_COST);
  updateCommonGaugeView();

  currentRole = "attacker";

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

  currentRole = "defender";

  setState(STATE.DEFEND);
  showAlert("！", "斬り返せ！", "#f97316");
  enableAttackBtn(true);

  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  defendTimeoutId = setTimeout(() => {
    // 防御失敗 → 自分がダメージ
    mockSendSlashResult("hit");
    applyDamageTo("you", 3);
    showResult("hit", "defender");
  }, windowMs);

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

  mockSendSlashResult("counter");
  // カウンター成功したら相手にダメージ
  applyDamageTo("enemy", 3);

  showResult("counter", "defender");
}

// ===== ダメージ適用（ローカル版） =====
function applyDamageTo(who, amount) {
  if (who === "you") {
    hpYou = Math.max(0, hpYou - amount);
    updateHpView();
    if (hpYou <= 0) {
      // あなたの負け
      showAlert("×", "YOU LOSE", "#ef4444");
      log("あなたのHPが0になりました");
      // ちょっと待ってからリセット
      setTimeout(() => {
        resetBattle();
      }, 1200);
    }
  } else if (who === "enemy") {
    hpEnemy = Math.max(0, hpEnemy - amount);
    updateHpView();
    if (hpEnemy <= 0) {
      showAlert("◎", "YOU WIN!", "#22c55e");
      log("敵のHPが0になりました");
      setTimeout(() => {
        resetBattle();
      }, 1200);
    }
  }
}

// ===== 結果表示 =====
function showResult(type, role = currentRole) {
  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  if (role === "attacker") {
    if (type === "counter") {
      showAlert("防", "相手に防がれた！（カウンター）", "#ef4444");
      log("あなたの攻撃は相手に防がれました");
    } else if (type === "hit") {
      showAlert("◎", "命中！", "#22c55e");
      log("あなたの攻撃が命中しました");
      // 命中したのでダメージ
      applyDamageTo("enemy", 3);
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("相打ち");
    } else if (type === "timeout") {
      showAlert("…", "相手の反応がありません（中止）", "#f97316");
      log("相手の反応がなく中止になりました");
    }
  } else if (role === "defender") {
    if (type === "counter") {
      showAlert("◎", "カウンター成功！", "#22c55e");
      log("あなたのカウンター成功");
      // カウンターのダメージはすでに onDefendTap で適用済み
    } else if (type === "hit") {
      showAlert("×", "被弾…", "#ef4444");
      log("あなたは被弾しました");
      // 被弾のダメージは enterDefendMode内で適用済み
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("相打ち");
    } else if (type === "timeout") {
      showAlert("…", "通信中止（timeout）", "#f97316");
      log("通信中止（timeout）");
    }
  } else {
    showAlert("＝", "結果: " + type, "#e2e8f0");
  }

  // 1秒後にidleへ（ただしHPで終わってなければ）
  resultTimeoutId = setTimeout(() => {
    if (hpYou > 0 && hpEnemy > 0) {
      toIdle();
    }
  }, 1000);
}

function toIdle() {
  clearTimers();
  currentRole = null;
  setState(STATE.IDLE);
  showAlert("", "待機中です。あなたか相手が斬ると始まります。");
  enableAttackBtn(true);
}

// HP等すべて初期化
function resetBattle() {
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  updateHpView();
  commonGauge = 0;
  updateCommonGaugeView();
  toIdle();
}

// ===== モック通信層 =====
function mockSendSlash() {
  log("あなたが斬りました（mockSendSlash）");

  const enemyDelay = getEnemyReactionMs();

  setTimeout(() => {
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

  if (state === STATE.ATTACK_WAIT) {
    showResult("draw", null);
    return;
  }

  enterDefendMode();
}

// あなたが先に斬って、相手が結果を返してきたとき
function onRemoteSlashResult(result) {
  if (state !== STATE.ATTACK_WAIT) return;
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
resetBattle();
startCommonGaugeLoop();
log("ゲームを開始しました。ゲージが溜まったら斬るボタンで攻撃できます。");
