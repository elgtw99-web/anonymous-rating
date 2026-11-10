// 端對端測試：獨立隨機主題，送出模擬評分到雲端，再讀回加總比對。  執行：node test.js
global.window = {};
require("./config.js");
const cfg = window.RATING_CONFIG;
const { makeClient, rank } = require("./core.js");
const client = makeClient(cfg, "selftest-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

(async () => {
  const n = cfg.presenters.length, K = cfg.criteria.length;
  const votes = [];
  for (let b = 0; b < 8; b++) for (let p = 0; p < n; p++)
    votes.push({ p, s: Array.from({ length: K }, (_, k) => (b * 3 + p * 2 + k * 5) % 11) });   // 含 0 分與 10 分
  votes.forEach(v => { if (v.p <= 1) v.s = [10, 10, 10]; });   // 第 0、1 號完全同分 → 並列

  const exp = Array.from({ length: n }, () => ({ total: 0, count: 0, crit: new Array(K).fill(0) }));
  votes.forEach(v => { exp[v.p].count++; v.s.forEach((x, k) => { exp[v.p].total += x; exp[v.p].crit[k] += x; }); });

  // 同時上傳全部（併發），另外送一張「選錯人」再撤回
  const ids = await Promise.all([client.submitVote(2, [0, 0, 0]), ...votes.map(v => client.submitVote(v.p, v.s))]);
  await client.retractVote(ids[0]);
  await new Promise(r => setTimeout(r, 3000));
  const res = await client.fetchResults();

  ok(res.votes === votes.length, `有效票數 ${res.votes} == ${votes.length}（撤回的不計）`);
  res.rows.forEach((r, i) => {
    ok(r.total === exp[i].total && r.count === exp[i].count && r.crit.join() === exp[i].crit.join(),
      `${r.name}: 總分 ${r.total}/${exp[i].total}，人數 ${r.count}/${exp[i].count}，各項 [${r.crit}]`);
  });
  const r = rank(res.rows, cfg.prize);
  ok(r.winners.length === 2 && r.each === cfg.prize / 2, `並列第一 ${r.winners.map(w => w.name)}，各 ${r.each}`);
  console.log(fail ? `\n❌ ${fail} 項失敗` : "\n✅ 全部通過");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
