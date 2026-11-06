# Turbine Lab — shrink the rendered drawings: 16 grey levels are plenty for line work and hatching.
# Run from the repo root after tools/render_drawings.py:  python turbine-lab/tools/compress_drawings.py
import glob, os
from PIL import Image
here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "drawings")
for f in sorted(glob.glob(os.path.join(here, "*.png"))):
    before = os.path.getsize(f)
    Image.open(f).convert("L").quantize(colors=16, dither=Image.Dither.NONE).save(f, optimize=True)
    print("%-22s %4d KB -> %4d KB" % (os.path.basename(f), before // 1024, os.path.getsize(f) // 1024))
