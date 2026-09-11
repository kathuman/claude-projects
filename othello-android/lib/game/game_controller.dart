// ============================================================================
// Mutable game session: wraps a Board with turn tracking, history (for
// undo), a move log, and settings (opponent mode, difficulty, board size).
// A ChangeNotifier so the UI just listens and rebuilds — no external state
// package needed for a game this size.
// ============================================================================

// The public size/mode/humanColor/difficulty setters below start a new game
// as a side effect, so the constructor assigns the backing fields directly
// instead of routing through them — hence no initializing formals here.
// ignore_for_file: prefer_initializing_formals

import 'package:flutter/foundation.dart';

import 'othello_ai.dart';
import 'othello_logic.dart';

enum OpponentMode { ai, twoPlayer }

class _Snapshot {
  final Board board;
  final int turn;
  final ({int? r, int? c})? lastMove;
  final List<String> log;
  final bool over;
  final String? overReason;

  _Snapshot(this.board, this.turn, this.lastMove, this.log, this.over, this.overReason);
}

class GameController extends ChangeNotifier {
  GameController({
    int size = 8,
    OpponentMode mode = OpponentMode.ai,
    int humanColor = black,
    int difficulty = 2,
  })  : _size = size,
        _mode = mode,
        _humanColor = humanColor,
        _difficulty = difficulty {
    _newGame();
  }

  int _size;
  OpponentMode _mode;
  int _humanColor;
  int _difficulty;
  bool hintsEnabled = true;

  late Board board;
  late List<List<int>> weights;
  int turn = black;
  ({int? r, int? c})? lastMove;
  final List<String> log = [];
  final List<_Snapshot> _history = [];
  bool over = false;
  String? overReason;
  bool thinking = false;

  // Bumped by every _newGame()/undo() so a stale runAiTurn() that was mid
  // "thinking" delay when the game was reset can tell and bail out instead
  // of applying its move to a board that isn't the one it was thinking about.
  int _generation = 0;

  int get size => _size;
  OpponentMode get mode => _mode;
  int get humanColor => _humanColor;
  int get difficulty => _difficulty;

  bool get isHumanTurn => _mode == OpponentMode.twoPlayer || turn == _humanColor;

  set size(int v) {
    _size = v;
    _newGame();
  }

  set mode(OpponentMode v) {
    _mode = v;
    _newGame();
  }

  set humanColor(int v) {
    _humanColor = v;
    _newGame();
  }

  set difficulty(int v) {
    _difficulty = v;
    notifyListeners();
  }

  void setHints(bool v) {
    hintsEnabled = v;
    notifyListeners();
  }

  void newGame() => _newGame();

  void _newGame() {
    _generation++;
    board = Board.initial(_size);
    weights = buildWeights(_size);
    turn = black;
    lastMove = null;
    log.clear();
    _history.clear();
    over = false;
    overReason = null;
    thinking = false;
    notifyListeners();
  }

  Counts get counts => board.counts();

  List<Move> get legalMovesForTurn => board.legalMoves(turn);

  void _pushHistory() {
    _history.add(_Snapshot(
      board.clone(),
      turn,
      lastMove,
      List<String>.from(log),
      over,
      overReason,
    ));
    if (_history.length > 300) _history.removeAt(0);
  }

  bool canUndo() => _history.isNotEmpty;

  /// Undo one full round (human move + any AI reply) so the human always
  /// lands back on their own turn.
  void undo() {
    if (_history.isEmpty) return;
    _generation++;
    thinking = false;
    _restore(_history.removeLast());
    if (_mode == OpponentMode.ai && turn != _humanColor && _history.isNotEmpty) {
      _restore(_history.removeLast());
    }
    notifyListeners();
  }

  void _restore(_Snapshot s) {
    board = s.board;
    turn = s.turn;
    lastMove = s.lastMove;
    log
      ..clear()
      ..addAll(s.log);
    over = s.over;
    overReason = s.overReason;
  }

  /// Attempts to play at (r,c) for the side to move. Returns true if legal.
  bool play(int r, int c) {
    if (over || thinking) return false;
    final flips = board.flipsFor(r, c, turn);
    if (flips.isEmpty) return false;
    _pushHistory();
    board.applyMove(r, c, turn);
    lastMove = (r: r, c: c);
    log.add('${turn == black ? 'B' : 'W'}-${board.coordName(r, c)}');
    turn = -turn;
    _resolveTurnState();
    notifyListeners();
    return true;
  }

  void _pass() {
    _pushHistory();
    log.add('${turn == black ? 'B' : 'W'}-pass');
    lastMove = null;
    turn = -turn;
    _resolveTurnState();
  }

  /// Called after a move (or forced pass) to see whose turn is really next:
  /// skip a side with no legal moves, and detect game-over.
  void _resolveTurnState() {
    if (board.legalMoves(turn).isNotEmpty) return;
    if (board.legalMoves(-turn).isNotEmpty) {
      // current side has no move; pass silently to the other side
      log.add('${turn == black ? 'B' : 'W'}-pass');
      turn = -turn;
      return;
    }
    // neither side can move: game over
    over = true;
    final c = board.counts();
    if (c.black > c.white) {
      overReason = 'Black wins ${c.black}–${c.white}';
    } else if (c.white > c.black) {
      overReason = 'White wins ${c.white}–${c.black}';
    } else {
      overReason = 'Tie game, ${c.black}–${c.white}';
    }
  }

  /// Human explicitly passes (only offered when they truly have no move —
  /// _resolveTurnState already auto-skips, so this is a defensive no-op path
  /// kept for symmetry / future rule variants).
  void passIfForced() {
    if (over || thinking) return;
    if (board.legalMoves(turn).isEmpty) {
      _pass();
      notifyListeners();
    }
  }

  /// Runs the AI move for the current turn (caller checks it's the AI's turn).
  Future<void> runAiTurn() async {
    if (over || isHumanTurn) return;
    final gen = _generation;
    thinking = true;
    notifyListeners();
    // Yield so the "thinking" state paints before the (synchronous) search runs.
    await Future<void>.delayed(const Duration(milliseconds: 260));
    // The game may have been reset or undone while we were "thinking" — if
    // so, this move was computed for a board that no longer exists, so drop it.
    if (gen != _generation) return;
    if (over) {
      thinking = false;
      notifyListeners();
      return;
    }
    final mv = chooseAiMove(board, weights, turn, _difficulty);
    if (gen != _generation) return;
    thinking = false;
    if (mv == null) {
      // shouldn't happen (resolveTurnState would have skipped/ended already)
      notifyListeners();
      return;
    }
    _pushHistory();
    board.applyMove(mv.r, mv.c, turn);
    lastMove = (r: mv.r, c: mv.c);
    log.add('${turn == black ? 'B' : 'W'}-${board.coordName(mv.r, mv.c)}');
    turn = -turn;
    _resolveTurnState();
    notifyListeners();
  }
}
