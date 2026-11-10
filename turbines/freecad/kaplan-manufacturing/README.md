# Kaplan turbine — manufacturing plans

A 13-sheet A3 manufacturing drawing set for the in-stream Kaplan turbine, generated from the FreeCAD model
(`../kaplan.FCStd`). Every view, section, dimension and table value is measured from the model.

**Open `kaplan-manufacturing-plans.pdf`**, or `index.html` in a browser. The single sheets are in `sheets/`.

| Sheet | Content |
|---|---|
| TL-KAP-000 | Cover, drawing list, general notes (units, ISO 2768-mK, ISO 13920-BF, EN ISO 3834 welding, ISO 12944 coating) |
| TL-KAP-001 | General assembly: section through the runner axis, view from upstream, plan, balloons, bill of materials with masses |
| TL-KAP-002 | Runner assembly: section, end view, runner data (blade spacing, diameters, hub ratio), blade setting, balancing G6.3 |
| TL-KAP-003 | Runner blade: two views, and the blade's cross-sections cut at four radii and laid flat (chord, blade angle β, thickness) |
| TL-KAP-004 to 007 | Trunnion, hub, bulb, duct: sections on the axis and a table of each part's exact revolved profile; the hub sheet also locates the five trunnion seats |
| TL-KAP-008, 009 | Guide vane; support pylon and gravity base |
| TL-KAP-010, 011 | Manufacturing process plans: operations, work centres and checks for every part |
| TL-KAP-012 | Assembly sequence; inspection and test plan with hold, witness and review points |

`step/` has one STEP file per unique part, for CAM programming. `plans.json` holds the numbers behind the sheets: the
bill of materials and the blade sections.

## What comes from the model, and what is assumed

- **From the model:** all geometry, positions and dimensions; the revolved profiles; the blade sections; the trunnion
  angles. Masses are calculated from the model volumes for the blades, trunnions, guide vanes and base.
- **Assumed (stated on the sheets):**
  - materials, processes, tolerances, inspection and test criteria;
  - the wall thicknesses of parts the model shows as solid blocks: hub 60 mm cast wall, bulb 12 mm shell, duct
    16 mm skin, pylon 20 mm plate box. Their sections are cut from shells made by shrinking each exact profile by
    that thickness, and their masses use those shells;
  - the duct, a 270° cutaway in the model, is planned as a full 360° ring.
- **Not in the model, so marked "to be designed":** the pitch mechanism inside the hub, the bolting and the shaft
  flange.

This is a teaching model: the plans show what a manufacturing package for such a unit contains and how it follows
from the CAD model. **Not for construction.**

## Regenerating

From the repo root:

```
"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" turbines/freecad/kaplan-manufacturing/make_plans.py
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --no-pdf-header-footer ^
    --print-to-pdf=turbines/freecad/kaplan-manufacturing/kaplan-manufacturing-plans.pdf turbines/freecad/kaplan-manufacturing/index.html
```

Views are projected with FreeCAD's hidden-line removal (`TechDraw.projectEx`). Sections cut each solid on the plane
and hatch the cut faces. The sheets, title blocks, dimensions and tables are written as SVG by the script.
