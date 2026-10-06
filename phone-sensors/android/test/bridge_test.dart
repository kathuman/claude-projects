import 'package:flutter_test/flutter_test.dart';
import 'package:sensor_deck/bridge.dart';

void main() {
  test('a reading measured 5 ms before hand-over and batched 30 ms later is 35 ms old', () {
    final a = arrive({'k': 's', 'id': 'pressure', 'v': [1013.2], 't': 1000.0, 'sent': 1005.0}, 200.0);
    final m = batch([a], 230.0);
    final it = (m['items'] as List).first as Map;
    expect(m['now'], 0);
    expect(it['t'], closeTo(-35.0, 1e-9));
    expect(it.containsKey('sent') || it.containsKey('at') || it.containsKey('age'), isFalse);
    expect(it['v'], [1013.2]);
  });

  test('status, list and fingerprint messages pass through unchanged', () {
    final s = arrive({'k': 'status', 'id': 'ambient', 'state': 'unavailable', 'text': 'none'}, 10);
    final f = arrive({'k': 'fp', 'result': 'matched', 'text': 'ok'}, 10);
    final m = batch([s, f], 60);
    expect(m['items'], [
      {'k': 'status', 'id': 'ambient', 'state': 'unavailable', 'text': 'none'},
      {'k': 'fp', 'result': 'matched', 'text': 'ok'},
    ]);
  });

  test('the page reads the age as now − t', () {
    final m = batch([arrive({'k': 's', 'id': 'light', 'v': [300], 't': 50.0, 'sent': 52.0}, 0)], 48.0);
    final it = (m['items'] as List).first as Map;
    expect((m['now'] as num) - (it['t'] as num), closeTo(50.0, 1e-9));
  });
}
