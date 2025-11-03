// setsuna-net.js
// Firebase RTDB を使った 2人マッチング＋ラウンド管理（roundId）＋再戦投票

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

// コールバック
let onMatchedCb = () => {};
let onStatusCb = () => {};
let onRemoteSlashCb = () => {};
let onRemoteSlashResultCb = () => {};
let onRoundChangedCb = () => {};

// 現在のルーム情報
let currentRoomId = null;
let currentSlot = null;   // "p1" | "p2"
let currentRoundId = null;

// ラウンドID生成
function makeRoundId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
  getRoundId: () => currentRoundId,
};

if (!RTDB) {
  console.warn("[setsuna-net] Firebase 未設定のためオンライン対戦は無効です");
}

// ===== マッチング処理 =====
async function joinMatchmaking() {
  if (!RTDB) {
    onStatusCb && onStatusCb({ state: "offline" });
    return;
  }

  // 前回のルーム紐付けが残っていると「1台で即マッチ」になるので消しておく
  await playerRoomsRef.child(playerId).remove().catch(() => {});

  onStatusCb && onStatusCb({ state: "connecting" });

  let matchedWith = null;
  let becameWaiting = false;

  await waitingRef.transaction(
    (cur) => {
      if (cur === null) {
        // 誰も待っていない → 自分が待機に入る
        becameWaiting = true;
        return { playerId, ts: Date.now() };
      } else if (cur.playerId === playerId) {
        // すでに自分が待機している
        becameWaiting = true;
        return cur;
      } else {
        // 他の人が待っていた → この人とマッチさせる
        matchedWith = cur.playerId;
        return null; // 待機枠を空にする
      }
    },
    async (err, committed, snap) => {
      if (err) {
        console.error("[setsuna-net] matchmaking transaction error", err);
        onStatusCb && onStatusCb({ state: "error", error: err.message });
        return;
      }

      // マッチ相手が決まっているなら、自分は 2人目（p2）
      if (matchedWith) {
        const roomId = `room_${matchedWith}_${playerId}_${Date.now()}`;
        currentRoomId = roomId;
        currentSlot = "p2";
        currentRoundId = makeRoundId();

        // ルーム作成
        await roomsRef.child(roomId).set({
          createdAt: Date.now(),
          players: {
            p1: { id: matchedWith },
            p2: { id: playerId },
          },
          roundId: currentRoundId,
          signals: {},
          rematchVotes: {},
        });

        await playerRoomsRef.child(matchedWith).set(roomId);
        await playerRoomsRef.child(playerId).set(roomId);
        playerRoomsRef.child(playerId).onDisconnect().remove();
        waitingRef.onDisconnect().cancel && waitingRef.onDisconnect().cancel();

        onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p2" });
        onMatchedCb && onMatchedCb({ roomId, slot: "p2" });
        onRoundChangedCb && onRoundChangedCb(currentRoundId);

        startRoomListeners(roomId, "p2");
      } else if (becameWaiting) {
        // 自分が待機側（p1）
        onStatusCb && onStatusCb({ state: "waiting" });

        // 接続が切れたら待機を自動解除
        try {
          waitingRef.onDisconnect().set(null);
          playerRoomsRef.child(playerId).onDisconnect().remove();
        } catch (_) {}

        // 自分がマッチングされたら /playerRooms/{playerId} に roomId が書かれる
        playerRoomsRef.child(playerId).on("value", async (snap2) => {
          const roomId = snap2.val();
          if (!roomId || currentRoomId) return;

          currentRoomId = roomId;
          currentSlot = "p1";

          const roomSnap = await roomsRef.child(roomId).get();
          const roomVal = roomSnap.val() || {};
          currentRoundId = roomVal.roundId || makeRoundId();

          onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p1" });
          onMatchedCb && onMatchedCb({ roomId, slot: "p1" });
          onRoundChangedCb && onRoundChangedCb(currentRoundId);

          startRoomListeners(roomId, "p1");
        });
      } else {
        // ここに来ることはほぼない（念のため）
        onStatusCb && onStatusCb({ state: "waiting" });
      }
    }
  );
}

// ===== ルーム内リスナー =====
function startRoomListeners(roomId, mySlot) {
  const other = mySlot === "p1" ? "p2" : "p1";

  // roundId 変更監視（再戦など）
  roomsRef.child(roomId).child("roundId").on("value", (snap) => {
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
