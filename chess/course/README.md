# Chess course

An interactive chess course in five levels, part of the [Chess](../) app. Live:
https://kathuman.github.io/claude-projects/chess/course/

| Level | Lessons |
|---|---|
| Beginner | the board, setting up, rook, bishop, queen, knight, king, pawn, check and checkmate |
| Basic | castling, en passant, promotion, stalemate and draws, piece values, notation, mate in one |
| Intermediate | opening principles, forks, pins, skewers, discovered attacks, back-rank mate, king and queen mate |
| Upper intermediate | pawn structure, outposts, king and pawn endings (opposition), rule of the square, removing the defender, open files |
| Advanced | calculation, the Lucena and Philidor positions, prophylaxis, converting an advantage, how to keep improving |

Each lesson is a short series of steps: explanations on the board, "click every square this piece can reach"
(the answer is computed from the rules), moves to find (with hints, the solution on request, scripted
replies for multi-move tactics, and a warning when a move would give stalemate instead of mate), and quizzes.
Progress is kept in the browser.

## Files

- `course.js` — the lessons as data: positions (FEN), goals and solutions. No wording.
- `i18n/<code>.js` — all wording, by key; `en.js` is the source. Bundled: English, Spanish (`es`),
  Afrikaans (`af`), German (`de`), Danish (`da`), Dutch (`nl`).
- `app.js` — the page: board, steps, progress, languages and speech.
- `../src/rules.js` — the chess rules (the app's move generator, with FEN and SAN), shared with the tests.

## Languages

- **Bundled translations** load on demand. They were written by Claude (AI) and say so on the page;
  corrections from native speakers are welcome.
- **Any other language:** *Other language…* translates every string on the device with the browser's built-in
  Translator API where available (recent Chrome), and keeps the result in the browser; elsewhere the course
  opens through Google Translate.
- The choice is kept in the browser and in the address (`?lang=de`), so links open in the same language.

### Adding a language

1. Copy `i18n/en.js` to `i18n/<code>.js` (an ISO 639-1 code, e.g. `fr`), change the last key on the first
   line to `.fr`, and translate the values — not the keys. Keep `{n}`-style placeholders as they are.
   Set `meta.name` (the language's own name) and `meta.speech` (a BCP 47 voice code, e.g. `fr-FR`), and the
   `piece.*` names, which are used when moves are read aloud.
2. Add `["fr", "Français"]` to `BUNDLED` in `app.js`.
3. Run `node chess/tests/course.test.js`: it fails on unknown or missing keys and on changed placeholders.

Moves are written with piece symbols (♔♕♖♗♘, ♚♛♜♝♞) rather than letters, so they read the same in every
language and are spoken as the language's piece names.

## Audio

*Read aloud* (the speaker button, or the checkbox under the lesson) reads each step with the browser's speech
synthesis, in a voice for the chosen language; *Listen* reads the current step once. If the device has no
voice for that language, the page says so and shows the text only.

## Tests

- `node chess/tests/rules.test.js` — perft (move-path counts) against published values for three standard
  positions, FEN, SAN, mate and stalemate.
- `node chess/tests/course.test.js` — every position parses, every solution is legal, "mate" goals end in
  mate, quiz answers exist, all wording exists in English, and translations use exactly the English keys.
  With `CHROME=<chrome.exe>` and the repo served on :8767, the tactics and endgames are also checked against
  Stockfish (`tests/engine-probe.html`): the expected moves must be best, and other moves that are as good are
  reported.
