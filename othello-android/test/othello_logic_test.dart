import 'package:flutter_test/flutter_test.dart';
import 'package:othello/game/othello_ai.dart';
import 'package:othello/game/othello_logic.dart';

void main() {
  group('Board.initial', () {
    test('sets up the standard 4-disc opening on any even size', () {
      for (final n in [6, 8, 10]) {
        final b = Board.initial(n);
        final m = n ~/ 2;
        expect(b.at(m - 1, m - 1), white);
        expect(b.at(m - 1, m), black);
        expect(b.at(m, m - 1), black);
        expect(b.at(m, m), white);
        expect(b.counts().black, 2);
        expect(b.counts().white, 2);
        expect(b.counts().empty, n * n - 4);
      }
    });
  });

  group('legal moves + flips', () {
    test('Black has exactly 4 legal moves in the opening position on 8×8', () {
      final b = Board.initial(8);
      final moves = b.legalMoves(black);
      final coords = moves.map((m) => (m.r, m.c)).toSet();
      expect(coords, {(2, 3), (3, 2), (4, 5), (5, 4)});
    });

    test('playing a move flips the sandwiched disc(s)', () {
      final b = Board.initial(8);
      // Black plays (2,3): flips White at (3,3).
      final flips = b.applyMove(2, 3, black);
      expect(flips, [3 * 8 + 3]);
      expect(b.at(3, 3), black);
      expect(b.counts().black, 4);
      expect(b.counts().white, 1);
    });

    test('a move onto an occupied square or with no bracket is illegal', () {
      final b = Board.initial(8);
      expect(b.flipsFor(3, 3, black), isEmpty); // occupied
      expect(b.flipsFor(0, 0, black), isEmpty); // no sandwich
    });
  });

  group('AI', () {
    test('chooseAiMove always returns one of the legal moves', () {
      final b = Board.initial(8);
      final weights = buildWeights(8);
      for (final diff in [1, 2, 3, 4]) {
        final mv = chooseAiMove(b.clone(), weights, black, diff);
        expect(mv, isNotNull);
        final legal = b.legalMoves(black).map((m) => (m.r, m.c)).toSet();
        expect(legal.contains((mv!.r, mv.c)), isTrue, reason: 'difficulty $diff');
      }
    });

    test('a full game between two AIs terminates and discs sum to the board area', () {
      final size = 8;
      var b = Board.initial(size);
      final weights = buildWeights(size);
      var turn = black;
      var passes = 0;
      var safety = 0;
      while (passes < 2 && safety < 200) {
        safety++;
        final moves = b.legalMoves(turn);
        if (moves.isEmpty) {
          passes++;
          turn = -turn;
          continue;
        }
        passes = 0;
        final mv = chooseAiMove(b, weights, turn, 2)!;
        b.applyMove(mv.r, mv.c, turn);
        turn = -turn;
      }
      final c = b.counts();
      expect(c.black + c.white + c.empty, size * size);
      expect(safety, lessThan(200)); // actually finished, didn't hit the safety cap
    });
  });

  group('isXorC', () {
    test('flags the C and X squares around a corner but not the corner itself', () {
      expect(isXorC(8, 0, 0), isFalse); // corner
      expect(isXorC(8, 0, 1), isTrue); // C square
      expect(isXorC(8, 1, 0), isTrue); // C square
      expect(isXorC(8, 1, 1), isTrue); // X square
      expect(isXorC(8, 2, 2), isFalse);
    });
  });
}
