"""
parametric_robot.py -- FreeCAD macro: parametric model of a two-wheeled,
single-axis balancing robot, driven entirely by a spreadsheet.

WHAT THIS DOES
  1. Creates (or reuses) a document with a "Params" Spreadsheet holding
     every geometric and material input, as named aliases.
  2. Builds two wheel cylinders and a body box as native parametric
     Part objects, with every dimension bound to the spreadsheet via
     FreeCAD expressions (edit the spreadsheet, hit recompute, the
     solids follow -- that binding is what "parametrize the robot using
     FreeCAD" means in practice).
  3. Computes real mass, center of mass and inertia from the actual
     solid geometry + the spreadsheet's material densities (not the
     box/cylinder formulas the browser simulator falls back on when no
     CAD model is available -- see web/js/params.mjs).
  4. Writes web/cad/robot_params.json in the schema the simulator reads,
     with "source": "freecad", and exports wheel.stl / body.stl.
  5. Saves the document as cad/parametric_robot.FCStd.

HOW TO RUN
  Open FreeCAD, Macro -> Macros... -> Execute, pick this file. Or
  headless:  freecadcmd parametric_robot.py
  (run it from the repo root, or edit REPO_ROOT below.)

  First run creates the spreadsheet with the defaults below. Edit values
  in the "Params" sheet afterwards (Spreadsheet workbench) and re-run
  the macro (or just hit the document recompute + re-run the export
  section at the bottom) to regenerate robot_params.json from your
  changes -- the spreadsheet is the thing you're meant to keep editing,
  not this script.

COORDINATE CONVENTION (FreeCAD is Z-up; this differs from the Y-up
convention three.js/web/js/scene.mjs uses -- the JSON only ever carries
scalar magnitudes, never positions or axes, so this mismatch stays fully
contained inside this script and never reaches the simulator):
  X = forward / direction of travel (body "depth")
  Y = lateral / axle direction (body "width", wheel spin axis)
  Z = vertical (body "height")

CAVEAT: this script was written and reviewed carefully against the
documented FreeCAD Python API (Spreadsheet aliasing + setExpression,
Part::Box / Part::Cylinder, Shape.CenterOfMass / Shape.MatrixOfInertia,
Mesh.export) but could not be executed in the environment that produced
it -- there is no FreeCAD install there. Please run it once and report
back if any call doesn't match your FreeCAD version; the schema it must
produce (web/cad/robot_params.json) is documented in docs/dynamics.md
and web/js/params.mjs if you need to patch the export section by hand.
"""

import os

import FreeCAD as App
import Part
import Mesh

# ---------------------------------------------------------------------------
# Defaults used only the first time the spreadsheet is created. After that,
# whatever is in the spreadsheet wins -- this script never overwrites an
# existing cell.
# ---------------------------------------------------------------------------
DEFAULTS = {
    # geometry (m)
    "wheelRadius": 0.04,
    "wheelWidth": 0.026,
    "trackWidth": 0.16,
    "bodyWidth": 0.09,
    "bodyDepth": 0.05,
    "bodyHeight": 0.20,
    "mountGap": 0.0,  # vertical gap between axle top and body bottom
    # material (kg/m^3) -- lumped effective densities, not a real BOM
    "wheelDensity": 1200.0,
    "bodyDensity": 600.0,
    # motor + environment -- passed through to robot_params.json unchanged
    "motorMaxTorque": 0.35,
    "motorTimeConstant": 0.02,
    "gravity": 9.81,
    "rollingResistance": 0.02,
    "pitchDamping": 0.0008,
    "yawDamping": 0.01,
}

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT_DIR = os.path.join(REPO_ROOT, "cad", "exported")
JSON_PATH = os.path.join(REPO_ROOT, "web", "cad", "robot_params.json")
FCSTD_PATH = os.path.join(REPO_ROOT, "cad", "parametric_robot.FCStd")

DOC_NAME = "BalanceBotParametric"
SHEET_NAME = "Params"


def get_or_create_document():
    if DOC_NAME in App.listDocuments():
        return App.getDocument(DOC_NAME)
    return App.newDocument(DOC_NAME)


def get_or_create_sheet(doc):
    sheet = doc.getObject(SHEET_NAME)
    if sheet is not None:
        return sheet

    sheet = doc.addObject("Spreadsheet::Sheet", SHEET_NAME)
    row = 1
    for key, value in DEFAULTS.items():
        sheet.set("A%d" % row, key)
        sheet.set("B%d" % row, str(value))
        sheet.setAlias("B%d" % row, key)
        row += 1
    doc.recompute()
    return sheet


def read_params(sheet):
    return {key: sheet.get(key) for key in DEFAULTS}


def build_geometry(doc, p):
    wheel_r = p["wheelRadius"]
    wheel_w = p["wheelWidth"]
    track = p["trackWidth"]

    def make_wheel(name, y_sign):
        obj = doc.getObject(name)
        if obj is None:
            obj = doc.addObject("Part::Cylinder", name)
        obj.Radius = wheel_r
        obj.Height = wheel_w
        obj.setExpression("Radius", "<<%s>>.wheelRadius" % SHEET_NAME)
        obj.setExpression("Height", "<<%s>>.wheelWidth" % SHEET_NAME)
        # A cylinder's own axis is local Z, extending from the placement
        # base in +Z. Rotating -90 deg about X sends that to world +Y;
        # +90 deg sends it to world -Y -- so each wheel's inner face sits
        # exactly at y = y_sign*trackWidth/2 and the wheel extends
        # outward from there, with its axle at ground-plane height
        # (Z = wheelRadius).
        obj.Placement = App.Placement(
            App.Vector(0, y_sign * (track / 2.0), wheel_r),
            App.Rotation(App.Vector(1, 0, 0), -90 if y_sign > 0 else 90),
        )
        return obj

    wheel_left = make_wheel("WheelLeft", -1)
    wheel_right = make_wheel("WheelRight", 1)
    for wheel, y_sign in ((wheel_left, -1), (wheel_right, 1)):
        wheel.setExpression(
            ".Placement.Base.y", "%d * <<%s>>.trackWidth / 2" % (y_sign, SHEET_NAME)
        )
        wheel.setExpression(".Placement.Base.z", "<<%s>>.wheelRadius" % SHEET_NAME)

    body = doc.getObject("Body")
    if body is None:
        body = doc.addObject("Part::Box", "Body")
    body.Length = p["bodyDepth"]  # X
    body.Width = p["bodyWidth"]  # Y
    body.Height = p["bodyHeight"]  # Z
    body.setExpression("Length", "<<%s>>.bodyDepth" % SHEET_NAME)
    body.setExpression("Width", "<<%s>>.bodyWidth" % SHEET_NAME)
    body.setExpression("Height", "<<%s>>.bodyHeight" % SHEET_NAME)
    body.Placement = App.Placement(
        App.Vector(-p["bodyDepth"] / 2.0, -p["bodyWidth"] / 2.0, p["wheelRadius"] + p["mountGap"]),
        App.Rotation(),
    )
    body.setExpression(".Placement.Base.x", "-<<%s>>.bodyDepth / 2" % SHEET_NAME)
    body.setExpression(".Placement.Base.y", "-<<%s>>.bodyWidth / 2" % SHEET_NAME)
    body.setExpression(
        ".Placement.Base.z", "<<%s>>.wheelRadius + <<%s>>.mountGap" % (SHEET_NAME, SHEET_NAME)
    )

    doc.recompute()
    return wheel_left, wheel_right, body


def centroidal_inertia(shape):
    """Return (mass-independent) Ixx, Iyy, Izz about the shape's own
    center of mass, in the shape's current (world) orientation -- so the
    caller can read off whichever axis is physically meaningful (spin
    axis, pitch axis, yaw axis) without worrying separately about how
    the solid was placed or rotated to get there."""
    com = shape.CenterOfMass
    centered = shape.copy()
    centered.translate(App.Vector(-com.x, -com.y, -com.z))
    m = centered.MatrixOfInertia
    return m.A11, m.A22, m.A33


def compute_and_export(doc, p, wheel_left, body):
    wheel_density = p["wheelDensity"]
    body_density = p["bodyDensity"]

    wheel_volume = wheel_left.Shape.Volume * 1e-9  # mm^3 -> m^3 (FreeCAD's internal unit is mm)
    wheel_mass = wheel_volume * wheel_density
    _, wheel_iyy, _ = centroidal_inertia(wheel_left.Shape)
    # MatrixOfInertia is in kg*mm^2-equivalent-density-weighted units if
    # computed directly on the shape (FreeCAD has no mass awareness at the
    # Part::Shape level) -- it returns a *volume*-weighted second moment in
    # mm^5; multiply by density (kg/m^3) and convert mm^5 -> m^5 (1e-15) to
    # get kg*m^2.
    wheel_inertia = wheel_iyy * 1e-15 * wheel_density  # about its own spin axis (Y)

    body_volume = body.Shape.Volume * 1e-9
    body_mass = body_volume * body_density
    _, body_iyy, body_izz = centroidal_inertia(body.Shape)
    body_pitch_inertia = body_iyy * 1e-15 * body_density  # pitch axis = Y
    body_yaw_own = body_izz * 1e-15 * body_density  # yaw axis = Z, through body's own centroid

    half_track = p["trackWidth"] / 2.0
    _, _, wheel_izz = centroidal_inertia(wheel_left.Shape)
    wheel_yaw_own = wheel_izz * 1e-15 * wheel_density
    yaw_inertia = body_yaw_own + 2 * (wheel_yaw_own + wheel_mass * half_track * half_track)

    com_height = (body.Shape.CenterOfMass.z * 1e-3) - p["wheelRadius"]  # mm -> m, minus axle height

    params_out = {
        "schemaVersion": 1,
        "source": "freecad",
        "geometry": {
            "wheelRadius": p["wheelRadius"],
            "wheelWidth": p["wheelWidth"],
            "trackWidth": p["trackWidth"],
            "bodyWidth": p["bodyWidth"],
            "bodyDepth": p["bodyDepth"],
            "bodyHeight": p["bodyHeight"],
            "comHeight": com_height,
        },
        "mass": {"wheelMass": wheel_mass, "bodyMass": body_mass},
        "inertia": {
            "wheelInertia": wheel_inertia,
            "bodyPitchInertia": body_pitch_inertia,
            "yawInertia": yaw_inertia,
        },
        "motor": {"maxTorque": p["motorMaxTorque"], "timeConstant": p["motorTimeConstant"]},
        "environment": {
            "gravity": p["gravity"],
            "rollingResistance": p["rollingResistance"],
            "pitchDamping": p["pitchDamping"],
            "yawDamping": p["yawDamping"],
        },
    }

    import json

    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w") as f:
        json.dump(params_out, f, indent=2)
    print("Wrote %s" % JSON_PATH)

    os.makedirs(EXPORT_DIR, exist_ok=True)
    Mesh.export([wheel_left], os.path.join(EXPORT_DIR, "wheel.stl"))
    Mesh.export([body], os.path.join(EXPORT_DIR, "body.stl"))
    print("Exported STL meshes to %s" % EXPORT_DIR)

    return params_out


def main():
    doc = get_or_create_document()
    sheet = get_or_create_sheet(doc)
    p = read_params(sheet)
    wheel_left, wheel_right, body = build_geometry(doc, p)
    result = compute_and_export(doc, p, wheel_left, body)

    doc.saveAs(FCSTD_PATH)
    print("Saved %s" % FCSTD_PATH)
    return result


if __name__ == "__main__":
    main()
