// ============================================================================
// Pure game rules for Othello / Reversi — no Flutter, no I/O. A board is a
// flat List<int> of length n*n holding BLACK / WHITE / EMPTY. This layer is
// deliberately dependency-free so it can be unit tested on its own and is
// shared verbatim by the AI (game/othello_ai.dart).
// ============================================================================

const int black = 1;
const int white = -1;
const int empty = 0;

const List<List<int>> _dirs = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/// Column letters, Go-style (skips "I" to avoid confusion with 1).
const String kCols = 'ABCDEFGHJKLMNOPQRS';

class Move {
  final int r, c;
  final List<int> flips; // flat indices flipped by this move
  const Move(this.r, this.c, this.flips);
}

class Counts {
  final int black, white, empty;
  const Counts(this.black, this.white, this.empty);
}

/// Immutable-ish board wrapper. `cells` is row-major, length size*size.
class Board {
  final int size;
  final List<int> cells;

  Board(this.size, this.cells);

  factory Board.initial(int size) {
    final cells = List<int>.filled(size * size, empty);
    final m = size ~/ 2;
    cells[(m - 1) * size + (m - 1)] = white;
    cells[(m - 1) * size + m] = black;
    cells[m * size + (m - 1)] = black;
    cells[m * size + m] = white;
    return Board(size, cells);
  }

  Board clone() => Board(size, List<int>.from(cells));

  int at(int r, int c) => cells[r * size + c];
  void set(int r, int c, int v) => cells[r * size + c] = v;
  bool inBounds(int r, int c) => r >= 0 && r < size && c >= 0 && c < size;

  /// Discs flipped if `color` plays at (r,c). Empty = illegal.
  List<int> flipsFor(int r, int c, int color) {
    if (at(r, c) != empty) return const [];
    final out = <int>[];
    for (final d in _dirs) {
      final dr = d[0], dc = d[1];
      final line = <int>[];
      var rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc) && at(rr, cc) == -color) {
        line.add(rr * size + cc);
        rr += dr;
        cc += dc;
      }
      if (line.isNotEmpty && inBounds(rr, cc) && at(rr, cc) == color) {
        out.addAll(line);
      }
    }
    return out;
  }

  List<Move> legalMoves(int color) {
    final moves = <Move>[];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (at(r, c) != empty) continue;
        final f = flipsFor(r, c, color);
        if (f.isNotEmpty) moves.add(Move(r, c, f));
      }
    }
    return moves;
  }

  /// Applies a move in place, returns the flipped indices.
  List<int> applyMove(int r, int c, int color) {
    final f = flipsFor(r, c, color);
    set(r, c, color);
    for (final i in f) {
      cells[i] = color;
    }
    return f;
  }

  Counts counts() {
    var b = 0, w = 0;
    for (final v in cells) {
      if (v == black) {
        b++;
      } else if (v == white) {
        w++;
      }
    }
    return Counts(b, w, size * size - b - w);
  }

  String coordName(int r, int c) => '${kCols[c]}${size - r}';
}

/// The C and X squares hugging a corner (not the corner itself) — usually
/// poison to play early since they hand the corner to the opponent.
bool isXorC(int size, int r, int c) {
  final dr = r < size - 1 - r ? r : size - 1 - r;
  final dc = c < size - 1 - c ? c : size - 1 - c;
  if (dr == 0 && dc == 0) return false;
  return dr <= 1 && dc <= 1;
}

/// Classic Othello positional table for any even board size: corners
/// prized, C/X squares next to them poisoned, edges good, one-in-from-edge
/// weak, interior flat.
List<List<int>> buildWeights(int n) {
  final w = List.generate(n, (_) => List<int>.filled(n, 0));
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      final dr = r < n - 1 - r ? r : n - 1 - r;
      final dc = c < n - 1 - c ? c : n - 1 - c;
      int v;
      if (dr == 0 && dc == 0) {
        v = 120;
      } else if ((dr == 0 && dc == 1) || (dr == 1 && dc == 0)) {
        v = -20;
      } else if (dr == 1 && dc == 1) {
        v = -40;
      } else if (dr == 0 || dc == 0) {
        v = (dr == 0 ? dc : dr) == 2 ? 20 : 5;
      } else if (dr == 1 || dc == 1) {
        v = -5;
      } else {
        v = 3;
      }
      w[r][c] = v;
    }
  }
  return w;
}
