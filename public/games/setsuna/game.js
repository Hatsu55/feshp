// game.js（オンライン接続口つき）
// ※ダメージ式はあなたが渡してくれた 400*(1+step) のまま

import { net } from "./setsuna-net.js";

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

// 今回の攻撃情報
let pendingAttackCharge = 0;
let pendingAttackDamage = 0;

// タイマー
let defendTimeoutId = null;
let resultTimeoutId = null;

// 防御受付
let currentDefendWindow = 300; // ms
let enemyReactionMode = "normal";

// DOM取得（前回と同じ）
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
  alertTextEl.style.color = color || "inherit";
}
function enableAttackBtn(enabled) {
  attackBtn.disabled = !enabled;
}

// ===== ゲージ/HP =====
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}
function updateHpView() {
  hpYouEl.style.width = `${Math.max(0, (hpYou / HP_MAX) * 100)}%`;
  hpEnemyEl.style.width = `${Math.max(0, (hpEnemy / HP_MAX) * 100)}%`;
}

// あなたが調整したダメージ式
function calcDamageFromCharge(chargePct) {
  const c = Math.max(0, Math.min(100, Math.floor(chargePct)));
  const step = Math.floor(c / 10); // 0〜10
  return 400 * (1 + step); // 400〜4400
}

function consumeGaugeAfterAttack() {
  commonGauge = 0;
  updateCommonGaugeView();
  pendingAttackCharge = 0;
  pendingAttackDamage = 0;
}

// ゲージ増加
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1;
      updateCommonGaugeView();
    }
  }, 100);
}

// ===== あなたが攻撃する時 =====
function onAttack() {
  if (state !== STATE.IDLE) return;

  // ゲージからこの一撃の威力を決める
  pendingAttackCharge = commonGauge;
  pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);

  currentRole = "attacker";

  // ★ (1) RTDBに送る
  net.sendSlash({
    damage: pendingAttackDamage,
    charge: pendingAttackCharge,
    createdAt: Date.now(),
  });

  // ★ (2) ローカルでも待機状態にする
  setState(STATE.ATTACK_WAIT);
  showAlert("斬", `相手の反応を待っています…（${pendingAttackDamage}ダメ予定）`, "#e2e8f0");
  enableAttackBtn(false);

  // 念のためのタイムアウト（相手がresultを返さなかったら）
  const TIMEOUT_MS = 450;
  setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      onRemoteTimeout();
    }
  }, TIMEOUT_MS);
}

// ===== 相手が斬ってきたとき（RTDBから来る） =====
function enterDefendModeFromRemote(payload) {
  // payload = { damage, charge, createdAt }
  clearTimers();
  currentRole = "defender";
  pendingAttackDamage = payload?.damage ?? 400;
  pendingAttackCharge = payload?.charge ?? 0;

  setState(STATE.DEFEND);
  showAlert("！", "斬り返せ！", "#f97316");
  enableAttackBtn(true);

  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  defendTimeoutId = setTimeout(() => {
    // 防御失敗 → この一撃分だけ食らう
    applyDamageTo("you", pendingAttackDamage);
    consumeGaugeAfterAttack();
    net.sendSlashResult({
      result: "hit",
      createdAt: Date.now(),
    });
    showResult("hit", "defender");
  }, windowMs);

  function tick(now) {
    if (state !== STATE.DEFEND) return;
    const elapsed = now - start;
    const remain = Math.max(windowMs - elapsed, 0);
    timerBar.style.width = `${(remain / windowMs) * 100}%`;
    if (remain > 0) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ===== 防御中タップ（カウンター） =====
function onDefendTap() {
  if (state !== STATE.DEFEND) return;
  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;

  const reflected = pendingAttackDamage * 2;
  applyDamageTo("enemy", reflected);
  consumeGaugeAfterAttack();
  net.sendSlashResult({
    result: "counter",
    damage: reflected,
    createdAt: Date.now(),
  });
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
      setTimeout(() => resetBattle(), 1200);
    }
  } else {
    hpEnemy = Math.max(0, hpEnemy - amount);
    updateHpView();
    if (hpEnemy <= 0) {
      showAlert("◎", "YOU WIN!", "#22c55e");
      log("敵のHPが0になりました");
      setTimeout(() => resetBattle(), 1200);
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
      const reflected = pendingAttackDamage * 2;
      applyDamageTo("you", reflected);
      showAlert("防", `相手に防がれた！(カウンター ${reflected})`, "#ef4444");
      log(`あなたの攻撃はカウンターされ、${reflected}ダメージを受けました`);
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
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
      const dmg = extraDamage ?? pendingAttackDamage * 2;
      showAlert("◎", `カウンター成功！（${dmg}ダメージ返し）`, "#22c55e");
      log(`あなたのカウンター成功（${dmg}ダメージ）`);
    } else if (type === "hit") {
      showAlert("×", "被弾…", "#ef4444");
      log("あなたは被弾しました");
    } else if (type === "timeout") {
      showAlert("…", "通信中止（timeout）", "#f97316");
      log("通信中止（timeout）");
    }
  }

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

// ===== リモートからのイベントをバインド =====
net.onRemoteSlash((payload) => {
  // 相手がslashしてきたら防御モードへ
  enterDefendModeFromRemote(payload);
});

net.onRemoteSlashResult((payload) => {
  // 自分がATTACK_WAIT中のときにだけ処理する
  if (state !== STATE.ATTACK_WAIT) return;
  const r = payload.result;
  if (r === "counter") {
    showResult("counter", "attacker");
  } else if (r === "hit") {
    showResult("hit", "attacker");
  } else if (r === "timeout") {
    showResult("timeout", "attacker");
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

// 起動時にマッチングへ
net.joinMatchmaking();
resetBattle();
startCommonGaugeLoop();
log("オンライン待機に入りました。他の端末が開くとペアになります。");
