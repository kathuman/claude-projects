// Firmware for a design: Arduino C++ sketches that compile for the chosen controller as they are, with the pin
// numbers, PWM limit, wheel geometry, speed-loop gains, servo channels and arm geometry filled in from the parts.
//
//   selftest/selftest.ino — bring-up: I²C scan, each motor and encoder, each sensor, servos to their centre
//   robot/robot.ino       — the robot: drive with speed control and ramps (two sides, four mecanum wheels, or a
//                           balancing loop), the chosen behaviours, the arm with inverse kinematics and teach/replay,
//                           commands over USB serial, Bluetooth or Wi-Fi
//
// Only the code a design needs is emitted, so the sketches stay readable. No third-party libraries: the PCA9685 and
// MPU-6050 are driven over Wire directly, which keeps the build to the board package alone.

import { CATALOG_DATE } from './catalog.js';
import { BOARDS } from './pins.js';

const f3 = (x) => Number(x).toFixed(3);
const f2 = (x) => Number(x).toFixed(2);

// Deterministic short hash, for the Wi-Fi name and password of a design.
function hash(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function wifiCredentials(key) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let h = hash(key);
  let pass = '';
  for (let i = 0; i < 10; i++) { pass += alphabet[h % alphabet.length]; h = hash(pass + key); }
  return { ssid: `robot-${hash(key).toString(16).slice(0, 4)}`, pass };
}

// Everything the generators need, flattened from a design.
export function firmwareConfig(design, req) {
  const board = BOARDS[design.board];
  const esp = board.arch === 'esp32';
  const pins = {};
  for (const [id, p] of Object.entries(design.pins?.map ?? {})) pins[id] = p;
  const cfg = {
    title: { rover: 'Rover', tracked: 'Tracked rover', mecanum: 'Mecanum rover', balance: 'Balancing robot', arm: 'Desktop arm',
      mobile: 'Rover with arm' }[design.type],
    type: design.type, board, esp, pins, key: design.key,
    wifi: esp && design.wireless, bt: !!design.bt,
    wifiCred: wifiCredentials(design.key),
  };
  if (design.type !== 'arm') {
    const { chassis, motor, wheel, driver } = design.parts;
    const b = req.rover.behaviours;
    cfg.drive = {
      driver, scheme: driver.scheme, wheelD: wheel.diameter, track: chassis.track,
      maxSpeed: design.specs?.topSpeed ?? design.ev.perf.flat.speed,
      airSpeed: design.specs?.airSpeed ?? design.specs?.topSpeed ?? design.ev.perf.flat.speed,
      pwmLimit: Math.max(1, Math.round(255 * design.ev.perf.capDuty)), accel: req.rover.accel,
      cpr: motor.cpr, encoders: !!motor.cpr, motorV: motor.vNom, battV: design.parts.battery.vMax,
      sonar: b.includes('obstacle'), line: b.includes('line') && design.ev.kind !== 'balance',
      imu: b.includes('odometry') || design.ev.kind === 'balance',
      remote: b.includes('remote'), behaviours: b,
      kind: design.ev.kind, motors: design.ev.motors,
      // mecanum: the distance between the front and rear axles
      wheelBase: Math.max(0.05, chassis.length - wheel.diameter - 0.008),
    };
    if (design.ev.kind === 'balance') cfg.drive.balance = balanceGains(design);
  }
  if (design.arm) {
    const { frame, servos } = design.arm;
    const joints = [];
    let ch = 0;
    for (const j of frame.joints) joints.push({ name: j, ch: ch++, servo: servos[j] });
    joints.push({ name: 'gripper', ch: ch++, servo: servos.gripper });
    cfg.arm = { frame, joints, parallel: frame.parallel, hasWrist: frame.joints.includes('wrist'),
      hasRoll: frame.joints.includes('roll') };
  }
  cfg.i2c = !!(cfg.arm || cfg.drive?.imu);
  cfg.loopMs = cfg.drive?.balance ? 10 : 20;
  return cfg;
}

// Start values for the balancing loop, from the model: the lean loop gives three times the gravity torque per degree
// of lean (m·g·h per radian, shared by the motors), and damps over about 0.4 of the robot's fall time √(h/g). They
// are starting points to tune from (the K command), not final gains.
export function balanceGains(design) {
  const { ev, parts } = design;
  const b = ev.perf.balance;
  const n = parts.chassis.driven;
  const Ts = parts.motor.stallTorque * (parts.battery.vNom * ev.perf.capDuty) / parts.motor.vNom;
  const perDeg = (3 * ev.mass * 9.81 * b.h * Math.PI) / 180;
  const kp = Math.min(60, Math.max(5, (perDeg / (n * Ts)) * 255));
  const tau = Math.sqrt(b.h / 9.81);
  return { kp, kd: kp * tau * 0.4, h: b.h, lean: b.lean };
}

const inputMode = (cfg, id) => (cfg.pins[id].caps.has('out') ? 'INPUT_PULLUP' : 'INPUT');

// ---------------------------------------------------------------- shared pieces

function header(cfg, what) {
  const b = cfg.board;
  const ide = cfg.esp
    ? 'Arduino IDE 2 with the "esp32" board package by Espressif (3.x): Tools > Board > esp32 > ESP32 Dev Module.'
    : `Arduino IDE 2: Tools > Board > Arduino AVR Boards > ${b.name}${b.name.includes('Nano') ? ' (Processor: ATmega328P; try "Old Bootloader" if the upload fails)' : ''}.`;
  return `// ${cfg.title}: ${what}
// Generated by Robot Configurator from its parts catalog of ${CATALOG_DATE}.
// Controller: ${b.name}. Upload with ${ide}
// Serial monitor: 115200 baud, line ending "Newline".
`;
}

// Types used in function signatures go first: the Arduino IDE inserts its generated prototypes before the first
// function, so a type declared later would be unknown there.
const typesBlock = () => `// ---- Types
struct LineReader {
  char buf[64];
  uint8_t len;
};
`;

function pinConsts(cfg) {
  const lines = Object.entries(cfg.pins).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, p]) => `const uint8_t PIN_${id} = ${p.code};${' '.repeat(Math.max(1, 12 - id.length - p.code.length))}// ${p.label}`);
  return lines.length ? `// ---- Pins (as wired from the wiring table)\n${lines.join('\n')}\n` : '';
}

function pcaCode() {
  return `
// ---- PCA9685 servo driver, driven over I2C directly (address 0x40, 50 Hz)
const uint8_t PCA_ADDR = 0x40;

void pcaWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(PCA_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

void pcaBegin() {
  pcaWrite(0x00, 0x10);   // MODE1: sleep, so the prescaler can be set
  pcaWrite(0xFE, 121);    // prescale = round(25 MHz / (4096 * 50 Hz)) - 1
  pcaWrite(0x00, 0x20);   // wake, register auto-increment
  delay(1);
  pcaWrite(0x00, 0xA0);   // restart PWM channels
}

// Pulse width in microseconds on one channel (one period is 20 ms = 4096 ticks).
void pcaPulse(uint8_t channel, uint16_t us) {
  uint16_t ticks = (uint32_t)us * 4096UL / 20000UL;
  Wire.beginTransmission(PCA_ADDR);
  Wire.write(0x06 + 4 * channel);
  Wire.write(0);
  Wire.write(0);
  Wire.write(ticks & 0xFF);
  Wire.write(ticks >> 8);
  Wire.endTransmission();
}
`;
}

function imuCode() {
  return `
// ---- MPU-6050 gyro (I2C 0x68): heading from the z-axis rate
const uint8_t IMU_ADDR = 0x68;
float gyroBias = 0;

void imuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

int16_t imuRead16(uint8_t reg) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((int)IMU_ADDR, 2);
  int16_t hi = Wire.read();
  int16_t lo = Wire.read();
  return (hi << 8) | lo;
}

// Gyro z rate in degrees per second (±250 °/s range, 131 counts per °/s).
float gyroZ() { return imuRead16(0x47) / 131.0f - gyroBias; }

void imuBegin() {
  imuWrite(0x6B, 0x00);   // wake up
  imuWrite(0x1B, 0x00);   // gyro ±250 °/s
  imuWrite(0x1A, 0x03);   // 44 Hz low-pass filter
  delay(100);
  float sum = 0;          // the robot must stand still while the bias is measured
  for (int i = 0; i < 200; i++) { sum += imuRead16(0x47) / 131.0f; delay(3); }
  gyroBias = sum / 200;
}
`;
}

// Pitch for a balancing robot: the accelerometer gives the lean against gravity (noisy, but it never drifts), the gyro
// its rate (smooth, but it drifts); a complementary filter blends the two.
function tiltCode() {
  return `
// ---- Tilt (MPU-6050 flat, its X arrow pointing forward): pitch from accelerometer and gyro, blended
const bool IMU_FLIP = false;   // set true if leaning forward makes the angle fall (see the self-test)
float gyroBiasY = 0;
float pitch = 0;               // degrees, positive = leaning forward
float pitchRate = 0;           // degrees per second

float accelPitch() {
  float ax = imuRead16(0x3B);
  float az = imuRead16(0x3F);
  float a = degrees(atan2(-ax, az));
  return IMU_FLIP ? -a : a;
}

void tiltBegin() {
  float sum = 0;          // still standing still from imuBegin()
  for (int i = 0; i < 200; i++) { sum += imuRead16(0x45) / 131.0f; delay(3); }
  gyroBiasY = sum / 200;
  pitch = accelPitch();
}

void tiltUpdate(float dt) {
  float rate = imuRead16(0x45) / 131.0f - gyroBiasY;
  pitchRate = IMU_FLIP ? -rate : rate;
  pitch = 0.98f * (pitch + pitchRate * dt) + 0.02f * accelPitch();
}
`;
}

// ---------------------------------------------------------------- drive

function driveChannelCode(scheme) {
  switch (scheme) {
    case 'en-in': return `// One H-bridge channel: direction on IN1/IN2, speed as PWM on the enable pin.
void driveChannel(uint8_t en, uint8_t in1, uint8_t in2, int power) {
  digitalWrite(in1, power > 0 ? HIGH : LOW);
  digitalWrite(in2, power < 0 ? HIGH : LOW);
  analogWrite(en, abs(power));
}`;
    case 'in-in': return `// One H-bridge channel: PWM on IN1 for forward, on IN2 for reverse (the other input held low).
void driveChannel(uint8_t in1, uint8_t in2, int power) {
  analogWrite(in1, power > 0 ? power : 0);
  analogWrite(in2, power < 0 ? -power : 0);
}`;
    case 'pwm-dir': return `// One channel: direction on DIR, speed as PWM.
void driveChannel(uint8_t pwm, uint8_t dir, int power) {
  digitalWrite(dir, power < 0 ? HIGH : LOW);
  analogWrite(pwm, abs(power));
}`;
    case 'two-pwm': return `// One BTS7960 board: PWM on RPWM for forward, on LPWM for reverse (the other held low).
void driveChannel(uint8_t rpwm, uint8_t lpwm, int power) {
  analogWrite(rpwm, power > 0 ? power : 0);
  analogWrite(lpwm, power < 0 ? -power : 0);
}`;
    default: throw new Error(`unknown driver scheme ${scheme}`);
  }
}

function channelPins(scheme, s) {
  return {
    'en-in': [`PIN_${s}_EN`, `PIN_${s}_IN1`, `PIN_${s}_IN2`],
    'in-in': [`PIN_${s}_IN1`, `PIN_${s}_IN2`],
    'pwm-dir': [`PIN_${s}_PWM`, `PIN_${s}_DIR`],
    'two-pwm': [`PIN_${s}_RPWM`, `PIN_${s}_LPWM`],
  }[scheme];
}

const MOTOR_LABEL = { FL: 'FRONT LEFT', RL: 'REAR LEFT', FR: 'FRONT RIGHT', RR: 'REAR RIGHT' };

// Four motors, one per mecanum wheel, each on its own driver channel. Indices follow the wiring: 0 front left,
// 1 rear left, 2 front right, 3 rear right.
function motorCore4(cfg, { selftest = false } = {}) {
  const d = cfg.drive;
  const isr = cfg.esp ? 'IRAM_ATTR ' : '';
  const outs = d.motors.flatMap((m) => channelPins(d.scheme, m));
  let code = `
// ---- Motors: 0 front left, 1 rear left, 2 front right, 3 rear right
const uint8_t MOTOR_COUNT = 4;
const int PWM_LIMIT = ${d.pwmLimit};${d.pwmLimit < 255 ? `            // ${Math.round(d.pwmLimit / 2.55)} % of 255: a full ${f2(d.battV)} V battery gives the ${d.motorV} V motors at most their rating` : '            // the battery never exceeds the motor rating'}
${selftest ? 'bool INVERT[MOTOR_COUNT] = {false, false, false, false};  // the self-test drives the raw directions' : 'const bool INVERT[MOTOR_COUNT] = {false, false, false, false};  // true for a wheel that turns backwards on "forward" (see the self-test)'}

${driveChannelCode(d.scheme)}

${d.encoders ? `// the direction each wheel was last driven, which its encoder counts in (only channel A is wired)
volatile int8_t motorDir[MOTOR_COUNT] = {1, 1, 1, 1};

` : ''}// power from -255 (full reverse) to 255 (full forward)
void motorWrite(uint8_t m, int power) {
  power = constrain(power, -PWM_LIMIT, PWM_LIMIT);${d.encoders ? '\n  if (power != 0) motorDir[m] = power > 0 ? 1 : -1;' : ''}
  if (INVERT[m]) power = -power;
  switch (m) {
${d.motors.map((m, i) => `    case ${i}: driveChannel(${channelPins(d.scheme, m).join(', ')}, power); break;`).join('\n')}
  }
}

void motorsBegin() {
${outs.map((p) => `  pinMode(${p}, OUTPUT);`).join('\n')}
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) motorWrite(m, 0);
}
`;
  if (d.encoders) {
    code += `
// ---- Encoders: channel A only (four encoders with both channels need more pins than the board has); each count
// takes the direction the wheel is being driven, which is exact except for the moment a wheel reverses
const float COUNTS_PER_REV = ${d.cpr}.0f;   // channel-A rising edges per wheel revolution
volatile long encTicks[MOTOR_COUNT] = {0, 0, 0, 0};

${d.motors.map((m, i) => `void ${isr}enc${m}ISR() { encTicks[${i}] += motorDir[${i}]; }`).join('\n')}

long readTicks(uint8_t m) {
  noInterrupts();
  long t = encTicks[m];
  interrupts();
  return t;
}

void encodersBegin() {
${d.motors.map((m) => `  pinMode(PIN_${m}_ENCA, ${inputMode(cfg, `${m}_ENCA`)});`).join('\n')}
${d.motors.map((m) => `  attachInterrupt(digitalPinToInterrupt(PIN_${m}_ENCA), enc${m}ISR, RISING);`).join('\n')}
}
`;
  }
  return code;
}

function motorCore(cfg, { selftest = false } = {}) {
  const d = cfg.drive;
  if (d.kind === 'mecanum') return motorCore4(cfg, { selftest });
  const isr = cfg.esp ? 'IRAM_ATTR ' : '';
  const outs = ['L', 'R'].flatMap((s) => channelPins(d.scheme, s));
  let code = `
// ---- Motors
const int PWM_LIMIT = ${d.pwmLimit};${d.pwmLimit < 255 ? `            // ${Math.round(d.pwmLimit / 2.55)} % of 255: a full ${f2(d.battV)} V battery gives the ${d.motorV} V motors at most their rating` : '            // the battery never exceeds the motor rating'}
${selftest ? 'bool INVERT_LEFT = false, INVERT_RIGHT = false;  // the self-test drives the raw directions' : `const bool INVERT_LEFT = false;   // set true if the left wheel turns backwards on "forward" (see the self-test)
const bool INVERT_RIGHT = false;  // the same for the right wheel`}

${driveChannelCode(d.scheme)}

// side 0 = left, 1 = right; power from -255 (full reverse) to 255 (full forward)
void motorWrite(uint8_t side, int power) {
  power = constrain(power, -PWM_LIMIT, PWM_LIMIT);
  if (side == 0 ? INVERT_LEFT : INVERT_RIGHT) power = -power;
  if (side == 0) driveChannel(${channelPins(d.scheme, 'L').join(', ')}, power);
  else driveChannel(${channelPins(d.scheme, 'R').join(', ')}, power);
}

void motorsBegin() {
${outs.map((p) => `  pinMode(${p}, OUTPUT);`).join('\n')}
  motorWrite(0, 0);
  motorWrite(1, 0);
}
`;
  if (d.encoders) {
    code += `
// ---- Encoders: channel A interrupts, channel B gives the direction
const float COUNTS_PER_REV = ${d.cpr}.0f;   // channel-A rising edges per wheel revolution
${selftest ? 'const bool INVERT_ENC_LEFT = false, INVERT_ENC_RIGHT = false;' : `const bool INVERT_ENC_LEFT = false;   // set true if the left count falls while the wheel turns forward
const bool INVERT_ENC_RIGHT = false;`}
volatile long encTicks[2] = {0, 0};

void ${isr}encLeftISR() { encTicks[0] += (digitalRead(PIN_L_ENCB) ? -1 : 1) * (INVERT_ENC_LEFT ? -1 : 1); }
void ${isr}encRightISR() { encTicks[1] += (digitalRead(PIN_R_ENCB) ? -1 : 1) * (INVERT_ENC_RIGHT ? -1 : 1); }

long readTicks(uint8_t side) {
  noInterrupts();
  long t = encTicks[side];
  interrupts();
  return t;
}

void encodersBegin() {
  pinMode(PIN_L_ENCA, ${inputMode(cfg, 'L_ENCA')});
  pinMode(PIN_L_ENCB, ${inputMode(cfg, 'L_ENCB')});
  pinMode(PIN_R_ENCA, ${inputMode(cfg, 'R_ENCA')});
  pinMode(PIN_R_ENCB, ${inputMode(cfg, 'R_ENCB')});
  attachInterrupt(digitalPinToInterrupt(PIN_L_ENCA), encLeftISR, RISING);
  attachInterrupt(digitalPinToInterrupt(PIN_R_ENCA), encRightISR, RISING);
}
`;
  }
  return code;
}

function sensorCode(cfg) {
  const d = cfg.drive;
  let code = '';
  if (d.sonar) {
    code += `
// ---- HC-SR04 distance (m); 4 m when nothing echoes within 25 ms
float readDistance() {
  digitalWrite(PIN_SONAR_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_SONAR_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_SONAR_TRIG, LOW);
  unsigned long us = pulseIn(PIN_SONAR_ECHO, HIGH, 25000UL);
  if (us == 0) return 4.0f;
  return us * 0.000343f / 2;
}
`;
  }
  if (d.line) {
    code += `
// ---- Line sensor, OUT1 = leftmost
const uint8_t LINE_PINS[5] = {PIN_LINE1, PIN_LINE2, PIN_LINE3, PIN_LINE4, PIN_LINE5};
const bool LINE_ON_HIGH = true;   // the module output level over the black line; check it in the self-test

// Bit i set when sensor i sees the line.
uint8_t readLine() {
  uint8_t bits = 0;
  for (uint8_t i = 0; i < 5; i++) if ((digitalRead(LINE_PINS[i]) == HIGH) == LINE_ON_HIGH) bits |= 1 << i;
  return bits;
}
`;
  }
  return code;
}

function sensorsBegin(cfg) {
  const d = cfg.drive;
  const l = [];
  if (d.sonar) { l.push('  pinMode(PIN_SONAR_TRIG, OUTPUT);'); l.push(`  pinMode(PIN_SONAR_ECHO, INPUT);`); }
  if (d.line) for (let i = 1; i <= 5; i++) l.push(`  pinMode(PIN_LINE${i}, ${inputMode(cfg, `LINE${i}`)});`);
  return l.join('\n');
}

// Mecanum: forward, sideways and turn commands become four wheel speeds (rollers in an X seen from above).
function mecanumControl(cfg) {
  const d = cfg.drive;
  let code = `
// ---- Drive: body speed command → ramped → four wheel speeds → ${d.encoders ? 'PI speed loop per wheel' : 'open-loop PWM'}
const float WHEEL_DIAMETER = ${f3(d.wheelD)}f;   // m; measure your wheels and correct
const float TRACK_WIDTH = ${f3(d.track)}f;      // m between the left and right wheel centres; measure and correct
const float WHEEL_BASE = ${f3(d.wheelBase)}f;       // m between the front and rear axles; measure and correct
const float MAX_WHEEL_SPEED = ${f2(d.maxSpeed)}f;   // m/s at PWM_LIMIT (from the motor model; the self-test measures it)
const float MAX_ACCEL = ${f2(d.accel)}f;         // m/s²; the ramp also keeps the start-up current down
const unsigned long COMMAND_TIMEOUT = 600;   // ms: remote driving stops when commands stop arriving

float targetV = 0, targetS = 0, targetW = 0;   // forward m/s, sideways m/s (positive = left), turn rad/s (positive = left)
float rampV = 0, rampS = 0, rampW = 0;
float wheelTarget[MOTOR_COUNT] = {0, 0, 0, 0};
`;
  if (d.encoders) {
    code += `const float KP = 0.50f * PWM_LIMIT / MAX_WHEEL_SPEED;   // PWM per m/s of speed error
const float KI = 2.00f * PWM_LIMIT / MAX_WHEEL_SPEED;   // PWM per m of accumulated error
float integral[MOTOR_COUNT] = {0, 0, 0, 0};
float wheelSpeed[MOTOR_COUNT] = {0, 0, 0, 0};
long lastTicks[MOTOR_COUNT] = {0, 0, 0, 0};
float odoDistance = 0;    // m travelled forward
float odoSideways = 0;    // m travelled sideways (positive = left)
float odoHeading = 0;     // degrees, positive = left
`;
  }
  code += `
void driveUpdate(float dt) {
  const float k = (TRACK_WIDTH + WHEEL_BASE) / 2;
  rampV += constrain(targetV - rampV, -MAX_ACCEL * dt, MAX_ACCEL * dt);
  rampS += constrain(targetS - rampS, -MAX_ACCEL * dt, MAX_ACCEL * dt);
  float maxAlpha = MAX_ACCEL / k;
  rampW += constrain(targetW - rampW, -maxAlpha * dt, maxAlpha * dt);
  wheelTarget[0] = rampV - rampS - rampW * k;   // front left
  wheelTarget[1] = rampV + rampS - rampW * k;   // rear left
  wheelTarget[2] = rampV + rampS + rampW * k;   // front right
  wheelTarget[3] = rampV - rampS + rampW * k;   // rear right
  float peak = 0;
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) peak = max(peak, (float)fabs(wheelTarget[m]));
  if (peak > MAX_WHEEL_SPEED) for (uint8_t m = 0; m < MOTOR_COUNT; m++) wheelTarget[m] *= MAX_WHEEL_SPEED / peak;
`;
  if (d.encoders) {
    code += `  const float metresPerTick = PI * WHEEL_DIAMETER / COUNTS_PER_REV;
  float step[MOTOR_COUNT];
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) {
    long t = readTicks(m);
    step[m] = (t - lastTicks[m]) * metresPerTick;
    lastTicks[m] = t;
    wheelSpeed[m] = step[m] / dt;
    float target = wheelTarget[m];
    if (fabs(target) < 0.005f && fabs(wheelSpeed[m]) < 0.02f) { integral[m] = 0; motorWrite(m, 0); continue; }
    float err = target - wheelSpeed[m];
    integral[m] = constrain(integral[m] + err * dt, -0.3f * PWM_LIMIT / KI, 0.3f * PWM_LIMIT / KI);
    float pwm = target / MAX_WHEEL_SPEED * PWM_LIMIT + KP * err + KI * integral[m];
    motorWrite(m, (int)pwm);
  }
  odoDistance += (step[0] + step[1] + step[2] + step[3]) / 4;
  odoSideways += (-step[0] + step[1] + step[2] - step[3]) / 4;
${d.imu ? '  odoHeading += gyroZ() * dt;' : '  odoHeading += degrees((-step[0] - step[1] + step[2] + step[3]) / (4 * k));'}
}
`;
  } else {
    code += `  for (uint8_t m = 0; m < MOTOR_COUNT; m++) motorWrite(m, (int)(wheelTarget[m] / MAX_WHEEL_SPEED * PWM_LIMIT));
}
`;
  }
  return code;
}

// Balancing: an outer speed loop turns the speed error into a lean to hold, an inner loop drives the wheels under the
// centre of mass to reach that lean. Wheel encoders give the speed; the turn is a difference between the wheels.
function balanceControl(cfg) {
  const d = cfg.drive;
  const g = d.balance;
  return `
// ---- Balance: the speed loop asks for a lean, the lean loop drives the wheels under the centre of mass
const float WHEEL_DIAMETER = ${f3(d.wheelD)}f;   // m; measure your wheels and correct
const float TRACK_WIDTH = ${f3(d.track)}f;      // m between the wheel centres; measure and correct
const float MAX_WHEEL_SPEED = ${f2(d.maxSpeed)}f;   // m/s at PWM_LIMIT (from the motor model; the self-test measures it)
const float MAX_ACCEL = ${f2(d.accel)}f;         // m/s²: how fast the commanded speed changes
const unsigned long COMMAND_TIMEOUT = 600;   // ms: remote driving stops when commands stop arriving
// Start values from the model (centre of mass ${(g.h * 1000).toFixed(0)} mm above the axle); tune them with K, then write them here.
float BALANCE_ZERO = 0;              // degrees read when it stands balanced on its own (the self-test or Z measures it)
float ANGLE_KP = ${f2(g.kp)}f;           // PWM per degree of lean
float ANGLE_KD = ${f2(g.kd)}f;            // PWM per degree per second
float SPEED_KP = 8.0f;               // degrees of lean per m/s of speed error
float SPEED_KI = 4.0f;               // degrees of lean per metre of accumulated speed error
const float MAX_LEAN = 8;            // degrees the speed loop may ask for
const float FALL_ANGLE = 45;         // degrees: past this the motors stop; stand it up to start again
const int DEADBAND = 8;              // PWM that only overcomes gearbox friction; raise it if the wheels hesitate
const float TURN_GAIN = PWM_LIMIT / MAX_WHEEL_SPEED * TRACK_WIDTH / 2;   // PWM per rad/s of turn

float targetV = 0, targetW = 0;   // commanded forward speed (m/s) and turn rate (rad/s, positive = left)
float rampV = 0;
float wheelSpeed[2] = {0, 0};
long lastTicks[2] = {0, 0};
float odoDistance = 0;    // m travelled (mean of both wheels)
float odoHeading = 0;     // degrees, positive = left
float speedFiltered = 0, speedIntegral = 0;
bool fallen = true;       // it starts lying down; it balances once stood up within 3 degrees

void driveUpdate(float dt) {
  tiltUpdate(dt);
  const float metresPerTick = PI * WHEEL_DIAMETER / COUNTS_PER_REV;
  float step[2];
  for (uint8_t s = 0; s < 2; s++) {
    long t = readTicks(s);
    step[s] = (t - lastTicks[s]) * metresPerTick;
    lastTicks[s] = t;
    wheelSpeed[s] = step[s] / dt;
  }
  odoDistance += (step[0] + step[1]) / 2;
  odoHeading += gyroZ() * dt;
  speedFiltered += 0.2f * ((wheelSpeed[0] + wheelSpeed[1]) / 2 - speedFiltered);

  float lean = pitch - BALANCE_ZERO;
  if (fabs(lean) > FALL_ANGLE) fallen = true;
  if (fallen) {
    motorWrite(0, 0);
    motorWrite(1, 0);
    if (fabs(lean) < 3) { fallen = false; speedIntegral = 0; rampV = 0; }
    return;
  }
  rampV += constrain(targetV - rampV, -MAX_ACCEL * dt, MAX_ACCEL * dt);
  float speedErr = rampV - speedFiltered;
  speedIntegral = constrain(speedIntegral + speedErr * dt, -MAX_LEAN / SPEED_KI, MAX_LEAN / SPEED_KI);
  float targetLean = constrain(SPEED_KP * speedErr + SPEED_KI * speedIntegral, -MAX_LEAN, MAX_LEAN);
  float power = ANGLE_KP * (lean - targetLean) + ANGLE_KD * pitchRate;
  if (power > 0) power += DEADBAND;
  else if (power < 0) power -= DEADBAND;
  float turn = TURN_GAIN * targetW;
  motorWrite(0, (int)(power - turn));
  motorWrite(1, (int)(power + turn));
}
`;
}

function driveControl(cfg) {
  const d = cfg.drive;
  if (d.kind === 'mecanum') return mecanumControl(cfg);
  if (d.balance) return balanceControl(cfg);
  const kp = 0.5;
  const ki = 2.0;
  let code = `
// ---- Drive: body speed command → ramped wheel speeds → ${d.encoders ? 'PI speed loop per wheel' : 'open-loop PWM'}
const float WHEEL_DIAMETER = ${f3(d.wheelD)}f;   // m; measure your wheels and correct
const float TRACK_WIDTH = ${f3(d.track)}f;      // m between the wheel centres; measure and correct
const float MAX_WHEEL_SPEED = ${f2(d.maxSpeed)}f;   // m/s at PWM_LIMIT (from the motor model; the self-test measures it)
const float MAX_ACCEL = ${f2(d.accel)}f;         // m/s²; the ramp also keeps the start-up current down
const unsigned long COMMAND_TIMEOUT = 600;   // ms: remote driving stops when commands stop arriving

float targetV = 0, targetW = 0;   // commanded forward speed (m/s) and turn rate (rad/s, positive = left)
float rampV = 0, rampW = 0;
float wheelTarget[2] = {0, 0};
`;
  if (d.encoders) {
    code += `const float KP = ${f2(kp)}f * PWM_LIMIT / MAX_WHEEL_SPEED;   // PWM per m/s of speed error
const float KI = ${f2(ki)}f * PWM_LIMIT / MAX_WHEEL_SPEED;   // PWM per m of accumulated error
float integral[2] = {0, 0};
float wheelSpeed[2] = {0, 0};
long lastTicks[2] = {0, 0};
float odoDistance = 0;    // m travelled (mean of both wheels)
float odoHeading = 0;     // degrees, positive = left
`;
  }
  code += `
void driveUpdate(float dt) {
  rampV += constrain(targetV - rampV, -MAX_ACCEL * dt, MAX_ACCEL * dt);
  float maxAlpha = 2 * MAX_ACCEL / TRACK_WIDTH;
  rampW += constrain(targetW - rampW, -maxAlpha * dt, maxAlpha * dt);
  float vl = rampV - rampW * TRACK_WIDTH / 2;
  float vr = rampV + rampW * TRACK_WIDTH / 2;
  float peak = max(fabs(vl), fabs(vr));
  if (peak > MAX_WHEEL_SPEED) { vl *= MAX_WHEEL_SPEED / peak; vr *= MAX_WHEEL_SPEED / peak; }
  wheelTarget[0] = vl;
  wheelTarget[1] = vr;
`;
  if (d.encoders) {
    code += `  const float metresPerTick = PI * WHEEL_DIAMETER / COUNTS_PER_REV;
  float step[2];
  for (uint8_t s = 0; s < 2; s++) {
    long t = readTicks(s);
    step[s] = (t - lastTicks[s]) * metresPerTick;
    lastTicks[s] = t;
    wheelSpeed[s] = step[s] / dt;
    float target = wheelTarget[s];
    if (fabs(target) < 0.005f && fabs(wheelSpeed[s]) < 0.02f) { integral[s] = 0; motorWrite(s, 0); continue; }
    float err = target - wheelSpeed[s];
    integral[s] = constrain(integral[s] + err * dt, -0.3f * PWM_LIMIT / KI, 0.3f * PWM_LIMIT / KI);
    float pwm = target / MAX_WHEEL_SPEED * PWM_LIMIT + KP * err + KI * integral[s];
    motorWrite(s, (int)pwm);
  }
  odoDistance += (step[0] + step[1]) / 2;
${d.imu ? '  odoHeading += gyroZ() * dt;' : '  odoHeading += degrees((step[1] - step[0]) / TRACK_WIDTH);'}
}
`;
  } else {
    code += `  for (uint8_t s = 0; s < 2; s++) motorWrite(s, (int)(wheelTarget[s] / MAX_WHEEL_SPEED * PWM_LIMIT));
}
`;
  }
  return code;
}

function behaviourCode(cfg) {
  const d = cfg.drive;
  const modes = ['IDLE', 'REMOTE'];
  if (d.sonar) modes.push('AVOID');
  if (d.line) modes.push('LINE');
  if (d.encoders) modes.push('MOVE');
  let code = `
// ---- Behaviours
enum Mode { ${modes.map((m) => `MODE_${m}`).join(', ')} };
const char* const MODE_NAMES[] = { ${modes.map((m) => `"${m.toLowerCase()}"`).join(', ')} };
const uint8_t MODE_COUNT = ${modes.length};
Mode mode = MODE_IDLE;
unsigned long lastCommand = 0;
`;
  if (d.sonar) {
    code += `
// Obstacle avoidance: cruise, slow down as something gets close, back off and turn away from it.
enum AvoidState { CRUISE, BACKUP, TURN };
AvoidState avoidState = CRUISE;
unsigned long avoidUntil = 0;
float turnDir = 1;
float lastDistance = 4.0f;
unsigned long lastPing = 0;
const float AVOID_STOP = 0.25f;   // m
const float AVOID_SLOW = 0.60f;   // m

void avoidStep() {
  unsigned long now = millis();
  if (now - lastPing >= 60) { lastDistance = readDistance(); lastPing = now; }
  const float cruise = 0.5f * MAX_WHEEL_SPEED;
  switch (avoidState) {
    case CRUISE:
      if (lastDistance < AVOID_STOP) {
        avoidState = BACKUP;
        avoidUntil = now + 400;
        targetV = -0.3f * cruise;
        targetW = 0;
      } else {
        float k = constrain((lastDistance - AVOID_STOP) / (AVOID_SLOW - AVOID_STOP), 0.3f, 1.0f);
        targetV = cruise * k;
        targetW = 0;
      }
      break;
    case BACKUP:
      if (now >= avoidUntil) {
        avoidState = TURN;
        turnDir = random(2) ? 1 : -1;
        avoidUntil = now + random(300, 900);
        targetV = 0;
        targetW = 2.0f * turnDir;
      }
      break;
    case TURN:
      if (now >= avoidUntil) avoidState = CRUISE;
      break;
  }
}
`;
  }
  if (d.line) {
    code += `
// Line following: the weighted line position steers (PD), the speed drops in sharp curves.
const float LINE_SPEED = ${f2(Math.min(0.3, 0.4 * d.maxSpeed))}f;   // m/s
const float LINE_KP = 2.5f;     // rad/s per sensor of offset
const float LINE_KD = 0.15f;
float lineError = 0, lastLineError = 0;

void lineStep(float dt) {
  uint8_t bits = readLine();
  if (bits == 0) {   // lost: spin towards the side the line was last seen
    targetV = 0;
    targetW = lastLineError > 0 ? -2.5f : 2.5f;
    return;
  }
  float sum = 0;
  uint8_t count = 0;
  for (uint8_t i = 0; i < 5; i++) if (bits & (1 << i)) { sum += (int)i - 2; count++; }
  lineError = sum / count;                 // -2 (far left) … +2 (far right)
  float derr = (lineError - lastLineError) / dt;
  lastLineError = lineError;
  targetW = -(LINE_KP * lineError + LINE_KD * derr);
  targetV = LINE_SPEED * (1 - 0.3f * fabs(lineError));
}
`;
  }
  if (d.encoders) {
    code += `
// Measured moves: drive a distance or turn an angle, slowing down at the end.
float moveDistance = 0, moveAngle = 0, moveStartDist = 0, moveStartHeading = 0;

void startMove(float metres, float degreesLeft) {
  moveDistance = metres;
  moveAngle = degreesLeft;
  moveStartDist = odoDistance;
  moveStartHeading = odoHeading;
  mode = MODE_MOVE;
}

void moveStep() {
  if (moveDistance != 0) {
    float left = moveDistance - (odoDistance - moveStartDist);
    if (left * (moveDistance > 0 ? 1 : -1) <= 0.005f) { moveDistance = 0; targetV = 0; mode = MODE_IDLE; return; }
    targetV = constrain(1.5f * left, -0.5f * MAX_WHEEL_SPEED, 0.5f * MAX_WHEEL_SPEED);
    if (fabs(targetV) < 0.05f) targetV = left > 0 ? 0.05f : -0.05f;
    targetW = 0;
  } else {
    float left = moveAngle - (odoHeading - moveStartHeading);
    if (fabs(left) <= 2) { targetW = 0; mode = MODE_IDLE; return; }
    targetW = constrain(radians(left) * 2.0f, -2.0f, 2.0f);
    if (fabs(targetW) < 0.4f) targetW = left > 0 ? 0.4f : -0.4f;
    targetV = 0;
  }
}
`;
  }
  return code;
}

// ---------------------------------------------------------------- arm

function armCode(cfg) {
  const a = cfg.arm;
  const fr = a.frame;
  const mm = (m) => (m * 1000).toFixed(0);
  const defaults = {
    base: { zero: 90, dir: 1 },
    shoulder: { zero: 0, dir: 1 },
    elbow: a.parallel ? { zero: 90, dir: 1 } : { zero: 180, dir: 1 },
    wrist: { zero: 90, dir: 1 },
    roll: { zero: 90, dir: 1 },
    gripper: { zero: 0, dir: 1 },
  };
  const rows = a.joints.map((j) => {
    const d = defaults[j.name];
    const lo = j.name === 'gripper' ? 20 : 10;
    const hi = j.name === 'gripper' ? 120 : 170;
    return `  {"${j.name}", ${j.ch}, 500, 2500, ${d.zero}, ${d.dir}, ${lo}, ${hi}, 90, 90},   // ${j.servo.name}`;
  });
  const idx = Object.fromEntries(a.joints.map((j, i) => [j.name, i]));
  return `
// ---- Arm
// Each servo angle (0–180°) is zero + dir × the kinematic joint angle. Assemble every joint with its servo at 90°
// in the home pose: base facing forward, upper arm vertical, ${a.parallel ? 'forearm horizontal' : 'forearm horizontal (90° to the upper arm)'}${a.hasWrist ? ', wrist in line with the forearm' : ''}.
// Then correct zero and dir per joint if a joint moves the wrong way (see the calibration step in the build guide).
struct Joint {
  const char* name;
  uint8_t channel;      // PCA9685 output
  int16_t usMin, usMax; // pulse widths at 0° and 180°
  float zero, dir;      // servo angle = zero + dir * joint angle
  float lo, hi;         // allowed servo angles (keeps clear of the end stops)
  float cur, target;    // servo angles now and commanded
};

Joint joints[] = {
${rows.join('\n')}
};
const uint8_t JOINT_COUNT = sizeof(joints) / sizeof(joints[0]);
const uint8_t GRIPPER = ${idx.gripper};
const float GRIP_CLOSED = 20, GRIP_OPEN = 110;   // gripper servo angles; set from the calibration step
float jointSpeed = 60;                           // degrees per second

// Geometry (mm), from the frame: shoulder height, upper arm, forearm, ${a.hasWrist ? 'wrist axis' : 'forearm tip'} to grip point
const float BASE_H = ${mm(fr.baseH)}, L1 = ${mm(fr.L1)}, L2 = ${mm(fr.L2)}, TOOL = ${mm(fr.tool)};

void setServoAngle(uint8_t i, float deg) {
  joints[i].target = constrain(deg, joints[i].lo, joints[i].hi);
}

void writeServo(uint8_t i) {
  Joint& j = joints[i];
  pcaPulse(j.channel, j.usMin + (uint16_t)((j.usMax - j.usMin) * j.cur / 180.0f));
}

void armBegin() {
  pcaBegin();
  for (uint8_t i = 0; i < JOINT_COUNT; i++) writeServo(i);
}

// Move every servo toward its target at jointSpeed; true while any is still moving.
bool armUpdate(float dt) {
  bool moving = false;
  for (uint8_t i = 0; i < JOINT_COUNT; i++) {
    Joint& j = joints[i];
    float diff = j.target - j.cur;
    if (fabs(diff) < 0.05f) continue;
    float step = constrain(diff, -jointSpeed * dt, jointSpeed * dt);
    j.cur += step;
    writeServo(i);
    moving = true;
  }
  return moving;
}

// Inverse kinematics: grip point (x forward, y left, z up, mm, from the base centre on the table)${a.hasWrist ? ' and tool pitch (degrees, 0 = level, -90 = pointing down)' : ''}.
// Writes the servo targets and returns true, or returns false when the point is out of reach or past a joint limit.
bool moveTo(float x, float y, float z, float pitchDeg) {
${a.hasWrist ? '' : '  pitchDeg = 0;   // the parallel linkage keeps the gripper level\n'}  float yaw = atan2(y, x);
  float r = sqrt(x * x + y * y);
  float phi = radians(pitchDeg);
  float wr = r - TOOL * cos(phi);
  float wz = z - BASE_H - TOOL * sin(phi);
  float D = (wr * wr + wz * wz - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  if (D < -1 || D > 1) return false;
  float q2 = -acos(D);                                         // elbow up
  float q1 = atan2(wz, wr) - atan2(L2 * sin(q2), L1 + L2 * cos(q2));
  float s[${a.joints.length}];
  for (uint8_t i = 0; i < JOINT_COUNT; i++) s[i] = joints[i].target;
  s[${idx.base}] = joints[${idx.base}].zero + joints[${idx.base}].dir * degrees(yaw);
  s[${idx.shoulder}] = joints[${idx.shoulder}].zero + joints[${idx.shoulder}].dir * degrees(q1);
  s[${idx.elbow}] = joints[${idx.elbow}].zero + joints[${idx.elbow}].dir * degrees(${a.parallel ? 'q1 + q2' : 'q2'});
${a.hasWrist ? `  s[${idx.wrist}] = joints[${idx.wrist}].zero + joints[${idx.wrist}].dir * degrees(phi - q1 - q2);\n` : ''}  for (uint8_t i = 0; i < JOINT_COUNT; i++) if (s[i] < joints[i].lo || s[i] > joints[i].hi) return false;
  for (uint8_t i = 0; i < JOINT_COUNT; i++) joints[i].target = s[i];
  return true;
}

void setGripper(float percentOpen) {
  setServoAngle(GRIPPER, GRIP_CLOSED + (GRIP_OPEN - GRIP_CLOSED) * constrain(percentOpen, 0.0f, 100.0f) / 100);
}

void armHome() {
  for (uint8_t i = 0; i < JOINT_COUNT; i++) setServoAngle(i, 90);
}

// Teach and replay: up to 8 poses in RAM (printed with "L" so they can be pasted back after a reset)
const uint8_t MAX_POSES = 8;
float poses[MAX_POSES][${a.joints.length}];
uint8_t poseCount = 0;
int8_t replayIndex = -1;
unsigned long replayPause = 0;

void replayStep(bool moving) {
  if (replayIndex < 0 || moving || millis() < replayPause) return;
  if (replayIndex >= poseCount) { replayIndex = -1; return; }
  for (uint8_t i = 0; i < JOINT_COUNT; i++) setServoAngle(i, poses[replayIndex][i]);
  replayIndex++;
  replayPause = millis() + 300;
}
`;
}

// ---------------------------------------------------------------- commands and links

function commandCode(cfg) {
  const d = cfg.drive;
  const a = cfg.arm;
  const help = [];
  const m4 = d?.kind === 'mecanum';
  const zeroS = m4 ? ' targetS =' : '';
  if (d) {
    help.push(m4 ? 'D v w s  drive: v m/s forward, w rad/s left, s m/s sideways to the left (repeat within 0.6 s)'
      : 'D v w    drive: v m/s forward, w rad/s left (repeat within 0.6 s)');
    help.push(`M n      mode: ${['idle', 'remote', d.sonar && 'avoid', d.line && 'line'].filter(Boolean).map((m, i) => `${i} ${m}`).join(', ')}`);
    if (d.encoders) { help.push('F m      drive forward m metres (negative = back)'); help.push('T deg    turn deg degrees (positive = left)'); }
    help.push('S        stop');
    if (d.balance) {
      help.push('K p d    lean gains (PWM per degree, PWM per degree/s); K p d sp si also sets the speed gains');
      help.push('Z        the angle it stands at now is the balance point');
    }
  }
  if (a) {
    help.push('J i deg  servo i to deg (0-180)');
    help.push(`P x y z${a.hasWrist ? ' p' : ''}  grip point in mm${a.hasWrist ? ', tool pitch p degrees' : ''}`);
    help.push('G pct    gripper open 0-100 %');
    help.push('H        home pose');
    help.push('V dps    joint speed, degrees per second');
    help.push('W        save the current pose');
    help.push('R        replay saved poses');
    help.push('L        list saved poses');
    help.push('C        clear saved poses');
  }
  help.push('?        status and this help');

  const cases = [];
  if (d) {
    cases.push(`    case 'D':
      targetV = constrain(a1, -MAX_WHEEL_SPEED, MAX_WHEEL_SPEED);
      targetW = a2;${m4 ? '\n      targetS = constrain(a3, -MAX_WHEEL_SPEED, MAX_WHEEL_SPEED);' : ''}
      mode = MODE_REMOTE;
      lastCommand = millis();
      out.println(F("ok"));
      break;
    case 'M':
      if (a1 >= 0 && a1 < MODE_COUNT) {
        mode = (Mode)(int)a1;
        targetV =${zeroS} targetW = 0;
        lastCommand = millis();
        out.print(F("mode "));
        out.println(MODE_NAMES[mode]);
      } else out.println(F("error: no such mode"));
      break;
    case 'S':
      mode = MODE_IDLE;
      targetV =${zeroS} targetW = 0;${a ? '\n      replayIndex = -1;' : ''}
      out.println(F("stopped"));
      break;`);
    if (d.balance) {
      cases.push(`    case 'K':
      if (n >= 2) { ANGLE_KP = a1; ANGLE_KD = a2; }
      if (n >= 4) { SPEED_KP = a3; SPEED_KI = a4; }
      out.print(F("ANGLE_KP "));
      out.print(ANGLE_KP, 2);
      out.print(F("  ANGLE_KD "));
      out.print(ANGLE_KD, 2);
      out.print(F("  SPEED_KP "));
      out.print(SPEED_KP, 2);
      out.print(F("  SPEED_KI "));
      out.println(SPEED_KI, 2);
      break;
    case 'Z':
      BALANCE_ZERO = pitch;
      out.print(F("BALANCE_ZERO "));
      out.println(BALANCE_ZERO, 2);
      break;`);
    }
    if (d.encoders) {
      cases.push(`    case 'F':
      startMove(a1, 0);
      out.println(F("ok"));
      break;
    case 'T':
      startMove(0, a1);
      out.println(F("ok"));
      break;`);
    }
  }
  if (a) {
    cases.push(`    case 'J':
      if (n >= 2 && a1 >= 0 && a1 < JOINT_COUNT) { setServoAngle((uint8_t)a1, a2); out.println(F("ok")); }
      else out.println(F("error: J index degrees"));
      break;
    case 'P':
      if (n >= 3 && moveTo(a1, a2, a3, n >= 4 ? a4 : ${a.hasWrist ? '-45' : '0'})) out.println(F("ok"));
      else out.println(F("error: out of reach or past a joint limit"));
      break;
    case 'G':
      setGripper(a1);
      out.println(F("ok"));
      break;
    case 'H':
      armHome();
      out.println(F("ok"));
      break;
    case 'V':
      jointSpeed = constrain(a1, 5.0f, 360.0f);
      out.println(F("ok"));
      break;
    case 'W':
      if (poseCount < MAX_POSES) {
        for (uint8_t i = 0; i < JOINT_COUNT; i++) poses[poseCount][i] = joints[i].target;
        poseCount++;
        out.print(F("saved pose "));
        out.println(poseCount);
      } else out.println(F("error: memory full"));
      break;
    case 'R':
      replayIndex = 0;
      out.println(F("replaying"));
      break;
    case 'L':
      for (uint8_t p = 0; p < poseCount; p++) {
        for (uint8_t i = 0; i < JOINT_COUNT; i++) {
          out.print(F("J "));
          out.print(i);
          out.print(' ');
          out.println(poses[p][i], 1);
        }
        out.println(F("W"));
      }
      break;
    case 'C':
      poseCount = 0;
      out.println(F("cleared"));
      break;`);
  }
  const status = [];
  if (d) {
    status.push(`  out.print(F("mode "));
  out.println(MODE_NAMES[mode]);`);
    if (d.balance) status.push(`  out.print(F("lean deg "));
  out.print(pitch - BALANCE_ZERO, 1);
  out.println(fallen ? F("  (down: stand it up to balance)") : F("  (balancing)"));`);
    if (d.encoders) status.push(`  out.print(F("wheel speeds m/s"));
  for (uint8_t m = 0; m < ${m4 ? 4 : 2}; m++) {
    out.print(' ');
    out.print(wheelSpeed[m], 2);
  }
  out.println();
  out.print(F("distance m "));
  out.print(odoDistance, 2);
  out.print(F("  heading deg "));
  out.println(odoHeading, 1);`);
    if (d.sonar) status.push(`  out.print(F("obstacle m "));
  out.println(readDistance(), 2);`);
  }
  if (a) status.push(`  out.print(F("servos"));
  for (uint8_t i = 0; i < JOINT_COUNT; i++) {
    out.print(' ');
    out.print(joints[i].cur, 1);
  }
  out.println();`);

  return `
// ---- Commands: one per line, from USB serial${cfg.bt ? ', Bluetooth' : ''}${cfg.wifi ? ' or the Wi-Fi page' : ''}
void printHelp(Print& out) {
${help.map((h) => `  out.println(F("${h}"));`).join('\n')}
}

void handleCommand(char* line, Print& out) {
  char* tok = strtok(line, " ,");
  if (!tok) return;
  char c = toupper(tok[0]);
  float args[4] = {0, 0, 0, 0};
  uint8_t n = 0;
  while (n < 4 && (tok = strtok(NULL, " ,")) != NULL) args[n++] = atof(tok);
  float a1 = args[0], a2 = args[1], a3 = args[2], a4 = args[3];
  (void)a3;
  (void)a4;
  switch (c) {
${cases.join('\n')}
    case '?':
${status.join('\n')}
      printHelp(out);
      break;
    default:
      out.println(F("unknown command; ? for help"));
  }
}

// Collects characters from a stream into lines (LineReader is declared at the top).
void readLines(Stream& in, LineReader& r) {
  while (in.available()) {
    char ch = in.read();
    if (ch == '\\n' || ch == '\\r') {
      if (r.len) {
        r.buf[r.len] = 0;
        handleCommand(r.buf, in);
        r.len = 0;
      }
    } else if (r.len < sizeof(r.buf) - 1) {
      r.buf[r.len++] = ch;
    }
  }
}
`;
}

function webPage(cfg) {
  const d = cfg.drive;
  const a = cfg.arm;
  let body = '';
  let script = `const send=(c)=>fetch('/cmd?c='+encodeURIComponent(c)).then(r=>r.text()).then(t=>{document.getElementById('log').textContent=t});\n`;
  if (d) {
    const modeButtons = ['Idle', 'Remote', d.sonar && 'Avoid', d.line && 'Line'].filter(Boolean)
      .map((m, i) => `<button onclick="send('M ${i}')">${m}</button>`).join('');
    const slide = d.kind === 'mecanum' ? '<label><input type="checkbox" id="slide" style="width:auto"> joystick slides sideways</label>' : '';
    body += `<h2>Drive</h2><div id="pad"><div id="knob"></div></div>${slide}<div class="row">${modeButtons}<button class="stop" onclick="send('S')">Stop</button></div>`;
    script += `const pad=document.getElementById('pad'),knob=document.getElementById('knob');let jx=0,jy=0,held=false;
function place(e){const r=pad.getBoundingClientRect(),p=e.touches?e.touches[0]:e;let x=(p.clientX-r.left)/r.width*2-1,y=(p.clientY-r.top)/r.height*2-1;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m}jx=x;jy=y;knob.style.left=(50+x*40)+'%';knob.style.top=(50+y*40)+'%'}
function release(){held=false;jx=jy=0;knob.style.left=knob.style.top='50%';send('D 0 0')}
pad.addEventListener('pointerdown',e=>{held=true;pad.setPointerCapture(e.pointerId);place(e)});pad.addEventListener('pointermove',e=>{if(held)place(e)});pad.addEventListener('pointerup',release);pad.addEventListener('pointercancel',release);
${d.kind === 'mecanum'
    ? `setInterval(()=>{if(held){const s=document.getElementById('slide').checked;send('D '+(-jy*${f2(d.maxSpeed)}).toFixed(2)+' '+(s?0:-jx*3).toFixed(2)+' '+(s?-jx*${f2(d.maxSpeed)}:0).toFixed(2))}},150);`
    : `setInterval(()=>{if(held)send('D '+(-jy*${f2(d.maxSpeed)}).toFixed(2)+' '+(-jx*3).toFixed(2))},150);`}\n`;
  }
  if (a) {
    const sliders = a.joints.map((j, i) => `<label>${j.name}<input type="range" min="0" max="180" value="90" oninput="send('J ${i} '+this.value)"></label>`).join('');
    body += `<h2>Arm</h2>${sliders}<div class="row"><button onclick="send('H')">Home</button><button onclick="send('G 100')">Open</button><button onclick="send('G 0')">Close</button><button onclick="send('W')">Save pose</button><button onclick="send('R')">Replay</button><button onclick="send('C')">Clear</button></div>`;
  }
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cfg.title}</title>
<style>body{font-family:system-ui,sans-serif;margin:16px;max-width:480px;background:#111;color:#eee}button{font-size:16px;padding:10px 14px;margin:4px;border-radius:8px;border:0;background:#2b6;color:#fff}.stop{background:#c33}#pad{position:relative;width:100%;aspect-ratio:1;background:#222;border-radius:50%;touch-action:none}#knob{position:absolute;left:50%;top:50%;width:22%;height:22%;margin:-11% 0 0 -11%;border-radius:50%;background:#2b6}label{display:block;margin:10px 0}input{width:100%}pre{color:#9c9}</style></head>
<body><h1>${cfg.title}</h1>${body}<pre id="log"></pre><script>${script}</script></body></html>`;
}

// A C string literal, split into lines of at most ~100 characters. (Not a raw string: the IDE's prototype
// generator misreads raw strings that contain braces.)
function cString(text) {
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const out = [];
  for (const line of text.split('\n')) {
    const chunks = [];
    for (let i = 0; i < line.length; i += 100) chunks.push(line.slice(i, i + 100));
    if (!chunks.length) chunks.push('');
    chunks[chunks.length - 1] += '\n';
    out.push(...chunks.map((c) => esc(c).replace('\n', '\\n')));
  }
  return out.map((l) => `  "${l}"`).join('\n');
}

function wifiCode(cfg) {
  return `
// ---- Wi-Fi: the robot is its own access point; open http://192.168.4.1 on a phone joined to it
#include <WiFi.h>
#include <WebServer.h>
const char* AP_SSID = "${cfg.wifiCred.ssid}";
const char* AP_PASS = "${cfg.wifiCred.pass}";   // change it if you like (8+ characters)
WebServer server(80);

const char PAGE[] =
${cString(webPage(cfg))};

// Captures a command's reply for the web response.
class StringPrint : public Print {
 public:
  String text;
  size_t write(uint8_t c) override {
    text += (char)c;
    return 1;
  }
};

void wifiBegin() {
  WiFi.softAP(AP_SSID, AP_PASS);
  server.on("/", []() { server.send(200, "text/html", String(PAGE)); });
  server.on("/cmd", []() {
    char line[64];
    server.arg("c").toCharArray(line, sizeof(line));
    StringPrint reply;
    handleCommand(line, reply);
    server.send(200, "text/plain", reply.text);
  });
  server.begin();
  Serial.print(F("Wi-Fi: join "));
  Serial.print(AP_SSID);
  Serial.print(F(" (password "));
  Serial.print(AP_PASS);
  Serial.println(F(") and open http://192.168.4.1"));
}
`;
}

// ---------------------------------------------------------------- the robot sketch

export function robotSketch(cfg) {
  const d = cfg.drive;
  const a = cfg.arm;
  const includes = ['#include <Arduino.h>'];
  if (cfg.i2c) includes.push('#include <Wire.h>');
  if (cfg.bt) includes.push('#include <SoftwareSerial.h>');
  let code = header(cfg, 'robot program') + '\n' + includes.join('\n') + '\n\n' + typesBlock() + '\n' + pinConsts(cfg);
  if (a) code += pcaCode();
  if (d?.imu) code += imuCode();
  if (d?.balance) code += tiltCode();
  if (d) code += motorCore(cfg) + sensorCode(cfg) + driveControl(cfg) + behaviourCode(cfg);
  if (a) code += armCode(cfg);
  code += commandCode(cfg);
  if (cfg.bt) code += `
// ---- Bluetooth (HC-05, 9600 baud): pair with PIN 1234 and use a serial terminal app (Android; iPhones cannot use
// classic Bluetooth serial)
SoftwareSerial bt(PIN_BT_RX, PIN_BT_TX);
LineReader btReader = {{0}, 0};
`;
  if (cfg.wifi) code += wifiCode(cfg);

  const setup = ['  Serial.begin(115200);'];
  if (cfg.i2c) setup.push('  Wire.begin();');
  if (d) {
    setup.push('  motorsBegin();');
    if (d.encoders) setup.push('  encodersBegin();');
    const sb = sensorsBegin(cfg);
    if (sb) setup.push(sb);
    if (d.imu) setup.push(d.balance ? '  imuBegin();   // lay it down or hold it still for two seconds\n  tiltBegin();' : '  imuBegin();   // keep the robot still for a second');
    if (d.sonar) setup.push('  randomSeed(analogRead(A0));');
  }
  if (a) setup.push('  armBegin();');
  if (cfg.bt) setup.push('  bt.begin(9600);');
  if (cfg.wifi) setup.push('  wifiBegin();');
  setup.push(`  Serial.println(F("${cfg.title} ready."));`);
  setup.push('  printHelp(Serial);');

  const loop = [];
  loop.push('  readLines(Serial, serialReader);');
  if (cfg.bt) loop.push('  readLines(bt, btReader);');
  if (cfg.wifi) loop.push('  server.handleClient();');
  loop.push(`
  unsigned long now = millis();
  if (now - lastUpdate < ${cfg.loopMs}) return;   // ${1000 / cfg.loopMs} Hz control loop
  float dt = (now - lastUpdate) / 1000.0f;
  lastUpdate = now;`);
  if (d) {
    const zs = d.kind === 'mecanum' ? ' targetS =' : '';
    const sw = [`    case MODE_IDLE:\n      targetV =${zs} targetW = 0;\n      break;`,
      `    case MODE_REMOTE:\n      if (now - lastCommand > COMMAND_TIMEOUT) targetV =${zs} targetW = 0;\n      break;`];
    if (d.sonar) sw.push('    case MODE_AVOID:\n      avoidStep();\n      break;');
    if (d.line) sw.push('    case MODE_LINE:\n      lineStep(dt);\n      break;');
    if (d.encoders) sw.push('    case MODE_MOVE:\n      moveStep();\n      break;');
    loop.push(`  switch (mode) {
${sw.join('\n')}
  }
  driveUpdate(dt);`);
  }
  if (a) loop.push('  replayStep(armUpdate(dt));');

  code += `
LineReader serialReader = {{0}, 0};
unsigned long lastUpdate = 0;

void setup() {
${setup.join('\n')}
}

void loop() {
${loop.join('\n')}
}
`;
  return code;
}

// ---------------------------------------------------------------- the self-test sketch

export function selftestSketch(cfg) {
  const d = cfg.drive;
  const a = cfg.arm;
  const includes = ['#include <Arduino.h>'];
  if (cfg.i2c) includes.push('#include <Wire.h>');
  if (cfg.bt) includes.push('#include <SoftwareSerial.h>');
  let code = header(cfg, 'self-test (run this first, step by step, from the serial monitor)') + '\n'
    + includes.join('\n') + '\n\n' + pinConsts(cfg);
  if (a) code += pcaCode();
  if (d?.balance) code += imuCode() + tiltCode();
  if (d) code += motorCore(cfg, { selftest: true }) + sensorCode(cfg);
  if (cfg.bt) code += '\nSoftwareSerial bt(PIN_BT_RX, PIN_BT_TX);\n';
  code += `
void waitKey(const __FlashStringHelper* what) {
  Serial.println();
  Serial.println(what);
  Serial.println(F("  -> send any character to continue"));
  while (!Serial.available()) delay(10);
  delay(20);
  while (Serial.available()) Serial.read();
}
`;
  const steps = [];
  steps.push(`  Serial.begin(115200);
  delay(500);
  Serial.println(F("=== ${cfg.title} self-test ==="));`);
  if (cfg.i2c) {
    const expect = [a && '0x40 = PCA9685 servo driver', d?.imu && '0x68 = MPU-6050'].filter(Boolean).join(', ');
    steps.push(`  Wire.begin();
  Serial.println(F("I2C scan (expect ${expect}):"));
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("  found 0x"));
      Serial.println(addr, HEX);
    }
  }`);
  }
  if (d) {
    steps.push(`  motorsBegin();${d.encoders ? '\n  encodersBegin();' : ''}
  waitKey(F("MOTORS: lift the robot so the wheels spin freely."));`);
    const m4 = d.kind === 'mecanum';
    if (m4) {
      d.motors.forEach((m, i) => {
        steps.push(`  Serial.println(F("${MOTOR_LABEL[m]} motor forward at 40 % for 1.5 s ..."));${d.encoders ? `\n  long before${i} = readTicks(${i});` : ''}
  motorWrite(${i}, PWM_LIMIT * 2 / 5);
  delay(1500);
  motorWrite(${i}, 0);${d.encoders ? `\n  Serial.print(F("  encoder counts: "));\n  Serial.println(readTicks(${i}) - before${i});` : ''}
  Serial.println(F("  It must have turned FORWARD. If it went backwards, set INVERT[${i}] = true in robot.ino."));${d.encoders ? `\n  Serial.println(F("  The count must be above zero; 0 means its encoder A wire is not connected."));` : ''}
  delay(800);`);
      });
    }
    for (const [side, name] of m4 ? [] : [[0, 'LEFT'], [1, 'RIGHT']]) {
      steps.push(`  Serial.println(F("${name} motor forward at 40 % for 1.5 s ..."));${d.encoders ? `\n  long before${side} = readTicks(${side});` : ''}
  motorWrite(${side}, PWM_LIMIT * 2 / 5);
  delay(1500);
  motorWrite(${side}, 0);${d.encoders ? `\n  Serial.print(F("  encoder counts: "));\n  Serial.println(readTicks(${side}) - before${side});` : ''}
  Serial.println(F("  It must have turned FORWARD. If it went backwards, set INVERT_${name} = true in robot.ino."));${d.encoders ? `\n  Serial.println(F("  The count must be positive. If it was negative, set INVERT_ENC_${name} = true."));` : ''}
  delay(800);`);
    }
    if (d.encoders && m4) {
      steps.push(`  Serial.println(F("Full-speed test, 2 s (wheels in the air read a little faster than on the floor) ..."));
  long t0[MOTOR_COUNT];
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) t0[m] = readTicks(m);
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) motorWrite(m, PWM_LIMIT);
  delay(2000);
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) motorWrite(m, 0);
  float perTick = PI * ${f3(d.wheelD)} / ${d.cpr}.0;
  float sp[MOTOR_COUNT];
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) sp[m] = abs(readTicks(m) - t0[m]) * perTick / 2;
  float speedL = min(sp[0], sp[1]);
  float speedR = min(sp[2], sp[3]);
  Serial.print(F("  wheel speeds m/s, front left, rear left, front right, rear right:"));
  for (uint8_t m = 0; m < MOTOR_COUNT; m++) {
    Serial.print(' ');
    Serial.print(sp[m], 2);
  }
  Serial.println();
  Serial.println(F("  Put about 90 % of the lowest number in MAX_WHEEL_SPEED in robot.ino."));
  Serial.println(F("  The model says ${f2(d.airSpeed)} m/s in the air. Paste the next line into the page to compare:"));
  Serial.print(F("RESULT speed_air_left="));
  Serial.print(speedL, 2);
  Serial.print(F(" speed_air_right="));
  Serial.println(speedR, 2);`);
    } else if (d.encoders) {
      steps.push(`  Serial.println(F("Full-speed test, 2 s (wheels in the air read a little faster than on the floor) ..."));
  long l0 = readTicks(0), r0 = readTicks(1);
  motorWrite(0, PWM_LIMIT);
  motorWrite(1, PWM_LIMIT);
  delay(2000);
  motorWrite(0, 0);
  motorWrite(1, 0);
  float perTick = PI * ${f3(d.wheelD)} / ${d.cpr}.0;
  float speedL = abs(readTicks(0) - l0) * perTick / 2;
  float speedR = abs(readTicks(1) - r0) * perTick / 2;
  Serial.print(F("  wheel speed m/s, left "));
  Serial.print(speedL, 2);
  Serial.print(F(", right "));
  Serial.println(speedR, 2);
  Serial.println(F("  Put about 90 % of the lower number in MAX_WHEEL_SPEED in robot.ino."));
  Serial.println(F("  The model says ${f2(d.airSpeed)} m/s in the air. Paste the next line into the page to compare:"));
  Serial.print(F("RESULT speed_air_left="));
  Serial.print(speedL, 2);
  Serial.print(F(" speed_air_right="));
  Serial.println(speedR, 2);`);
    }
    if (d.sonar) {
      steps.push(`  pinMode(PIN_SONAR_TRIG, OUTPUT);
  pinMode(PIN_SONAR_ECHO, INPUT);
  waitKey(F("DISTANCE SENSOR: hold your hand 10-50 cm in front of it."));
  for (uint8_t i = 0; i < 10; i++) {
    Serial.print(F("  distance m "));
    Serial.println(readDistance(), 2);
    delay(300);
  }`);
    }
    if (d.line) {
      steps.push(`${sensorsBegin({ ...cfg, drive: { ...d, sonar: false } })}
  waitKey(F("LINE SENSOR: put the robot on the floor with the middle sensor over the black line."));
  for (uint8_t i = 0; i < 10; i++) {
    Serial.print(F("  sensors (1 = sees line, left to right) "));
    uint8_t bits = readLine();
    for (uint8_t s = 0; s < 5; s++) Serial.print(bits & (1 << s) ? '1' : '0');
    Serial.println();
    delay(300);
  }
  Serial.println(F("  Only the middle one should read 1. If the pattern is inverted, set LINE_ON_HIGH = false."));`);
    }
    if (d.balance) {
      steps.push(`  waitKey(F("TILT: lay the robot on its back and keep it still for two seconds (the gyro is measured)."));
  imuBegin();
  tiltBegin();
  waitKey(F("Now hold it upright, wheels on the floor, at the angle where it would stay up by itself."));
  float zero = 0;
  for (uint8_t i = 0; i < 50; i++) { tiltUpdate(0.01f); zero += pitch / 50; delay(10); }
  Serial.print(F("  angle at the balance point, degrees: "));
  Serial.println(zero, 1);
  Serial.println(F("  Put this number in BALANCE_ZERO in robot.ino (or stand it there and send Z later)."));
  waitKey(F("Lean it FORWARD by about 20 degrees and hold it there."));
  float fwd = 0;
  for (uint8_t i = 0; i < 50; i++) { tiltUpdate(0.01f); fwd += pitch / 50; delay(10); }
  Serial.print(F("  angle leaning forward, degrees: "));
  Serial.println(fwd, 1);
  Serial.println(fwd > zero ? F("  Good: leaning forward raises the angle.") : F("  It fell: set IMU_FLIP = true in robot.ino."));`);
    } else if (d.imu) {
      steps.push(`  Wire.beginTransmission(0x68);
  Wire.write(0x75);
  Wire.endTransmission(false);
  Wire.requestFrom(0x68, 1);
  Serial.print(F("MPU-6050 WHO_AM_I (expect 0x68): 0x"));
  Serial.println(Wire.available() ? Wire.read() : 0, HEX);`);
    }
  }
  if (a) {
    steps.push(`  waitKey(F("SERVOS: remove the servo horns or keep the arm clear. Each servo goes to 90 degrees in turn."));
  pcaBegin();
  for (uint8_t ch = 0; ch < ${a.joints.length}; ch++) {
    Serial.print(F("  channel "));
    Serial.print(ch);
    Serial.println(F(" -> 90 degrees"));
    pcaPulse(ch, 1500);
    delay(800);
  }
  Serial.println(F("  Now fit each horn with its joint in the home pose (see the build guide). The servos hold 90."));`);
  }
  if (cfg.bt) {
    steps.push(`  bt.begin(9600);
  waitKey(F("BLUETOOTH: pair your phone with HC-05 (PIN 1234), open a serial terminal app and connect."));
  Serial.println(F("  Type something in the phone app within 20 s ..."));
  unsigned long until = millis() + 20000;
  while (millis() < until) {
    if (bt.available()) Serial.write(bt.read());
  }
  Serial.println();`);
  }
  if (cfg.wifi) {
    steps.push(`  Serial.println(F("Wi-Fi: the robot program starts its own network ${cfg.wifiCred.ssid}; nothing to test here."));`);
  }
  steps.push('  Serial.println(F("=== Self-test done. Upload robot.ino next. ==="));');
  code += `
void setup() {
${steps.join('\n\n')}
}

void loop() {}
`;
  return code;
}

export function readme(cfg) {
  const b = cfg.board;
  return `${cfg.title}: programs
=====================================

Generated by Robot Configurator (parts catalog ${CATALOG_DATE}).

1. Install Arduino IDE 2 (arduino.cc/en/software).
2. ${cfg.esp ? 'Boards Manager: install "esp32 by Espressif Systems" (version 3.x). Board: ESP32 Dev Module.'
    : `Board: ${b.name} (Arduino AVR Boards, built in). Clone boards with a CH340 USB chip may need the CH340
   driver on Windows or older macOS.`}
3. Open selftest/selftest.ino, upload it, open the serial monitor at 115200 baud with "Newline", and follow it
   step by step. Note the settings it tells you to change.
4. Open robot/robot.ino, apply those settings at the top, and upload it.
5. Type ? in the serial monitor for the command list.${cfg.wifi ? `

Wi-Fi: join "${cfg.wifiCred.ssid}" (password ${cfg.wifiCred.pass}) and open http://192.168.4.1` : ''}${cfg.bt ? `

Bluetooth: pair with HC-05 (PIN 1234) and send the same commands from a serial terminal app (Android).` : ''}

No extra libraries are needed.
`;
}

export function generateFirmware(design, req) {
  const cfg = firmwareConfig(design, req);
  return {
    cfg,
    files: [
      { path: 'selftest/selftest.ino', content: selftestSketch(cfg) },
      { path: 'robot/robot.ino', content: robotSketch(cfg) },
      { path: 'README.txt', content: readme(cfg) },
    ],
  };
}
