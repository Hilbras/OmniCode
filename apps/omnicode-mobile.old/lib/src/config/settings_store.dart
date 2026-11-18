import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'server_config.dart';

class StorageFailure implements Exception {
  const StorageFailure(this.message, [this.cause]);

  final String message;
  final Object? cause;

  @override
  String toString() => cause == null ? message : '$message: $cause';
}

class SettingsStore {
  SettingsStore({FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? FlutterSecureStorage();

  static const String baseUrlKey = 'omnicode.server.baseUrl';
  static const String tokenKey = 'omnicode.server.token';

  final FlutterSecureStorage _secureStorage;

  Future<ServerConfig?> load() async {
    final SharedPreferences prefs;
    final String? storedToken;
    try {
      prefs = await SharedPreferences.getInstance();
      storedToken = await _secureStorage.read(key: tokenKey);
    } catch (error) {
      throw StorageFailure('Could not read the saved server settings', error);
    }
    final storedUrl = prefs.getString(baseUrlKey);
    if (storedUrl == null || storedUrl.trim().isEmpty) {
      return null;
    }
    try {
      return ServerConfig.parse(baseUrl: storedUrl, token: storedToken ?? '');
    } on ServerConfigException {
      return null;
    }
  }

  Future<void> save(ServerConfig config) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(baseUrlKey, config.baseUrl);
      if (config.token.isEmpty) {
        await _secureStorage.delete(key: tokenKey);
      } else {
        await _secureStorage.write(key: tokenKey, value: config.token);
      }
    } catch (error) {
      throw StorageFailure('Could not save the server settings', error);
    }
  }

  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(baseUrlKey);
      await _secureStorage.delete(key: tokenKey);
    } catch (error) {
      throw StorageFailure('Could not clear the server settings', error);
    }
  }
}
