// game.js（カウンター時は2倍で返す＋HP10000版）

const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;
let currentRole = null; // "attacker" | "defender" | null

// ===== 共通ゲージ =====
let commonGauge = 0; // 0〜100
const COMMON_GAUGE_MAX = 100;
let commonGaugeTimerId = null;

// ===== HP =====
const HP_MAX = 10000;
let hpYou = HP_MAX;
let hpEnemy = HP_MAX;

// ===== 「今回の攻撃」は何％・何ダメだったか =====
// Aが斬った瞬間のゲージとダメージをここに保存しておく。
// これをBがカウンターで「2倍」にして返す。
let pendingAttackCharge = 0; // 0〜100
let pendingAttackDamage = 0; // ダメージ値（HP単位）

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

// ===== 共通ユーティリティ =====
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

// ===== ゲージ表示 =====
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}

// ===== HP表示 =====
function updateHpView() {
  hpYouEl.style.width = `${Math.max(0, (hpYou / HP_MAX) * 100)}%`;
  hpEnemyEl.style.width = `${Math.max(0, (hpEnemy / HP_MAX) * 100)}%`;
}

// ===== ゲージ→ダメージ変換 =====
// 今回はHPが10000なので、10段階で細かく刻みます。
// 0〜100% → 10段階 → 400 * (1〜11) = 400〜4400ダメ
function calcDamageFromCharge(chargePct) {
  const c = Math.max(0, Math.min(100, Math.floor(chargePct)));
  const step = Math.floor(c / 10); // 0〜10
  return 400 * (1 + step); // 400〜4400
}

// この攻撃が確定したのでゲージを使い切る
function consumeGaugeAfterAttack() {
  commonGauge = 0;
  updateCommonGaugeView();
  // 攻撃情報もクリアしておく
  pendingAttackCharge = 0;
  pendingAttackDamage = 0;
}

// ===== ゲージを時間で溜める =====
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1; // 0.1秒で1%増 → 10秒で100%
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
  if (state !== STATE.IDLE) return;

  // いまの共通ゲージ量を「今回の攻撃」として保存
  pendingAttackCharge = commonGauge;
  pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);

  currentRole = "attacker";

  // 本来はここでRTDBにslashを書く
  mockSendSlash(pendingAttackDamage);

  setState(STATE.ATTACK_WAIT);
  showAlert("斬", `相手の反応を待っています…（${pendingAttackDamage}ダメ予定）`, "#e2e8f0");
  enableAttackBtn(false);

  // 450msでタイムアウト
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

  // もし「今回の攻撃」の情報がまだないなら、
  // 相手はこの時点のゲージで斬ってきたとみなす（デバッグ用）
  if (pendingAttackDamage === 0) {
    pendingAttackCharge = commonGauge;
    pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);
  }

  setState(STATE.DEFEND);
  showAlert("！", "斬り返せ！", "#f97316");
  enableAttackBtn(true);

  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  // 受付時間内に押せなかったら「食らう」
  defendTimeoutId = setTimeout(() => {
    // 今回の攻撃分だけ自分が食らう
    applyDamageTo("you", pendingAttackDamage);
    consumeGaugeAfterAttack(); // この一撃は解決したのでゲージをリセット
    mockSendSlashResult("hit");
    showResult("hit", "defender");
  }, windowMs);

  // バーの減少アニメ
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

// ===== 防御中のタップ（カウンター成功） =====
function onDefendTap() {
  if (state !== STATE.DEFEND) return;

  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;

  // カウンター成功時：
  // 1. 自分へのダメージは0（無効化）
  // 2. 元の攻撃ダメージの2倍を攻撃者に返す
  const reflected = pendingAttackDamage * 2;
  applyDamageTo("enemy", reflected);
  consumeGaugeAfterAttack();
  mockSendSlashResult("counter");
  showResult("counter", "defender", reflected);
}

// ===== ダメージ適用 =====
function applyDamageTo(who, amount) {
  if (amount <= 0) amount = 1;
  if (who === "you") {
    hpYou = Math.max(0, hpYou - amount);
    updateHpView();
    if (hpYou <= 0) {
      showAlert("×", "YOU LOSE", "#ef4444");
      log("あなたのHPが0になりました");
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
function showResult(type, role = currentRole, extraDamage = null) {
  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  if (role === "attacker") {
    if (type === "counter") {
      // 自分が攻めたけどカウンターされた → 2倍食らう
      const reflected = pendingAttackDamage * 2;
      applyDamageTo("you", reflected);
      showAlert("防", `相手に防がれた！(カウンター ${reflected}ダメ)`, "#ef4444");
      log(`あなたの攻撃はカウンターされ、${reflected}ダメージを受けました`);
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
      // 自分の攻撃が通った
      applyDamageTo("enemy", pendingAttackDamage);
      showAlert("◎", `命中！（${pendingAttackDamage}ダメージ）`, "#22c55e");
      log(`あなたの攻撃が命中（${pendingAttackDamage}ダメージ）`);
      consumeGaugeAfterAttack();
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("相打ち");
      consumeGaugeAfterAttack();
    } else if (type === "timeout") {
      showAlert("…", "相手の反応がありません（中止）", "#f97316");
      log("相手の反応がなく中止になりました");
      consumeGaugeAfterAttack();
    }
  } else if (role === "defender") {
    if (type === "counter") {
      const dmg = extraDamage != null ? extraDamage : pendingAttackDamage * 2;
      showAlert("◎", `カウンター成功！（${dmg}ダメージ返し）`, "#22c55e");
      log(`あなたのカウンター成功（${dmg}ダメージを返した）`);
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
    consumeGaugeAfterAttack();
  }

  // 勝敗がついてないときだけidleへ
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

// ===== タイマークリア =====
function clearTimers() {
  if (defendTimeoutId) clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  if (resultTimeoutId) clearTimeout(resultTimeoutId);
  resultTimeoutId = null;
}

// ===== モック通信層 =====
function mockSendSlash(expectedDamage) {
  log(`mock: あなたが斬りました（想定ダメージ${expectedDamage}）`);

  const enemyDelay = getEnemyReactionMs();

  setTimeout(() => {
    if (state !== STATE.ATTACK_WAIT) {
      return;
    }
    // 50%でカウンターされるようにしておく
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

// ===== 敵の反応時間 =====
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

// ===== 初期化 =====
function resetBattle() {
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  updateHpView();
  commonGauge = 0;
  updateCommonGaugeView();
  pendingAttackCharge = 0;
  pendingAttackDamage = 0;
  toIdle();
}

resetBattle();
startCommonGaugeLoop();
log("ゲームを開始しました。カウンター成功時はダメージ無効＋2倍で返します。");
