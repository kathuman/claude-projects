# Interference check for the machine assembly: every pair of parts whose solids overlap by more than 1 mm³.
# Parts that are meant to sit inside one another (a tube in its clamp, a dowel through the pulley, nails in the board,
# a belt round its pulley) are listed in EXPECTED.
#
#   "C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" hardware/cad/check_clearance.py    (after build_machine.py)

import os, itertools
import FreeCAD as App

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "hardware", "cad")
doc = App.openDocument(os.path.join(HERE, "..", "..", "web", "public", "hardware", "string-art-machine.FCStd"))

EXPECTED = {
    frozenset(p) for p in [
        ("A_centre_dowel", "P_turntable_pulley"), ("A_centre_dowel", "W_platter"), ("A_centre_dowel", "B_nail_board"),
        ("A_centre_dowel", "W_base"),
        ("E_magnet", "W_platter"),
        ("T_brass_guide_tube", "P_guide_arm"), ("T_ptfe_tube", "P_guide_arm"),
        ("A_z_motor_leadscrew", "P_z_carriage"), ("M_z_motor_leadscrew", "P_z_carriage"), ("M_z_motor_leadscrew", "P_z_motor_mount"),
        ("A_y_belt", "P_guide_arm"), ("A_y_belt", "A_y_pulley"), ("A_y_belt", "A_y_idler"),
        ("A_x_belt", "P_turntable_pulley"), ("A_x_belt", "A_x_pulley_20t"),
        ("A_mgn9_rail", "A_mgn9h_carriage"), ("A_mgn12_rail", "A_mgn12h_carriage"),
        ("T_thread_cone", "P_cone_stand"), ("A_tension_discs", "P_tensioner_bracket"),
        ("T_ptfe_tube", "P_dancer_arm"), ("T_ptfe_tube", "P_dancer_bracket"),
    ]
}

objs = [o for o in doc.Objects if hasattr(o, "Shape") and not o.Shape.isNull() and o.Label != "N_nails"]
bad = []
for a, b in itertools.combinations(objs, 2):
    if not a.Shape.BoundBox.intersect(b.Shape.BoundBox):
        continue
    if frozenset((a.Label, b.Label)) in EXPECTED:
        continue
    try:
        v = a.Shape.common(b.Shape).Volume
    except Exception as e:  # noqa: BLE001
        v = -1
    if v > 1 or v < 0:
        bad.append((a.Label, b.Label, v))
for a, b, v in bad:
    print("OVERLAP %-26s %-26s %10.1f mm3" % (a, b, v))
print("clearance check: %d unexpected overlaps among %d parts" % (len(bad), len(objs)))
