const log = document.getElementById('log');
const ping = document.getElementById('ping');

function println(t){ log.textContent += `${t}\n`; }

println('✅ MVP-0 起動OK（Vite + Vanilla JS）');
println('📌 次の目標: games.json → カード表示 → iframe起動（MVP-1）');

ping?.addEventListener('click', (e)=>{
  e.preventDefault();
  println('🟢 ボタン動作チェックOK');
});
