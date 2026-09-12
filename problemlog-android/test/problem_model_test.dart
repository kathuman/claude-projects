import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:problemlog/data/problem.dart';
import 'package:problemlog/services/claude_service.dart';

void main() {
  group('Problem', () {
    test('round-trips through toMap/fromMap', () {
      final original = Problem(
        id: 'abc-123',
        title: 'Checkout 500s on mobile',
        description: 'The checkout page has thrown 500s on mobile for an hour.',
        summary: 'Mobile checkout returns HTTP 500 since the payments deploy.',
        category: 'Software Bug',
        longTermSolution: 'Add a regression test for the payments SDK version bump.',
        shortTermMitigation: 'Roll back the payments deploy.',
        date: DateTime.utc(2026, 9, 11, 14, 30),
      );

      final restored = Problem.fromMap(original.toMap());

      expect(restored.id, original.id);
      expect(restored.title, original.title);
      expect(restored.description, original.description);
      expect(restored.summary, original.summary);
      expect(restored.category, original.category);
      expect(restored.longTermSolution, original.longTermSolution);
      expect(restored.shortTermMitigation, original.shortTermMitigation);
      expect(restored.date, original.date);
    });

    test('copyWith only changes the given fields', () {
      final p = Problem(
        id: '1',
        title: 'A',
        description: 'B',
        summary: 'C',
        category: 'D',
        longTermSolution: 'E',
        shortTermMitigation: 'F',
        date: DateTime.utc(2026, 1, 1),
      );
      final updated = p.copyWith(title: 'New title');
      expect(updated.title, 'New title');
      expect(updated.description, 'B');
      expect(updated.id, '1');
      expect(updated.date, p.date);
    });
  });

  group('ClaudeService.parseAnalysisResponse', () {
    String responseWith(Map<String, dynamic> input) => jsonEncode({
          'id': 'msg_1',
          'content': [
            {
              'type': 'tool_use',
              'name': 'record_problem_analysis',
              'input': input,
            }
          ],
        });

    test('extracts all fields from a well-formed tool_use block', () {
      final body = responseWith({
        'title': 'Checkout 500s on mobile',
        'summary': 'Mobile checkout has returned 500s for an hour.',
        'category': 'Software Bug',
        'long_term_solution': 'Pin the payments SDK version and add CI coverage.',
        'short_term_mitigation': 'Roll back the latest payments deploy.',
      });

      final analysis = ClaudeService.parseAnalysisResponse(body);

      expect(analysis.title, 'Checkout 500s on mobile');
      expect(analysis.summary, 'Mobile checkout has returned 500s for an hour.');
      expect(analysis.category, 'Software Bug');
      expect(analysis.longTermSolution, 'Pin the payments SDK version and add CI coverage.');
      expect(analysis.shortTermMitigation, 'Roll back the latest payments deploy.');
    });

    test('trims whitespace around each field', () {
      final body = responseWith({
        'title': '  Spaced title  ',
        'summary': ' summary ',
        'category': ' Cat ',
        'long_term_solution': ' long ',
        'short_term_mitigation': ' short ',
      });

      final analysis = ClaudeService.parseAnalysisResponse(body);

      expect(analysis.title, 'Spaced title');
      expect(analysis.summary, 'summary');
      expect(analysis.category, 'Cat');
    });

    test('ignores a preceding non-tool_use content block', () {
      final body = jsonEncode({
        'content': [
          {'type': 'text', 'text': 'thinking...'},
          {
            'type': 'tool_use',
            'name': 'record_problem_analysis',
            'input': {
              'title': 'T',
              'summary': 'S',
              'category': 'C',
              'long_term_solution': 'L',
              'short_term_mitigation': 'M',
            },
          },
        ],
      });

      final analysis = ClaudeService.parseAnalysisResponse(body);
      expect(analysis.title, 'T');
    });

    test('throws ClaudeApiException when no tool_use block is present', () {
      final body = jsonEncode({
        'content': [
          {'type': 'text', 'text': 'I have a question before I can help.'},
        ],
      });

      expect(
        () => ClaudeService.parseAnalysisResponse(body),
        throwsA(isA<ClaudeApiException>()),
      );
    });
  });
}
