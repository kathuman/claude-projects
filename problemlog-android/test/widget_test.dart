// Smoke tests. The problem list itself reads through a real platform-channel
// database (sqflite), which isn't backed in the plain widget-test sandbox —
// so these check the chrome that renders regardless of how that future
// resolves, rather than the list content. See test/problem_model_test.dart
// for the parts that are pure Dart and fully exercised.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:problemlog/main.dart';

void main() {
  testWidgets('Problem Log boots with its title and call to action', (tester) async {
    await tester.pumpWidget(const ProblemLogApp());
    await tester.pump();

    expect(find.text('Problem Log'), findsOneWidget);
    expect(find.text('New problem'), findsOneWidget);
  });

  testWidgets('tapping New problem opens the describe screen', (tester) async {
    await tester.pumpWidget(const ProblemLogApp());
    await tester.pump();

    await tester.tap(find.text('New problem'));
    await tester.pumpAndSettle();

    expect(find.text('Analyze'), findsOneWidget);
    expect(find.byIcon(Icons.mic_none), findsOneWidget);
  });
}
