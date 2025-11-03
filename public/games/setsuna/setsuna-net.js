// setsuna-net.js
// 役割: マッチング / ラウンド管理(roundId) / 信号送受信
// 仕様: すべての信号に roundId を付け、現在の roundId と一致したものだけ処理。
//       再戦時は roundId を更新し、/signals をクリア。

const RTDB = window.__SETUNA_RTDB__ || null;

const LOCAL_PLAYER_KEY = "setsuna_player_id";
let playerId = localStorage.getItem(LOCAL_PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2);
  localStorage.setItem(LOCAL_PLAYER_KEY, playerId);
}

// コールバック
let onMatchedCb = () => {};
let onStatusCb = () => {};
let onRemoteSlashCb = () => {};
let onRemoteSlashResultCb = () => {};
let onRoundChangedCb = () => {};

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
  console.warn("[setsuna-net] Firebase未設定。オンライン不可。");
}

// ルーム関連
const waitingRef = RTDB ? RTDB.ref("setsuna/waiting") : null;
const roomsRef = RTDB ? RTDB.ref("setsuna/rooms") : null;
const playerRoomsRef = RTDB ? RTDB.ref("setsuna/playerRooms") : null;

let currentRoomId = null;
let currentSlot = null; // "p1" | "p2"
let currentRoundId = null;
let slashRef = null;
let resultRef = null;

function makeRoundId() {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ===== マッチング =====
async function joinMatchmaking() {
  if (!RTDB) {
    onStatusCb && onStatusCb({ state: "offline" });
    return;
  }
  onStatusCb && onStatusCb({ state: "connecting" });

  let matchedWith = null;

  await waitingRef.transaction(
    (cur) => {
      if (cur === null) return { playerId, ts: Date.now() }; // 自分が待つ
      if (cur.playerId === playerId) return cur; // 既に待機中
      matchedWith = cur.playerId; // 相手がいた
      return null; // 取り除いてマッチ確定
    },
    async (err, committed, snap) => {
      if (err) {
        onStatusCb && onStatusCb({ state: "error", error: err.message });
        return;
      }

      if (matchedWith) {
        // 自分は2人目（p2）。ルーム作成者。
        const roomId = `room_${matchedWith}_${playerId}_${Date.now()}`;
        currentRoomId = roomId;
        currentSlot = "p2";
        currentRoundId = makeRoundId();

        await roomsRef.child(roomId).set({
          createdAt: Date.now(),
          players: { p1: { id: matchedWith }, p2: { id: playerId } },
          roundId: currentRoundId,
          signals: {}, // 空で開始
        });
        await playerRoomsRef.child(matchedWith).set(roomId);
        await playerRoomsRef.child(playerId).set(roomId);

        onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p2" });
        onMatchedCb && onMatchedCb({ roomId, slot: "p2" });
        onRoundChangedCb && onRoundChangedCb(currentRoundId);

        startRoomListeners(roomId, "p2");
      } else {
        // 自分は先に待っている側（p1）
        currentSlot = "p1";
        onStatusCb && onStatusCb({ state: "waiting" });

        playerRoomsRef.child(playerId).on("value", async (snap) => {
          const roomId = snap.val();
          if (!roomId || currentRoomId) return;

          currentRoomId = roomId;

          // roomの roundId を取得
          const roomSnap = await roomsRef.child(roomId).get();
          currentRoundId = roomSnap.val()?.roundId || makeRoundId();

          onStatusCb && onStatusCb({ state: "matched", roomId, slot: "p1" });
          onMatchedCb && onMatchedCb({ roomId, slot: "p1" });
          onRoundChangedCb && onRoundChangedCb(currentRoundId);

          startRoomListeners(roomId, "p1");
        });
      }
    }
  );
}

// ===== リスナーと信号クリア =====
function startRoomListeners(roomId, mySlot) {
  const other = mySlot === "p1" ? "p2" : "p1";

  // ラウンド変更の監視
  roomsRef.child(roomId).child("roundId").on("value", (snap) => {
    const rid = snap.val();
    if (!rid || rid === currentRoundId) return;
    currentRoundId = rid;
    onRoundChangedCb && onRoundChangedCb(currentRoundId);
  });

  // 自分が受け取る相手の信号
  slashRef = roomsRef.child(roomId).child("signals").child(`${other}_slash`);
  resultRef = roomsRef.child(roomId).child("signals").child(`${other}_result`);

  slashRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    // ラウンド不一致は無視
    if (!val.roundId || val.roundId !== currentRoundId) return;
    onRemoteSlashCb && onRemoteSlashCb(val);
  });

  resultRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    if (!val.roundId || val.roundId !== currentRoundId) return;
    onRemoteSlashResultCb && onRemoteSlashResultCb(val);
  });
}

// ===== 送信 =====
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

// ===== 再戦要求（新しい roundId を発行し、signals をクリア） =====
async function requestRematch() {
  if (!RTDB || !currentRoomId) return;
  const newId = makeRoundId();
  await roomsRef.child(currentRoomId).update({
    roundId: newId,
    signals: null, // まるごとクリア
  });
  // 自分側も即時更新（on('value')でも入ってくるが体感を良くする）
  currentRoundId = newId;
  onRoundChangedCb && onRoundChangedCb(currentRoundId);
}
