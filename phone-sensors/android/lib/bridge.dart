// The timing half of the bridge, kept apart so it can be tested without a phone.
//
// A reading carries t (when the sensor measured it) and sent (when Android handed it over), both in ms of the phone's
// elapsedRealtime clock. Here it waits up to 50 ms for the next batch. The page needs one number: how old each
// reading is when the batch arrives. It gets {now: 0, items} with t = −age, so its own "now − t" is the age.

/// Called when a reading arrives: keeps its age at that moment and the arrival time on [clockMs].
Map<String, dynamic> arrive(Map<String, dynamic> item, double clockMs) {
  final out = Map<String, dynamic>.from(item);
  if (out['t'] is num && out['sent'] is num) {
    out['age'] = (out['sent'] as num) - (out['t'] as num);
    out['at'] = clockMs;
  }
  out.remove('sent');
  return out;
}

/// Called when the batch leaves at [clockMs]: adds the time spent waiting to each reading's age and returns the
/// message for window.SensorDeckBridge.receive.
Map<String, dynamic> batch(List<Map<String, dynamic>> queue, double clockMs) {
  final items = queue.map((it) {
    final out = Map<String, dynamic>.from(it);
    if (out.containsKey('at')) {
      final age = (out.remove('age') as num) + (clockMs - (out.remove('at') as num));
      out['t'] = -age;
    }
    return out;
  }).toList();
  return {'now': 0, 'items': items};
}
