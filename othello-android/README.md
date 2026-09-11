# Othello — Android

A native Android build of Othello (Reversi), built with [Flutter](https://flutter.dev).
Play against a heuristic computer opponent (four strengths) or pass-and-play
with a friend, on a 6×6, 8×8 or 10×10 board.

This is the same rules/AI as the [web version](../othello/index.html) on this
site, ported from JavaScript to Dart — see "How the code is built" for the
correspondence.

## Features

- Full Othello rules: legal-move hints, flip animation-free but visually
  clear disc rendering, automatic pass when a side has no legal move,
  game-over detection.
- Opponent: computer (negamax search with alpha-beta pruning over a
  positional weight table, corner and mobility heuristics) or 2-player
  hotseat.
- Board size 6×6 / 8×8 / 10×10 — the AI rebuilds its positional map and
  search depth to match.
- Four computer strengths: Easy (mostly random), Medium, Hard, Expert
  (searches deeper and fully solves the endgame once few squares remain).
- Undo (steps back a full round so it's always your turn again), move log,
  live disc counts, hint toggle.
- Six disc colourways and six board felts, matching the web version's
  palette.
- Light/dark theme toggle (Material 3).

## Project layout

```
lib/
  game/
    othello_logic.dart    — pure board rules (Board, legal moves, flips)
    othello_ai.dart        — evaluate() / negamax() / chooseAiMove()
    game_controller.dart   — mutable session: turns, history/undo, move log
  ui/
    board_view.dart        — CustomPainter board renderer + disc/board themes
  main.dart                 — app shell, settings panel, score/move-log UI
test/
  othello_logic_test.dart  — rules + AI unit tests
  widget_test.dart          — boots the app, plays a move
assets/icon/                — source images for the launcher icon
  (flutter_launcher_icons generates the actual mipmaps into android/app/src/main/res)
```

`game/` has zero Flutter imports — it's plain Dart, unit-testable without a
widget tree, and is the direct counterpart of the `BOARD LOGIC` / `AI`
sections in `othello/index.html`'s script.

## Building

Requires the [Flutter SDK](https://docs.flutter.dev/get-started/install) and
an Android SDK with a platform + build-tools installed (`flutter doctor`
checks this). From this directory:

```bash
flutter pub get
flutter build apk --release      # -> build/app/outputs/flutter-apk/app-release.apk
```

Install directly on a connected/USB-debugging-enabled phone:

```bash
flutter install --release
```

or copy `app-release.apk` to the phone and open it (enable "Install unknown
apps" for whatever app you transfer it through — Files, a chat app, etc.).
It's signed with the Flutter debug keystore, which is fine for sideloading
but not for a Play Store listing — add a real signing config in
`android/app/build.gradle.kts` before publishing.

Regenerate the launcher icon after changing `assets/icon/icon*.png`:

```bash
dart run flutter_launcher_icons
```

## Testing

```bash
flutter analyze
flutter test
```
