# Sensor Deck

Every sensor a phone's browser can read, live, in one page. You can record the readings or stream them to a
computer. Live: https://kathuman.github.io/claude-projects/phone-sensors/

Nothing is installed. Open the page on the phone (Chrome on Android gives the most), tap **Start sensors** and allow
what the browser asks for.

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

Browsers don't expose some phone sensors to web pages: the barometer, the proximity sensor, the hardware step counter,
the fingerprint reader, NFC tags (Chrome on Android has Web NFC, which is not used here), Bluetooth devices nearby,
and cell-tower or Wi-Fi details. Reading them would need a native Android app.

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

`node phone-sensors/tests/core.test.js` (52 checks, run in CI):
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

The browser was checked with Playwright: synthetic motion and orientation events, a fake location, fake camera and
microphone, the touch pad, the demo phone, CSV/JSON downloads, phone width, and a phone page streaming to a computer
page over PeerJS. All 44 checks pass. Real sensors can only be judged on a real phone.
