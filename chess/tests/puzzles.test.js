// Puzzle logic and puzzle data checks — run with: node chess/tests/puzzles.test.js
const fs = require("fs"), path = require("path");
const R = require("../src/rules.js"), P = require("../src/puzzles.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

// Glicko-2: Glickman's worked example (rating 1500, RD 200, σ 0.06 against three opponents) can't be run
// one game at a time, so check the properties instead
const me = { r: 1500, rd: 200, vol: 0.06 };
const win = P.rate(me, 1500, 1), loss = P.rate(me, 1500, 0);
check("a win against an equal puzzle raises the rating, a loss lowers it by the same amount", win.r > 1500 && loss.r < 1500 && Math.abs((win.r - 1500) + (loss.r - 1500)) < 0.2, win.r + " / " + loss.r);
check("deviation shrinks after a result", win.rd < 200 && loss.rd < 200, win.rd.toFixed(1));
const upset = P.rate(me, 2100, 1), easy = P.rate(me, 900, 1);
check("solving a hard puzzle gains more than an easy one", upset.r - 1500 > 3 * (easy.r - 1500), (upset.r - 1500).toFixed(1) + " vs " + (easy.r - 1500).toFixed(1));
let r = P.newRating();
for (let i = 0; i < 60; i++) r = P.rate(r, 1800, i % 3 === 2 ? 0 : 1); // solving 2/3 of 1800 puzzles
check("solving 2/3 of 1800-rated puzzles settles near 1800 + 120", r.r > 1820 && r.r < 2020 && r.rd < 90, r.r.toFixed(0) + " ± " + r.rd.toFixed(0));
check("expected score is 0.5 at equal ratings", Math.abs(P.expected({ r: 1500, rd: 60 }, 1500) - 0.5) < 1e-9);

// solving: Lichess-format puzzle (the opponent moves first)
const puz = ["t1", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1", "g8f8 d1d8", 900, "mateIn1 backRankMate"];
let s = P.start(R, puz);
check("start: the solver is the side not to move in the FEN", s.side === "w");
P.advance(R, s);
check("the opponent's first move is played by the puzzle", s.pos.turn === "w" && s.ply === 1);
check("a wrong move fails", P.tryMove(R, Object.assign({}, s), R.findMove(s.pos, "Rd7")) === "wrong");
check("the solution solves", P.tryMove(R, s, R.findMove(s.pos, "Rd8")) === "solved" && s.done);
// any mate counts: two rooks, two mating moves
const two = ["t2", "6k1/5ppp/8/8/8/8/1R3PPP/R5K1 b - - 0 1", "g8h8 a1a8", 900, "mateIn1"];
s = P.start(R, two); P.advance(R, s);
check("any checkmate is accepted, not only the listed one (Rb8# for Ra8#)", P.tryMove(R, s, R.findMove(s.pos, "Rb8")) === "solved");
// multi-move: right then the reply
const multi = ["t3", "r5k1/5ppp/8/8/8/8/5PPP/R2R2K1 b - - 0 1", "h7h6 d1d8 a8d8 a1d1", 1000, "short"];
s = P.start(R, multi); P.advance(R, s);
check("a right move that isn't the end", P.tryMove(R, s, R.findMove(s.pos, "Rd8+")) === "right" && !s.done);
P.advance(R, s);
check("…after the reply, the last move solves", P.tryMove(R, s, R.findMove(s.pos, "Rd1")) === "solved");

// choosing
const list = [["a", "", "", 1000, ""], ["b", "", "", 1050, ""], ["c", "", "", 1500, "fork"], ["d", "", "", 2400, ""]];
check("pick: nearest unseen puzzle", P.pick(list, 1020, {}, () => 0)[0] === "a" && P.pick(list, 1020, { a: 1 }, () => 0)[0] === "b");
check("pick: the window widens when nothing is close", P.pick(list, 2000, {}, () => 0)[0] === "d");
check("pick: with a filter (theme)", P.pick(list, 1000, {}, () => 0, (p) => /fork/.test(p[4]))[0] === "c");
check("pick: nothing left → null", P.pick(list, 1000, { a: 1, b: 1, c: 1, d: 1 }) === null);
check("daily puzzle: same for a date, different across dates", P.dailyIndex("2026-10-05", 1000) === P.dailyIndex("2026-10-05", 1000) && P.dailyIndex("2026-10-05", 1000) !== P.dailyIndex("2026-10-06", 1000));
check("timed run: difficulty climbs, capped", P.runTarget(0) === 700 && P.runTarget(10) === 1400 && P.runTarget(100) === 2600);

// the shipped data, if built
const dir = path.join(__dirname, "../puzzles/data");
if (fs.existsSync(path.join(dir, "index.json"))) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  check("index: bands cover 400–3000", index.bands[0].from === 400 && index.bands[index.bands.length - 1].to === 3000);
  check("bandsFor picks its band and the nearer neighbour", P.bandsFor(index, 1450).map((b) => b.from).join() === "1400,1200" && P.bandsFor(index, 1550).map((b) => b.from).join() === "1400,1600");
  let total = 0, bad = 0, wrongBand = 0, ids = new Set(), dup = 0;
  for (const b of index.bands) {
    const ps = JSON.parse(fs.readFileSync(path.join(dir, b.file), "utf8"));
    total += ps.length;
    for (const p of ps) {
      if (ids.has(p[0])) dup++; ids.add(p[0]);
      if (p[3] < b.from || p[3] >= b.to) wrongBand++;
      // replay a sample of each band fully through the puzzle logic
      if (Math.random() < 0.08) {
        const st = P.start(R, p); P.advance(R, st);
        while (!st.done) {
          const res = P.tryMove(R, st, R.findMove(st.pos, st.moves[st.ply]));
          if (res === "wrong") { bad++; break; }
          if (res === "right") P.advance(R, st);
        }
      }
    }
  }
  check("data: " + total + " puzzles, matching index.json", total === index.total);
  check("data: every puzzle is in its rating band, no duplicates", wrongBand === 0 && dup === 0, wrongBand + " / " + dup);
  check("data: a sample replays to the end through the puzzle logic", bad === 0, bad + " failures");
  const want = ["fork", "pin", "skewer", "discoveredAttack", "backRankMate", "mateIn1", "mateIn2", "rookEndgame", "pawnEndgame", "promotion", "capturingDefender", "deflection"];
  check("data: every theme the course links to has at least 150 puzzles", want.every((t) => (index.themes[t] || 0) >= 150), want.map((t) => t + " " + (index.themes[t] || 0)).join(", "));
} else console.log("(no puzzle data built yet: skipping the data checks)");
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
