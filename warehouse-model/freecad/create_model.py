"""
create_model.py — the authoritative parametric FreeCAD warehouse model.

Run with FreeCAD's own Python (not a system Python — FreeCAD's modules only
exist inside it):

    "C:\\Program Files\\FreeCAD 1.1\\bin\\freecadcmd.exe" freecad\\create_model.py

On Linux/Mac the executable is typically just `freecadcmd` on PATH.

What this script does, in order:
  1. Loads ../data/parameters.json — the single source of truth also read
     by the web app's calculations.js. Nothing here is hard-coded twice.
  2. Creates a Spreadsheet object and writes every parameter into it as a
     named, unit-tagged cell. This is the actual FreeCAD parameter table —
     editing a cell in the FreeCAD GUI and recomputing will resize the
     building live.
  3. Derives the rack layout (how many bays/rows physically fit) with the
     exact same arithmetic as calculations.js's computeLayout() — same
     variable names, same order — printed at the end so the two can be
     diffed by eye against the web app's own console output.
  4. Builds the geometry: floor, walls, roof (Structure), rack-row blocks
     (Equipment), dock markers and staging zones (Flow), all named and
     grouped, with every object's key dimensions bound to the spreadsheet
     via FreeCAD expressions (not plain Python numbers) so they stay live.
  5. Saves the .FCStd and exports a tessellated GLB baseline snapshot for
     the web app's "Reference Model (from FreeCAD)" view.

A note on what IS and ISN'T dynamically parametric here: an object's own
DIMENSIONS (wall length, rack-row length/depth/height, dock width...) are
bound to the spreadsheet via expressions, so nudging a spreadsheet cell in
the GUI and recomputing genuinely resizes them. The NUMBER of rack rows and
bays, though, is a Python-time decision (this script computes how many fit
and creates that many objects) — FreeCAD's expression engine binds property
*values*, not object *counts*. To change the count, re-run this script
(e.g. after editing parameters.json, or by overriding a value via the
--set flag below) rather than editing the count in the GUI.
"""

import argparse
import json
import os
import sys

import FreeCAD
import Part
import Import


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
PARAMETERS_PATH = os.path.join(REPO_ROOT, "data", "parameters.json")
FCSTD_PATH = os.path.join(SCRIPT_DIR, "warehouse_model.FCStd")
GLB_PATH = os.path.join(REPO_ROOT, "web", "models", "warehouse_baseline.glb")

M = 1000.0  # 1 m in the document's internal mm units


# ---------------------------------------------------------------------------
# Parameter loading
# ---------------------------------------------------------------------------
def load_parameters(overrides=None):
    with open(PARAMETERS_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)["parameters"]
    values = {name: entry["value"] for name, entry in raw.items()}
    if overrides:
        for k, v in overrides.items():
            if k not in values:
                raise KeyError("Unknown parameter override: " + k)
            values[k] = v
    return values, raw


# ---------------------------------------------------------------------------
# Spreadsheet — the live FreeCAD parameter table
# ---------------------------------------------------------------------------
def build_spreadsheet(doc, values, raw):
    sheet = doc.addObject("Spreadsheet::Sheet", "Parameters")
    sheet.Label = "Parameters"
    row = 1
    for name, entry in raw.items():
        sheet.set("A%d" % row, name)
        sheet.set("B%d" % row, str(values[name]))
        sheet.set("C%d" % row, entry.get("unit", ""))
        sheet.set("D%d" % row, entry.get("description", ""))
        sheet.setAlias("B%d" % row, name)
        row += 1
    doc.recompute()
    return sheet


def expr_mm(sheet_obj_name, param_name):
    """A FreeCAD expression string converting a parameter (stored in its
    natural engineering unit, e.g. metres) into document-internal mm."""
    return "%s.%s * 1000" % (sheet_obj_name, param_name)


# ---------------------------------------------------------------------------
# Reusable geometry builders
# ---------------------------------------------------------------------------
def make_box(doc, name, label, length_expr, width_expr, height_expr, placement, group):
    obj = doc.addObject("Part::Box", name)
    obj.Label = label
    obj.setExpression("Length", length_expr)
    obj.setExpression("Width", width_expr)
    obj.setExpression("Height", height_expr)
    obj.Placement = placement
    group.addObject(obj)
    return obj


def create_wall(doc, sheet, name, label, length_expr, width_expr, x, y, z, group):
    placement = FreeCAD.Placement(FreeCAD.Vector(x, y, z), FreeCAD.Rotation())
    return make_box(
        doc, name, label,
        length_expr, width_expr, expr_mm("Parameters", "clear_height"),
        placement, group,
    )


def create_rack_row(doc, sheet, index, x0, y0, bays_per_row, group):
    """One rack row, modeled as a single envelope block (facility-layout
    scale, not pallet-level detail — see README for why)."""
    name = "RackRow_%03d" % index
    obj = doc.addObject("Part::Box", name)
    obj.Label = "Rack Row %d" % index
    # bays_per_row is a derived, generation-time quantity (see module
    # docstring) so Length is set as a plain value here, not an expression
    # -- bay_width itself still is live via the spreadsheet elsewhere.
    obj.Length = bays_per_row * (doc.Parameters.bay_width * M)
    obj.setExpression("Width", expr_mm("Parameters", "rack_depth"))
    obj.setExpression("Height", expr_mm("Parameters", "rack_height"))
    obj.Placement = FreeCAD.Placement(FreeCAD.Vector(x0, y0, 0), FreeCAD.Rotation())
    group.addObject(obj)
    return obj


def create_dock_marker(doc, sheet, name, label, x, y, group):
    obj = doc.addObject("Part::Box", name)
    obj.Label = label
    obj.setExpression("Length", "300")
    obj.setExpression("Width", expr_mm("Parameters", "dock_bay_width"))
    obj.setExpression("Height", "3000")
    obj.Placement = FreeCAD.Placement(FreeCAD.Vector(x, y, 0), FreeCAD.Rotation())
    group.addObject(obj)
    return obj


def create_zone_marker(doc, name, label, x, y, length, width, group):
    """A near-flat floor decal marking a staging/cross-aisle zone."""
    obj = doc.addObject("Part::Box", name)
    obj.Label = label
    obj.Length = length
    obj.Width = width
    obj.Height = 20  # 2 cm — a visible floor marking, not a real volume
    obj.Placement = FreeCAD.Placement(FreeCAD.Vector(x, y, 0), FreeCAD.Rotation())
    group.addObject(obj)
    return obj


# ---------------------------------------------------------------------------
# Layout derivation — MUST mirror web/src/calculations.js computeLayout()
# ---------------------------------------------------------------------------
def derive_layout(p):
    usable_length = p["warehouse_length"] - 2 * p["cross_aisle_width"]
    bays_per_row = max(0, int(usable_length // p["bay_width"]))
    rack_row_length = bays_per_row * p["bay_width"]

    width_per_aisle_unit = 2 * p["rack_depth"] + p["aisle_width"]
    num_aisle_units = max(0, int(p["warehouse_width"] // width_per_aisle_unit))
    num_rack_rows = num_aisle_units * 2
    racking_width_used = num_aisle_units * width_per_aisle_unit

    positions_per_bay = p["levels_per_rack"] * p["positions_per_level_per_bay"]
    total_bays = num_rack_rows * bays_per_row
    storage_capacity = total_bays * positions_per_bay

    return {
        "usable_length": usable_length,
        "bays_per_row": bays_per_row,
        "rack_row_length": rack_row_length,
        "width_per_aisle_unit": width_per_aisle_unit,
        "num_aisle_units": num_aisle_units,
        "num_rack_rows": num_rack_rows,
        "racking_width_used": racking_width_used,
        "positions_per_bay": positions_per_bay,
        "total_bays": total_bays,
        "storage_capacity": storage_capacity,
    }


# ---------------------------------------------------------------------------
# Model assembly
# ---------------------------------------------------------------------------
def build_model(values, raw):
    p = values
    layout = derive_layout(p)

    doc = FreeCAD.newDocument("warehouse_model")
    sheet = build_spreadsheet(doc, values, raw)
    doc.recompute()

    grp_structure = doc.addObject("App::DocumentObjectGroup", "Structure")
    grp_equipment = doc.addObject("App::DocumentObjectGroup", "Equipment")
    grp_flow = doc.addObject("App::DocumentObjectGroup", "Flow")

    wt = p["wall_thickness"]  # mm already (wall_thickness is stored in mm)
    WL = p["warehouse_length"] * M
    WW = p["warehouse_width"] * M

    # --- Structure ---------------------------------------------------
    floor = make_box(
        doc, "Floor", "Floor",
        "(Parameters.warehouse_length * 1000) + 2 * Parameters.wall_thickness",
        "(Parameters.warehouse_width * 1000) + 2 * Parameters.wall_thickness",
        "200",
        FreeCAD.Placement(FreeCAD.Vector(-wt, -wt, -200), FreeCAD.Rotation()),
        grp_structure,
    )

    west_wall = create_wall(
        doc, sheet, "Wall_West", "West Wall (Receiving end)",
        "Parameters.wall_thickness", expr_mm("Parameters", "warehouse_width"),
        -wt, 0, 0, grp_structure,
    )
    east_wall = create_wall(
        doc, sheet, "Wall_East", "East Wall (Shipping end)",
        "Parameters.wall_thickness", expr_mm("Parameters", "warehouse_width"),
        WL, 0, 0, grp_structure,
    )
    south_wall = create_wall(
        doc, sheet, "Wall_South", "South Wall",
        "(Parameters.warehouse_length * 1000) + 2 * Parameters.wall_thickness",
        "Parameters.wall_thickness",
        -wt, -wt, 0, grp_structure,
    )
    north_wall = create_wall(
        doc, sheet, "Wall_North", "North Wall",
        "(Parameters.warehouse_length * 1000) + 2 * Parameters.wall_thickness",
        "Parameters.wall_thickness",
        -wt, WW, 0, grp_structure,
    )

    roof = doc.addObject("Part::Box", "Roof")
    roof.Label = "Roof"
    roof.setExpression("Length", "(Parameters.warehouse_length * 1000) + 2 * Parameters.wall_thickness")
    roof.setExpression("Width", "(Parameters.warehouse_width * 1000) + 2 * Parameters.wall_thickness")
    roof.Height = 300
    roof.setExpression("Placement.Base.z", expr_mm("Parameters", "clear_height"))
    roof.Placement.Base.x = -wt
    roof.Placement.Base.y = -wt
    grp_structure.addObject(roof)

    # --- Equipment: rack rows -----------------------------------------
    y_offset = (p["warehouse_width"] - layout["racking_width_used"]) * M / 2.0
    x0 = p["cross_aisle_width"] * M
    row_index = 1
    for unit_i in range(layout["num_aisle_units"]):
        unit_y0 = y_offset + unit_i * layout["width_per_aisle_unit"] * M
        # Row A of the back-to-back pair
        create_rack_row(doc, sheet, row_index, x0, unit_y0, layout["bays_per_row"], grp_equipment)
        row_index += 1
        # Row B, offset by rack_depth + aisle_width
        row_b_y = unit_y0 + (p["rack_depth"] + p["aisle_width"]) * M
        create_rack_row(doc, sheet, row_index, x0, row_b_y, layout["bays_per_row"], grp_equipment)
        row_index += 1

    # --- Flow: staging zones + dock markers ---------------------------
    create_zone_marker(
        doc, "Zone_Receiving", "Receiving Staging Zone",
        0, 0, p["cross_aisle_width"] * M, WW, grp_flow,
    )
    create_zone_marker(
        doc, "Zone_Shipping", "Shipping Staging Zone",
        WL - p["cross_aisle_width"] * M, 0, p["cross_aisle_width"] * M, WW, grp_flow,
    )

    recv_total = p["num_receiving_docks"] * p["dock_bay_width"] * M
    recv_y0 = (WW - recv_total) / 2.0
    for i in range(int(p["num_receiving_docks"])):
        create_dock_marker(
            doc, sheet, "Dock_Receiving_%02d" % (i + 1), "Receiving Dock %d" % (i + 1),
            -300, recv_y0 + i * p["dock_bay_width"] * M, grp_flow,
        )

    ship_total = p["num_shipping_docks"] * p["dock_bay_width"] * M
    ship_y0 = (WW - ship_total) / 2.0
    for i in range(int(p["num_shipping_docks"])):
        create_dock_marker(
            doc, sheet, "Dock_Shipping_%02d" % (i + 1), "Shipping Dock %d" % (i + 1),
            WL, ship_y0 + i * p["dock_bay_width"] * M, grp_flow,
        )

    doc.recompute()
    return doc, layout


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def export_glb(doc, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    objs = []
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape is not None and not obj.Shape.isNull():
            obj.Shape.tessellate(0.05)  # 5 cm deflection - coarse enough to stay small, fine enough to read as boxes
            objs.append(obj)
    Import.export(objs, path)
    return len(objs)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Generate the parametric warehouse FreeCAD model.")
    parser.add_argument("--set", action="append", default=[], metavar="name=value",
                         help="Override a parameter for this run, e.g. --set warehouse_length=150")
    args, _ = parser.parse_known_args(sys.argv[1:])

    overrides = {}
    for item in args.set:
        k, _, v = item.partition("=")
        overrides[k] = float(v)

    values, raw = load_parameters(overrides)
    doc, layout = build_model(values, raw)

    doc.saveAs(FCSTD_PATH)
    n_exported = export_glb(doc, GLB_PATH)

    print("")
    print("=" * 70)
    print("Warehouse model generated")
    print("=" * 70)
    print("Saved FCStd : %s" % FCSTD_PATH)
    print("Exported GLB: %s (%d objects, %d bytes)" % (GLB_PATH, n_exported, os.path.getsize(GLB_PATH)))
    print("")
    print("Layout (must match web/src/calculations.js computeLayout/computeCapacity):")
    for k in ("usable_length", "bays_per_row", "rack_row_length", "width_per_aisle_unit",
              "num_aisle_units", "num_rack_rows", "racking_width_used",
              "positions_per_bay", "total_bays", "storage_capacity"):
        print("  %-22s = %s" % (k, layout[k]))
    print("=" * 70)


if __name__ in ("__main__", "create_model"):
    # freecadcmd imports a script passed on its command line as a module
    # named after the file (not "__main__" as plain CPython would), so
    # this guard has to account for both invocation styles.
    main()
