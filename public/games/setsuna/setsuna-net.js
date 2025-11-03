// setsuna-net.js
// ネットがあればRTDBで待機→ルームへ、なければローカルで即マッチとして返す

const RTDB = window.__SETUNA_RTDB__ || null;

// どの端末かを区別するためのID
const LOCAL_PLAYER_KEY = "setsuna_player_id";
let playerId = localStorage.getItem(LOCAL_PLAYER_KEY);
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).slice(2);
  localStorage.setItem(LOCAL_PLAYER_KEY, playerId);
}

// ゲームから渡してもらうハンドラ
let onSlashHandler = () => {};
let onSlashResultHandler = () => {};
let onMatchedHandler = () => {};

function setOnSlash(cb) {
  onSlashHandler = cb;
}
function setOnSlashResult(cb) {
  onSlashResultHandler = cb;
}
function setOnMatched(cb) {
  onMatchedHandler = cb;
}

// ==== RTDBがない場合はローカルマッチ扱い ====
if (!RTDB) {
  console.log("[setsuna-net] RTDBなし → ローカルマッチモード");
  // windowに公開
  window.SetsunaNet = {
    mode: "local",
    playerId,
    joinMatchmaking() {
      console.log("[setsuna-net] ローカルでマッチング成功");
      onMatchedHandler &&
        onMatchedHandler({ roomId: "local-room", slot: "p1", mode: "local" });
    },
    sendSlash(payload) {
      // 相手がいないのでそのまま「相手が斬ってきた」として呼ぶ
      console.log("[setsuna-net] (local) sendSlash → onSlashHandler");
      onSlashHandler && onSlashHandler(payload);
    },
    sendSlashResult(payload) {
      console.log("[setsuna-net] (local) sendSlashResult → onSlashResultHandler");
      onSlashResultHandler && onSlashResultHandler(payload);
    },
    onRemoteSlash: setOnSlash,
    onRemoteSlashResult: setOnSlashResult,
    onMatched: setOnMatched,
  };
} else {
  // ==== ここから下がRTDBあり版（今回は最小） ====
  console.log("[setsuna-net] RTDBあり → オンライン待機モード");

  const waitingRef = RTDB.ref("setsuna/waiting");
  const roomsRef = RTDB.ref("setsuna/rooms");

  let currentRoomId = null;
  let currentSlot = null;

  async function joinMatchmaking() {
    // すごく雑な2人マッチ
    await waitingRef.transaction(
      (cur) => {
        if (cur === null) {
          // 誰もいなければ自分が待機
          return { playerId, ts: Date.now() };
        } else if (cur.playerId === playerId) {
          // 自分がすでに待ってる
          return cur;
        } else {
          // 誰かが待ってるのでこの場で消す（=マッチ成立）
          return null;
        }
      },
      async (err, committed, snap) => {
        if (err) {
          console.error("[setsuna-net] matchmaking error", err);
          return;
        }

        const val = snap.val();

        // val === null → いま2人目として入った
        if (val === null) {
          // 2人目側：新しい部屋を作る
          const roomId = "room_" + Date.now();
          currentRoomId = roomId;
          currentSlot = "p2";

          await roomsRef.child(roomId).set({
            createdAt: Date.now(),
            players: {
              p2: { playerId, joinedAt: Date.now() },
            },
            signals: {},
          });

          startRoomListeners(roomId, "p2");
          console.log("[setsuna-net] マッチング成功（2人目） room:", roomId);
          onMatchedHandler &&
            onMatchedHandler({ roomId, slot: "p2", mode: "online" });
        } else {
          // 1人目側：誰かが入ってくるのを待つ
          currentRoomId = null;
          currentSlot = "p1";
          console.log("[setsuna-net] 待機に入りました。別の端末が来るのを待ちます…");
          // 本当はroomsを監視してp1としてjoinを検知する
          // 簡易版では自分で自分をマッチ済み扱いにする
          onMatchedHandler &&
            onMatchedHandler({ roomId: "room_waiting", slot: "p1", mode: "online-wait" });
        }
      }
    );
  }

  function startRoomListeners(roomId, mySlot) {
    const otherSlot = mySlot === "p1" ? "p2" : "p1";
    const slashRef = roomsRef.child(roomId).child("signals").child(otherSlot + "_slash");
    const resultRef = roomsRef.child(roomId).child("signals").child(otherSlot + "_result");

    slashRef.on("value", (snap) => {
      const val = snap.val();
      if (!val) return;
      console.log("[setsuna-net] 相手がslashした:", val);
      onSlashHandler && onSlashHandler(val);
    });

    resultRef.on("value", (snap) => {
      const val = snap.val();
      if (!val) return;
      console.log("[setsuna-net] 相手がslash_result:", val);
      onSlashResultHandler && onSlashResultHandler(val);
    });
  }

  function sendSlash(payload) {
    if (!currentRoomId || !currentSlot) return;
    roomsRef.child(currentRoomId).child("signals").child(currentSlot + "_slash").set(payload);
  }

  function sendSlashResult(payload) {
    if (!currentRoomId || !currentSlot) return;
    roomsRef.child(currentRoomId).child("signals").child(currentSlot + "_result").set(payload);
  }

  window.SetsunaNet = {
    mode: "online",
    playerId,
    joinMatchmaking,
    sendSlash,
    sendSlashResult,
    onRemoteSlash: setOnSlash,
    onRemoteSlashResult: setOnSlashResult,
    onMatched: setOnMatched,
  };
}
