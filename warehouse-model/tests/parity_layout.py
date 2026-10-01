"""Helper for tests/parity.test.js: runs freecad/create_model.py's derive_layout()
on the parameter sets given as JSON on stdin and prints the layouts as JSON.
FreeCAD itself isn't needed — its modules are stubbed, since derive_layout()
is plain Python arithmetic."""
import importlib.util
import json
import os
import sys
import types

for name in ("FreeCAD", "Part", "Import"):
    sys.modules[name] = types.ModuleType(name)

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("create_model_parity", os.path.join(here, "..", "freecad", "create_model.py"))
cm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cm)

_, _, rack_types = cm.load_parameters()
designs = json.load(sys.stdin)
json.dump([cm.derive_layout(p, rack_types) for p in designs], sys.stdout)
