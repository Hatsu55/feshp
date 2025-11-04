// game.js
// オンライン刹那の見切り：ラウンド制＋再戦ボタン（両者OKで再開）

import { net } from "./setsuna-net.js";

const STATE = {
  INIT: "init",
  WAIT_MATCH: "wait_match",
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result", // 勝敗確定も含む
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

// 防御受付（ややシビア寄りの固定値：250ms）
let currentDefendWindow = 250;

// DOM
const gameStateEl = document.getElementById("game-state");
const alertSymbolEl = document.getElementById("alert-symbol");
const alertTextEl = document.getElementById("alert-text");
const logAreaEl = document.getElementById("log-area");
const attackBtn = document.getElementById("attack-btn");
const rematchBtn = document.getElementById("rematch-btn");
const reconnectBtn = document.getElementById("reconnect-btn");
const timerBarWrap = document.getElementById("timer-bar-wrap");
const timerBar = document.getElementById("timer-bar");
const commonGaugeFill = document.getElementById("common-gauge-fill");
const commonGaugeValue = document.getElementById("common-gauge-value");
const hpYouEl = document.getElementById("hp-you");
const hpEnemyEl = document.getElementById("hp-enemy");
const netStatusLabel = document.getElementById("net-status-label");

// デバッグ用要素は存在しないかもしれないので null セーフにする
const debugRoleEl = document.getElementById("debug-role");
const debugStateEl = document.getElementById("debug-state");
const debugHpEl = document.getElementById("debug-hp");
const debugGaugeEl = document.getElementById("debug-gauge");

// ===== ユーティリティ =====
function setState(next) {
  state = next;
  gameStateEl.textContent = `state: ${next}`;
  if (debugStateEl) debugStateEl.textContent = `state: ${next}`;
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
function showRematchButton() {
  rematchBtn.classList.remove("hidden");
  enableRematchBtn(true);
}
function hideRematchButton() {
  rematchBtn.classList.add("hidden");
  enableRematchBtn(false);
}
function showReconnectButton() {
  reconnectBtn.classList.remove("hidden");
  reconnectBtn.disabled = false;
}
function hideReconnectButton() {
  reconnectBtn.classList.add("hidden");
  reconnectBtn.disabled = true;
}
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${pct}%`;
  if (debugGaugeEl) debugGaugeEl.textContent = `Gauge: ${pct}`;
}
function updateHpView() {
  const youPct = Math.max(0, (hpYou / HP_MAX) * 100);
  const enemyPct = Math.max(0, (hpEnemy / HP_MAX) * 100);
  hpYouEl.style.width = `${youPct}%`;
  hpEnemyEl.style.width = `${enemyPct}%`;
  if (debugHpEl) debugHpEl.textContent = `HP: YOU=${hpYou} ENEMY=${hpEnemy}`;
}
function clearTimers() {
  if (defendTimeoutId) clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  if (resultTimeoutId) clearTimeout(resultTimeoutId);
  resultTimeoutId = null;
}

// ===== ダメージ式（10段階・400刻み） =====
function calcDamageFromCharge(chargePct) {
  const step = Math.floor(Math.max(0, Math.min(100, chargePct)) / 10); // 0〜10
  return 400 * (1 + step); // 400〜4400
}

// ===== 共通ゲージループ =====
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    // マッチング中や結果表示中など「関係ない時」はゲージを増やさない
    if (
      state === STATE.IDLE ||
      state === STATE.DEFEND ||
      state === STATE.ATTACK_WAIT
    ) {
      if (commonGauge < COMMON_GAUGE_MAX) {
        commonGauge += 1;
        updateCommonGaugeView();
      }
    }
  }, 100);
}

// 「攻撃が発生したのでゲージは消費済み」という見た目だけを反映する
function consumeGaugeVisually() {
  commonGauge = 0;
  updateCommonGaugeView();
}

// ===== ゲージ消費（ペンディング値のクリアも含めた完全リセット） =====
function consumeGaugeAfterAttack() {
  commonGauge = 0;
  updateCommonGaugeView();
  pendingAttackCharge = 0;
  pendingAttackDamage = 0;
}

// ===== HP適用 =====
function applyDamageTo(target, amount) {
  if (target === "you") hpYou = Math.max(0, hpYou - amount);
  else hpEnemy = Math.max(0, hpEnemy - amount);
  updateHpView();

  if (debugRoleEl) debugRoleEl.textContent = `role: ${currentRole || "-"}`;
  if (debugStateEl) debugStateEl.textContent = `state: ${state}`;

  if (hpYou <= 0 || hpEnemy <= 0) {
    endBattle();
  }
}

// ===== 決着処理 =====
function endBattle() {
  clearTimers();
  setState(STATE.RESULT);
  enableAttackBtn(false);
  showRematchButton();
  timerBarWrap.classList.add("hidden");

  if (hpYou <= 0 && hpEnemy <= 0) {
    showAlert("＝", "相打ちで両者戦闘不能…", "#e2e8f0");
    log("両者HP0 → 引き分け");
  } else if (hpYou <= 0) {
    showAlert("×", "敗北…", "#ef4444");
    log("あなたの敗北");
  } else if (hpEnemy <= 0) {
    showAlert("◎", "勝利！", "#22c55e");
    log("勝利");
  }
}

// ===== ラウンド開始UI =====
function beginRoundUI() {
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  updateHpView();
  commonGauge = 0;
  updateCommonGaugeView();
  clearTimers();
  hideRematchButton();
  hideReconnectButton();
  toIdle();
  log(`新しいラウンド開始 (roundId=${net.getRoundId ? net.getRoundId() : "?"})`);
}

// ===== 攻撃 =====
function onAttack() {
  if (state !== STATE.IDLE) return;

  // 現在のゲージを使用してダメージを決定
  pendingAttackCharge = commonGauge;
  pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);

  // 「斬撃が起きたので共通ゲージは消費済み」という見た目にする（ただし pending 値は保持）
  consumeGaugeVisually();

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

// ===== 防御へ（相手の slash を受信） =====
function enterDefendModeFromRemote(payload) {
  // すでにこちらも攻撃中なら相打ち扱い
  if (state === STATE.ATTACK_WAIT) {
    showResult("draw", "attacker");
    net.sendSlashResult({ result: "draw", ts: Date.now() });
    return;
  }

  if (state !== STATE.IDLE) {
    return;
  }

  currentRole = "defender";
  setState(STATE.DEFEND);

  pendingAttackDamage = payload.damage;
  pendingAttackCharge = payload.charge;

  // 「相手が斬った＝共通ゲージが消費された」とみなして、自分側でもゲージを0表示
  consumeGaugeVisually();

  showAlert("！", "斬撃が来た！ タップでカウンター", "#f97316");
  log(`相手が斬ってきました。予定ダメージ: ${pendingAttackDamage}`);

  timerBarWrap.classList.remove("hidden");
  timerBar.style.transition = "none";
  timerBar.style.width = "100%";
  void timerBar.offsetWidth;
  timerBar.style.transition = `width ${currentDefendWindow}ms linear`;
  timerBar.style.width = "0%";

  defendTimeoutId = setTimeout(() => {
    if (state !== STATE.DEFEND) return;
    timerBarWrap.classList.add("hidden");
    showResult("hit", "defender");
    net.sendSlashResult({ result: "hit", ts: Date.now() });
  }, currentDefendWindow);
}

// ===== 防御側のタップ =====
function onDefendTap() {
  if (state !== STATE.DEFEND) return;

  clearTimeout(defendTimeoutId);
  defendTimeoutId = null;
  timerBarWrap.classList.add("hidden");

  const reflected = pendingAttackDamage * 2;
  showResult("counter", "defender", reflected);
  net.sendSlashResult({ result: "counter", damage: reflected, ts: Date.now() });
}

// ===== 結果表示 =====
function showResult(type, role = currentRole, extraDamage = null) {
  const battleEnded = hpYou <= 0 || hpEnemy <= 0;

  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);

  if (role === "attacker") {
    if (type === "counter") {
      const reflected = pendingAttackDamage * 2;
      applyDamageTo("you", reflected);
      if (!battleEnded && hpYou > 0) {
        showAlert("防", `相手に防がれた！（カウンター${reflected}）`, "#ef4444");
        log(`攻撃がカウンターされました（${reflected}ダメージ）`);
      }
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
      applyDamageTo("enemy", pendingAttackDamage);
      if (!battleEnded && hpEnemy > 0) {
        showAlert("◎", `命中！（${pendingAttackDamage}）`, "#22c55e");
        log(`攻撃が命中（${pendingAttackDamage}ダメージ）`);
      }
      consumeGaugeAfterAttack();
    } else if (type === "draw") {
      if (!battleEnded) {
        showAlert("＝", "相打ち", "#e2e8f0");
        log("同時斬り → 相打ち");
      }
      consumeGaugeAfterAttack();
    } else if (type === "timeout") {
      if (!battleEnded) {
        showAlert("…", "相手の反応がありません（中止）", "#f97316");
        log("相手から結果が返ってこなかったため中止しました");
      }
      consumeGaugeAfterAttack();
    }
  } else if (role === "defender") {
    if (type === "counter") {
      const dmg = extraDamage ?? pendingAttackDamage * 2;
      // 自分視点では相手にダメージ
      applyDamageTo("enemy", dmg);
      if (!battleEnded && hpEnemy > 0) {
        showAlert("◎", `カウンター成功！（${dmg}ダメージ）`, "#22c55e");
        log(`カウンター成功（${dmg}ダメージ返し）`);
      }
    } else if (type === "hit") {
      // 自分が被弾
      applyDamageTo("you", pendingAttackDamage);
      if (!battleEnded && hpYou > 0) {
        showAlert("×", "斬られた…", "#ef4444");
        log("防御に失敗しました");
      }
    }
  }

  // HPが残っているときだけIDLEへ戻す（決着時は endBattle が担当）
  resultTimeoutId = setTimeout(() => {
    if (hpYou > 0 && hpEnemy > 0 && state === STATE.RESULT) {
      toIdle();
    }
  }, 900);
}

// ===== 中止処理（通信切断など） =====
function abortBattle(message) {
  clearTimers();
  setState(STATE.RESULT);
  timerBarWrap.classList.add("hidden");
  enableAttackBtn(false);
  hideRematchButton();
  showReconnectButton();
  showAlert("×", message || "対戦が中止されました", "#f97316");
  log("対戦が中止されました。再マッチングするには「再マッチング開始」を押してください。");
}

// ===== 状態遷移 =====
function toIdle() {
  clearTimers();
  currentRole = null;
  setState(STATE.IDLE);
  showAlert("", "ゲーム開始");
  enableAttackBtn(true);
}

// ===== ネットイベント =====
net.onStatus((info) => {
  if (info.state === "offline") {
    setState(STATE.INIT);
    netStatusLabel.textContent = "ネットワーク: Firebase未設定（オンライン不可）";
    showAlert("×", "オンライン機能が無効です（Firebase未設定）", "#f97316");
    enableAttackBtn(false);
    hideRematchButton();
  } else if (info.state === "connecting") {
    setState(STATE.WAIT_MATCH);
    netStatusLabel.textContent = "ネットワーク: 接続中…";
    showAlert("…", "オンラインに接続中です…", "#e2e8f0");
    enableAttackBtn(false);
    hideRematchButton();
  } else if (info.state === "waiting") {
    setState(STATE.WAIT_MATCH);
    netStatusLabel.textContent = "ネットワーク: もう1台を待っています";
    showAlert("…", "もう1台で同じURLを開いてください", "#e2e8f0");
    enableAttackBtn(false);
    hideRematchButton();
  } else if (info.state === "matched") {
    netStatusLabel.textContent = `ネットワーク: マッチング成功 (room=${info.roomId}, slot=${info.slot})`;
    log(`マッチング成功: room=${info.roomId} slot=${info.slot}`);
    beginRoundUI();
  } else if (info.state === "error") {
    setState(STATE.INIT);
    netStatusLabel.textContent = `ネットワーク: エラー (${info.error})`;
    showAlert("×", "オンライン接続でエラーが発生しました", "#ef4444");
    enableAttackBtn(false);
    hideRematchButton();
  }
});

net.onMatched((room) => {
  log(`onMatched: room=${room.roomId} slot=${room.slot}`);
});

// ラウンド変更（再戦成立）時
net.onRoundChanged(() => {
  beginRoundUI();
});

// 相手切断（presence検知）
net.onOpponentLeft((_info) => {
  abortBattle("相手の接続が切れました（中止）");
});

// 相手の行動
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
  // 自分の準備OKだけ送る。両者が押したら room の roundId が更新される。
  enableRematchBtn(false);
  log("再戦の準備ができました。相手の準備を待っています…");
  net.requestRematch();
});

reconnectBtn.addEventListener("click", () => {
  hideReconnectButton();
  hideRematchButton();
  clearTimers();
  hpYou = HP_MAX;
  hpEnemy = HP_MAX;
  commonGauge = 0;
  updateHpView();
  updateCommonGaugeView();
  setState(STATE.WAIT_MATCH);
  enableAttackBtn(false);
  showAlert("…", "再マッチング中…", "#e2e8f0");
  log("再マッチングを開始します。別の端末と再度マッチングします。");
  net.joinMatchmaking();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (!attackBtn.disabled) attackBtn.click();
  }
});

// ===== 初期化 =====
hideRematchButton();
hideReconnectButton();
updateHpView();
updateCommonGaugeView();
startCommonGaugeLoop();
setState(STATE.INIT);
enableAttackBtn(false);
log("マッチング開始・・・");
net.joinMatchmaking();
