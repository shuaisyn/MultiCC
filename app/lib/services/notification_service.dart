import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;

  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
    );
  }

  static Future<void> show({
    required String title,
    required String body,
    int id = 0,
  }) async {
    const android = AndroidNotificationDetails(
      'multicc_tasks',
      'Task Notifications',
      channelDescription: 'MultiCC task completion and status notifications',
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
    );
    await _plugin.show(
      id: id,
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(android: android),
    );
  }
}
