// ============================================================================
// Renders the board as one CustomPainter: felt squares, legal-move dots,
// discs with a radial "3D" gradient, and a ring on the last move. Taps are
// mapped from local offset back to a (row, col) cell.
// ============================================================================

import 'package:flutter/material.dart';

import '../game/othello_logic.dart';

class DiscTheme {
  final List<Color> black;
  final List<Color> white;
  final Color blackEdge;
  final Color whiteEdge;
  const DiscTheme({
    required this.black,
    required this.white,
    required this.blackEdge,
    required this.whiteEdge,
  });
}

class BoardTheme {
  final Color a, b, line;
  const BoardTheme({required this.a, required this.b, required this.line});
}

const kDiscThemes = <String, DiscTheme>{
  'Classic': DiscTheme(
    black: [Color(0xFF6A6A6A), Color(0xFF101010)],
    white: [Color(0xFFFFFFFF), Color(0xFFF2EFE6)],
    blackEdge: Color(0xFF000000),
    whiteEdge: Color(0xFFC9C4B6),
  ),
  'Jade': DiscTheme(
    black: [Color(0xFF34A37D), Color(0xFF0C5C43)],
    white: [Color(0xFFFFFFFF), Color(0xFFEFE7D2)],
    blackEdge: Color(0xFF063B2B),
    whiteEdge: Color(0xFFC7BB98),
  ),
  'Sunset': DiscTheme(
    black: [Color(0xFFE0574A), Color(0xFFB12F24)],
    white: [Color(0xFFFFE1A6), Color(0xFFE6A93A)],
    blackEdge: Color(0xFF7C1C15),
    whiteEdge: Color(0xFFB9822A),
  ),
  'Ocean': DiscTheme(
    black: [Color(0xFF3F6FAE), Color(0xFF1C3F6E)],
    white: [Color(0xFFEAF6F2), Color(0xFFBFE0D7)],
    blackEdge: Color(0xFF122A4C),
    whiteEdge: Color(0xFF8FBAAD),
  ),
  'Neon': DiscTheme(
    black: [Color(0xFFFF5CC8), Color(0xFFD0219A)],
    white: [Color(0xFF7CF7F7), Color(0xFF1FD0D0)],
    blackEdge: Color(0xFF8A1268),
    whiteEdge: Color(0xFF12908F),
  ),
  'Royal': DiscTheme(
    black: [Color(0xFF7D4BB0), Color(0xFF4A2183)],
    white: [Color(0xFFFFE9A8), Color(0xFFE8C057)],
    blackEdge: Color(0xFF2F1557),
    whiteEdge: Color(0xFFB8942F),
  ),
};

const kBoardThemes = <String, BoardTheme>{
  'Felt green': BoardTheme(a: Color(0xFF1F7A4D), b: Color(0xFF17693F), line: Color(0x4D000000)),
  'Walnut': BoardTheme(a: Color(0xFF7A4A26), b: Color(0xFF5D3719), line: Color(0x66000000)),
  'Slate': BoardTheme(a: Color(0xFF44525F), b: Color(0xFF333F4A), line: Color(0x5C000000)),
  'Ocean teal': BoardTheme(a: Color(0xFF1A6E77), b: Color(0xFF14555D), line: Color(0x52000000)),
  'Sand': BoardTheme(a: Color(0xFFD0B177), b: Color(0xFFC09C5C), line: Color(0x6B503714)),
  'Charcoal': BoardTheme(a: Color(0xFF2D2D33), b: Color(0xFF212126), line: Color(0x8C000000)),
};

class BoardView extends StatelessWidget {
  final Board board;
  final List<Move> legalMoves;
  final bool showHints;
  final int turn;
  final ({int? r, int? c})? lastMove;
  final DiscTheme discTheme;
  final BoardTheme boardTheme;
  final Color accent;
  final void Function(int r, int c) onTapCell;

  const BoardView({
    super.key,
    required this.board,
    required this.legalMoves,
    required this.showHints,
    required this.turn,
    required this.lastMove,
    required this.discTheme,
    required this.boardTheme,
    required this.accent,
    required this.onTapCell,
  });

  @override
  Widget build(BuildContext context) {
    final legalSet = {for (final m in legalMoves) m.r * board.size + m.c};
    return AspectRatio(
      aspectRatio: 1,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final cell = constraints.maxWidth / board.size;
          return GestureDetector(
            onTapUp: (details) {
              final c = (details.localPosition.dx / cell).floor().clamp(0, board.size - 1);
              final r = (details.localPosition.dy / cell).floor().clamp(0, board.size - 1);
              onTapCell(r, c);
            },
            child: CustomPaint(
              size: Size.square(constraints.maxWidth),
              painter: _BoardPainter(
                board: board,
                legalSet: legalSet,
                showHints: showHints,
                lastMove: lastMove,
                discTheme: discTheme,
                boardTheme: boardTheme,
                accent: accent,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _BoardPainter extends CustomPainter {
  final Board board;
  final Set<int> legalSet;
  final bool showHints;
  final ({int? r, int? c})? lastMove;
  final DiscTheme discTheme;
  final BoardTheme boardTheme;
  final Color accent;

  _BoardPainter({
    required this.board,
    required this.legalSet,
    required this.showHints,
    required this.lastMove,
    required this.discTheme,
    required this.boardTheme,
    required this.accent,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final n = board.size;
    final cell = size.width / n;

    // felt squares with a faint diagonal gradient per cell for a woven look
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        final rect = Rect.fromLTWH(c * cell, r * cell, cell, cell);
        final grad = LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [boardTheme.a, boardTheme.b],
        );
        canvas.drawRect(rect, Paint()..shader = grad.createShader(rect));
      }
    }

    // grid lines
    final linePaint = Paint()
      ..color = boardTheme.line
      ..strokeWidth = 1;
    for (var i = 0; i <= n; i++) {
      canvas.drawLine(Offset(i * cell, 0), Offset(i * cell, size.height), linePaint);
      canvas.drawLine(Offset(0, i * cell), Offset(size.width, i * cell), linePaint);
    }
    // outer border
    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height),
      Paint()
        ..color = boardTheme.line
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );

    // legal-move hint dots
    if (showHints) {
      final hintPaint = Paint()..color = Colors.black.withValues(alpha: 0.22);
      for (final idx in legalSet) {
        final r = idx ~/ n, c = idx % n;
        final cx = c * cell + cell / 2, cy = r * cell + cell / 2;
        canvas.drawCircle(Offset(cx, cy), cell * 0.13, hintPaint);
      }
    }

    // discs
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        final v = board.at(r, c);
        if (v == empty) continue;
        final cx = c * cell + cell / 2, cy = r * cell + cell / 2;
        final radius = cell * 0.41;

        // drop shadow
        canvas.drawCircle(
          Offset(cx + cell * 0.02, cy + cell * 0.03),
          radius,
          Paint()..color = Colors.black.withValues(alpha: 0.32),
        );

        final colors = v == black ? discTheme.black : discTheme.white;
        final edge = v == black ? discTheme.blackEdge : discTheme.whiteEdge;
        final grad = RadialGradient(
          center: const Alignment(-0.35, -0.4),
          colors: colors,
          stops: const [0.0, 0.85],
        );
        final discRect = Rect.fromCircle(center: Offset(cx, cy), radius: radius);
        canvas.drawCircle(
          Offset(cx, cy),
          radius,
          Paint()..shader = grad.createShader(discRect),
        );
        canvas.drawCircle(
          Offset(cx, cy),
          radius,
          Paint()
            ..color = edge
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.2,
        );

        if (lastMove != null && lastMove!.r == r && lastMove!.c == c) {
          canvas.drawCircle(
            Offset(cx, cy),
            radius * 0.52,
            Paint()
              ..color = accent
              ..style = PaintingStyle.stroke
              ..strokeWidth = cell * 0.045,
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _BoardPainter oldDelegate) => true;
}
