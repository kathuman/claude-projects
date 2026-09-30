"""Independent check of the IFC export with IfcOpenShell (bundled with FreeCAD 1.x):
schema validation, spatial structure, element counts, property sets, and real geometry.

    freecadcmd tests/ifc_check.py <file.ifc> <expected.json>

Prints one JSON line starting with IFCCHECK. Used by tests/exporters.test.js."""
import json
import sys

args = [a for a in sys.argv[1:] if a.endswith(".ifc") or a.endswith(".json")]
path, expected_path = args[0], args[1]
out = {"ok": False}
try:
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.element
    import ifcopenshell.validate

    f = ifcopenshell.open(path)
    exp = json.load(open(expected_path))
    # schema validation (types, attribute counts, enumerations, references)
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(f, logger)
    out["schema"] = f.schema
    out["validation_issues"] = [str(s.get("message", s))[:160] for s in logger.statements][:5]
    out["n_issues"] = len(logger.statements)
    # structure and counts
    out["projects"] = len(f.by_type("IfcProject"))
    out["storeys"] = len(f.by_type("IfcBuildingStorey"))
    out["walls"] = len(f.by_type("IfcWall"))
    out["slabs"] = len(f.by_type("IfcSlab"))
    out["racks"] = len(f.by_type("IfcFurniture"))
    out["doors"] = len(f.by_type("IfcDoor"))
    out["spaces"] = len(f.by_type("IfcSpace"))
    storey = f.by_type("IfcBuildingStorey")[0]
    out["contained"] = sum(len(r.RelatedElements) for r in storey.ContainsElements)
    bld = f.by_type("IfcBuilding")[0]
    psets = ifcopenshell.util.element.get_psets(bld)
    out["positions"] = psets.get("Pset_WarehouseModelResults", {}).get("StoragePositions")
    out["rack_positions_sum"] = sum(ifcopenshell.util.element.get_psets(r).get("Pset_WarehouseRack", {}).get("PalletPositions", 0) for r in f.by_type("IfcFurniture"))
    # geometry: build every solid and measure the racks' combined footprint and the walls' extents
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    xs, ys, zs, rack_area, built = [], [], [], 0.0, 0
    for el in f.by_type("IfcProduct"):
        if not el.Representation:
            continue
        shape = ifcopenshell.geom.create_shape(settings, el)
        v = shape.geometry.verts
        px, py, pz = v[0::3], v[1::3], v[2::3]
        built += 1
        if el.is_a("IfcWall"):
            xs += [min(px), max(px)]; ys += [min(py), max(py)]; zs += [max(pz)]
        if el.is_a("IfcFurniture"):
            rack_area += (max(px) - min(px)) * (max(py) - min(py))
    out["built"] = built
    out["outer"] = [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3), round(max(zs), 3)]
    out["rack_area"] = round(rack_area, 2)
    out["ok"] = True
except Exception as e:  # report, don't crash the harness
    out["error"] = repr(e)
print("IFCCHECK " + json.dumps(out))
