# Sensor Deck

Every sensor a phone's browser can read, live, in one page. You can record the readings or stream them to a
computer. Live: https://kathuman.github.io/claude-projects/phone-sensors/

Nothing is installed. Open the page on the phone (Chrome on Android gives the most), tap **Start sensors** and allow
what the browser asks for.

For what browsers can't read, there is the **Sensor Deck Android app** ([download](download/sensor-deck.apk),
[source and details](android/)). It runs this same page and adds the barometer, battery and air temperature,
humidity, proximity, the hardware step counter, a fingerprint check, and any other sensor the phone lists.

## What it reads

| Card | Readings | Web API |
|---|---|---|
| Accelerometer | x, y, z, magnitude (m/s², including gravity) | `DeviceMotionEvent.accelerationIncludingGravity` |
| Linear acceleration | x, y, z, magnitude (gravity removed) | `DeviceMotionEvent.acceleration` |
| Gyroscope | rotation rate about x, y, z (°/s) | `DeviceMotionEvent.rotationRate` |
| Orientation | compass heading, pitch, roll, alpha | `deviceorientationabsolute` (iOS: `webkitCompassHeading`) |
| Magnetometer | x, y, z, magnitude (µT) | `Magnetometer` (Generic Sensor API) |
| Ambient light | illuminance (lx) | `AmbientLightSensor` (Generic Sensor API) |
| Location | latitude, longitude, accuracy, altitude, speed, course | `navigator.geolocation` |
| Microphone | level (dBFS), strongest frequency, spectrum | `getUserMedia` + Web Audio `AnalyserNode` |
| Camera | average brightness and colour, preview, torch | `getUserMedia` (video), `applyConstraints({torch})` |
| Touch | fingers, pressure, position, contact size | Pointer events |
| Battery | level, charging, time to full/empty | `navigator.getBattery` |
| Network | downlink estimate, round trip, online | `navigator.connection` |
| Screen | rotation angle, viewport size | `screen.orientation` |
| Barometer *(app)* | pressure (hPa), altitude (standard atmosphere) | `Sensor.TYPE_PRESSURE` |
| Temperature *(app)* | battery °C, air °C where fitted | `BatteryManager.EXTRA_TEMPERATURE`, `TYPE_AMBIENT_TEMPERATURE` |
| Humidity *(app)* | relative humidity, dew point (Magnus) | `Sensor.TYPE_RELATIVE_HUMIDITY` |
| Proximity *(app)* | distance (cm), near | `Sensor.TYPE_PROXIMITY` |
| Step counter *(app)* | steps since boot and this session | `Sensor.TYPE_STEP_COUNTER` |
| Fingerprint *(app)* | matched or not, number of checks | `BiometricPrompt` |
| Any sensor *(app)* | raw values of any sensor Android lists | `SensorManager.getSensorList` |

The cards marked *(app)* collapse to a short note with the download link in a browser. In the app, light and the
magnetometer also come from Android directly, without the Chrome flag.
There are two more cards:
- **This device:** the model (Chrome on Android reports it), system version, cores, memory and screen, and which
  sensor APIs exist.
- **Buzz & screen:** the vibration motor, and a screen wake lock. The wake lock matters because browsers stop sensors
  when the screen sleeps.

Each card has:
- a status (on, off, not allowed, not available), and says why when a sensor can't be read;
- the live numbers and the measured sample rate;
- a 10-second chart, with a read-out of the exact values where you hover;
- a table of the latest readings;
- the API it comes from.

**Derived readings**, worked out from the raw ones:
- steps and cadence;
- shakes;
- compass heading with a needle;
- a spirit level;
- the motion rhythm (the strongest frequency of the movement over the last 5 s, about 1.8 Hz when walking);
- distance walked, counting only good GPS fixes.

## Recording

**Record** keeps every reading from every running sensor at its own rate.

**CSV** saves one row per reading (`time_s, sensor, v1…v6`). **CSV columns** says what `v1…v6` mean for each sensor.
**JSON** saves the same readings with the device information and the column names.

## Streaming to a computer

1. On the computer, open the page and choose **Computer view**. A device without a touch screen opens it by itself.
   It shows a QR code and a six-character code.
2. Scan the QR code with the phone, or type the code on the phone and tap **Connect**.
3. Start the sensors on the phone. The computer draws the same cards, the device information, the derived readings
   and a small camera picture twice a second.
4. On the computer:
   - **Buzz the phone** makes the phone vibrate;
   - the round-trip time shows the delay;
   - the computer can record as well.

How the connection works:
- The phone and the computer talk directly over a WebRTC data channel, using the vendored
  [PeerJS](https://peerjs.com/) library.
- The public PeerJS broker (`0.peerjs.com`) only introduces the two devices. Readings never pass through it.
- The phone sends a batch every 50 ms. Motion arrives at about 60 Hz.
- Everything the computer receives is checked (`checkMessage`): known message types and sensor ids only, numbers only,
  bounded sizes. The phone accepts only two things from the computer: a ping and a buzz.
- Same Wi-Fi works best. Some mobile networks and strict firewalls block direct connections. PeerJS then needs a
  relay (TURN) server, which this app doesn't use.

**Demo phone** plays a simulated phone: someone walking with it in hand in Copenhagen. It works on any device, so
the page can be tried on a desktop. **Try with a demo phone** in the computer view opens one in a new tab, already
paired.

## What a web page cannot read

Browsers don't expose these to web pages: the barometer, thermometers, the hygrometer, the proximity sensor, the
hardware step counter and the fingerprint reader. The Android app reads them.

No app at all can read the fingerprint itself. Android only says whether it matched.

Still not read: NFC tags (Chrome on Android has Web NFC, which is not used here), Bluetooth devices nearby, and
cell-tower or Wi-Fi details.

Other limits:
- **Magnetometer and light sensor:** Chrome on Android hides them behind
  `chrome://flags/#enable-generic-sensor-extra-classes`. The cards say so when they are missing.
- **iPhone (Safari):** motion, orientation, location, camera, microphone and touch work. Battery, network, vibration
  and the Generic Sensor API don't.
- **HTTPS:** all sensors need a secure page. GitHub Pages and `localhost` both qualify.

## Files

- `index.html`: the page and its styles (the Cobot Lab blueprint theme). The chart colours are validated for both
  themes against the dataviz palette checks: lightness band, colour-blind separation and 3:1 contrast.
- `app.js`: the cards, charts, derived readings, recording, the demo phone, and both ends of the link.
- `src/sensors.js`: one adapter per sensor, each with a start and a stop, plus permission and status reporting.
- `src/core.js`: everything that is plain maths, tested in Node:
  - the sensor catalogue, ring buffers and statistics;
  - the step counter (time-constant smoothing, so any sample rate behaves alike) and the shake detector;
  - the compass from alpha/beta/gamma;
  - the spirit level;
  - FFT, resampling, peak frequency, dBFS;
  - haversine distance and the GPS track;
  - CSV;
  - the message checks, the batcher and pairing codes;
  - the demo phone.
- `vendor/`: PeerJS 1.5.5 and qrcodejs 1.0.0 (both MIT).

## Tests

`node phone-sensors/tests/core.test.js` (57 checks, run in CI):
- **Steps:** 20 s of walking at 1.8 steps/s counts 36 ± 2, at 20 Hz or 60 Hz sampling. A phone lying still counts
  none, and neither does noise.
- **Shakes:** a hard back-and-forth is one shake; ordinary handling is none.
- **Compass:** flat and upright headings worked out by hand.
- **Spectrum:** the FFT puts a cosine in exactly its bins, and the peak frequency of a 2.3 Hz tone is found within
  0.05 Hz.
- **Location and export:** haversine distance (Copenhagen to Aarhus is about 157 km), track jitter rejection, and
  CSV quoting.
- **Messages:** junk, scripts, non-JPEG frames and unknown commands are refused.
- **Demo phone:** gives a value for every channel.
- **Altitude:** matches the standard atmosphere's published values (1000 m at 898.75 hPa).
- **Dew point:** matches tables (9.3 °C for 20 °C at 50 %).
- **Junk readings:** sentinels such as −1e30 are dropped.

The browser was checked with Playwright: synthetic motion and orientation events, a fake location, fake camera and
microphone, the touch pad, the demo phone, CSV/JSON downloads, phone width, and a phone page streaming to a computer
page over PeerJS. All 44 checks pass.

A second browser run (37 checks) plays the Android app's side of the bridge:
- native readings, a missing air thermometer, the sensor list, and raw values;
- fingerprint matched, failed and none-enrolled;
- keep-screen-on, and stopping every source;
- the app's readings reaching the computer view.

The app itself was checked on the Android emulator; see [android/README.md](android/README.md). Real sensors can only
be judged on a real phone.
