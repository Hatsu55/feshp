// game.js
// ラウンド管理(roundId)＋再戦ボタン＋旧信号無視の実装

import { net } from "./setsuna-net.js";

const STATE = {
  INIT: "init",
  WAIT_MATCH: "wait_match",
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.INIT;
let currentRole = null;

// ===== 共通ゲージ =====
let commonGauge = 0;
const COMMON_GAUGE_MAX = 100;
let commonGaugeTimerId = null;

// ===== HP =====
const HP_MAX = 10000;
let hpYou = HP_MAX;
let hpEnemy = HP_MAX;

// 今回の攻撃
let pendingAttackCharge = 0;
let pendingAttackDamage = 0;

// タイマー
let defendTimeoutId = null;
let resultTimeoutId = null;

// 防御受付
let currentDefendWindow = 300;

// DOM取得
const gameStateEl = document.getElementById("game-state");
const alertSymbolEl = document.getElementById("alert-symbol");
const alertTextEl = document.getElementById("alert-text");
const logAreaEl = document.getElementById("log-area");
const attackBtn = document.getElementById("attack-btn");
const rematchBtn = document.getElementById("rematch-btn");
const defendWindowRange = document.getElementById("defend-window-range");
const defendWindowLabel = document.getElementById("defend-window-label");
const timerBarWrap = document.getElementById("timer-bar-wrap");
const timerBar = document.getElementById("timer-bar");
const commonGaugeFill = document.getElementById("common-gauge-fill");
const commonGaugeValue = document.getElementById("common-gauge-value");
const hpYouEl = document.getElementById("hp-you");
const hpEnemyEl = document.getElementById("hp-enemy");
const netStatusLabel = document.getElementById("net-status-label");

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
function enableRematchBtn(enabled) {
  rematchBtn.disabled = !enabled;
}
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}
function updateHpView() {
  hpYouEl.style.width = `${Math.max(0, (hpYou / HP_MAX) * 100)}%`;
  hpEnemyEl.style.width = `${Math.max(0, (hpEnemy / HP_MAX) * 100)}%`;
}
function clearTimers() {
  if (defendTimeoutId) clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  if (resultTimeoutId) clearTimeout(resultTimeoutId);
  resultTimeoutId = null;
}

// ===== ダメージ式（あなたの指定） =====
function calcDamageFromCharge(chargePct) {
  const c = Math.max(0, Math.min(100, Math.floor(chargePct)));
  const step = Math.floor(c / 10); // 0〜10
  return 400 * (1 + step); // 400〜4400
}

// ===== 共通ゲージループ =====
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1;
      updateCommonGaugeView();
    }
  }, 100);
}

// ===== 攻撃 =====
function onAttack() {
  if (state !== STATE.IDLE) return;

  pendingAttackCharge = commonGauge;
  pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);

  currentRole = "attacker";
  setState(STATE.ATTACK_WAIT);
  enableAttackBtn(false);
  showAlert("斬", `相手の反応を待っています…（${pendingAttackDamage}）`, "#e2e8f0");
  log(`あなたが斬りました。ダメージ予定: ${pendingAttackDamage}`);

  net.sendSlash({
    damage: pendingAttackDamage,
    charge: pendingAttackCharge,
    ts: Date.now(),
  });

  resultTimeoutId = setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      showResult("timeout", "attacker");
    }
  }, 1200);
}

// ===== 防御へ遷移（相手のslash受信時） =====
function enterDefendModeFromRemote(payload) {
  // roundId不一致は setsuna-net 側で弾いている。ここはラウンド一致のみ来る。
  if (state === STATE.ATTACK_WAIT) {
    showResult("draw", null);
    return;
  }
  clearTimers();

  currentRole = "defender";
  pendingAttackDamage = payload?.damage ?? 400;
  pendingAttackCharge = payload?.charge ?? 0;

  setState(STATE.DEFEND);
  enableAttackBtn(true);
  showAlert("！", "斬り返せ！", "#f97316");
  log(`相手が斬ってきました。受けると ${pendingAttackDamage} ダメージ`);

  timerBarWrap.classList.remove("hidden");
  timerBar.style.width = "100%";

  const start = performance.now();
  const windowMs = currentDefendWindow;

  defendTimeoutId = setTimeout(() => {
    applyDamageTo("you", pendingAttackDamage);
    consumeGaugeAfterAttack();
    net.sendSlashResult({ result: "hit", ts: Date.now() });
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
  net.sendSlashResult({ result: "counter", damage: reflected, ts: Date.now() });
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
      setTimeout(() => resetBattle(false), 1200);
    }
  } else {
    hpEnemy = Math.max(0, hpEnemy - amount);
    updateHpView();
    if (hpEnemy <= 0) {
      showAlert("◎", "YOU WIN!", "#22c55e");
      log("敵のHPが0になりました");
      setTimeout(() => resetBattle(false), 1200);
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
      showAlert("防", `相手に防がれた！（カウンター${reflected}）`, "#ef4444");
      log(`攻撃がカウンターされました（${reflected}ダメージ）`);
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
      applyDamageTo("enemy", pendingAttackDamage);
      showAlert("◎", `命中！（${pendingAttackDamage}）`, "#22c55e");
      log(`攻撃が命中（${pendingAttackDamage}ダメ）`);
      consumeGaugeAfterAttack();
    } else if (type === "draw") {
      showAlert("＝", "相打ち", "#e2e8f0");
      log("同時斬り → 相打ち");
      consumeGaugeAfterAttack();
    } else if (type === "timeout") {
      showAlert("…", "相手の反応がありません（中止）", "#f97316");
      log("相手から結果が返ってこなかったため中止");
      consumeGaugeAfterAttack();
    }
  } else if (role === "defender") {
    if (type === "counter") {
      const dmg = extraDamage ?? pendingAttackDamage * 2;
      showAlert("◎", `カウンター成功！（${dmg}ダメージ）`, "#22c55e");
      log(`カウンター成功（${dmg}）`);
    } else if (type === "hit") {
      showAlert("×", "被弾…", "#ef4444");
      log("防御失敗");
    }
  }

  resultTimeoutId = setTimeout(() => {
    if (hpYou > 0 && hpEnemy > 0 && state === STATE.RESULT) {
      toIdle();
    }
  }, 900);
}

function toIdle() {
  clearTimers();
  currentRole = null;
  setState(STATE.IDLE);
  showAlert("", "待機中です。あなたか相手が斬ると始まります。");
  enableAttackBtn(true);
  enableRematchBtn(true);
}

// ===== ラウンド開始/再戦時の共通処理 =====
function beginRoundUI() {
  resetBattle(true);       // HP/ゲージを満タンへ
  toIdle();                // 攻撃可能状態へ
  log(`新しいラウンド開始（roundId=${net.getRoundId?.() || "local"}）`);
  showAlert("◎", "再戦スタート！", "#22c55e");
}

// ===== ネットイベント =====
net.onStatus((info) => {
  if (info.state === "offline") {
    setState(STATE.INIT);
    netStatusLabel.textContent = "ネットワーク: Firebase未設定（オンライン不可）";
    showAlert("×", "オンライン機能が無効です（Firebase未設定）", "#f97316");
    enableAttackBtn(false);
    enableRematchBtn(false);
  } else if (info.state === "connecting") {
    setState(STATE.WAIT_MATCH);
    netStatusLabel.textContent = "ネットワーク: 接続中…";
    showAlert("…", "オンラインに接続中です…", "#e2e8f0");
    enableAttackBtn(false);
    enableRematchBtn(false);
  } else if (info.state === "waiting") {
    setState(STATE.WAIT_MATCH);
    netStatusLabel.textContent = "ネットワーク: もう1台を待っています";
    showAlert("…", "もう1台で同じURLを開いてください", "#e2e8f0");
    enableAttackBtn(false);
    enableRematchBtn(false);
  } else if (info.state === "matched") {
    netStatusLabel.textContent = `ネットワーク: マッチング成功 (room=${info.roomId}, slot=${info.slot})`;
    log(`マッチング成功: room=${info.roomId} slot=${info.slot}`);
    beginRoundUI(); // 初回ラウンド開始
  } else if (info.state === "error") {
    setState(STATE.INIT);
    netStatusLabel.textContent = `ネットワーク: エラー (${info.error})`;
    showAlert("×", "オンライン接続でエラーが発生しました", "#ef4444");
    enableAttackBtn(false);
    enableRematchBtn(false);
  }
});

net.onMatched((room) => {
  log(`onMatched: room=${room.roomId} slot=${room.slot}`);
});

// ラウンドIDが更新されたらUIも新ラウンドへ
net.onRoundChanged(() => {
  beginRoundUI();
});

// 相手の信号受信
net.onRemoteSlash((payload) => {
  enterDefendModeFromRemote(payload);
});
net.onRemoteSlashResult((payload) => {
  if (state !== STATE.ATTACK_WAIT) return;
  const r = payload.result;
  if (r === "counter") showResult("counter", "attacker");
  else if (r === "hit") showResult("hit", "attacker");
  else if (r === "timeout") showResult("timeout", "attacker");
});

// ===== イベントバインド =====
attackBtn.addEventListener("click", () => {
  if (state === STATE.DEFEND) onDefendTap();
  else onAttack();
});
rematchBtn.addEventListener("click", () => {
  enableRematchBtn(false); // 連打防止
  net.requestRematch();    // 両端に roundId 変更通知 → beginRoundUI()
});

defendWindowRange.addEventListener("input", (e) => {
  currentDefendWindow = Number(e.target.value);
  defendWindowLabel.textContent = `${currentDefendWindow}ms`;
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (!attackBtn.disabled) attackBtn.click();
  }
});

// ===== ゲージ/HPリセット =====
function consumeGaugeAfterAttack() {
  commonGauge = 0;
  updateCommonGaugeView();
  pendingAttackCharge = 0;
  pendingAttackDamage = 0;
}
function resetBattle(quiet) {
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  updateHpView();
  commonGauge = 0;
  updateCommonGaugeView();
  clearTimers();
  if (!quiet) setState(STATE.INIT);
  enableAttackBtn(false);
  enableRematchBtn(false);
}

// ===== 初期化 =====
resetBattle(true);
startCommonGaugeLoop();
net.joinMatchmaking();
log("オンライン待機に入りました。別の端末で同じURLを開くとマッチングします。");
