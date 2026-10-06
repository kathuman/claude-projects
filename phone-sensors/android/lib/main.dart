// Sensor Deck for Android: the Sensor Deck web page in a WebView, plus a bridge to what a web page cannot read
// (barometer, temperatures, humidity, proximity, light, magnetometer, step counter, any listed sensor, fingerprint).
//
// Page → app: window.SensorDeckNative.postMessage(json) with {cmd: hello | list | start | stop | fingerprint | awake | open}.
// App → page: window.SensorDeckBridge.receive({now, items}) every 50 ms; each item's age is now − t, in ms.
//
// Version history:
//   1.0.0  first release: the page in a WebView, native sensors, battery temperature, fingerprint check, camera,
//          microphone and location permissions handed to the page, screen kept on while sensors run
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'bridge.dart';

const appVersion = '1.0.0';
// --dart-define=PAGE_URL=http://10.0.2.2:8767/phone-sensors/ points the app at a local server (the emulator's host)
const pageBase = String.fromEnvironment('PAGE_URL', defaultValue: 'https://kathuman.github.io/claude-projects/phone-sensors/');
const native = MethodChannel('sensordeck/native');
const events = EventChannel('sensordeck/events');
const navy = Color(0xFF0A2F52);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: navy, systemNavigationBarColor: navy));
  runApp(const SensorDeckApp());
}

class SensorDeckApp extends StatelessWidget {
  const SensorDeckApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Sensor Deck',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF7DD3FC), brightness: Brightness.dark), scaffoldBackgroundColor: navy),
        home: const DeckPage(),
      );
}

class DeckPage extends StatefulWidget {
  const DeckPage({super.key});
  @override
  State<DeckPage> createState() => _DeckPageState();
}

class _DeckPageState extends State<DeckPage> {
  late final WebViewController web;
  final queue = <Map<String, dynamic>>[];
  final clock = Stopwatch()..start();
  Timer? flush;
  String? error;
  StreamSubscription? sub;

  @override
  void initState() {
    super.initState();
    web = WebViewController.fromPlatformCreationParams(
      const PlatformWebViewControllerCreationParams(),
      // the page asks for the camera or microphone: ask Android first, then let the page have it
      onPermissionRequest: (req) async {
        final want = <String>[
          if (req.types.contains(WebViewPermissionResourceType.camera)) 'camera',
          if (req.types.contains(WebViewPermissionResourceType.microphone)) 'microphone',
        ];
        final ok = await native.invokeMethod<bool>('permissions', want) ?? false;
        ok ? req.grant() : req.deny();
      },
    )
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(navy)
      ..addJavaScriptChannel('SensorDeckNative', onMessageReceived: (m) => fromPage(m.message))
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: (r) {
          // the page and its own links stay here; anything else (maps, GitHub) opens in the browser
          if (r.url.startsWith(pageBase) || r.url.startsWith('about:')) return NavigationDecision.navigate;
          native.invokeMethod('open', {'url': r.url});
          return NavigationDecision.prevent;
        },
        onPageStarted: (_) => setState(() => error = null),
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) setState(() => error = e.description);
        },
      ));
    final platform = web.platform;
    if (platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(const bool.fromEnvironment('INSPECT'));
      platform.setMediaPlaybackRequiresUserGesture(false);
      platform.setGeolocationPermissionsPromptCallbacks(onShowPrompt: (_) async {
        final ok = await native.invokeMethod<bool>('permissions', ['location']) ?? false;
        return GeolocationPermissionsResponse(allow: ok, retain: false);
      });
    }
    sub = events.receiveBroadcastStream().listen((e) => push(Map<String, dynamic>.from(e as Map)));
    web.loadRequest(Uri.parse('$pageBase?app=android&appv=$appVersion'));
  }

  // readings wait here at most 50 ms; each is stamped with its age so the page can date it exactly
  double get ms => clock.elapsedMicroseconds / 1000.0;

  void push(Map<String, dynamic> item) {
    queue.add(arrive(item, ms));
    flush ??= Timer(const Duration(milliseconds: 50), send);
  }

  void send() {
    flush = null;
    if (queue.isEmpty) return;
    final m = batch(queue, ms);
    queue.clear();
    web.runJavaScript('window.SensorDeckBridge && window.SensorDeckBridge.receive(${jsonEncode(m)});');
  }

  Future<void> fromPage(String text) async {
    Map<String, dynamic> m;
    try {
      m = Map<String, dynamic>.from(jsonDecode(text) as Map);
    } catch (_) {
      return;
    }
    switch (m['cmd']) {
      case 'hello':
        final info = Map<String, dynamic>.from(await native.invokeMethod('info') as Map);
        info['Sensor Deck app'] = appVersion;
        push({'k': 'info', 'info': info});
      case 'list':
        push({'k': 'list', 'sensors': await native.invokeMethod('list')});
      case 'start':
        await native.invokeMethod('start', {'id': m['id'], 'index': m['index']});
      case 'stop':
        await native.invokeMethod('stop', {'id': m['id']});
      case 'fingerprint':
        final r = Map<String, dynamic>.from(await native.invokeMethod('fingerprint') as Map);
        push({'k': 'fp', ...r});
      case 'awake':
        await native.invokeMethod('awake', {'on': m['on'] == true});
      case 'open':
        await native.invokeMethod('open', {'url': m['url']});
    }
  }

  @override
  void dispose() {
    sub?.cancel();
    flush?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) async {
          if (didPop) return;
          if (await web.canGoBack()) {
            web.goBack();
          } else {
            SystemNavigator.pop();
          }
        },
        child: Scaffold(
          body: SafeArea(
            child: error == null
                ? WebViewWidget(controller: web)
                : Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        const Text('Sensor Deck needs the internet once to load its page.', textAlign: TextAlign.center, style: TextStyle(fontSize: 16)),
                        const SizedBox(height: 8),
                        Text(error!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Colors.white60)),
                        const SizedBox(height: 16),
                        FilledButton(onPressed: () { setState(() => error = null); web.reload(); }, child: const Text('Try again')),
                      ]),
                    ),
                  ),
          ),
        ),
      );
}
