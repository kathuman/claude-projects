// Builds chess/puzzles/data/ from the Lichess puzzle database (CC0, https://database.lichess.org/#puzzles).
//   node chess/tests/build-puzzles.js [lichess_db_puzzle.csv.zst | URL]
// The ~300 MB file is streamed and decompressed (Node's built-in zstd) and never stored. Selection, with a
// fixed seed so a rebuild is reproducible:
//   - quality: popularity >= 85, at least 300 plays, rating deviation <= 90;
//   - balance: up to PER_BAND puzzles from every 100-point rating band from 400 to 3000 (reservoir sampling);
//   - coverage: up to PER_THEME puzzles of every theme, so rare themes are there too.
// Every selected puzzle is replayed through src/rules.js: each move must be legal, and "mate" puzzles must
// end in checkmate. Output: one JSON file per 200-point band plus index.json.
const fs = require("fs"), path = require("path"), https = require("https"), zlib = require("zlib"), readline = require("readline");
const R = require("../src/rules.js");
const SRC = process.argv[2] || "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const OUT = path.join(__dirname, "../puzzles/data");
const PER_BAND = 1100, PER_THEME = 250, MIN_R = 400, MAX_R = 3000;

let seed = 20261005;
function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function reservoir(size) { return { size, seen: 0, items: [] }; }
function offer(res, item) {
  res.seen++;
  if (res.items.length < res.size) res.items.push(item);
  else { const j = Math.floor(rand() * res.seen); if (j < res.size) res.items[j] = item; }
}
const bands = {}, themes = {};
let rows = 0, kept = 0;

function input() {
  if (!/^https?:/.test(SRC)) return Promise.resolve(fs.createReadStream(SRC));
  return new Promise((ok, fail) => https.get(SRC, (res) => res.statusCode === 200 ? ok(res) : fail(new Error("HTTP " + res.statusCode))).on("error", fail));
}

// The file is written by pzstd: every zstd frame is preceded by a 12-byte skippable frame holding its
// compressed size. Node's zstd stream rejects skippable frames, so they are cut out here.
const { Transform } = require("stream");
function stripSkippable() {
  let buf = Buffer.alloc(0), need = 0, passthrough = false;
  return new Transform({
    transform(chunk, enc, done) {
      if (passthrough) return done(null, chunk);
      buf = Buffer.concat([buf, chunk]);
      const out = [];
      for (;;) {
        if (need > 0) {
          const n = Math.min(need, buf.length);
          if (!n) break;
          out.push(buf.subarray(0, n)); buf = buf.subarray(n); need -= n;
          continue;
        }
        if (buf.length < 8) break;
        const magic = buf.readUInt32LE(0);
        if ((magic & 0xfffffff0) === 0x184d2a50) {          // skippable frame: magic, size, payload
          const size = buf.readUInt32LE(4);
          if (buf.length < 8 + size) break;
          need = size === 4 ? buf.readUInt32LE(8) : 0;       // pzstd: the next frame's compressed size
          buf = buf.subarray(8 + size);
        } else { passthrough = true; out.push(buf); buf = Buffer.alloc(0); break; } // plain zstd from here on
      }
      done(null, Buffer.concat(out));
    }
  });
}

(async () => {
  const t0 = Date.now();
  const raw = await input();
  const lines = readline.createInterface({ input: raw.pipe(stripSkippable()).pipe(zlib.createZstdDecompress()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (rows++ === 0) continue; // header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
    const f = line.split(",");
    const rating = +f[3], rd = +f[4], pop = +f[5], plays = +f[6];
    if (rating < MIN_R || rating >= MAX_R || pop < 85 || plays < 300 || rd > 90) continue;
    kept++;
    const p = [f[0], f[1], f[2], rating, f[7]];
    const b = Math.floor(rating / 100) * 100;
    offer(bands[b] || (bands[b] = reservoir(PER_BAND)), p);
    f[7].split(" ").forEach((t) => { if (t) offer(themes[t] || (themes[t] = reservoir(PER_THEME)), p); });
    if (rows % 1000000 === 0) console.log((rows / 1e6) + "M rows, " + kept + " pass the quality filter, " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
  }
  // union, checked against the rules
  const all = new Map();
  Object.values(bands).concat(Object.values(themes)).forEach((r) => r.items.forEach((p) => all.set(p[0], p)));
  let bad = 0;
  const good = [];
  for (const p of all.values()) {
    try {
      let pos = R.loadFEN(p[1]).pos;
      if (!pos) throw new Error("FEN");
      const ms = p[2].split(" ");
      for (const u of ms) { const m = R.findMove(pos, u); if (!m) throw new Error("illegal " + u); pos = R.play(pos, m); }
      if (/\bmate\b/.test(p[4]) && !R.isMate(pos)) throw new Error("mate theme without mate");
      good.push(p);
    } catch (e) { bad++; if (bad < 10) console.log("rejected", p[0], e.message); }
  }
  good.sort((a, b) => a[3] - b[3]);
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const index = { source: "Lichess puzzle database (CC0), https://database.lichess.org/#puzzles", built: new Date().toISOString().slice(0, 10),
    selection: "popularity >= 85, >= 300 plays, rating deviation <= 90; up to " + PER_BAND + " per 100-point band 400-2999, up to " + PER_THEME + " per theme",
    format: ["id", "fen (before the opponent's move)", "moves in UCI (the first is the opponent's)", "rating", "themes"],
    total: good.length, bands: [], themes: {} };
  for (let lo = MIN_R; lo < MAX_R; lo += 200) {
    const list = good.filter((p) => p[3] >= lo && p[3] < lo + 200);
    const file = "p" + String(lo).padStart(4, "0") + ".json";
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(list));
    const tc = {};
    list.forEach((p) => p[4].split(" ").forEach((t) => { tc[t] = (tc[t] || 0) + 1; }));
    index.bands.push({ from: lo, to: lo + 200, file, count: list.length, themes: tc });
    Object.keys(tc).forEach((t) => { index.themes[t] = (index.themes[t] || 0) + tc[t]; });
  }
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
  console.log(rows + " rows read, " + kept + " passed the filter, " + good.length + " puzzles written (" + bad + " rejected) in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
})().catch((e) => { console.error(e); process.exit(1); });
