// 端對端測試：用獨立的隨機命名空間，送出模擬選票到雲端，再讀回加總比對。
// 執行：node test.js
global.window = {};
require("./config.js");
const cfg = window.RATING_CONFIG;
const { makeClient, rank } = require("./core.js");

const ns = "selftest-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const client = makeClient(cfg, ns);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

(async () => {
  const n = cfg.presenters.length;
  // 6 張選票；編號 0 的人因自己免評，少 1 票
  const ballots = [];
  for (let b = 0; b < 6; b++) {
    const s = {};
    for (let p = 0; p < n; p++) {
      if (p === 0 && b === 0) continue;
      s[p] = ((p * 3 + b * 7) % cfg.maxScore) + 1;
    }
    ballots.push(s);
  }
  // 讓第 1、2 號人選完全同分以測試並列
  ballots.forEach(s => { s[1] = 10; s[2] = 10; });

  const exp = Array.from({ length: n }, () => ({ total: 0, count: 0 }));
  ballots.forEach(s => Object.entries(s).forEach(([p, v]) => { exp[p].total += v; exp[p].count++; }));

  await Promise.all(ballots.map(b => client.submitBallot(b)));   // 同時上傳，測試併發
  await new Promise(r => setTimeout(r, 3000));   // ntfy 寫入快取約需 1 秒內
  const res = await client.fetchResults();

  ok(res.ballots === ballots.length, `選票數 ${res.ballots} == ${ballots.length}`);
  res.rows.forEach((r, i) => {
    ok(r.total === exp[i].total && r.count === exp[i].count,
       `${r.name}: 總分 ${r.total}/${exp[i].total}，人數 ${r.count}/${exp[i].count}`);
  });
  const grand = res.rows.reduce((a, r) => a + r.total, 0);
  const grandExp = exp.reduce((a, r) => a + r.total, 0);
  ok(grand === grandExp, `全體總分 ${grand} == ${grandExp}`);

  const r = rank(res.rows, cfg.prize);
  ok(r.winners.length === 2 && r.each === cfg.prize / 2, `並列第一 ${r.winners.map(w => w.name)}，各 ${r.each}`);
  console.log(fail ? `\n❌ ${fail} 項失敗` : "\n✅ 全部通過（topic=" + ns + "）");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
