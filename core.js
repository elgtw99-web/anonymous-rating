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
    async function post(obj) {
      var body = JSON.stringify(obj);
      await retry(async function () {
        var r = await fetch(base, { method: "POST", body: body });
        if (!r.ok) throw new Error("HTTP " + r.status);
      });
    }
    async function submitBallot(scores) {
      var id = newId();
      await post({ v: 1, id: id, s: scores });
      return id;
    }
    // 撤回先前送出的選票（選錯人時使用）：該票不再計入加總
    async function retractBallot(id) { await post({ v: 1, retract: id }); }

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
      var seen = {}, ballots = 0, rejected = 0, retracted = {}, msgs = [];
      text.split("\n").forEach(function (line) {
        if (!line.trim()) return;
        try {
          var m = JSON.parse(line); if (m.event !== "message") return;
          var b0 = JSON.parse(m.message);
          if (b0 && b0.v === 1) { if (b0.retract) retracted[b0.retract] = true; else msgs.push(b0); }
        } catch (e) {}
      });
      msgs.forEach(function (b) {
        if (!b.id || seen[b.id] || typeof b.s !== "object" || b.s === null) return;
        if (retracted[b.id]) { seen[b.id] = true; return; }
        // 驗證：分數必須是 min~max 的整數、發表人序號必須存在，否則整張作廢
        var keys = Object.keys(b.s);
        var valid = keys.length > 0 && keys.every(function (k) {
          var v = b.s[k];
          return /^\d+$/.test(k) && +k < n && Number.isInteger(v) && v >= (cfg.minScore || 0) && v <= max;
        });
        seen[b.id] = true;
        if (!valid) { rejected++; return; }
        ballots++;
        keys.forEach(function (k) { var r = rows[+k], v = b.s[k]; r.total += v; r.count++; r.dist[v]++; });
      });
      return { rows: rows, ballots: ballots, rejected: rejected };
    }

    return { submitBallot: submitBallot, retractBallot: retractBallot, fetchResults: fetchResults };
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
