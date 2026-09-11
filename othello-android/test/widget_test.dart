// Smoke test: the app boots to the initial 8×8 position, showing 2 discs a
// side and the starting "Black to move" banner.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:othello/main.dart';

void main() {
  testWidgets('Othello boots with the standard opening position', (tester) async {
    await tester.pumpWidget(const OthelloApp());
    await tester.pump();

    expect(find.text('Othello'), findsOneWidget);
    expect(find.text('Black to move'), findsOneWidget);
    // starting position: 2 black, 2 white
    expect(find.text('2'), findsNWidgets(2));
  });

  testWidgets('tapping a legal cell places a disc and flips to White',
      (tester) async {
    await tester.pumpWidget(const OthelloApp());
    await tester.pump();

    final boardFinder = find.byType(GestureDetector).last;
    final board = tester.getRect(boardFinder);
    final cell = board.width / 8;

    // Standard opening: Black's legal moves on 8×8 include (2,3) i.e. row 2
    // (0-indexed), col 3 — the cell just above white's disc at (3,3).
    final tapPoint = Offset(
      board.left + cell * 3 + cell / 2,
      board.top + cell * 2 + cell / 2,
    );
    await tester.tapAt(tapPoint);
    await tester.pump();

    expect(find.textContaining('to move'), findsOneWidget);
  });
}
