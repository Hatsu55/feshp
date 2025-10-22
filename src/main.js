// ====== 共通 ======
const base = import.meta.env.BASE_URL || './';  // GitHub Pages のサブパス対応

// ====== DOM 参照 ======
const listEl  = document.getElementById('game-list');
const player  = document.getElementById('player');
const frame   = document.getElementById('gameFrame');
const closeBtn= document.getElementById('closeBtn');
const info    = document.getElementById('playerInfo');

// デバッグカウンタUI
const counterValueEl = document.getElementById('counterValue');
const incBtn         = document.getElementById('incBtn');
const resetBtn       = document.getElementById('resetBtn');

// ====== ストレージ鍵（将来拡張しやすい命名） ======
const STORAGE = {
  COUNTER: 'fes:counter:v1',
  // 例：STAMPS: 'fes:stamps:v1'
};

// ====== 初期化 ======
init().catch(err => {
  console.error(err);
  if (listEl) listEl.innerHTML = `<div class="card">読み込みエラー: ${escapeHtml(String(err))}</div>`;
});

async function init(){
  // 1) デバッグカウンタの初期表示／イベント
  setupCounter();

  // 2) ゲーム一覧の生成
  await loadAndRenderGames();

  // 3) postMessage受信（score/exit）
  setupMessageListener();
}

// ====== デバッグ：自動保存カウンタ ======
function setupCounter(){
  // 現在値のロード（未保存なら0）
  const current = loadCounter();
  renderCounter(current);

  // ＋1
  incBtn?.addEventListener('click', () => {
    const next = clamp(loadCounter() + 1, 0, 99999);
    saveCounter(next);
    renderCounter(next);
  });

  // リセット（開発時用）
  resetBtn?.addEventListener('click', () => {
    saveCounter(0);
    renderCounter(0);
  });
}

function loadCounter(){
  try{
    const raw = localStorage.getItem(STORAGE.COUNTER);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }catch(e){
    // localStorage が使えない環境でも落ちないように
    console.warn('localStorage load failed', e);
    return 0;
  }
}

function saveCounter(n){
  try{
    localStorage.setItem(STORAGE.COUNTER, String(n));
  }catch(e){
    console.warn('localStorage save failed', e);
  }
}

function renderCounter(n){
  if (counterValueEl) counterValueEl.textContent = String(n);
}

function clamp(v, min, max){ return Math.min(max, Math.max(min, v)); }

// ====== ゲーム一覧（games.json → カード生成） ======
async function loadAndRenderGames(){
  // public/games.json を取得（baseは /feshp/ 相当）
  const url = `${base}games.json?ts=${Date.now()}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`games.jsonを取得できません (${res.status})`);
  const data = await res.json();
  renderCards(data.games || []);
}

function renderCards(games){
  if(!listEl) return;

  if(!games.length){
    listEl.innerHTML = `<div class="card">まだゲームが登録されていません。</div>`;
    return;
  }

  listEl.innerHTML = '';
  for(const g of games){
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${escapeHtml(g.title)}</h3>
      <p>${escapeHtml(g.desc || '')}</p>
      <button class="button" data-id="${escapeHtml(g.id)}">起動</button>
    `;
    card.querySelector('button')?.addEventListener('click', ()=> openGame(g));
    listEl.appendChild(card);
  }
}

function openGame(game){
  const src = base + String(game.path || '').replace(/^\//,'');
  if (frame) frame.src = src;
  if (info)  info.textContent = `Playing: ${game.title}`;
  if (player){
    player.classList.remove('hidden');
    player.setAttribute('aria-hidden','false');
  }
}

closeBtn?.addEventListener('click', ()=> {
  if (frame) frame.src = 'about:blank';
  if (player){
    player.classList.add('hidden');
    player.setAttribute('aria-hidden','true');
  }
  if (info) info.textContent = '';
});

// ====== postMessage 受信 ======
function setupMessageListener(){
  window.addEventListener('message', (ev)=>{
    const msg = ev.data || {};
    if(msg?.type === 'score'){
      if (info) info.textContent = `Score: ${msg.value}`;
    }else if(msg?.type === 'exit'){
      closeBtn?.click();
    }
  });
}

// ====== utils ======
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
