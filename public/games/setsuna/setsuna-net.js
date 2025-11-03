// setsuna-net.js
// Firebase RTDBがあればオンライン、なければ「オンライン未設定」として待つだけ

const RTDB = window.__SETUNA_RTDB__ || null;

// 端末ごとに固定のID
const LOCAL_PLAYER_KEY = "setsuna_player_id";
let playerId = localStorage.getItem(LOCAL_PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2);
  localStorage.setItem(LOCAL_PLAYER_KEY, playerId);
}

// コールバック置き場
let onMatchedCb = () => {};
let onRemoteSlashCb = () => {};
let onRemoteSlashResultCb = () => {};
let onStatusCb = () => {};

function onMatched(cb) {
  onMatchedCb = cb;
}
function onRemoteSlash(cb) {
  onRemoteSlashCb = cb;
}
function onRemoteSlashResult(cb) {
  onRemoteSlashResultCb = cb;
}
function onStatus(cb) {
  onStatusCb = cb;
}

// RTDBがないとき → 何もしない
if (!RTDB) {
  console.warn("[setsuna-net] Firebaseが無いのでオンライン対戦は無効です");
  window.SetsunaNet = {
    mode: "offline",
    playerId,
    joinMatchmaking() {
      // 成功は絶対に言わない
      onStatusCb && onStatusCb({ state: "offline", reason: "RTDB not configured" });
    },
    sendSlash() {
      // 送れない
    },
    sendSlashResult() {
      // 送れない
    },
    onMatched,
    onRemoteSlash,
    onRemoteSlashResult,
    onStatus,
  };
} else {
  // ===== RTDBあり（オンライン） =====

  const waitingRef = RTDB.ref("setsuna/waiting");
  const roomsRef = RTDB.ref("setsuna/rooms");
  const playerRoomsRef = RTDB.ref("setsuna/playerRooms");

  let currentRoomId = null;
  let currentSlot = null;

  async function joinMatchmaking() {
    onStatusCb && onStatusCb({ state: "connecting" });

    let matchedWith = null;

    await waitingRef.transaction(
      (cur) => {
        if (cur === null) {
          // 誰も待ってなければ自分が待機になる
          return { playerId, ts: Date.now() };
        } else if (cur.playerId === playerId) {
          // 自分がもう待ってる
          return cur;
        } else {
          // 他の人がいた → この人とマッチさせるので待機を空にする
          matchedWith = cur.playerId;
          return null;
        }
      },
      async (err, committed, snap) => {
        if (err) {
          console.error("[setsuna-net] transaction error", err);
          onStatusCb && onStatusCb({ state: "error", error: err.message });
          return;
        }

        // ここで matchedWith が入っていれば “自分が2人目”
        if (matchedWith) {
          // ルームを作る
          const roomId = "room_" + matchedWith + "_" + playerId + "_" + Date.now();
          currentRoomId = roomId;
          currentSlot = "p2";

          await roomsRef.child(roomId).set({
            createdAt: Date.now(),
            players: {
              p1: { id: matchedWith },
              p2: { id: playerId },
            },
            signals: {},
          });

          // 2人とも自分の部屋を知れるようにする
          await playerRoomsRef.child(matchedWith).set(roomId);
          await playerRoomsRef.child(playerId).set(roomId);

          // 自分は即マッチ成立
          onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p2" });
          onMatchedCb && onMatchedCb({ roomId, slot: "p2" });

          startRoomSignalListeners(roomId, "p2");
        } else {
          // ここに来たのは “自分が先に待ってる側”
          onStatusCb && onStatusCb({ state: "waiting" });

          // 誰かが自分とマッチしたら /playerRooms/{playerId} に書かれるのでそれを待つ
          playerRoomsRef.child(playerId).on("value", (snap) => {
            const roomId = snap.val();
            if (!roomId) return;
            currentRoomId = roomId;
            // 自分が先に待ってたのでslotはp1
            currentSlot = "p1";

            onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p1" });
            onMatchedCb && onMatchedCb({ roomId, slot: "p1" });

            startRoomSignalListeners(roomId, "p1");
          });
        }
      }
    );
  }

  function startRoomSignalListeners(roomId, mySlot) {
    const otherSlot = mySlot === "p1" ? "p2" : "p1";
    const oppSlashRef = roomsRef.child(roomId).child("signals").child(otherSlot + "_slash");
    const oppResultRef = roomsRef.child(roomId).child("signals").child(otherSlot + "_result");

    oppSlashRef.on("value", (snap) => {
      const val = snap.val();
      if (!val) return;
      onRemoteSlashCb && onRemoteSlashCb(val);
    });

    oppResultRef.on("value", (snap) => {
      const val = snap.val();
      if (!val) return;
      onRemoteSlashResultCb && onRemoteSlashResultCb(val);
    });
  }

  function sendSlash(payload) {
    if (!currentRoomId || !currentSlot) return;
    roomsRef
      .child(currentRoomId)
      .child("signals")
      .child(currentSlot + "_slash")
      .set(payload);
  }

  function sendSlashResult(payload) {
    if (!currentRoomId || !currentSlot) return;
    roomsRef
      .child(currentRoomId)
      .child("signals")
      .child(currentSlot + "_result")
      .set(payload);
  }

  window.SetsunaNet = {
    mode: "online",
    playerId,
    joinMatchmaking,
    sendSlash,
    sendSlashResult,
    onMatched,
    onRemoteSlash,
    onRemoteSlashResult,
    onStatus,
  };
}
