import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../data/problem.dart';
import '../data/problem_database.dart';

class ProblemDetailScreen extends StatelessWidget {
  final Problem problem;
  const ProblemDetailScreen({super.key, required this.problem});

  Future<void> _delete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this record?'),
        content: Text('"${problem.title}" will be removed for good.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true) return;
    await ProblemDatabase.instance.delete(problem.id);
    if (context.mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Problem'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _delete(context),
            tooltip: 'Delete',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(problem.title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Row(
            children: [
              Chip(label: Text(problem.category), visualDensity: VisualDensity.compact),
              const SizedBox(width: 8),
              Text(
                DateFormat.yMMMd().add_jm().format(problem.date),
                style: TextStyle(color: cs.onSurfaceVariant, fontSize: 12.5),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _section(context, 'Summary', problem.summary),
          _section(context, 'Short-term mitigation', problem.shortTermMitigation, icon: Icons.bolt_outlined),
          _section(context, 'Long-term solution', problem.longTermSolution, icon: Icons.build_circle_outlined),
          _section(context, 'Original description', problem.description, icon: Icons.notes_outlined, muted: true),
          const SizedBox(height: 8),
          Text('Problem ID: ${problem.id}', style: TextStyle(fontSize: 11, color: cs.onSurfaceVariant)),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String label, String body, {IconData? icon, bool muted = false}) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[Icon(icon, size: 16, color: cs.primary), const SizedBox(width: 6)],
              Text(
                label.toUpperCase(),
                style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold, letterSpacing: 0.5, color: cs.primary),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            body.isEmpty ? '—' : body,
            style: TextStyle(fontSize: 14.5, color: muted ? cs.onSurfaceVariant : null, height: 1.4),
          ),
        ],
      ),
    );
  }
}
