// Course checks — run with: node chess/tests/course.test.js
// Every position parses, every solution is legal move by move, "mate" goals end in mate, every
// step has its wording in English, quiz answers exist, and translations use only known keys.
// With CHROME=<chrome.exe> (and the repo served on :8767), the engine-marked puzzles are also
// checked against Stockfish: the expected moves must be best (within 0.4 pawns, or mate), and no
// other move may be as good, so a learner is never told a good move is wrong.
global.self = global;
const fs = require("fs"), path = require("path");
const R = require("../src/rules.js"), O = require("../src/openings.js");
require("../course/course.js");
require("../src/openings-data.js");
const BOOK = O.create(R, self.CHESS_OPENINGS_DATA), playTasks = [];
const dir = path.join(__dirname, "..", "course", "i18n");
fs.readdirSync(dir).filter((f) => f.endsWith(".js")).forEach((f) => require(path.join(dir, f)));
const C = self.CHESS_COURSE, I = self.CHESS_I18N, EN = I.en;
let pass = 0, fail = 0, warn = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const sq = (s) => /^[a-h][1-8]$/.test(s);
const needed = new Set(), engineTasks = [];
let steps = 0, lessons = 0;
for (const lv of C.levels) {
  needed.add("level." + lv.id); needed.add("level." + lv.id + ".desc");
  for (const ls of lv.lessons) {
    lessons++; needed.add("lesson." + ls.id);
    for (const st of ls.steps) {
      steps++; const tag = ls.id + " / " + st.k;
      needed.add(st.k);
      let pos = null;
      if (st.fen) { try { pos = R.fromFEN(st.fen); } catch (e) { check(tag + ": FEN parses", false, e.message); continue; } }
      (st.marks || "").split(/\s+/).filter(Boolean).forEach((m) => check(tag + ": mark " + m, sq(m)));
      (st.arrows || "").split(/\s+/).filter(Boolean).forEach((a) => check(tag + ": arrow " + a, /^[a-h][1-8][a-h][1-8]$/.test(a)));
      if (st.type === "click") { check(tag + ": target square", sq(st.target)); needed.add(st.k + ".hint"); }
      if (st.type === "squares") {
        const [r, c] = R.parseSquare(st.from), piece = pos.board[r][c];
        const n = R.legalMoves(pos).filter((m) => m[0] === r && m[1] === c).length;
        check(tag + ": a piece on " + st.from + " with moves", piece && n > 0, n + " squares");
        needed.add(st.k + ".hint");
      }
      if (st.type === "quiz") {
        check(tag + ": answer index", st.answer >= 0 && st.answer < st.options);
        for (let i = 1; i <= st.options; i++) needed.add(st.k + ".o" + i);
        needed.add(st.k + ".ok");
      }
      if (st.type === "move") {
        needed.add(st.k + ".hint");
        let p = pos, ok = true;
        st.solution.forEach((san, i) => {
          const m = R.findMove(p, san);
          if (!m) { ok = false; check(tag + ": move " + (i + 1) + " " + san + " legal", false, R.toFEN(p)); return; }
          p = R.play(p, m);
        });
        if (ok) check(tag + ": solution legal (" + st.solution.join(" ") + ")", true);
        if (ok && st.goal === "mate") check(tag + ": the line ends in checkmate", R.isMate(p));
        (st.accept || []).forEach((san) => check(tag + ": accepted move " + san + " legal", !!R.findMove(pos, san)));
        // opening drills: the line stays in the Lichess opening catalogue and reaches the opening it names
        if (ok && st.drill) {
          let q = pos, inBook = true; const seen = [q];
          st.solution.forEach((san) => { const m = R.findMove(q, san); if (!BOOK.inBook(q, R.toUCI(m))) inBook = false; q = R.play(q, m); seen.push(q); });
          const name = (BOOK.opening(seen) || {}).name || "";
          if (st.book !== false) check(tag + ": the drill line is in the opening catalogue", inBook);
          check(tag + ": the drill reaches the " + st.opening, name.indexOf(st.opening) >= 0, name);
        }
        if (st.engine) engineTasks.push({ tag, fen: st.fen, expected: [st.solution[0]].concat(st.accept || []).map((s) => R.toUCI(R.findMove(pos, s))), mate: st.goal === "mate" });
      }
      if (st.type === "play") {
        let pieces = 0; pos.board.forEach((row) => row.forEach((x) => { if (x) pieces++; }));
        const cs = pos.castling, legal = R.loadFEN(st.fen);
        check(tag + ": a tablebase position (7 pieces or fewer, no castling, legal)", pieces <= 7 && !cs.K && !cs.Q && !cs.k && !cs.q && !legal.error, pieces + " pieces");
        check(tag + ": goal is win or draw", st.goal === "win" || (st.goal === "draw" && st.moves > 0));
        playTasks.push({ tag, fen: st.fen, goal: st.goal });
      }
      if (st.link) needed.add(st.k + ".link");
    }
  }
}
const missing = [...needed].filter((k) => !(k in EN));
check(`English has the wording for all ${needed.size} keys of ${lessons} lessons and ${steps} steps`, missing.length === 0, missing.slice(0, 10).join(", "));
const known = new Set(Object.keys(EN));
for (const [lang, T] of Object.entries(I)) {
  if (lang === "en") continue;
  const extra = Object.keys(T).filter((k) => !known.has(k)), untranslated = [...known].filter((k) => !(k in T));
  check(`${lang} (${T["meta.name"]}): no unknown keys`, extra.length === 0, extra.slice(0, 5).join(", "));
  check(`${lang}: every key translated`, untranslated.length === 0, untranslated.length + " missing: " + untranslated.slice(0, 5).join(", "));
  // the same {placeholders} as English
  const ph = Object.keys(T).filter((k) => EN[k] && (EN[k].match(/\{\w+\}/g) || []).sort().join() !== (T[k].match(/\{\w+\}/g) || []).sort().join());
  check(`${lang}: placeholders match English`, ph.length === 0, ph.join(", "));
}

(async () => {
  // with NET=1: the tablebase agrees that each ending is a win (or a draw) for the side to move
  if (process.env.NET) {
    for (const t of playTasks) {
      const r = await fetch("https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(t.fen)).then((x) => x.json()).catch(() => null);
      const cat = r && r.category, want = t.goal === "win" ? ["win"] : ["draw", "blessed-loss", "cursed-win"];
      check(`${t.tag}: the tablebase says ${t.goal} for the learner`, want.includes(cat), cat);
      await new Promise((res) => setTimeout(res, 400));
    }
  } else console.log("(set NET=1 to also check the endings with the Lichess tablebase)");
  if (process.env.CHROME) {
    const { chromium } = require("playwright");
    const b = await chromium.launch({ executablePath: process.env.CHROME });
    const pg = await b.newPage();
    await pg.goto(process.env.PROBE || "http://127.0.0.1:8767/chess/tests/engine-probe.html");
    for (const t of engineTasks) {
      const pos = R.fromFEN(t.fen), n = Math.min(R.legalMoves(pos).length, 40);
      const r = await pg.evaluate(([f, n]) => window.analyse(f, 16, n), [t.fen, n]);
      const score = (l) => (l.mate !== null ? (l.mate > 0 ? 100000 - l.mate : -100000 - l.mate) : l.cp);
      const best = score(r.lines[0]);
      const byMove = Object.fromEntries(r.lines.map((l) => [l.pv[0], score(l)]));
      // as good as the best: the same forced mate, both decisively winning (over +6), or within 0.4 pawns
      const good = (s) => (best > 50000 ? s > 50000 && best - s <= 3 : best >= 600 ? s >= 600 : best - s <= 40);
      const bad = t.expected.filter((u) => !(u in byMove) || !good(byMove[u]));
      check(`${t.tag}: expected move(s) ${t.expected.join("/")} are best by Stockfish`, bad.length === 0, bad.map((u) => u + " " + (byMove[u] ?? "?")).join(", ") + " · best " + r.lines[0].pv[0] + " " + best);
      const rivals = Object.keys(byMove).filter((u) => !t.expected.includes(u) && good(byMove[u]));
      if (rivals.length) { warn++; console.log(`note ${t.tag}: also as good: ${rivals.join(", ")}`); }
    }
    await b.close();
  } else console.log("(set CHROME to also check the puzzles against Stockfish)");
  console.log(`${pass}/${pass + fail} checks passed` + (warn ? ` · ${warn} notes` : ""));
  process.exit(fail ? 1 : 0);
})();
