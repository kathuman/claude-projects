# Sensor Deck for Android

The Android app for [Sensor Deck](../). It runs the same web page in a WebView and adds the sensors a web page can't
read, through a bridge to Android's `SensorManager`:

| Card | Android source |
|---|---|
| Barometer (and altitude from it) | `Sensor.TYPE_PRESSURE` |
| Temperature: battery and air | `BatteryManager.EXTRA_TEMPERATURE`, `Sensor.TYPE_AMBIENT_TEMPERATURE` |
| Humidity (and dew point) | `Sensor.TYPE_RELATIVE_HUMIDITY` |
| Proximity | `Sensor.TYPE_PROXIMITY` |
| Step counter | `Sensor.TYPE_STEP_COUNTER` (asks for *Physical activity*) |
| Light, magnetometer | `Sensor.TYPE_LIGHT`, `Sensor.TYPE_MAGNETIC_FIELD` (no Chrome flag needed) |
| Fingerprint | `BiometricPrompt` with strong biometrics |
| Any sensor | `SensorManager.getSensorList(TYPE_ALL)`: pick any one and see its raw values |

**Fingerprint:** Android keeps fingerprints in secure hardware. No app can read a print. An app can only ask Android to
check one, and Android answers matched or not. On phones whose face unlock counts as a strong biometric, Android may
offer that instead; an app can't insist on a finger.

Everything else (motion, compass, location, camera, microphone, touch, recording, the computer view) is the web page
working as it does in Chrome. The app passes camera, microphone and location permission requests on to Android.

Download: [`../download/sensor-deck.apk`](../download/sensor-deck.apk). It needs Android 7 or later on 64-bit ARM.
Install steps are on the [web page](https://kathuman.github.io/claude-projects/phone-sensors/#app-help). The app is
signed with the Flutter debug key, which works for sideloading but not for Google Play.

## How it is built

- `lib/main.dart`: the WebView, permission handling, and the page ↔ app messages.
  - The page sends `window.SensorDeckNative.postMessage({cmd})`.
  - The app answers through `window.SensorDeckBridge.receive({now, items})` every 50 ms.
- `lib/bridge.dart`: the timing. Each reading carries its age, so the page dates it to when it was measured, not when it
  arrived.
- `android/app/src/main/kotlin/.../MainActivity.kt`: the native side.
  - Sensors are registered per page id, and a sensor feeding two cards is registered once.
  - Also here: battery temperature, the sensor list, the fingerprint prompt, runtime permissions, and keep-screen-on.
- `tool/make_icons.py`: draws the launcher icon.

The page only accepts readings it expects. It drops non-finite values, and values beyond ±10⁷ such as the emulator's
−1×10³⁰ for an unset sensor (`SensorCore.sane`).

## Build

```bash
flutter pub get
flutter test                                                          # the bridge's timing
flutter build apk --release --target-platform android-arm64           # -> build/app/outputs/flutter-apk/app-release.apk
cp build/app/outputs/flutter-apk/app-release.apk ../download/sensor-deck.apk
```

To test against a local copy of the page, build in debug mode:
`flutter build apk --debug --dart-define=PAGE_URL=http://10.0.2.2:8767/phone-sensors/ --dart-define=INSPECT=true`.
- Only debug builds may load plain http.
- `INSPECT` opens the WebView to Chrome DevTools.

## Tested

On the Android 14 emulator (x86_64 debug build), with the emulator's virtual sensors set from the command line
(`adb emu sensor set …`):
- the barometer: 898.75 hPa read as about 1000 m, then 1013.25 hPa as sea level;
- air temperature 23.5 °C;
- humidity 50 %, with a dew point of 12.5 °C;
- proximity: near;
- light: 420 lx;
- the magnetometer;
- battery temperature;
- the sensor list: 18 sensors;
- the raw accelerometer at 50 Hz, reading gravity of 9.81;
- the fingerprint check correctly reporting that none was enrolled.

16 of 16 checks passed.

Not yet tested:
- a fingerprint that was enrolled afterwards matching in the app (the emulator session ended first);
- the release APK on a real phone.
