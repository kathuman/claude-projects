package io.github.kathuman.sensor_deck

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * The native half of Sensor Deck. The Flutter side shows the Sensor Deck web page in a WebView; this activity reads what
 * a web page cannot: Android's SensorManager (barometer, air temperature, humidity, proximity, light, magnetometer, the
 * step counter, and any other sensor by its index in the list), the battery's temperature, and a BiometricPrompt
 * fingerprint check.
 *
 * Channels:
 *  - MethodChannel "sensordeck/native": info, list, start {id, index}, stop {id}, permissions [names], fingerprint,
 *    awake {on}, open {url}.
 *  - EventChannel "sensordeck/events": maps already in the page's format. Readings are {k:"s", id, v, t, sent}, where
 *    t is the reading's time and sent the time it left here, both ms of elapsedRealtime. There are also
 *    {k:"status", id, state, text} and {k:"fp", result, text}.
 */
class MainActivity : FlutterFragmentActivity(), SensorEventListener {
    private lateinit var sm: SensorManager
    private var sink: EventChannel.EventSink? = null
    private val main = Handler(Looper.getMainLooper())

    // which page ids each registered sensor feeds (one sensor can feed two, e.g. "pressure" and "raw")
    private val users = HashMap<Sensor, MutableSet<String>>()
    private val byId = HashMap<String, Sensor>()

    private var batteryOn = false
    private val batteryPoll = object : Runnable {
        override fun run() { sendBattery(); if (batteryOn) main.postDelayed(this, 2000) }
    }
    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) { sendBattery(i) }
    }

    private var pendingPermission: MethodChannel.Result? = null

    override fun configureFlutterEngine(engine: FlutterEngine) {
        super.configureFlutterEngine(engine)
        sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        EventChannel(engine.dartExecutor.binaryMessenger, "sensordeck/events").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) { sink = events }
            override fun onCancel(arguments: Any?) { sink = null }
        })
        MethodChannel(engine.dartExecutor.binaryMessenger, "sensordeck/native").setMethodCallHandler { call, result ->
            when (call.method) {
                "info" -> result.success(info())
                "list" -> result.success(sensorList())
                "start" -> { start(call.argument<String>("id") ?: "", call.argument<Int>("index")); result.success(true) }
                "stop" -> { stop(call.argument<String>("id") ?: ""); result.success(true) }
                "permissions" -> permissions(call.arguments as? List<*> ?: emptyList<String>(), result)
                "fingerprint" -> fingerprint(result)
                "awake" -> {
                    if (call.argument<Boolean>("on") == true) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    result.success(true)
                }
                "open" -> {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(call.argument<String>("url")))); result.success(true) }
                    catch (e: Exception) { result.success(false) }
                }
                else -> result.notImplemented()
            }
        }
    }

    // ---- what the phone is
    private fun info(): Map<String, String> {
        val all = sm.getSensorList(Sensor.TYPE_ALL)
        val bio = BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        return mapOf(
            "Model" to "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}",
            "Android" to "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            "Sensors (Android's list)" to all.size.toString(),
            "Barometer" to has(Sensor.TYPE_PRESSURE),
            "Air thermometer" to has(Sensor.TYPE_AMBIENT_TEMPERATURE),
            "Hygrometer" to has(Sensor.TYPE_RELATIVE_HUMIDITY),
            "Fingerprint / strong biometrics" to when (bio) {
                BiometricManager.BIOMETRIC_SUCCESS -> "yes, enrolled"
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "yes, none enrolled"
                else -> "no"
            }
        )
    }
    private fun has(type: Int) = if (sm.getDefaultSensor(type) != null) "yes" else "no"

    private fun sensorList(): List<Map<String, Any>> = sm.getSensorList(Sensor.TYPE_ALL).mapIndexed { i, s ->
        mapOf(
            "index" to i, "name" to s.name, "vendor" to s.vendor, "type" to s.type, "typeName" to typeName(s),
            "range" to s.maximumRange.toDouble(), "resolution" to s.resolution.toDouble(), "power" to s.power.toDouble(), "minDelay" to s.minDelay
        )
    }
    private fun typeName(s: Sensor): String {
        val t = s.stringType ?: ""
        return if (t.startsWith("android.sensor.")) t.removePrefix("android.sensor.").replace('_', ' ') else t.ifEmpty { "type ${s.type}" }
    }

    // ---- sensors
    private val types = mapOf(
        "pressure" to Sensor.TYPE_PRESSURE, "ambient" to Sensor.TYPE_AMBIENT_TEMPERATURE, "humidity" to Sensor.TYPE_RELATIVE_HUMIDITY,
        "proximity" to Sensor.TYPE_PROXIMITY, "light" to Sensor.TYPE_LIGHT, "mag" to Sensor.TYPE_MAGNETIC_FIELD, "steps" to Sensor.TYPE_STEP_COUNTER
    )
    private val names = mapOf(
        "pressure" to "barometer", "ambient" to "air thermometer", "humidity" to "hygrometer", "proximity" to "proximity sensor",
        "light" to "light sensor", "mag" to "magnetometer", "steps" to "step counter"
    )

    private fun start(id: String, index: Int?) {
        when (id) {
            "battery" -> startBattery()
            "steps" -> if (Build.VERSION.SDK_INT >= 29 && !granted(Manifest.permission.ACTIVITY_RECOGNITION)) {
                askThen(arrayOf(Manifest.permission.ACTIVITY_RECOGNITION)) { ok ->
                    if (ok) register(id, sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER))
                    else status(id, "denied", "Allow Physical activity for Sensor Deck in Android's settings.")
                }
            } else register(id, sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER))
            "raw" -> {
                stop("raw")
                val list = sm.getSensorList(Sensor.TYPE_ALL)
                register("raw", if (index != null && index in list.indices) list[index] else null)
            }
            else -> register(id, types[id]?.let { sm.getDefaultSensor(it) })
        }
    }

    private fun register(id: String, s: Sensor?) {
        if (s == null) { status(id, "unavailable", "This phone has no ${names[id] ?: "such sensor"}."); return }
        val ids = users.getOrPut(s) { mutableSetOf() }
        if (ids.isEmpty()) {
            val rate = if (id == "raw") SensorManager.SENSOR_DELAY_GAME else SensorManager.SENSOR_DELAY_UI
            if (!sm.registerListener(this, s, rate)) { status(id, "error", "Android refused to start the ${names[id] ?: "sensor"}."); return }
        }
        ids.add(id); byId[id] = s
        status(id, "on", "")
    }

    private fun stop(id: String) {
        if (id == "battery") { stopBattery(); return }
        val s = byId.remove(id) ?: return
        val ids = users[s] ?: return
        ids.remove(id)
        if (ids.isEmpty()) { sm.unregisterListener(this, s); users.remove(s) }
    }

    override fun onSensorChanged(e: SensorEvent) {
        val ids = users[e.sensor] ?: return
        val t = e.timestamp / 1e6
        val sent = SystemClock.elapsedRealtimeNanos() / 1e6
        val v = e.values.take(6).map { it.toDouble() }
        for (id in ids.toList()) {
            val m = hashMapOf<String, Any>("k" to "s", "id" to id, "v" to v, "t" to t, "sent" to sent)
            if (id == "proximity") m["max"] = e.sensor.maximumRange.toDouble()
            sink?.success(m)
        }
    }
    override fun onAccuracyChanged(s: Sensor?, accuracy: Int) {}

    // ---- battery temperature: tenths of a degree in the sticky ACTION_BATTERY_CHANGED intent
    private fun startBattery() {
        if (batteryOn) return
        batteryOn = true
        ContextCompat.registerReceiver(this, batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        status("battery", "on", "")
        main.post(batteryPoll)
    }
    private fun stopBattery() {
        if (!batteryOn) return
        batteryOn = false
        main.removeCallbacks(batteryPoll)
        try { unregisterReceiver(batteryReceiver) } catch (e: IllegalArgumentException) { }
    }
    private fun sendBattery(i: Intent? = null) {
        if (!batteryOn) return
        val intent = i ?: ContextCompat.registerReceiver(this, null, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED) ?: return
        val tenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
        if (tenths == Int.MIN_VALUE) return
        val now = SystemClock.elapsedRealtimeNanos() / 1e6
        sink?.success(hashMapOf<String, Any>("k" to "s", "id" to "battery", "v" to listOf(tenths / 10.0), "t" to now, "sent" to now))
    }

    private fun status(id: String, state: String, text: String) {
        sink?.success(hashMapOf<String, Any>("k" to "status", "id" to id, "state" to state, "text" to text))
    }

    // ---- runtime permissions for the WebView's camera, microphone and location, and for the step counter
    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
    private fun permissions(list: List<*>, result: MethodChannel.Result) {
        val perms = list.flatMap {
            when (it) {
                "camera" -> listOf(Manifest.permission.CAMERA)
                "microphone" -> listOf(Manifest.permission.RECORD_AUDIO)
                "location" -> listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                else -> emptyList()
            }
        }.toTypedArray()
        if (perms.all { granted(it) }) { result.success(true); return }
        pendingPermission?.success(false)
        pendingPermission = result
        ActivityCompat.requestPermissions(this, perms, 41)
    }
    private var afterGrant: ((Boolean) -> Unit)? = null
    private fun askThen(perms: Array<String>, then: (Boolean) -> Unit) {
        afterGrant = then
        ActivityCompat.requestPermissions(this, perms, 42)
    }
    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, perms, results)
        // coarse location alone still counts as a yes for location
        val ok = results.isNotEmpty() && results.any { it == PackageManager.PERMISSION_GRANTED } &&
            perms.indices.all { i -> results[i] == PackageManager.PERMISSION_GRANTED || perms[i] == Manifest.permission.ACCESS_FINE_LOCATION || perms[i] == Manifest.permission.ACCESS_COARSE_LOCATION }
        if (code == 41) { pendingPermission?.success(ok); pendingPermission = null }
        if (code == 42) { afterGrant?.invoke(ok); afterGrant = null }
    }

    // ---- fingerprint: Android's own prompt. Apps never see the print, only whether it matched. Each failed touch is
    // reported as it happens; the call's result is the outcome (matched, cancelled, none, unavailable, error).
    private fun fingerprint(result: MethodChannel.Result) {
        val can = BiometricManager.from(this).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        when (can) {
            BiometricManager.BIOMETRIC_SUCCESS -> {}
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> { result.success(mapOf("result" to "none", "text" to "No fingerprint is enrolled on this phone.")); return }
            else -> { result.success(mapOf("result" to "unavailable", "text" to "This phone has no fingerprint sensor Android lets apps use.")); return }
        }
        var answered = false
        val done = { r: String, text: String -> if (!answered) { answered = true; result.success(mapOf("result" to r, "text" to text)) } }
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
                val how = if (r.authenticationType == BiometricPrompt.AUTHENTICATION_RESULT_TYPE_BIOMETRIC) "biometric" else "device credential"
                done("matched", "Android confirmed a $how match.")
            }
            override fun onAuthenticationFailed() {
                sink?.success(hashMapOf<String, Any>("k" to "fp", "result" to "failed", "text" to "That finger was not recognised; try again."))
            }
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED
                done(if (cancelled) "cancelled" else "error", msg.toString())
            }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Sensor Deck fingerprint check")
                .setSubtitle("Touch the fingerprint sensor")
                .setDescription("Android checks the print; Sensor Deck only learns whether it matched.")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("Cancel")
                .build()
        )
    }

    override fun onDestroy() {
        sm.unregisterListener(this)
        users.clear(); byId.clear()
        stopBattery()
        super.onDestroy()
    }
}
