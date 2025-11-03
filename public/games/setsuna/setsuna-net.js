// setsuna-net.js
// 2人を自動でペアにする超シンプルな仕組み

const RTDB = window.__SETUNA_RTDB__;
if (!RTDB) {
  console.warn("RTDB が初期化されていません。index.htmlでFirebaseを読み込んでください。");
}

// この端末専用のID（localStorageに残す）
const LOCAL_PLAYER_KEY = "setsuna_player_id";
let playerId = localStorage.getItem(LOCAL_PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2);
  localStorage.setItem(LOCAL_PLAYER_KEY, playerId);
}

// ゲームが参加しているルームのID
let currentRoomId = null;
// ルーム内での自分の位置（"p1" or "p2"）
let currentRoomSlot = null;

// ゲーム側から呼ばれるようにexportしておく
export const net = {
  playerId,
  joinMatchmaking,
  getRoomInfo,
  sendSlash,
  sendSlashResult,
  onRemoteSlash,
  onRemoteSlashResult,
};

let remoteSlashCallback = () => {};
let remoteSlashResultCallback = () => {};

function onRemoteSlash(cb) {
  remoteSlashCallback = cb;
}
function onRemoteSlashResult(cb) {
  remoteSlashResultCallback = cb;
}

// マッチングに参加する
async function joinMatchmaking() {
  if (!RTDB) return;

  const waitingRef = RTDB.ref("setsuna/waiting");
  const roomsRef = RTDB.ref("setsuna/rooms");

  // トランザクションで「待ってる人がいるか」を確認する
  await waitingRef.transaction((current) => {
    if (current === null) {
      // 誰もいなければ自分が待機
      return {
        playerId,
        ts: Date.now(),
      };
    } else if (current.playerId === playerId) {
      // 自分がすでに待ってるならそのまま
      return current;
    } else {
      // 他の人が待ってる → この人と自分を部屋にするので、
      // waiting側は消しておく（return null）
      return null;
    }
  }, async (err, committed, snapshot) => {
    if (err) {
      console.error("matchmaking transaction error", err);
      return;
    }

    const val = snapshot.val();

    // もし snapshot.val() が null だったら「誰かとペアにして消した」ので
    // 今の自分が2人目としてルームを作る番
    if (val === null) {
      // 待ってた人をもう一度読み直す必要があるので、直前の値を取る
      // ここでは簡単のため、いったんroomsに自分がp2で入る形にする
      const roomId = "room_" + Date.now();
      currentRoomId = roomId;
      currentRoomSlot = "p2";

      // 2人を登録しておく（本当は1人目のIDをどこかで保持するのがきれい）
      // ここでは「p1はunknown」扱いにしておく
      await roomsRef.child(roomId).set({
        createdAt: Date.now(),
        players: {
          // p1はさっきwaitingにいた人だけど、ここではまだ分からないので空でOK
          p1: { playerId: "waiting-player", joinedAt: Date.now() },
          p2: { playerId, joinedAt: Date.now() },
        },
        // 通信欄を用意しておく
        signals: {
          p1: { slash: null, slash_result: null },
          p2: { slash: null, slash_result: null },
        },
      });

      // 相手のslash/結果を監視
      startRoomListeners(roomId, "p2");
    } else {
      // 自分が先に待機に入ったパターン
      // この場合は、別の誰かが来るまで待つ
      currentRoomId = null;
      currentRoomSlot = "p1";
      // 誰かがroomsに作ってくれるのを監視する
      roomsRef
        .orderByChild("players/p2/playerId")
        .equalTo(playerId)
        .on("child_added", (snap) => {
          if (currentRoomId) return; // もう決まってたら無視
          currentRoomId = snap.key;
          startRoomListeners(currentRoomId, "p1");
        });

      // もしくはwaitingノードが消えたら「マッチング成立した」とみなす実装でもOK
    }
  });
}

function getRoomInfo() {
  return {
    roomId: currentRoomId,
    slot: currentRoomSlot,
    playerId,
  };
}

// RTDBにslashを書く
function sendSlash(payload) {
  // payload = { damage: number, createdAt: number }
  if (!RTDB || !currentRoomId || !currentRoomSlot) return;
  const ref = RTDB.ref(
    `setsuna/rooms/${currentRoomId}/signals/${currentRoomSlot}/slash`
  );
  ref.set(payload);
}

// RTDBにslash_resultを書く
function sendSlashResult(payload) {
  // payload = { result: "counter" | "hit" | "timeout", createdAt: number }
  if (!RTDB || !currentRoomId || !currentRoomSlot) return;
  const ref = RTDB.ref(
    `setsuna/rooms/${currentRoomId}/signals/${currentRoomSlot}/slash_result`
  );
  ref.set(payload);
}

// 相手からのイベントを監視する
function startRoomListeners(roomId, mySlot) {
  const otherSlot = mySlot === "p1" ? "p2" : "p1";
  const slashRef = RTDB.ref(
    `setsuna/rooms/${roomId}/signals/${otherSlot}/slash`
  );
  const slashResultRef = RTDB.ref(
    `setsuna/rooms/${roomId}/signals/${otherSlot}/slash_result`
  );

  slashRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    // 相手がslashしてきた
    remoteSlashCallback(val);
  });

  slashResultRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) return;
    // 相手がslash_resultを返してきた
    remoteSlashResultCallback(val);
  });
}
