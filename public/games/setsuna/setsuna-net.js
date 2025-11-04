// setsuna-net.js
// Firebase RTDB を使った 2人マッチング＋ラウンド管理（roundId）＋再戦投票＋簡易プレゼンス監視

const RTDB = window.__SETUNA_RTDB__ || null;

// プレイヤーID（端末ごとに固定）
const LOCAL_PLAYER_KEY = "setsuna_player_id";
let playerId = localStorage.getItem(LOCAL_PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2);
  localStorage.setItem(LOCAL_PLAYER_KEY, playerId);
}

// RTDB 参照
const waitingRef = RTDB ? RTDB.ref("setsuna/waiting") : null;
const roomsRef = RTDB ? RTDB.ref("setsuna/rooms") : null;
const playerRoomsRef = RTDB ? RTDB.ref("setsuna/playerRooms") : null;
const presenceRef = RTDB ? RTDB.ref("setsuna/presence") : null;

// コールバック
let onMatchedCb = () => {};
let onStatusCb = () => {};
let onRemoteSlashCb = () => {};
let onRemoteSlashResultCb = () => {};
let onRoundChangedCb = () => {};
let onOpponentLeftCb = () => {};

// 現在のルーム情報
let currentRoomId = null;
let currentSlot = null; // "p1" | "p2"
let currentRoundId = null;
let currentOpponentId = null;

// ハートビート
const HEARTBEAT_INTERVAL_MS = 10000;
const OPPONENT_OFFLINE_MS = 15000;
let heartbeatTimerId = null;
let stopOpponentPresenceWatchFn = null;

function startHeartbeat() {
  if (!RTDB || !presenceRef) return;
  const myRef = presenceRef.child(playerId);
  myRef.set({ ts: Date.now() }).catch(() => {});
  try {
    myRef.onDisconnect().remove();
  } catch (_) {}
  if (heartbeatTimerId) clearInterval(heartbeatTimerId);
  heartbeatTimerId = setInterval(() => {
    myRef.update({ ts: Date.now() }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

function stopOpponentPresenceWatch() {
  if (stopOpponentPresenceWatchFn) {
    stopOpponentPresenceWatchFn();
    stopOpponentPresenceWatchFn = null;
  }
}

function watchOpponentPresence(opponentId) {
  if (!RTDB || !presenceRef || !opponentId) return;
  stopOpponentPresenceWatch();

  const ref = presenceRef.child(opponentId);
  let lastTs = Date.now();
  let offlineNotified = false;

  const onVal = (snap) => {
    const v = snap.val();
    if (v && typeof v.ts === "number") {
      lastTs = v.ts;
    } else if (!v) {
      // presence ノードが消えた → 即切断扱い
      if (!offlineNotified) {
        offlineNotified = true;
        onOpponentLeftCb && onOpponentLeftCb({ reason: "presence_removed" });
      }
    }
  };

  ref.on("value", onVal);

  const timerId = setInterval(() => {
    if (offlineNotified) return;
    if (Date.now() - lastTs > OPPONENT_OFFLINE_MS) {
      offlineNotified = true;
      onOpponentLeftCb && onOpponentLeftCb({ reason: "presence_timeout" });
    }
  }, HEARTBEAT_INTERVAL_MS);

  stopOpponentPresenceWatchFn = () => {
    ref.off("value", onVal);
    clearInterval(timerId);
  };
}

// ラウンドID生成
function makeRoundId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupRoomListeners() {
  if (!RTDB) return;
  if (currentRoomId) {
    roomsRef.child(currentRoomId).off();
  }
  if (playerRoomsRef) {
    playerRoomsRef.child(playerId).off();
  }
  stopOpponentPresenceWatch();
  currentRoomId = null;
  currentSlot = null;
  currentRoundId = null;
  currentOpponentId = null;
}

// ===== 公開API =====
export const net = {
  mode: RTDB ? "online" : "offline",
  playerId,
  joinMatchmaking,
  sendSlash,
  sendSlashResult,
  requestRematch,
  onMatched: (cb) => (onMatchedCb = cb),
  onStatus: (cb) => (onStatusCb = cb),
  onRemoteSlash: (cb) => (onRemoteSlashCb = cb),
  onRemoteSlashResult: (cb) => (onRemoteSlashResultCb = cb),
  onRoundChanged: (cb) => (onRoundChangedCb = cb),
  onOpponentLeft: (cb) => (onOpponentLeftCb = cb),
  getRoundId: () => currentRoundId,
};

// ===== マッチング開始 =====
async function joinMatchmaking() {
  if (!RTDB) {
    onStatusCb && onStatusCb({ state: "offline" });
    return;
  }

  // 以前のルーム監視をクリーンアップ
  cleanupRoomListeners();

  // 自プレゼンス開始
  startHeartbeat();

  // 前回のルーム紐付けが残っていると「1台で即マッチ」になるので消しておく
  await playerRoomsRef.child(playerId).remove().catch(() => {});

  onStatusCb && onStatusCb({ state: "connecting" });

  let matchedWith = null;
  let becameWaiting = false;

  await waitingRef.transaction(
    (cur) => {
      const now = Date.now();
      // 古い待機（30秒以上前）は無視して自分を書き込む
      if (cur && cur.ts && now - cur.ts > 30000) {
        return { playerId, ts: now };
      }

      if (!cur) {
        becameWaiting = true;
        return { playerId, ts: now };
      }

      if (cur.playerId === playerId) {
        becameWaiting = true;
        return cur;
      }

      // 他の人が待っていた → この人とマッチさせる
      matchedWith = cur.playerId;
      return null; // 待機枠を空にする
    },
    async (err, committed, _snap) => {
      if (err) {
        console.error("[setsuna-net] matchmaking transaction error", err);
        onStatusCb && onStatusCb({ state: "error", error: err.message });
        return;
      }

      // マッチ相手が決まっているなら、自分は 2人目（p2）
      if (matchedWith) {
        const roomId = `room_${matchedWith}_${playerId}_${Date.now()}`;
        const roundId = makeRoundId();
        const roomData = {
          players: { p1: matchedWith, p2: playerId },
          createdAt: Date.now(),
          roundId,
          signals: null,
          rematchVotes: null,
        };

        await roomsRef.child(roomId).set(roomData);
        await playerRoomsRef.child(matchedWith).set(roomId);
        await playerRoomsRef.child(playerId).set(roomId);

        currentRoomId = roomId;
        currentSlot = "p2";
        currentRoundId = roundId;
        currentOpponentId = matchedWith;

        onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p2" });
        onMatchedCb && onMatchedCb({ roomId, slot: "p2" });
        onRoundChangedCb && onRoundChangedCb(currentRoundId);

        startRoomListeners(roomId, "p2");
        watchOpponentPresence(currentOpponentId);
      } else if (becameWaiting) {
        // 自分が待機側（p1）
        onStatusCb && onStatusCb({ state: "waiting" });

        // 接続が切れたら待機を自動解除
        try {
          waitingRef.onDisconnect().set(null);
          playerRoomsRef.child(playerId).onDisconnect().remove();
        } catch (_) {}

        // 自分がマッチングされたら /playerRooms/{playerId} に roomId が書かれる
        const roomListener = async (snap2) => {
          const roomId = snap2.val();
          if (!roomId || currentRoomId) return;

          currentRoomId = roomId;
          currentSlot = "p1";

          const roomSnap = await roomsRef.child(roomId).get();
          const roomVal = roomSnap.val() || {};
          const players = roomVal.players || {};
          currentRoundId = roomVal.roundId || makeRoundId();
          currentOpponentId = players.p2 || null;

          onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p1" });
          onMatchedCb && onMatchedCb({ roomId, slot: "p1" });
          onRoundChangedCb && onRoundChangedCb(currentRoundId);

          startRoomListeners(roomId, "p1");
          if (currentOpponentId) {
            watchOpponentPresence(currentOpponentId);
          }

          // 待機状態をクリア
          try {
            waitingRef.onDisconnect().cancel && waitingRef.onDisconnect().cancel();
          } catch (_) {}
        };

        playerRoomsRef.child(playerId).on("value", roomListener);
      }
    }
  );
}

// ===== ルーム内監視 =====
function startRoomListeners(roomId, mySlot) {
  const other = mySlot === "p1" ? "p2" : "p1";

  // roundId 変更監視（再戦など）
  roomsRef
    .child(roomId)
    .child("roundId")
    .on("value", (snap) => {
      const rid = snap.val();
      if (!rid || rid === currentRoundId) return;
      currentRoundId = rid;
      onRoundChangedCb && onRoundChangedCb(currentRoundId);
    });

  // 相手の slash / result を監視
  const oppSlashRef = roomsRef.child(roomId).child("signals").child(`${other}_slash`);
  const oppResultRef = roomsRef.child(roomId).child("signals").child(`${other}_result`);

  oppSlashRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    if (!val.roundId || val.roundId !== currentRoundId) return; // 古いラウンドは無視
    onRemoteSlashCb && onRemoteSlashCb(val);
  });

  oppResultRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    if (!val.roundId || val.roundId !== currentRoundId) return;
    onRemoteSlashResultCb && onRemoteSlashResultCb(val);
  });

  // 再戦投票の監視
  const votesRef = roomsRef.child(roomId).child("rematchVotes");
  votesRef.on("value", (snap) => {
    const votes = snap.val() || {};
    const p1 = !!votes.p1;
    const p2 = !!votes.p2;

    // 両方 true になったタイミングで、新ラウンドを開始する。
    // 実際に roundId を更新するのは p1 だけにしてレースを避ける。
    if (p1 && p2 && mySlot === "p1") {
      const newId = makeRoundId();
      roomsRef.child(roomId).update({
        roundId: newId,
        signals: null,
        rematchVotes: null,
      });
      // currentRoundId 自体は roundId リスナーで更新される
    }
  });
}

// ===== 信号送信 =====
function sendSlash(payload) {
  if (!RTDB || !currentRoomId || !currentSlot || !currentRoundId) return;
  roomsRef
    .child(currentRoomId)
    .child("signals")
    .child(`${currentSlot}_slash`)
    .set({ ...payload, roundId: currentRoundId });
}

function sendSlashResult(payload) {
  if (!RTDB || !currentRoomId || !currentSlot || !currentRoundId) return;
  roomsRef
    .child(currentRoomId)
    .child("signals")
    .child(`${currentSlot}_result`)
    .set({ ...payload, roundId: currentRoundId });
}

// ===== 再戦ボタン → 自分の投票だけ true にする =====
async function requestRematch() {
  if (!RTDB || !currentRoomId || !currentSlot) return;
  await roomsRef
    .child(currentRoomId)
    .child("rematchVotes")
    .child(currentSlot)
    .set(true);
}
