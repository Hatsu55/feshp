// game.js（チャージ量でダメージが上がる版）

const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;
let currentRole = null;

// ===== ゲージ・HP（ローカル）=====
let commonGauge = 0; // 0〜100でチャージ
const COMMON_GAUGE_MAX = 100;
let commonGaugeTimerId = null;

// HPはとりあえず10固定
const HP_MAX = 10;
let hpYou = HP_MAX;
let hpEnemy = HP_MAX;

// タイマー類
let defendTimeoutId = null;
let resultTimeoutId = null;

// 防御受付
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
const commonGaugeFill = document.getElementById("common-gauge-fill");
const commonGaugeValue = document.getElementById("common-gauge-value");
const hpYouEl = document.getElementById("hp-you");
const hpEnemyEl = document.getElementById("hp-enemy");

// ====== 基本ユーティリティ ======
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
  alertTextEl.style.color = color || "inherit";
}

function enableAttackBtn(enabled) {
  attackBtn.disabled = !enabled;
}

// ====== ゲージ表示 ======
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}

// ====== HP表示 ======
function updateHpView() {
  hpYouEl.style.width = `${Math.max(0, (hpYou / HP_MAX) * 100)}%`;
  hpEnemyEl.style.width = `${Math.max(0, (hpEnemy / HP_MAX) * 100)}%`;
}

// ====== ダメージ計算（チャージ量で変化） ======
function calcDamageFromGauge() {
  // 0〜100% → 1〜6ダメにする
  // 20%ごとに+1
  const charge = Math.floor(commonGauge);
  const bonus = Math.floor(charge / 20); // 0〜5
  return 1 + bonus; // 最低1
}

// この斬撃で使ったからゲージを0にする
function consumeGaugeAfterAttack() {
  commonGauge = 0;
  updateCommonGaugeView();
}

// ====== ゲージを時間で溜める ======
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1; // 0.1秒ごとに1% = 約10秒で満タン
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

// ====== あなたが攻撃する時 ======
function onAttack() {
  if (state !== STATE.IDLE) return;

  // 今回は「ゲージが少なくても斬れる」→ダメージだけ小さくなる
  const dmg = calcDamageFromGauge();
  log(`あなたが斬りました（予定ダメージ: ${dmg}）`);

  currentRole = "attacker";

  // 本来はここでRTDBにslashを書く
  mockSendSlash(dmg);

  setState(STATE.ATTACK_WAIT);
  showAlert("斬", "相手の反応を待っています…", "#e2e8f0");
  enableAttackBtn(false);

  // 相手からの結果待ちタイムアウト
  const TIMEOUT_MS = 450;
  setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      onRemoteTimeout();
    }
  }, TIMEOUT_MS);
}

// ====== 相手が斬ってきた（防御モード） ======
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
    // 間に合わなかった → 攻撃側のチャージ分だけ食らう
    const dmg = calcDamageFromGauge();
    applyDamageTo("you", dmg);
    consumeGaugeAfterAttack();
    mockSendSlashResult("hit");
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

// ====== 防御中にタップ（カウンター） ======
function onDefendTap() {
  if (state !== STATE.DEFEND) return;

  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;

  const dmg = calcDamageFromGauge();
  applyDamageTo("enemy", dmg);
  consumeGaugeAfterAttack();
  mockSendSlashResult("counter");
  showResult("counter", "defender");
}

// ====== ダメージ適用 ======
function applyDamageTo(who, amount) {
  if (amount <= 0) amount = 1;
  if (who === "you") {
    hpYou = Math.max(0, hpYou - amount);
    updateHpView();
    if (hpYou <= 0) {
      showAlert("×", "YOU LOSE", "#ef4444");
      log("あなたのHPが0になりました");
      // 負け処理のときはここで終了していいが、簡単にリセット
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

// ====== 結果表示 ======
function showResult(type, role = currentRole) {
  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  if (role === "attacker") {
    if (type === "counter") {
      showAlert("防", "相手に防がれた！（カウンター）", "#ef4444");
      log("あなたの攻撃は相手に防がれました");
      // カウンターされたときも今回のチャージは使い切る
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
      // 攻撃が通った → ここでもう一回ダメージ適用（守備側でやるなら不要）
      const dmg = calcDamageFromGauge();
      applyDamageTo("enemy", dmg);
      consumeGaugeAfterAttack();
      showAlert("◎", `命中！（${dmg}ダメージ）`, "#22c55e");
      log(`あなたの攻撃が命中しました（${dmg}ダメージ）`);
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("相打ち");
      // 相打ちのときはとりあえずゲージは維持でもいいが、ここでは消す
      consumeGaugeAfterAttack();
    } else if (type === "timeout") {
      showAlert("…", "相手の反応がありません（中止）", "#f97316");
      log("相手の反応がなく中止になりました");
    }
  } else if (role === "defender") {
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
  } else {
    showAlert("＝", "結果: " + type, "#e2e8f0");
  }

  // 勝敗がついてないときだけidleに戻す
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

function clearTimers() {
  if (defendTimeoutId) clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  if (resultTimeoutId) clearTimeout(resultTimeoutId);
  resultTimeoutId = null;
}

// ====== モック通信層 ======
function mockSendSlash(expectedDamage) {
  log(`mock: あなたが斬りました（想定ダメージ${expectedDamage}）`);

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
  log(`mock: あなたが結果を返しました（${result}）`);
}

// 相手があなたにslashしてきた想定
function onRemoteSlash() {
  log("mock: 相手があなたに斬ってきました");
  if (state === STATE.ATTACK_WAIT) {
    // 同時斬り
    showResult("draw", null);
    return;
  }
  enterDefendMode();
}

// 攻撃側として結果を受け取る
function onRemoteSlashResult(result) {
  if (state !== STATE.ATTACK_WAIT) return;
  showResult(result, "attacker");
}

function onRemoteTimeout() {
  if (state !== STATE.ATTACK_WAIT) return;
  showResult("timeout", "attacker");
}

// ====== 敵の反応時間 ======
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

// ====== 初期化 ======
function resetBattle() {
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  updateHpView();
  commonGauge = 0;
  updateCommonGaugeView();
  toIdle();
}

// 読み込み時に必ずループを回す
resetBattle();
startCommonGaugeLoop();
log("ゲームを開始しました。ゲージが溜まるほどダメージが上がります。");
