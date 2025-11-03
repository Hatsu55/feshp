// game.js（ネットがなくても動く＋マッチング成功ログつき＋カウンター2倍＋HP10000）

const STATE = {
  IDLE: "idle",
  ATTACK_WAIT: "attack_wait",
  DEFEND: "defend",
  RESULT: "result",
};

let state = STATE.IDLE;
let currentRole = null;

// ===== 共通ゲージ =====
let commonGauge = 0;
const COMMON_GAUGE_MAX = 100;
let commonGaugeTimerId = null;

// ===== HP =====
const HP_MAX = 10000;
let hpYou = HP_MAX;
let hpEnemy = HP_MAX;

// 今回の一撃の情報（攻撃側が決める）
let pendingAttackCharge = 0;
let pendingAttackDamage = 0;

// タイマー
let defendTimeoutId = null;
let resultTimeoutId = null;

// 防御受付
let currentDefendWindow = 300;
let enemyReactionMode = "normal";

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

// ===== ネット（あってもなくてもOK） =====
const net = window.SetsunaNet || createLocalNet();

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

// ===== ゲージ/HP表示 =====
function updateCommonGaugeView() {
  const pct = Math.min(Math.max(commonGauge, 0), COMMON_GAUGE_MAX);
  commonGaugeFill.style.width = `${pct}%`;
  commonGaugeValue.textContent = `${Math.floor(pct)}%`;
}
function updateHpView() {
  hpYouEl.style.width = `${Math.max(0, (hpYou / HP_MAX) * 100)}%`;
  hpEnemyEl.style.width = `${Math.max(0, (hpEnemy / HP_MAX) * 100)}%`;
}

// ===== あなたが調整したダメージ式（10段階・400刻み） =====
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

// ===== ゲージ自動回復 =====
function startCommonGaugeLoop() {
  if (commonGaugeTimerId) return;
  commonGaugeTimerId = setInterval(() => {
    if (commonGauge < COMMON_GAUGE_MAX) {
      commonGauge += 1;
      updateCommonGaugeView();
    }
  }, 100);
}

// ===== あなたが攻撃する =====
function onAttack() {
  if (state !== STATE.IDLE) return;

  pendingAttackCharge = commonGauge;
  pendingAttackDamage = calcDamageFromCharge(pendingAttackCharge);
  currentRole = "attacker";

  // ネットに流す（ローカルでもここは呼ばれる）
  net.sendSlash({
    damage: pendingAttackDamage,
    charge: pendingAttackCharge,
    createdAt: Date.now(),
  });

  setState(STATE.ATTACK_WAIT);
  showAlert("斬", `相手の反応を待っています…（${pendingAttackDamage}ダメ予定）`, "#e2e8f0");
  enableAttackBtn(false);

  // 念のためのタイムアウト
  setTimeout(() => {
    if (state === STATE.ATTACK_WAIT) {
      onRemoteTimeout();
    }
  }, 500);
}

// ===== 相手が斬ってきた（ネットから来る） =====
function enterDefendModeFromRemote(payload) {
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

// ===== 防御中タップ（カウンター2倍） =====
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
      showAlert("防", `相手に防がれた！（カウンター${reflected}）`, "#ef4444");
      log(`あなたの攻撃はカウンターされ、${reflected}ダメージを受けました`);
      consumeGaugeAfterAttack();
    } else if (type === "hit") {
      applyDamageTo("enemy", pendingAttackDamage);
      showAlert("◎", `命中！（${pendingAttackDamage}ダメージ）`, "#22c55e");
      log(`あなたの攻撃が命中（${pendingAttackDamage}ダメージ）`);
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
      log(`あなたのカウンター成功（${dmg}ダメージ返し）`);
    } else if (type === "hit") {
      showAlert("×", "被弾…", "#ef4444");
      log("あなたは被弾しました");
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

// ===== ネットからのイベントを受ける =====
net.onRemoteSlash((payload) => {
  enterDefendModeFromRemote(payload);
});

net.onRemoteSlashResult((payload) => {
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

// マッチング成功したらログを出す
net.onMatched((info) => {
  log(`マッチング成功: room=${info.roomId} slot=${info.slot} mode=${info.mode}`);
  showAlert("◎", "マッチング成立しました", "#22c55e");
  // 1秒後に待機に戻す
  setTimeout(() => {
    toIdle();
  }, 1000);
});

// ===== ローカルネットを作る（setsuna-net.jsがないとき） =====
function createLocalNet() {
  console.log("[game.js] setsuna-net.js が無いのでローカルモードで起動します");
  let slashCb = () => {};
  let resultCb = () => {};
  let matchedCb = () => {};
  return {
    joinMatchmaking() {
      // 即マッチしたことにする
      matchedCb && matchedCb({ roomId: "local-room", slot: "p1", mode: "local" });
    },
    sendSlash(payload) {
      // そのまま相手が斬ってきたように自分に返す
      slashCb && slashCb(payload);
    },
    sendSlashResult(payload) {
      resultCb && resultCb(payload);
    },
    onRemoteSlash(cb) {
      slashCb = cb;
    },
    onRemoteSlashResult(cb) {
      resultCb = cb;
    },
    onMatched(cb) {
      matchedCb = cb;
    },
  };
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
  // ローカルで「相手が斬ってきた」を試す
  enterDefendModeFromRemote({
    damage: calcDamageFromCharge(commonGauge),
    charge: commonGauge,
  });
});
enemySpeedSelect.addEventListener("change", (e) => {
  enemyReactionMode = e.target.value;
  log(`敵の反応速度モードを ${enemyReactionMode} にしました`);
});
defendWindowRange.addEventListener("input", (e) => {
  currentDefendWindow = Number(e.target.value);
  defendWindowLabel.textContent = `${currentDefendWindow}ms`;
});
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (state === STATE.DEFEND) onDefendTap();
    else onAttack();
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
net.joinMatchmaking();
log("オンライン（またはローカル）待機に入りました。");
