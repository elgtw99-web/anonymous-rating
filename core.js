// 核心邏輯：投票上傳、加總、排名。瀏覽器與 Node 測試共用。
// 每張評分 = 一則匿名訊息（只含各項分數＋隨機編號），上傳到 ntfy.sh 主題；
// 結果頁一次讀回所有訊息、去除重複編號與已撤回的票後加總。
(function (root) {
  function makeClient(cfg, topicOverride) {
    var topic = topicOverride || cfg.topic;
    var base = cfg.server.replace(/\/$/, "") + "/" + topic;
    var K = cfg.criteria.length, MIN = cfg.minScore || 0, MAX = cfg.maxScore;

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
    async function post(obj) {
      var body = JSON.stringify(obj);
      await retry(async function () {
        var r = await fetch(base, { method: "POST", body: body });
        if (!r.ok) throw new Error("HTTP " + r.status);
      });
    }

    // 送出對某位發表人的一張評分：scores = [內容分, 發表分, 心得分]，回傳選票編號
    async function submitVote(presenterIndex, scores) {
      var id = newId();
      await post({ v: 2, id: id, p: presenterIndex, s: scores });
      return id;
    }
    // 撤回（選錯人時）：該票不再計入加總
    async function retractVote(id) { await post({ v: 2, retract: id }); }

    function validVote(b) {
      return Number.isInteger(b.p) && b.p >= 0 && b.p < cfg.presenters.length &&
        Array.isArray(b.s) && b.s.length === K &&
        b.s.every(function (v) { return Number.isInteger(v) && v >= MIN && v <= MAX; });
    }

    async function fetchResults() {
      var text = await retry(async function () {
        var r = await fetch(base + "/json?poll=1&since=all");
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      });
      var rows = cfg.presenters.map(function (name, i) {
        return { index: i, name: name, total: 0, count: 0, crit: new Array(K).fill(0) };
      });
      var retracted = {}, msgs = [], seen = {}, votes = 0, rejected = 0;
      text.split("\n").forEach(function (line) {
        if (!line.trim()) return;
        try {
          var m = JSON.parse(line); if (m.event !== "message") return;
          var b = JSON.parse(m.message);
          if (b && b.v === 2) { if (b.retract) retracted[b.retract] = true; else msgs.push(b); }
        } catch (e) {}
      });
      msgs.forEach(function (b) {
        if (!b.id || seen[b.id]) return;
        seen[b.id] = true;
        if (retracted[b.id]) return;
        if (!validVote(b)) { rejected++; return; }
        var r = rows[b.p];
        r.count++; votes++;
        b.s.forEach(function (v, k) { r.crit[k] += v; r.total += v; });
      });
      return { rows: rows, votes: votes, rejected: rejected };
    }
    return { submitVote: submitVote, retractVote: retractVote, fetchResults: fetchResults };
  }

  // 依「平均總分」排名（每位發表人的評分人數可能不同，用平均較公平）；
  // 平均完全相同者並列（整數交叉相乘，避免浮點誤差）
  function rank(rows, prize) {
    var list = rows.map(function (r) { return Object.assign({}, r, { avg: r.count ? r.total / r.count : 0 }); });
    function cmp(a, b) {
      if (a.count === 0 && b.count === 0) return 0;
      if (a.count === 0) return 1;
      if (b.count === 0) return -1;
      var l = a.total * b.count, r = b.total * a.count;
      return l === r ? 0 : (l > r ? -1 : 1);
    }
    list.sort(function (a, b) { return cmp(a, b) || a.index - b.index; });
    list.forEach(function (r, i) { r.rank = (i > 0 && cmp(list[i - 1], r) === 0) ? list[i - 1].rank : i + 1; });
    var winners = list.filter(function (r) { return r.rank === 1 && r.count > 0; });
    var each = winners.length ? Math.round((prize / winners.length) * 100) / 100 : 0;
    return { list: list, winners: winners, each: each };
  }

  var api = { makeClient: makeClient, rank: rank };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RatingCore = api;
})(typeof window !== "undefined" ? window : globalThis);
