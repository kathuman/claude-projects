# Chess for kids

The kids' mode of the [Chess](../) app, for young children. Live:
https://kathuman.github.io/claude-projects/chess/kids/

- **Eight worlds:** one for each piece (Rook Road, Bishop Hill, Queen Castle, King Garden, Knight Forest,
  Pawn Village), then Capture Cave and Checkmate Tower. The worlds open one after the other.
- **Levels:**
  - collect the stars with one piece, with rocks in the way;
  - capture the sleepy black pieces;
  - walk the king to the flag without stepping onto a guarded square (shown in red);
  - walk a pawn to the end, where it becomes a queen;
  - find checkmate in one;
  - "Pawn wars" against a gentle computer.
- **Rewards:**
  - Three stars for finishing in the fewest moves, two for close, one otherwise.
  - Checkmate levels give three stars on the first try.
  - Each world finished earns a trophy, with confetti. The confetti is skipped when the device asks for
    reduced motion.
- **Sir Hop**, the knight, reads every instruction aloud in the chosen language (it can be switched off), and
  little sounds mark stars and wins. **Help** lights up the next square on a shortest way.
- **Six languages,** shared with the course: English, Spanish, Afrikaans, German, Danish and Dutch. The kids'
  wording is in `i18n.js`; the translations were written by Claude, like the course's.
- **Size:** big squares and buttons, readable on a phone.
- **Progress** stays in the browser (`chess-kids-v1`). "Play a real game" opens the play app against Stockfish
  at level 1 with the coach on.

## Files

- `levels.js`: the worlds and levels as data. Each level has a `par`, the fewest moves for three stars.
- `i18n.js`: all words, in six languages.
- `app.js` and `index.html`: the page.
- `../src/kids.js`: the level logic:
  - positions, the hero's legal moves (the real rules, from `../src/rules.js`);
  - breadth-first search for the fewest moves and for Help;
  - the finish test;
  - stars;
  - the pawn-wars computer.

## Tests

`node chess/tests/kids.test.js`:
- Every level is solvable, and its par is exactly the fewest moves, found by search.
- Following Help finishes in par.
- No two things start on the same square, and no king starts in check.
- Each checkmate level is a Lichess puzzle (CC0) with exactly one mating move.
- Computer-against-computer pawn wars always reach a winner.
- Every language has every word.
