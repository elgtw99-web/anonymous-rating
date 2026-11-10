// 核心邏輯：投票上傳、加總、排名。瀏覽器與 Node 測試共用。
// 每張選票 = 一則匿名訊息（只含分數＋隨機選票編號），上傳到 ntfy.sh 主題；
// 結果頁一次讀回所有訊息、去除重複編號後加總。
(function (root) {
  function makeClient(cfg, topicOverride) {
    var topic = topicOverride || cfg.topic;
    var base = cfg.server.replace(/\/$/, "") + "/" + topic;

    function newId() {
      var a = new Uint32Array(3);
      (root.crypto || require("crypto").webcrypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (x) { return x.toString(36); }).join("");
    }

    async function retry(fn, tries) {
      var last;
      for (var i = 0; i < (tries || 5); i++) {
        try { return await fn(); } catch (e) { last = e; }
        await new Promise(function (r) { setTimeout(r, 600 * (i + 1)); });
      }
      throw last;
    }

    // 送出一張選票（單一請求）。scores = { 發表人序號: 分數 }。重試不會重複計算（以 id 去重）。
    async function submitBallot(scores) {
      var body = JSON.stringify({ v: 1, id: newId(), s: scores });
      await retry(async function () {
        var r = await fetch(base, { method: "POST", body: body });
        if (!r.ok) throw new Error("HTTP " + r.status);
      });
    }

    // 讀回全部選票並加總
    async function fetchResults() {
      var text = await retry(async function () {
        var r = await fetch(base + "/json?poll=1&since=all");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      });
      var n = cfg.presenters.length, max = cfg.maxScore;
      var rows = cfg.presenters.map(function (name, i) {
        return { index: i, name: name, total: 0, count: 0, dist: new Array(max + 1).fill(0) };
      });
      var seen = {}, ballots = 0, rejected = 0;
      text.split("\n").forEach(function (line) {
        if (!line.trim()) return;
        var m, b;
        try { m = JSON.parse(line); if (m.event !== "message") return; b = JSON.parse(m.message); } catch (e) { return; }
        if (!b || b.v !== 1 || !b.id || seen[b.id] || typeof b.s !== "object") return;
        // 驗證：分數必須是 1~max 的整數、發表人序號必須存在，否則整張作廢
        var keys = Object.keys(b.s);
        var valid = keys.length > 0 && keys.every(function (k) {
          var v = b.s[k];
          return /^\d+$/.test(k) && +k < n && Number.isInteger(v) && v >= 1 && v <= max;
        });
        seen[b.id] = true;
        if (!valid) { rejected++; return; }
        ballots++;
        keys.forEach(function (k) { var r = rows[+k], v = b.s[k]; r.total += v; r.count++; r.dist[v]++; });
      });
      return { rows: rows, ballots: ballots, rejected: rejected };
    }

    return { submitBallot: submitBallot, fetchResults: fetchResults };
  }

  // 依平均分排名；平均分完全相同者並列（用整數交叉相乘，避免浮點誤差）
  function rank(rows, prize) {
    var list = rows.map(function (r) { return Object.assign({}, r, { avg: r.count ? r.total / r.count : 0 }); });
    function cmp(a, b) { // a 比 b 高 → 負值
      if (a.count === 0 && b.count === 0) return 0;
      if (a.count === 0) return 1;
      if (b.count === 0) return -1;
      var l = a.total * b.count, r = b.total * a.count;
      return l === r ? 0 : (l > r ? -1 : 1);
    }
    list.sort(function (a, b) { return cmp(a, b) || a.index - b.index; });
    list.forEach(function (r, i) {
      r.rank = (i > 0 && cmp(list[i - 1], r) === 0) ? list[i - 1].rank : i + 1;
    });
    var winners = list.filter(function (r) { return r.rank === 1 && r.count > 0; });
    var each = winners.length ? Math.round((prize / winners.length) * 100) / 100 : 0;
    return { list: list, winners: winners, each: each };
  }

  var api = { makeClient: makeClient, rank: rank };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RatingCore = api;
})(typeof window !== "undefined" ? window : globalThis);
