// A stand-in for adb in the USB bridge tests. The device list comes from the file in FAKE_ADB_DEVICES; every call is
// appended to FAKE_ADB_LOG.
const fs = require("fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_ADB_LOG, args.join(" ") + "\n");
if (args[0] === "devices") process.stdout.write("List of devices attached\n" + fs.readFileSync(process.env.FAKE_ADB_DEVICES, "utf8"));
else if (args.includes("reverse")) process.stdout.write(args.includes("--remove") ? "" : "8766\n");
