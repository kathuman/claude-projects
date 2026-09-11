// ============================================================================
// The computer opponent. Also pure — takes a Board, returns a Move. Strength
// is just how many plies `negamax` searches, widened near the end of the
// game once the branching factor collapses so it can fully solve the finish.
// ============================================================================

import 'dart:math';

import 'othello_logic.dart';

final Random _rng = Random();

double evaluate(Board b, List<List<int>> weights, int color) {
  final myMoves = b.legalMoves(color).length;
  final opMoves = b.legalMoves(-color).length;
  if (myMoves == 0 && opMoves == 0) {
    final c0 = b.counts();
    final diff = (c0.black - c0.white) * color;
    return diff > 0 ? 100000 : (diff < 0 ? -100000 : 0);
  }

  final cnt = b.counts();
  final empties = cnt.empty;

  var pos = 0, myDisc = 0, opDisc = 0, myCorner = 0, opCorner = 0;
  for (var r = 0; r < b.size; r++) {
    for (var c = 0; c < b.size; c++) {
      final v = b.at(r, c);
      if (v == empty) continue;
      if (v == color) {
        pos += weights[r][c];
        myDisc++;
      } else {
        pos -= weights[r][c];
        opDisc++;
      }
    }
  }
  final lo = 0, hi = b.size - 1;
  final corners = [
    [lo, lo], [lo, hi], [hi, lo], [hi, hi],
  ];
  for (final k in corners) {
    final cv = b.at(k[0], k[1]);
    if (cv == color) {
      myCorner++;
    } else if (cv == -color) {
      opCorner++;
    }
  }

  final mobility = myMoves - opMoves;
  final cornerScore = 800 * (myCorner - opCorner);
  final discScore = myDisc - opDisc;
  final total = b.size * b.size;

  if (empties > total * 0.28) {
    // opening / midgame: mobility + position + corners dominate
    return (pos + 12 * mobility + cornerScore - 3 * discScore).toDouble();
  } else if (empties > total * 0.10) {
    return (pos + 6 * mobility + cornerScore + 4 * discScore).toDouble();
  } else {
    // endgame: maximise discs
    return (cornerScore + 25 * discScore + 2 * mobility).toDouble();
  }
}

double negamax(
  Board b,
  List<List<int>> weights,
  int color,
  int depth,
  double alpha,
  double beta,
) {
  final moves = b.legalMoves(color);
  if (depth == 0) return evaluate(b, weights, color);
  if (moves.isEmpty) {
    if (b.legalMoves(-color).isEmpty) return evaluate(b, weights, color);
    return -negamax(b, weights, -color, depth - 1, -beta, -alpha);
  }
  // move ordering: try high-weight squares first for better pruning
  moves.sort((m1, m2) => weights[m2.r][m2.c] - weights[m1.r][m1.c]);
  var best = double.negativeInfinity;
  for (final m in moves) {
    final nb = b.clone();
    nb.applyMove(m.r, m.c, color);
    final sc = -negamax(nb, weights, -color, depth - 1, -beta, -alpha);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/// difficulty: 1 Easy, 2 Medium, 3 Hard, 4 Expert.
Move? chooseAiMove(
  Board b,
  List<List<int>> weights,
  int color,
  int difficulty,
) {
  final moves = b.legalMoves(color);
  if (moves.isEmpty) return null;

  if (difficulty == 1) {
    // Easy: mostly random, slight nudge away from giving up corners.
    if (_rng.nextDouble() < 0.35) {
      final safe = moves.where((m) => !isXorC(b.size, m.r, m.c)).toList();
      final pool = safe.isNotEmpty ? safe : moves;
      return pool[_rng.nextInt(pool.length)];
    }
    return moves[_rng.nextInt(moves.length)];
  }

  final cnt = b.counts();
  final big = b.size >= 10, small = b.size <= 6;
  int depth;
  if (difficulty == 2) {
    depth = 3;
  } else if (difficulty == 3) {
    depth = 4;
  } else {
    depth = 6;
  }
  // Larger boards branch wider — pull the search in a ply or two so the
  // computer still answers quickly; smaller boards can afford one more.
  if (big) {
    depth -= difficulty == 4 ? 2 : 1;
  } else if (small && difficulty >= 2) {
    depth += 1;
  }
  // Dig deep — up to a full solve — once the branching factor collapses.
  final solveThresh = big ? 8 : 10;
  if ((difficulty >= 3 && cnt.empty <= solveThresh) ||
      cnt.empty <= (big ? 6 : 8)) {
    depth = max(depth, cnt.empty);
  }

  final ordered = List<Move>.from(moves)
    ..sort((m1, m2) => weights[m2.r][m2.c] - weights[m1.r][m1.c]);
  Move? best;
  var bestScore = double.negativeInfinity;
  var alpha = double.negativeInfinity;
  const beta = double.infinity;
  for (final m in ordered) {
    final nb = b.clone();
    nb.applyMove(m.r, m.c, color);
    var sc = -negamax(nb, weights, -color, depth - 1, -beta, -alpha);
    // tiny jitter so equal positions vary between games (not on Expert)
    if (difficulty < 4) sc += _rng.nextDouble() * 0.5;
    if (sc > bestScore) {
      bestScore = sc;
      best = m;
    }
    if (bestScore > alpha) alpha = bestScore;
  }
  return best;
}
