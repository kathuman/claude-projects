import 'package:flutter/material.dart';

import 'game/game_controller.dart';
import 'game/othello_logic.dart';
import 'ui/board_view.dart';

void main() => runApp(const OthelloApp());

const _accent = Color(0xFFC15F3C);

class OthelloApp extends StatefulWidget {
  const OthelloApp({super.key});

  @override
  State<OthelloApp> createState() => _OthelloAppState();
}

class _OthelloAppState extends State<OthelloApp> {
  ThemeMode _themeMode = ThemeMode.system;

  void _toggleTheme() {
    setState(() {
      final isDark = _themeMode == ThemeMode.dark ||
          (_themeMode == ThemeMode.system &&
              WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.dark);
      _themeMode = isDark ? ThemeMode.light : ThemeMode.dark;
    });
  }

  @override
  Widget build(BuildContext context) {
    final lightScheme = ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.light);
    final darkScheme = ColorScheme.fromSeed(seedColor: _accent, brightness: Brightness.dark);
    return MaterialApp(
      title: 'Othello',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: ThemeData(colorScheme: lightScheme, useMaterial3: true, fontFamily: 'Roboto'),
      darkTheme: ThemeData(colorScheme: darkScheme, useMaterial3: true, fontFamily: 'Roboto'),
      home: OthelloHomePage(onToggleTheme: _toggleTheme),
    );
  }
}

class OthelloHomePage extends StatefulWidget {
  final VoidCallback onToggleTheme;
  const OthelloHomePage({super.key, required this.onToggleTheme});

  @override
  State<OthelloHomePage> createState() => _OthelloHomePageState();
}

class _OthelloHomePageState extends State<OthelloHomePage> {
  late final GameController game;
  String discThemeName = 'Classic';
  String boardThemeName = 'Felt green';

  @override
  void initState() {
    super.initState();
    game = GameController()..addListener(_onGameChanged);
  }

  @override
  void dispose() {
    game.removeListener(_onGameChanged);
    game.dispose();
    super.dispose();
  }

  void _onGameChanged() {
    setState(() {});
    if (!game.over && !game.isHumanTurn && !game.thinking) {
      game.runAiTurn();
    }
  }

  void _onTapCell(int r, int c) {
    if (!game.isHumanTurn || game.thinking) return;
    game.play(r, c);
  }

  @override
  Widget build(BuildContext context) {
    final counts = game.counts;
    final discTheme = kDiscThemes[discThemeName]!;
    final boardTheme = kBoardThemes[boardThemeName]!;

    return Scaffold(
      appBar: AppBar(
        title: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('⚫', style: TextStyle(fontSize: 20)),
            SizedBox(width: 8),
            Text('Othello'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Toggle theme',
            icon: const Icon(Icons.brightness_6_outlined),
            onPressed: widget.onToggleTheme,
          ),
        ],
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth > 760;
            final boardCard = _BoardCard(
              game: game,
              counts: counts,
              discTheme: discTheme,
              boardTheme: boardTheme,
              onTapCell: _onTapCell,
            );
            final panel = _SettingsPanel(
              game: game,
              discThemeName: discThemeName,
              boardThemeName: boardThemeName,
              onDiscTheme: (v) => setState(() => discThemeName = v),
              onBoardTheme: (v) => setState(() => boardThemeName = v),
            );

            if (wide) {
              return Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 3,
                      child: SingleChildScrollView(child: boardCard),
                    ),
                    const SizedBox(width: 16),
                    SizedBox(width: 320, child: SingleChildScrollView(child: panel)),
                  ],
                ),
              );
            }
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  boardCard,
                  const SizedBox(height: 16),
                  panel,
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _BoardCard extends StatelessWidget {
  final GameController game;
  final Counts counts;
  final DiscTheme discTheme;
  final BoardTheme boardTheme;
  final void Function(int r, int c) onTapCell;

  const _BoardCard({
    required this.game,
    required this.counts,
    required this.discTheme,
    required this.boardTheme,
    required this.onTapCell,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Card(
      elevation: 1,
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _ScoreChip(
                      active: !game.over && game.turn == black,
                      color: discTheme.black.last,
                      edge: discTheme.blackEdge,
                      label: 'Black',
                      count: counts.black,
                    ),
                    const SizedBox(width: 14),
                    _ScoreChip(
                      active: !game.over && game.turn == white,
                      color: discTheme.white.first,
                      edge: discTheme.whiteEdge,
                      label: 'White',
                      count: counts.white,
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                BoardView(
                  board: game.board,
                  legalMoves: game.isHumanTurn ? game.legalMovesForTurn : const [],
                  showHints: game.hintsEnabled,
                  turn: game.turn,
                  lastMove: game.lastMove,
                  discTheme: discTheme,
                  boardTheme: boardTheme,
                  accent: cs.primary,
                  onTapCell: onTapCell,
                ),
                const SizedBox(height: 12),
                Text(
                  game.over
                      ? game.overReason ?? 'Game over'
                      : game.thinking
                          ? 'Computer is thinking…'
                          : '${game.turn == black ? 'Black' : 'White'} to move',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: game.over ? 16 : 14,
                    color: game.over ? cs.primary : null,
                  ),
                ),
              ],
            ),
          ),
          // A little corner signature, in the spirit of every other sub-app
          // on the site (see the "get in touch" footer on the web version).
          Positioned(
            right: 10,
            bottom: 6,
            child: Text(
              'kathuman',
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w500,
                letterSpacing: 0.3,
                color: cs.onSurfaceVariant.withValues(alpha: 0.55),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ScoreChip extends StatelessWidget {
  final bool active;
  final Color color;
  final Color edge;
  final String label;
  final int count;

  const _ScoreChip({
    required this.active,
    required this.color,
    required this.edge,
    required this.label,
    required this.count,
  });

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: active ? cs.primary : cs.outlineVariant),
        color: active ? cs.primary.withValues(alpha: 0.08) : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 16,
            height: 16,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color, border: Border.all(color: edge)),
          ),
          const SizedBox(width: 8),
          Text('$count', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
          const SizedBox(width: 6),
          Text(label, style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant, letterSpacing: 0.4)),
        ],
      ),
    );
  }
}

class _SettingsPanel extends StatelessWidget {
  final GameController game;
  final String discThemeName;
  final String boardThemeName;
  final ValueChanged<String> onDiscTheme;
  final ValueChanged<String> onBoardTheme;

  const _SettingsPanel({
    required this.game,
    required this.discThemeName,
    required this.boardThemeName,
    required this.onDiscTheme,
    required this.onBoardTheme,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _panelCard(context, 'Game', [
          _label('Opponent'),
          SegmentedButton<OpponentMode>(
            segments: const [
              ButtonSegment(value: OpponentMode.ai, label: Text('vs Computer')),
              ButtonSegment(value: OpponentMode.twoPlayer, label: Text('2 Players')),
            ],
            selected: {game.mode},
            onSelectionChanged: (s) => game.mode = s.first,
          ),
          if (game.mode == OpponentMode.ai) ...[
            const SizedBox(height: 14),
            _label('You play'),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: black, label: Text('Black')),
                ButtonSegment(value: white, label: Text('White')),
              ],
              selected: {game.humanColor},
              onSelectionChanged: (s) => game.humanColor = s.first,
            ),
            const SizedBox(height: 14),
            _label('Computer strength'),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 1, label: Text('Easy')),
                ButtonSegment(value: 2, label: Text('Med')),
                ButtonSegment(value: 3, label: Text('Hard')),
                ButtonSegment(value: 4, label: Text('Exp')),
              ],
              selected: {game.difficulty},
              onSelectionChanged: (s) => game.difficulty = s.first,
            ),
          ],
          const SizedBox(height: 14),
          _label('Board size'),
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 6, label: Text('6×6')),
              ButtonSegment(value: 8, label: Text('8×8')),
              ButtonSegment(value: 10, label: Text('10×10')),
            ],
            selected: {game.size},
            onSelectionChanged: (s) => game.size = s.first,
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => game.newGame(),
            child: const Text('New game'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: game.canUndo() ? () => game.undo() : null,
            child: const Text('Undo'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => game.setHints(!game.hintsEnabled),
            icon: Icon(game.hintsEnabled ? Icons.visibility : Icons.visibility_off),
            label: Text('Hints: ${game.hintsEnabled ? "on" : "off"}'),
          ),
        ]),
        const SizedBox(height: 16),
        _panelCard(context, 'Look', [
          _label('Discs'),
          DropdownButton<String>(
            isExpanded: true,
            value: discThemeName,
            items: kDiscThemes.keys
                .map((k) => DropdownMenuItem(value: k, child: Text(k)))
                .toList(),
            onChanged: (v) {
              if (v != null) onDiscTheme(v);
            },
          ),
          const SizedBox(height: 14),
          _label('Board'),
          DropdownButton<String>(
            isExpanded: true,
            value: boardThemeName,
            items: kBoardThemes.keys
                .map((k) => DropdownMenuItem(value: k, child: Text(k)))
                .toList(),
            onChanged: (v) {
              if (v != null) onBoardTheme(v);
            },
          ),
        ]),
        const SizedBox(height: 16),
        _panelCard(context, 'Moves', [
          SizedBox(
            height: 160,
            child: game.log.isEmpty
                ? const Center(child: Text('—', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    itemCount: game.log.length,
                    itemBuilder: (context, i) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Text(
                        '${i + 1}. ${game.log[i]}',
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                      ),
                    ),
                  ),
          ),
        ]),
      ],
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
      );

  Widget _panelCard(BuildContext context, String title, List<Widget> children) {
    return Card(
      elevation: 1,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 0.6, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}
