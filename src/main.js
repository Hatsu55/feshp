// ====== 共通 ======
const base = import.meta.env.BASE_URL || './';      // /feshp/ 相当（Pages）
const absoluteBase = location.origin + base;        // 絶対URL作成用

// ====== スタンプ定義（後で増やしやすい） ======
const STAMPS = [
  { id: 's1', label: 'A', color: '#4ade80' }, // green
  { id: 's2', label: 'B', color: '#60a5fa' }, // blue
  { id: 's3', label: 'C', color: '#f472b6' }, // pink
];
const STAMP_KEY = 'fes:stamps:v1';

// ====== DOM ======
const stampsEl = document.getElementById('stamps');
const openScannerBtn = document.getElementById('openScannerBtn');
const resetStampsBtn = document.getElementById('resetStampsBtn');
const qrGrid = document.getElementById('qrGrid');
const toastEl = document.getElementById('toast');

// スキャナ
const scanner = document.getElementById('scanner');
const scanVideo = document.getElementById('scanVideo');
const scanCanvas = document.getElementById('scanCanvas');
const scanCloseBtn = document.getElementById('scanCloseBtn');

// ゲームUI
const listEl  = document.getElementById('game-list');
const player  = document.getElementById('player');
const frame   = document.getElementById('gameFrame');
const closeBtn= document.getElementById('closeBtn');
const info    = document.getElementById('playerInfo');

// デバッグカウンタ
const counterValueEl = document.getElementById('counterValue');
const incBtn         = document.getElementById('incBtn');
const resetBtn       = document.getElementById('resetBtn');

// ====== 初期化 ======
init().catch(err => {
  console.error(err);
  if (listEl) listEl.innerHTML = `<div class="card">読み込みエラー: ${escapeHtml(String(err))}</div>`;
});

async function init(){
  // 0) URLの ?stamp=ID を取り込み（iPhone標準カメラ対応）
  const gotFromUrl = applyStampFromURL();

  // 1) スタンプ描画・イベント
  renderStamps();
  openScannerBtn?.addEventListener('click', startScanner);
  resetStampsBtn?.addEventListener('click', () => {
    saveStamps([]);
    renderStamps();
    showToast('スタンプをリセットしました');
  });

  // 2) デバッグ用：QRを3つ生成（印刷可）
  renderDebugQRCodes();

  // 3) デバッグカウンタ
  setupCounter();

  // 4) ゲーム一覧
  await loadAndRenderGames();

  // 5) postMessage受信
  setupMessageListener();

  if (gotFromUrl) showToast(`スタンプ「${gotFromUrl}」を獲得！`);
}

// ====== スタンプ：保存・描画 ======
function loadStamps(){
  try{
    const raw = localStorage.getItem(STAMP_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  }catch(e){
    console.warn('loadStamps failed', e);
    return [];
  }
}
function saveStamps(arr){
  try{
    localStorage.setItem(STAMP_KEY, JSON.stringify(arr));
  }catch(e){
    console.warn('saveStamps failed', e);
  }
}
function hasStamp(id){
  return loadStamps().includes(id);
}
function addStamp(id){
  const ids = new Set(loadStamps());
  ids.add(id);
  saveStamps([...ids]);
  renderStamps();
}

function renderStamps(){
  if (!stampsEl) return;
  const owned = new Set(loadStamps());
  stampsEl.innerHTML = '';
  for(const s of STAMPS){
    const div = document.createElement('div');
    div.className = 'stamp' + (owned.has(s.id) ? ' got' : '');
    if (owned.has(s.id)) {
      div.style.background = s.color;
      div.style.borderColor = s.color;
    }
    div.innerHTML = `<div class="label">${escapeHtml(s.label)}${owned.has(s.id) ? ' ✓' : ''}</div>`;
    div.setAttribute('data-id', s.id);
    stampsEl.appendChild(div);
  }
}

// URL ?stamp=s1 を受け取って保存
function applyStampFromURL(){
  const p = new URLSearchParams(location.search);
  const id = p.get('stamp');
  if (!id) return null;
  const ok = STAMPS.some(s => s.id === id);
  if (!ok) return null;
  if (!hasStamp(id)){
    addStamp(id);
  }else{
    renderStamps();
  }
  return id;
}

// ====== QRスキャナ（jsQR） ======
let scanStream = null;
let rafId = 0;

async function startScanner(){
  try{
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('このブラウザはカメラに対応していません。');
      return;
    }
    // 背面カメラ優先
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    scanVideo.srcObject = scanStream;
    await scanVideo.play();

    scanner.classList.add('active');
    scanner.setAttribute('aria-hidden','false');

    scanLoop();
  }catch(e){
    console.error(e);
    alert('カメラを開始できませんでした。権限をご確認ください。');
  }
}

function stopScanner(){
  cancelAnimationFrame(rafId);
  if (scanStream){
    for (const t of scanStream.getTracks()) t.stop();
    scanStream = null;
  }
  scanVideo.pause();
  scanner.classList.remove('active');
  scanner.setAttribute('aria-hidden','true');
}

scanCloseBtn?.addEventListener('click', stopScanner);

function scanLoop(){
  const w = scanVideo.videoWidth;
  const h = scanVideo.videoHeight;
  if (w && h){
    scanCanvas.width = w;
    scanCanvas.height = h;
    const ctx = scanCanvas.getContext('2d');
    ctx.drawImage(scanVideo, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = window.jsQR ? window.jsQR(imageData.data, w, h) : null;
    if (code && code.data){
      handleScannedText(code.data);
      stopScanner();
      return; // 終了
    }
  }
  rafId = requestAnimationFrame(scanLoop);
}

function handleScannedText(text){
  // 1) まずはURLとして扱う
  let url;
  try{
    url = new URL(text);
  }catch(_){
    // テキストだけのQRにも対応（?stamp=s1 のみなど）
    if (text.includes('stamp=')){
      const m = text.match(/[?&]stamp=([^&]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        applyStampId(id);
        return;
      }
    }
    alert('対応していないQRです');
    return;
  }
  // 自サイトかどうかは厳密には問わず、stampがあれば反映
  const id = new URLSearchParams(url.search).get('stamp');
  if (id){
    applyStampId(id);
  }else{
    alert('このQRにはスタンプ情報がありません');
  }
}

function applyStampId(id){
  if (!STAMPS.some(s => s.id === id)) {
    alert('不明なスタンプIDです');
    return;
  }
  if (!hasStamp(id)) addStamp(id);
  showToast(`スタンプ「${id.toUpperCase()}」を獲得！`);
  // URLバーを汚さないように履歴を書き換え（stampは残さない）
  history.replaceState(null, '', location.pathname);
}

// ====== デバッグ：QR生成（qrcodejs） ======
function renderDebugQRCodes(){
  if (!qrGrid || !window.QRCode) return;
  qrGrid.innerHTML = '';
  for(const s of STAMPS){
    const box = document.createElement('div');
    box.className = 'qr-box';
    const div = document.createElement('div');
    div.id = `qr-${s.id}`;
    const absUrl = `${absoluteBase}?stamp=${s.id}`;
    box.appendChild(div);
    const cap = document.createElement('div');
    cap.className = 'small';
    cap.textContent = absUrl;
    box.appendChild(cap);
    qrGrid.appendChild(box);

    new window.QRCode(div, {
      text: absUrl,
      width: 144,
      height: 144,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }
}

// ====== デバッグ：自動保存カウンタ ======
const STORAGE = { COUNTER: 'fes:counter:v1' };

function setupCounter(){
  const current = loadCounter();
  renderCounter(current);

  incBtn?.addEventListener('click', () => {
    const next = clamp(loadCounter() + 1, 0, 99999);
    saveCounter(next);
    renderCounter(next);
  });
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

// ====== ゲーム一覧（games.json → カード） ======
async function loadAndRenderGames(){
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

// ====== postMessage ======
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
function showToast(text){
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.style.display = 'block';
  setTimeout(()=> toastEl.style.display = 'none', 1500);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
