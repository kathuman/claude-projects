// Thin wrapper over speech_to_text: on-device dictation via Android's
// SpeechRecognizer. Requests the RECORD_AUDIO permission on first use.

import 'package:speech_to_text/speech_to_text.dart' as stt;

class SpeechService {
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _initialized = false;

  bool get isListening => _speech.isListening;

  /// Returns false if the device has no recognizer or the user denied the
  /// microphone permission.
  Future<bool> init() async {
    if (_initialized) return true;
    _initialized = await _speech.initialize(
      onError: (_) {},
      onStatus: (_) {},
    );
    return _initialized;
  }

  /// Starts listening, calling [onResult] with the running transcript as it
  /// updates (interim and final results alike — callers decide what to keep).
  Future<bool> startListening({
    required void Function(String text, bool isFinal) onResult,
  }) async {
    final ok = await init();
    if (!ok) return false;
    await _speech.listen(
      onResult: (result) => onResult(result.recognizedWords, result.finalResult),
      listenOptions: stt.SpeechListenOptions(
        partialResults: true,
        cancelOnError: true,
        pauseFor: const Duration(seconds: 4),
        listenFor: const Duration(minutes: 3),
      ),
    );
    return true;
  }

  Future<void> stop() => _speech.stop();

  void dispose() => _speech.cancel();
}
