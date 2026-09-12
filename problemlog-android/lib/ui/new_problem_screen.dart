// The core flow: describe the problem (typed and/or dictated) -> Analyze
// (calls Claude) -> review/edit the generated fields -> Save.

import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../data/problem.dart';
import '../data/problem_database.dart';
import '../services/claude_service.dart';
import '../services/settings_service.dart';
import '../services/speech_service.dart';

class NewProblemScreen extends StatefulWidget {
  const NewProblemScreen({super.key});

  @override
  State<NewProblemScreen> createState() => _NewProblemScreenState();
}

enum _Stage { describe, analyzing, review }

class _NewProblemScreenState extends State<NewProblemScreen> {
  final _descriptionController = TextEditingController();
  final _speech = SpeechService();
  final _claude = ClaudeService();

  _Stage _stage = _Stage.describe;
  bool _listening = false;
  String? _error;

  // Editable fields once analysis comes back.
  final _titleController = TextEditingController();
  final _summaryController = TextEditingController();
  final _categoryController = TextEditingController();
  final _longTermController = TextEditingController();
  final _shortTermController = TextEditingController();

  @override
  void dispose() {
    _descriptionController.dispose();
    _titleController.dispose();
    _summaryController.dispose();
    _categoryController.dispose();
    _longTermController.dispose();
    _shortTermController.dispose();
    _speech.dispose();
    super.dispose();
  }

  Future<void> _toggleListening() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
      return;
    }
    final base = _descriptionController.text;
    final started = await _speech.startListening(
      onResult: (text, isFinal) {
        final needsSpace = base.isNotEmpty && !base.endsWith(' ');
        _descriptionController.text = '$base${needsSpace ? ' ' : ''}$text';
        _descriptionController.selection = TextSelection.collapsed(offset: _descriptionController.text.length);
        if (isFinal) setState(() => _listening = false);
      },
    );
    if (!started) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Microphone unavailable — check the app has permission, or just type instead.')),
      );
      return;
    }
    setState(() => _listening = true);
  }

  Future<void> _analyze() async {
    final apiKey = await SettingsService.instance.getApiKey();
    if (apiKey == null || apiKey.isEmpty) {
      if (!mounted) return;
      setState(() => _error = 'Add your Claude API key in Settings first (top-right ⚙).');
      return;
    }
    setState(() {
      _stage = _Stage.analyzing;
      _error = null;
    });
    try {
      final analysis = await _claude.analyze(_descriptionController.text, apiKey: apiKey);
      _titleController.text = analysis.title;
      _summaryController.text = analysis.summary;
      _categoryController.text = analysis.category;
      _longTermController.text = analysis.longTermSolution;
      _shortTermController.text = analysis.shortTermMitigation;
      setState(() => _stage = _Stage.review);
    } on ClaudeApiException catch (e) {
      setState(() {
        _stage = _Stage.describe;
        _error = e.message;
      });
    } catch (e) {
      setState(() {
        _stage = _Stage.describe;
        _error = 'Unexpected error: $e';
      });
    }
  }

  Future<void> _save() async {
    final problem = Problem(
      id: const Uuid().v4(),
      title: _titleController.text.trim(),
      description: _descriptionController.text.trim(),
      summary: _summaryController.text.trim(),
      category: _categoryController.text.trim(),
      longTermSolution: _longTermController.text.trim(),
      shortTermMitigation: _shortTermController.text.trim(),
      date: DateTime.now(),
    );
    await ProblemDatabase.instance.insert(problem);
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_stage == _Stage.review ? 'Review & save' : 'New problem'),
      ),
      body: switch (_stage) {
        _Stage.describe => _buildDescribe(context),
        _Stage.analyzing => const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Asking Claude to structure this…'),
                ],
              ),
            ),
          ),
        _Stage.review => _buildReview(context),
      },
    );
  }

  Widget _buildDescribe(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Describe what\'s wrong — tap the mic and talk, or just type. '
            'Include what you know: what broke, when, impact, anything '
            'you\'ve already tried.',
            style: TextStyle(color: cs.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: TextField(
              controller: _descriptionController,
              maxLines: null,
              expands: true,
              textAlignVertical: TextAlignVertical.top,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: 'e.g. "The checkout page has been throwing a 500 error '
                    'for about an hour, only on mobile, started right after the '
                    'payments deploy this morning…"',
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (_error != null) ...[
            Text(_error!, style: TextStyle(color: cs.error)),
            const SizedBox(height: 8),
          ],
          Row(
            children: [
              FilledButton.tonalIcon(
                onPressed: _toggleListening,
                icon: Icon(_listening ? Icons.stop_circle_outlined : Icons.mic_none),
                label: Text(_listening ? 'Stop' : 'Talk'),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _descriptionController.text.trim().isEmpty ? null : _analyze,
                  child: const Text('Analyze'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildReview(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(
          'Claude\'s read on this — edit anything before saving.',
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 16),
        _field('Title', _titleController),
        _field('Category', _categoryController),
        _field('Summary', _summaryController, lines: 3),
        _field('Short-term mitigation', _shortTermController, lines: 3),
        _field('Long-term solution', _longTermController, lines: 3),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton(
              onPressed: () => setState(() => _stage = _Stage.describe),
              child: const Text('Back'),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                onPressed: _titleController.text.trim().isEmpty ? null : _save,
                child: const Text('Save record'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _field(String label, TextEditingController controller, {int lines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        maxLines: lines,
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        onChanged: (_) => setState(() {}),
      ),
    );
  }
}
