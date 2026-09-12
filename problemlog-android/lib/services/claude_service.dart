// Turns a raw problem description into the structured fields the app stores,
// by asking Claude to fill out a fixed tool schema (forced tool_choice, so
// the response is always well-formed JSON, never prose to scrape).

import 'dart:convert';

import 'package:http/http.dart' as http;

import '../data/problem.dart';

class ClaudeApiException implements Exception {
  final String message;
  ClaudeApiException(this.message);
  @override
  String toString() => message;
}

class ClaudeService {
  static const _endpoint = 'https://api.anthropic.com/v1/messages';
  static const _model = 'claude-sonnet-5';
  static const _apiVersion = '2023-06-01';

  static const _toolName = 'record_problem_analysis';

  static const _systemPrompt =
      'You turn a spoken or typed account of a problem — technical, '
      'operational, or personal — into a concise incident-style record. '
      'Be specific and actionable; prefer the user\'s own words and details '
      'over generic advice. If the description is vague, do your best with '
      'what is given rather than refusing.';

  Future<ProblemAnalysis> analyze(String description, {required String apiKey}) async {
    if (apiKey.trim().isEmpty) {
      throw ClaudeApiException('No API key set. Add one in Settings first.');
    }
    if (description.trim().isEmpty) {
      throw ClaudeApiException('Nothing to analyze — describe the problem first.');
    }

    final body = jsonEncode({
      'model': _model,
      'max_tokens': 1024,
      'system': _systemPrompt,
      'tools': [
        {
          'name': _toolName,
          'description': 'Records the structured analysis of a described problem.',
          'input_schema': {
            'type': 'object',
            'properties': {
              'title': {
                'type': 'string',
                'description': 'A short, specific title for the problem (under ~8 words).',
              },
              'summary': {
                'type': 'string',
                'description': 'A 1-3 sentence summary of the problem, tighter than the original description.',
              },
              'category': {
                'type': 'string',
                'description': 'A short category label, e.g. "Network", "Hardware", "Process", '
                    '"Software Bug", "Personnel", "Facilities" — pick or coin whatever fits best.',
              },
              'long_term_solution': {
                'type': 'string',
                'description': 'The durable fix that resolves the root cause, not just the symptom.',
              },
              'short_term_mitigation': {
                'type': 'string',
                'description': 'An immediate, practical stopgap that reduces impact right now, '
                    'before the long-term solution is in place.',
              },
            },
            'required': ['title', 'summary', 'category', 'long_term_solution', 'short_term_mitigation'],
          },
        }
      ],
      'tool_choice': {'type': 'tool', 'name': _toolName},
      'messages': [
        {'role': 'user', 'content': description.trim()},
      ],
    });

    http.Response resp;
    try {
      resp = await http
          .post(
            Uri.parse(_endpoint),
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey.trim(),
              'anthropic-version': _apiVersion,
            },
            body: body,
          )
          .timeout(const Duration(seconds: 45));
    } catch (e) {
      throw ClaudeApiException('Could not reach the Claude API — check your connection. ($e)');
    }

    if (resp.statusCode == 401) {
      throw ClaudeApiException('That API key was rejected. Check it in Settings.');
    }
    if (resp.statusCode == 429) {
      throw ClaudeApiException('Rate limited by the Claude API — wait a moment and try again.');
    }
    if (resp.statusCode != 200) {
      throw ClaudeApiException('Claude API error ${resp.statusCode}: ${_shortError(resp.body)}');
    }

    return parseAnalysisResponse(resp.body);
  }

  /// Pulls the forced tool_use block out of a Messages API response body and
  /// maps it onto [ProblemAnalysis]. Pure and separately unit-tested — no
  /// network involved — since this is the part actually worth getting right.
  static ProblemAnalysis parseAnalysisResponse(String responseBody) {
    final decoded = jsonDecode(responseBody) as Map<String, dynamic>;
    final content = decoded['content'] as List<dynamic>? ?? [];
    final toolUse = content.cast<Map<String, dynamic>>().firstWhere(
          (block) => block['type'] == 'tool_use' && block['name'] == _toolName,
          orElse: () => throw ClaudeApiException('Claude did not return a structured analysis.'),
        );
    final input = toolUse['input'] as Map<String, dynamic>;

    return ProblemAnalysis(
      title: (input['title'] as String? ?? '').trim(),
      summary: (input['summary'] as String? ?? '').trim(),
      category: (input['category'] as String? ?? '').trim(),
      longTermSolution: (input['long_term_solution'] as String? ?? '').trim(),
      shortTermMitigation: (input['short_term_mitigation'] as String? ?? '').trim(),
    );
  }

  static String _shortError(String body) {
    try {
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      final err = decoded['error'] as Map<String, dynamic>?;
      return (err?['message'] as String?) ?? body;
    } catch (_) {
      return body.length > 200 ? '${body.substring(0, 200)}…' : body;
    }
  }
}
