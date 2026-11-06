# Heat Pump Studio — refrigerant property tables, generated with CoolProp (http://www.coolprop.org).
# Run with a Python that has CoolProp installed:   python heat-pump-studio/tools/build_props.py
# Writes:
#   data/refrigerants.js   window.HPS_REFRIGERANTS: per refrigerant, saturation tables (every 0.5 K) and a superheated-
#                          vapour grid over ln(p) and superheat ΔT above saturation (always inside the vapour region)
#   tests/reference.json   CoolProp values at random states and complete reference cycles, for the tests
# Units: T °C, p bar, h kJ/kg, s kJ/(kg·K), ρ kg/m³, v m³/kg. Reference state: CoolProp's default for each fluid.
import json, math, os, random
import CoolProp.CoolProp as CP

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, ".."))
K = 273.15

# name shown, CoolProp name, ASHRAE 34 safety class, GWP100 (IPCC AR4, the values of EU F-gas Regulation 517/2014),
# lower flammability limit kg/m³ (None: not flammable), a one-line note
FLUIDS = [
    ("R290", "R290", "A3", 3, 0.038, "Propane. Natural refrigerant, excellent efficiency; highly flammable, so the charge is limited."),
    ("R32", "R32", "A2L", 675, 0.307, "Common in new split units; mildly flammable; high discharge temperatures."),
    ("R410A", "R410A", "A1", 2088, None, "Former standard for air-to-water units; high GWP, being phased down."),
    ("R134a", "R134a", "A1", 1430, None, "Medium pressure; used for higher flow temperatures; high GWP."),
    ("R1234yf", "R1234yf", "A2L", 4, 0.289, "Low-GWP HFO, similar pressures to R134a; mildly flammable."),
    ("R1234ze(E)", "R1234ze(E)", "A2L", 7, 0.303, "Low-GWP HFO for chillers and large heat pumps; low pressures."),
    ("R717", "R717", "B2L", 0, 0.116, "Ammonia. Industrial heat pumps; excellent thermodynamics; toxic, so plant-room only."),
]
T_MIN = -50.0
DT = [0, 0.5, 1, 2, 3, 4, 6, 8, 10, 12.5, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160]
DTL = [0, 1, 2, 3, 4, 6, 8, 10, 12.5, 15, 20, 25, 30, 40]     # subcooling below saturation, for the liquid grid
N_P = 64

def r(x, sig=6):
    if x == 0 or not math.isfinite(x): return 0
    return round(x, max(0, sig - 1 - int(math.floor(math.log10(abs(x))))))

data = {}
for name, cp, safety, gwp, lfl, note in FLUIDS:
    Tc = CP.PropsSI("Tcrit", cp) - K; pc = CP.PropsSI("pcrit", cp) / 1e5
    t_max = math.floor((Tc - 1.0) * 2) / 2                        # saturation table up to 1 K below the critical point
    Ts = [T_MIN + 0.5 * i for i in range(int((t_max - T_MIN) / 0.5) + 1)]
    sat = {k: [] for k in ("p", "pv", "hl", "hv", "sl", "sv", "dl", "dv")}
    for T in Ts:
        for q, suf in ((0, "l"), (1, "v")):
            sat["h" + suf].append(r(CP.PropsSI("H", "T", T + K, "Q", q, cp) / 1e3))
            sat["s" + suf].append(r(CP.PropsSI("S", "T", T + K, "Q", q, cp) / 1e3))
            sat["d" + suf].append(r(CP.PropsSI("D", "T", T + K, "Q", q, cp)))
        sat["p"].append(r(CP.PropsSI("P", "T", T + K, "Q", 0, cp) / 1e5))      # bubble point
        sat["pv"].append(r(CP.PropsSI("P", "T", T + K, "Q", 1, cp) / 1e5))     # dew point (differs for blends: R410A)
    # superheated grid: pressures from saturation at T_MIN to saturation 3 K below critical, uniform in ln p
    p_lo = CP.PropsSI("P", "T", T_MIN + K, "Q", 1, cp) / 1e5
    p_hi = CP.PropsSI("P", "T", Tc - 3 + K, "Q", 1, cp) / 1e5
    lnp = [math.log(p_lo) + (math.log(p_hi) - math.log(p_lo)) * i / (N_P - 1) for i in range(N_P)]
    H, S, V = [], [], []
    LH, LS, LD = [], [], []
    for lp in lnp:
        p = math.exp(lp) * 1e5
        tsat = CP.PropsSI("T", "P", p, "Q", 1, cp)
        hr, sr, vr = [], [], []
        for dt in DT:
            if dt == 0:
                h = CP.PropsSI("H", "P", p, "Q", 1, cp); s = CP.PropsSI("S", "P", p, "Q", 1, cp); d = CP.PropsSI("D", "P", p, "Q", 1, cp)
            else:
                h = CP.PropsSI("H", "P", p, "T", tsat + dt, cp); s = CP.PropsSI("S", "P", p, "T", tsat + dt, cp); d = CP.PropsSI("D", "P", p, "T", tsat + dt, cp)
            hr.append(r(h / 1e3)); sr.append(r(s / 1e3)); vr.append(r(1 / d))
        H.append(hr); S.append(sr); V.append(vr)
        lh, ls, ld = [], [], []
        for dt in DTL:
            try:
                if dt == 0: h = CP.PropsSI("H", "P", p, "Q", 0, cp); s_ = CP.PropsSI("S", "P", p, "Q", 0, cp); d = CP.PropsSI("D", "P", p, "Q", 0, cp)
                else: h = CP.PropsSI("H", "P", p, "T", tsat - dt, cp); s_ = CP.PropsSI("S", "P", p, "T", tsat - dt, cp); d = CP.PropsSI("D", "P", p, "T", tsat - dt, cp)
                lh.append(r(h / 1e3)); ls.append(r(s_ / 1e3)); ld.append(r(d))
            except Exception:                              # below the fluid's triple point: repeat the last value
                lh.append(lh[-1]); ls.append(ls[-1]); ld.append(ld[-1])
        LH.append(lh); LS.append(ls); LD.append(ld)
    data[name] = {"name": name, "safety": safety, "gwp": gwp, "lfl": lfl, "note": note,
                  "Tcrit": r(Tc), "pcrit": r(pc), "M": r(CP.PropsSI("M", cp) * 1e3),
                  "sat": dict(T0=T_MIN, dT=0.5, n=len(Ts), **sat),
                  "sh": {"lnp": [r(x, 7) for x in lnp], "dT": DT, "h": H, "s": S, "v": V},
                  "lq": {"dT": DTL, "h": LH, "s": LS, "d": LD}}
    print("%-11s Tc %6.2f °C  pc %6.2f bar  sat %d rows  grid %d × %d" % (name, Tc, pc, len(Ts), N_P, len(DT)))

os.makedirs(os.path.join(APP, "data"), exist_ok=True)
with open(os.path.join(APP, "data", "refrigerants.js"), "w", encoding="utf-8") as f:
    f.write("// Heat Pump Studio — refrigerant property tables, generated by tools/build_props.py with CoolProp %s. Do not edit.\n" % CP.get_global_param_string("version"))
    f.write("(function (root) { root.HPS_REFRIGERANTS = ")
    json.dump(data, f, separators=(",", ":"))
    f.write("; if (typeof module !== \"undefined\" && module.exports) module.exports = root.HPS_REFRIGERANTS; })(typeof self !== \"undefined\" ? self : this);\n")

# ---- reference values for the tests
random.seed(7)
ref = {"coolprop": CP.get_global_param_string("version"), "sat": [], "vapour": [], "liquid": [], "cycles": []}
for name, cp, *_ in FLUIDS:
    Tc = data[name]["Tcrit"]
    for _ in range(25):
        T = random.uniform(T_MIN + 1, Tc - 4)
        ref["sat"].append({"fluid": name, "T": T, "p": CP.PropsSI("P", "T", T + K, "Q", 0, cp) / 1e5,
                           "hl": CP.PropsSI("H", "T", T + K, "Q", 0, cp) / 1e3, "hv": CP.PropsSI("H", "T", T + K, "Q", 1, cp) / 1e3,
                           "sv": CP.PropsSI("S", "T", T + K, "Q", 1, cp) / 1e3, "dv": CP.PropsSI("D", "T", T + K, "Q", 1, cp)})
    for _ in range(40):
        Tsat = random.uniform(T_MIN + 2, Tc - 6); p = CP.PropsSI("P", "T", Tsat + K, "Q", 1, cp)
        dt = random.uniform(0.5, 120); T = Tsat + dt
        ref["vapour"].append({"fluid": name, "p": p / 1e5, "T": T, "h": CP.PropsSI("H", "P", p, "T", T + K, cp) / 1e3,
                              "s": CP.PropsSI("S", "P", p, "T", T + K, cp) / 1e3, "v": 1 / CP.PropsSI("D", "P", p, "T", T + K, cp)})
    for _ in range(15):
        # subcooled liquid at a condensing pressure: the app takes h ≈ h of saturated liquid at the same temperature
        Tcond = random.uniform(20, min(70, Tc - 8)); p = CP.PropsSI("P", "T", Tcond + K, "Q", 0, cp)
        T = Tcond - random.uniform(1, 10)
        ref["liquid"].append({"fluid": name, "p": p / 1e5, "T": T, "h": CP.PropsSI("H", "P", p, "T", T + K, cp) / 1e3})

def cycle(cp, te, tc, sh, sc, eta):
    pe = CP.PropsSI("P", "T", te + K, "Q", 1, cp); pc_ = CP.PropsSI("P", "T", tc + K, "Q", 0, cp)
    h1 = CP.PropsSI("H", "P", pe, "T", te + sh + K, cp) if sh > 0 else CP.PropsSI("H", "P", pe, "Q", 1, cp)
    s1 = CP.PropsSI("S", "P", pe, "T", te + sh + K, cp) if sh > 0 else CP.PropsSI("S", "P", pe, "Q", 1, cp)
    v1 = 1 / (CP.PropsSI("D", "P", pe, "T", te + sh + K, cp) if sh > 0 else CP.PropsSI("D", "P", pe, "Q", 1, cp))
    h2s = CP.PropsSI("H", "P", pc_, "S", s1, cp); h2 = h1 + (h2s - h1) / eta
    t2 = CP.PropsSI("T", "P", pc_, "H", h2, cp) - K
    h3 = CP.PropsSI("H", "P", pc_, "T", tc - sc + K, cp) if sc > 0 else CP.PropsSI("H", "P", pc_, "Q", 0, cp)
    return {"pe": pe / 1e5, "pc": pc_ / 1e5, "h1": h1 / 1e3, "h2": h2 / 1e3, "h3": h3 / 1e3, "t2": t2, "v1": v1,
            "cop": (h2 - h3) / (h2 - h1)}
CASES = [("R134a", -10, 40, 0, 0, 1.0), ("R134a", -10, 40, 5, 3, 0.7), ("R290", -5, 45, 5, 3, 0.7), ("R32", -7, 50, 5, 5, 0.68),
         ("R410A", 0, 40, 5, 3, 0.7), ("R1234yf", 5, 55, 5, 3, 0.7), ("R1234ze(E)", 10, 70, 5, 5, 0.72), ("R717", -5, 60, 5, 3, 0.75),
         ("R290", -20, 55, 6, 2, 0.65), ("R32", 2, 35, 4, 2, 0.7)]
for name, te, tc, sh, sc, eta in CASES:
    cp = next(c for n, c, *_ in FLUIDS if n == name)
    ref["cycles"].append(dict(fluid=name, te=te, tc=tc, sh=sh, sc=sc, eta=eta, **cycle(cp, te, tc, sh, sc, eta)))
os.makedirs(os.path.join(APP, "tests"), exist_ok=True)
json.dump(ref, open(os.path.join(APP, "tests", "reference.json"), "w"), indent=0)
print("reference: %d sat, %d vapour, %d liquid, %d cycles" % (len(ref["sat"]), len(ref["vapour"]), len(ref["liquid"]), len(ref["cycles"])))
print("data/refrigerants.js %.0f kB" % (os.path.getsize(os.path.join(APP, "data", "refrigerants.js")) / 1024))
