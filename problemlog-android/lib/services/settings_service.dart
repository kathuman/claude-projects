// Wraps flutter_secure_storage (Android Keystore-backed) for the one secret
// this app holds: the user's own Anthropic API key, used only to call the
// Claude API directly from their device. Never sent anywhere else.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SettingsService {
  SettingsService._();
  static final SettingsService instance = SettingsService._();

  static const _apiKeyKey = 'anthropic_api_key';
  final _storage = const FlutterSecureStorage();

  Future<String?> getApiKey() => _storage.read(key: _apiKeyKey);

  Future<void> setApiKey(String key) => _storage.write(key: _apiKeyKey, value: key.trim());

  Future<void> clearApiKey() => _storage.delete(key: _apiKeyKey);
}
