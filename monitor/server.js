/* 本地开发者监测服务（零依赖 Node）——统计本机访问游戏时的数据
   说明：GitHub Pages 为纯静态托管，远程访客数据无法回传（无后端），
   本服务统计的是通过本机访问（本地/开发测试）产生的数据。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8765;
const DATA_FILE = path.join(__dirname, 'data.json');

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {
    return { visits: [], registers: [], logouts: [], online: {} };
  }
}
function save(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
const dayStr = ts => { const x = new Date(ts); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

function renderPage(db) {
  const now = Date.now();
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const visitsToday = db.visits.filter(v => v.ts >= today0.getTime()).length;
  const onlineUsers = Object.entries(db.online).filter(([, ts]) => now - ts < 5 * 60 * 1000).map(([u]) => u);
  const byDay = {};
  for (let i = 13; i >= 0; i--) byDay[dayStr(now - i * 864e5)] = { visits: 0 };
  db.visits.forEach(v => { const s = dayStr(v.ts); if (byDay[s]) byDay[s].visits++; });
  const dayRows = Object.entries(byDay).map(([d, v]) =>
    `<tr><td>${d}</td><td>${v.visits}</td><td style="width:55%"><div class="bar" style="width:${Math.min(100, v.visits / Math.max(1, Math.max(...Object.values(byDay).map(x => x.visits))) * 100)}%"></div></td></tr>`).join('');
  const maxV = Math.max(1, ...Object.values(byDay).map(x => x.visits));
  const dayRows2 = Object.entries(byDay).map(([d, v]) =>
    `<tr><td>${d}</td><td>${v.visits}</td><td style="width:55%"><div class="bar" style="width:${(v.visits / maxV * 100).toFixed(1)}%"></div></td></tr>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>《中国人能飞》开发者监测系统</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:"Courier New",Consolas,monospace; background:#05060f; color:#eaf6ff; padding:2em; }
h1 { color:#7cfffb; letter-spacing:.2em; font-size:1.4em; margin-bottom:1.2em; text-shadow:0 0 12px rgba(0,229,255,.6); }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1em; margin-bottom:1.6em; }
.card { border:1px solid rgba(0,229,255,.35); background:rgba(0,229,255,.05); padding:1em; text-align:center; }
.card .num { font-size:2em; font-weight:700; color:#ffd76e; }
.card .lbl { font-size:.75em; color:#9fb4c8; letter-spacing:.1em; margin-top:.3em; }
.card.hl .num { color:#7cfffb; }
table { width:100%; border-collapse:collapse; font-size:.85em; }
th,td { padding:.5em .8em; border-bottom:1px solid rgba(0,229,255,.15); text-align:left; }
th { color:#b388ff; letter-spacing:.15em; }
.bar { height:12px; background:linear-gradient(90deg,#00e5ff,#7cfffb); border-radius:2px; }
.online { color:#3dffa2; margin-top:1em; font-size:.85em; letter-spacing:.08em; }
.foot { margin-top:1.6em; font-size:.7em; color:#6c7f93; letter-spacing:.08em; line-height:1.8; }
#tm { color:#6c7f93; font-size:.75em; margin-top:.6em; }
</style></head><body>
<h1>《中国人能飞》开发者监测系统</h1>
<div class="grid">
  <div class="card hl"><div class="num">${visitsToday}</div><div class="lbl">今日访问人次</div></div>
  <div class="card"><div class="num">${db.visits.length}</div><div class="lbl">累计访问人次</div></div>
  <div class="card"><div class="num">${db.registers.length}</div><div class="lbl">已注册用户数</div></div>
  <div class="card"><div class="num">${db.logouts.length}</div><div class="lbl">注销人数</div></div>
  <div class="card hl"><div class="num">${onlineUsers.length}</div><div class="lbl">当前在线人数</div></div>
</div>
<div class="online">🟢 在线用户：${onlineUsers.length ? onlineUsers.join('、') : '（暂无）'}</div>
<h1 style="font-size:1.1em;margin-top:1.4em">近 14 天访问趋势</h1>
<table><tr><th>日期</th><th>访问人次</th><th>趋势</th></tr>${dayRows2}</table>
<div class="foot">说明：GitHub Pages 为纯静态托管，远程访客的访问无法回传统计（无后端）。
本系统统计的是「通过本机/本地方式访问游戏」产生的数据（访问 / 注册 / 注销 / 在线心跳）。<br>
如需统计远程全站访问，可接入第三方统计（如不蒜子 / 百度统计）或后续架设服务器后端。</div>
<div id="tm"></div>
<script>
const t = document.getElementById('tm');
t.textContent = '最后刷新：' + new Date().toLocaleTimeString('zh-CN') + '（每 5 秒自动刷新）';
setInterval(() => location.reload(), 5000);
</script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/api/track') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const db = load();
        if (d.type === 'visit') db.visits.push({ ts: d.ts, user: d.user || '' });
        else if (d.type === 'register') db.registers.push({ ts: d.ts, user: d.user || '' });
        else if (d.type === 'logout') db.logouts.push({ ts: d.ts, user: d.user || '' });
        else if (d.type === 'online') db.online[d.user || '访客'] = d.ts;
        save(db);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400); res.end('{}'); }
    });
    return;
  }
  if (req.method === 'GET' && url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage(load()));
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('[监测] 《中国人能飞》开发者监测系统已启动: http://localhost:' + PORT);
});
