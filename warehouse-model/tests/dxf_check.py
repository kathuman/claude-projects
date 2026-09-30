"""Independent check of the DXF export: FreeCAD's own DXF importer reads it.

    freecadcmd tests/dxf_check.py <file.dxf>

Prints DXFCHECK <objects> <bbox x> <bbox y>. Used by tests/exporters.test.js."""
import sys
import FreeCAD
import importDXF

path = [a for a in sys.argv[1:] if a.lower().endswith(".dxf")][0]
doc = FreeCAD.newDocument("dxfcheck")
importDXF.insert(path, "dxfcheck")
bb, n = None, 0
for o in doc.Objects:
    n += 1
    if hasattr(o, "Shape") and not o.Shape.isNull():
        bb = o.Shape.BoundBox if bb is None else bb.united(o.Shape.BoundBox)
print("DXFCHECK %d %.4f %.4f" % (n, bb.XLength if bb else 0, bb.YLength if bb else 0))
