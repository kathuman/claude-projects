# My training

The learner's dashboard for the [Chess](../) app. Live: https://kathuman.github.io/claude-projects/chess/train/

- **This week's plan:**
  - puzzles for your three weakest themes;
  - the course lesson behind the weakest;
  - the spaced-repetition reviews due;
  - three games against Stockfish with the coach.

  A plan is made on the first visit each week, or on request, and its progress counts this week's clean solves,
  finished lessons and reviewed games. A new learner gets a starter plan.
- **Strengths and weaknesses by theme** come from two sources: puzzle results, and your reviewed games against
  Stockfish. In those games, each mistake is checked for the tactic it allowed and the tactic it missed.
- **Spaced repetition:** puzzles you missed, and your own game mistakes turned into puzzles, come back after 1, 3,
  7, 16 and 35 days. They're solved in the puzzles page's Review mode.
- **Recent games**, with what each mistake allowed or missed, and a link to replay the game.
- **The coach** and its level.

Everything stays in the browser:

| Key | Holds |
|---|---|
| `chess-profile-v1` | games, reviews, plan and coach |
| `chess-puzzles-v1` | the puzzle rating |
| `chess-course-progress` | lessons done |

## How it fits together

- `../src/profile.js` holds the profile and its logic:
  - logging;
  - the Leitner boxes for spaced repetition;
  - per-theme scores (puzzle success against a 75% expectation, plus game mistakes from the last 30 days);
  - the weekly plan;
  - the rule that steps the coach back to Light after three games with at most one warning, and back to full after
    a game with four or more.
- `../src/motifs.js` names the tactic in a move, using Lichess's theme names: fork, pin, skewer, hanging piece,
  discovered attack or check, back-rank, smothered and other mates, promotion.
  - It was tuned against the theme labels of about 11,000 Lichess puzzles, scoring the first solving move,
    as review uses it.
  - Precision (how often Lichess agrees when it names a tactic): hanging piece 62%, pin 75%, skewer 76%,
    discovered check 96%, smothered mate and promotion 100%.
  - Fork (64%) and discovered attack (57%) are lower partly because Lichess labels only a puzzle's main idea.
- The play app writes a game into the profile when its review finishes. Each mistake becomes a puzzle: the
  opponent's previous move, then the move you should have played.

## Tests

`node chess/tests/profile.test.js`:
- one hand-built position per tactic;
- the spaced-repetition schedule;
- ISO weeks;
- the fool's mate review turned into themes and a puzzle;
- theme scores;
- the plan and its progress;
- the coach's level changes.
