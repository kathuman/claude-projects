// Motif detection and learner-profile checks — run with: node chess/tests/profile.test.js
const R = require("../src/rules.js"), M = require("../src/motifs.js"), F = require("../src/profile.js"), P = require("../src/puzzles.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const motif = (fen, san) => { const p = R.fromFEN(fen); return M.detect(R, p, R.findMove(p, san)); };

// one position per motif
const cases = [
  ["knight fork (Nc7+ wins the rook)", "r3k3/6pp/8/1N6/8/8/PP6/4K3 w - - 0 1", "Nc7+", "fork"],
  ["hanging piece (Rxd5 takes a loose queen)", "4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", "Rxd5", "hangingPiece"],
  ["pin (Bb5 pins the knight to the king)", "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", "Bb5", "pin"],
  ["skewer (Re1+ through the king to the queen)", "4q3/8/8/4k3/8/8/8/R5K1 w - - 0 1", "Re1+", "skewer"],
  ["back-rank mate", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "Rd8#", "backRankMate"],
  ["smothered mate", "6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1", "Nf7#", "smotheredMate"],
  ["discovered check (the knight steps off the e-file)", "4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1", "Nc5", "discoveredCheck"],
  ["promotion", "8/4P3/8/8/8/8/k7/4K3 w - - 0 1", "e8=Q", "promotion"],
];
cases.forEach(([name, fen, san, want]) => { const got = motif(fen, san); check("motif: " + name, got.includes(want), got.join(",")); });
check("motif: a quiet opening move has none", motif(R.START_FEN, "e4").length === 0);
check("motif: a defended piece isn't hanging", !motif("4k3/4p3/3q4/8/8/8/3R4/4K3 w - - 0 1", "Rxd6").includes("hangingPiece"));
check("motif: a fork onto defended pawns isn't a fork", !motif("4k3/8/2p1p3/8/3N4/8/8/4K3 w - - 0 1", "Nb5").includes("fork"));
check("mate themes are capped at 5", M.mateTheme(1) === "mateIn1" && M.mateTheme(-3) === "mateIn3" && M.mateTheme(9) === "mateIn5");

// spaced repetition
const DAY = F.DAY, t0 = Date.UTC(2026, 9, 5, 12);
let prof = F.fresh();
const puz = ["abc", "6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1", "g8f8 d1d8", 900, "mateIn1"];
F.srsAdd(prof, puz, t0);
check("srs: a missed puzzle is due tomorrow, not today", F.srsDue(prof, t0).length === 0 && F.srsDue(prof, t0 + DAY).length === 1);
let t = t0 + DAY, steps = [];
for (let i = 0; i < 6; i++) { const r = F.srsResult(prof, "abc", true, t); steps.push(r); if (prof.srs.abc) t = prof.srs.abc.due; }
check("srs: solved again and again it climbs through 3, 7, 16, 35 days, then is learned", steps.join(" ") === "up up up up learned ", steps.join(" "));
F.srsAdd(prof, puz, t0); F.srsResult(prof, "abc", true, t0 + DAY); F.srsResult(prof, "abc", false, t0 + 5 * DAY);
check("srs: a miss sends it back to box 0, due the next day", prof.srs.abc.box === 0 && prof.srs.abc.due === t0 + 6 * DAY);
check("srs: upcoming counts by day", F.srsUpcoming(prof, t0, 7)[6] === 1);

// ISO weeks
check("week key: Monday 5 Oct 2026 is 2026-W41", F.weekKey(t0) === "2026-W41", F.weekKey(t0));
check("week key: Friday 1 Jan 2027 still belongs to 2026-W53", F.weekKey(Date.UTC(2027, 0, 1)) === "2026-W53", F.weekKey(Date.UTC(2027, 0, 1)));
check("week start is Monday 00:00 UTC", F.weekStart(Date.UTC(2026, 9, 8, 15)) === Date.UTC(2026, 9, 5));

// mistakes from a review: fool's mate, 2. g4?? allows mate in one
let pos = R.fromFEN(R.START_FEN); const positions = [pos], ucis = ["f2f3", "e7e5", "g2g4", "d8h4"];
ucis.forEach((u) => { pos = R.play(pos, R.fromUCI(pos, u)); positions.push(pos); });
const ev = (cp) => ({ cp, mate: null });
const rv = { positions, evals: [ev(20), ev(-60), ev(-70), { cp: -99999, mate: -1 }, { cp: -100000, mate: null, over: true }], best: ["e2e4", "e7e5", "e2e4", "d8h4", null], kinds: ["inaccuracy", "best", "blunder", "best"] };
const ms = F.gameMistakes(R, M, rv, ucis, "w");
check("game mistakes: only the learner's mistakes and blunders", ms.length === 1 && ms[0].ply === 2 && ms[0].kind === "blunder");
check("game mistakes: 2. g4 allowed a mate in one", ms[0].allowed.includes("mateIn1"), ms[0].allowed.join(","));
const own = F.mistakePuzzle(R, rv, ucis, ms[0], 1300);
let s = P.start(R, own); P.advance(R, s);
check("a game mistake becomes a puzzle: the opponent's move, then find the right move", own[2] === "e7e5 e2e4" && P.tryMove(R, s, R.fromUCI(s.pos, "e2e4")) === "solved" && /yourGame/.test(own[4]), own.join(" | "));
check("…and none for a mistake on the first move", F.mistakePuzzle(R, rv, ucis, { ply: 0, missed: [] }) === null);

// strengths, weaknesses and the plan
prof = F.fresh();
const store = { themes: { fork: [2, 9], pin: [9, 10], short: [3, 10], mateIn1: [1, 1] } };
F.logGame(prof, { t: t0 - DAY, side: "w", mistakes: [{ ply: 10, kind: "blunder", allowed: ["fork"], missed: [] }, { ply: 20, kind: "mistake", allowed: [], missed: ["skewer"] }] });
F.logGame(prof, { t: t0 - 40 * DAY, side: "w", mistakes: [{ ply: 5, kind: "blunder", allowed: ["pin"], missed: [] }] });
const stats = F.themeStats(prof, store, t0);
check("themes: forks are the weakest (2/9 in puzzles, allowed in a game)", stats[0].theme === "fork", stats.slice(0, 3).map((e) => e.theme + " " + e.score.toFixed(2)).join(", "));
check("themes: length tags like 'short' are not ideas", !stats.some((e) => e.theme === "short"));
check("themes: pin 9/10 is a strength; a 40-day-old game mistake no longer counts", stats.find((e) => e.theme === "pin").strong);
check("themes: one puzzle doesn't make a weakness", stats.find((e) => e.theme === "mateIn1").score < 0.12);
F.srsAdd(prof, puz, t0);
const plan = F.makePlan(prof, store, ["board", "forks", "pins"], { board: true }, t0);
const kinds = plan.items.map((i) => i.kind + (i.theme ? ":" + i.theme : i.lesson ? ":" + i.lesson : ""));
check("plan: fork puzzles first, the forks lesson, due reviews, games", kinds[0] === "puzzles:fork" && kinds.includes("lesson:forks") && kinds.includes("review") && kinds[kinds.length - 1] === "games", kinds.join(" "));
check("plan: says why", /allowed 1 in your games/.test(plan.items[0].why) && /22%/.test(plan.items[0].why), plan.items[0].why);
const starter = F.makePlan(F.fresh(), { themes: {} }, ["board", "setup"], {}, t0).items.map((i) => i.kind + (i.lesson ? ":" + i.lesson : ""));
check("plan for a new learner: rated puzzles, the first lesson, daily puzzles, games", starter.join(" ") === "rated lesson:board daily games", starter.join(" "));
F.logPuzzle(prof, ["x1", "", "", 1500, "fork short"], true, "theme", t0 + 1000);
F.logPuzzle(prof, ["x2", "", "", 1500, "fork"], false, "theme", t0 + 2000);
F.logPuzzle(prof, ["x3", "", "", 1500, "fork"], true, "review", t0 + 3000);
F.logPuzzle(prof, ["x4", "", "", 1500, "fork"], true, "theme", t0 - 3 * DAY); // last week
F.logGame(prof, { t: t0 + 5000, side: "b", mistakes: [] });
const prog = F.planProgress(prof, plan, { forks: true }, t0 + 6000);
check("plan progress: one clean fork solve this week (not the review, not last week), no skewers yet, the lesson, a review, a game", JSON.stringify(prog) === "[1,0,1,1,1]", JSON.stringify(prog) + " for " + kinds.join(" "));

// coach
prof = F.fresh();
check("coach: full until three calm games in a row", F.coachAfterGame(prof, 1) === null && F.coachAfterGame(prof, 0) === null && F.coachAfterGame(prof, 1) === "light" && prof.coach.level === "light");
check("coach: back to full after a rough game", F.coachAfterGame(prof, 2) === null && F.coachAfterGame(prof, 5) === "full");

// storage round trip
const mem = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
F.save(mem, prof);
check("profile saves and loads", F.load(mem).coach.level === "full" && F.load({ getItem: () => "garbage" }).v === 1);
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
