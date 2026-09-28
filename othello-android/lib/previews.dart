// Widget Preview entries — viewed with `flutter widget-preview start` from
// this project's directory (Flutter's built-in previewer, not a pub
// package). Nothing here runs in the shipped app; it exists purely for
// `flutter widget-preview`.
//
// See https://flutter.dev/to/widget-previews

import 'package:flutter/material.dart';
import 'package:flutter/widget_previews.dart';

import 'game/othello_logic.dart';
import 'main.dart';
import 'ui/board_view.dart';

/// The whole app, exactly as it boots on a device.
@Preview(name: 'Othello — full app')
Widget previewApp() => const OthelloApp();

/// Wraps a bare widget (like [BoardView], which expects to sit inside a
/// Material/Directionality tree) in a minimal scaffold for isolated preview.
/// Referenced by the annotations below, so it must stay public and static.
Widget boardPreviewWrapper(Widget child) => MaterialApp(
      home: Scaffold(
        body: Center(child: Padding(padding: const EdgeInsets.all(24), child: child)),
      ),
    );

/// A midgame position: black has just played (4,2), flipping white's disc
/// at (3,2) — used so the preview shows discs of both colours, legal-move
/// hints, and the last-move ring all at once instead of the plain opening.
Board _sampleMidgame() {
  final board = Board.initial(8);
  board.applyMove(2, 3, black); // opening move
  board.applyMove(2, 2, white);
  board.applyMove(4, 2, black); // flips (3,2)
  return board;
}

/// The board on its own, in both themes — the part of the app worth
/// checking pixel-by-pixel without spinning up the whole game/AI.
@Preview(name: 'Board — light', brightness: Brightness.light, wrapper: boardPreviewWrapper, size: Size(380, 380))
@Preview(name: 'Board — dark', brightness: Brightness.dark, wrapper: boardPreviewWrapper, size: Size(380, 380))
Widget previewBoard() {
  final board = _sampleMidgame();
  return BoardView(
    board: board,
    legalMoves: board.legalMoves(white),
    showHints: true,
    turn: white,
    lastMove: (r: 4, c: 2),
    discTheme: kDiscThemes['Classic']!,
    boardTheme: kBoardThemes['Felt green']!,
    accent: const Color(0xFFC15F3C),
    onTapCell: (r, c) {},
  );
}

/// Same position, rendered with each of the six board felts, to spot-check
/// the palette in one pass.
@Preview(name: 'Board — Walnut', wrapper: boardPreviewWrapper, size: Size(320, 320))
Widget previewBoardWalnut() => _themedBoard(boardTheme: 'Walnut', discTheme: 'Sunset');

@Preview(name: 'Board — Slate', wrapper: boardPreviewWrapper, size: Size(320, 320))
Widget previewBoardSlate() => _themedBoard(boardTheme: 'Slate', discTheme: 'Ocean');

@Preview(name: 'Board — Charcoal', wrapper: boardPreviewWrapper, size: Size(320, 320))
Widget previewBoardCharcoal() => _themedBoard(boardTheme: 'Charcoal', discTheme: 'Neon');

Widget _themedBoard({required String boardTheme, required String discTheme}) {
  final board = _sampleMidgame();
  return BoardView(
    board: board,
    legalMoves: const [],
    showHints: false,
    turn: white,
    lastMove: (r: 4, c: 2),
    discTheme: kDiscThemes[discTheme]!,
    boardTheme: kBoardThemes[boardTheme]!,
    accent: const Color(0xFFC15F3C),
    onTapCell: (r, c) {},
  );
}
