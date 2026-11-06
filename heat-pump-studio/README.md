# Heat Pump Studio

**Live:** https://kathuman.github.io/claude-projects/heat-pump-studio/

Design a heat pump the way an engineer does, from the building to the compressor. It handles homes and larger
commercial and industrial machines (up to megawatts). English, Spanish (Latin America) and Danish.

## The design steps

1. **Building.** Estimate the heat load from floor area, insulation level, indoor and design outdoor temperature, and
   occupants (a hot-water allowance), or enter the load directly. Presets give approximate design temperatures for 17
   cities.
2. **Heat source.** Outdoor air, ground (borehole brine), groundwater or lake water, or waste heat. The source inlet
   temperature, how much the source is cooled, and the evaporator approach together set the evaporating temperature.
   For ground sources the app also sizes the boreholes (guide values after VDI 4640).
3. **Heating circuit.** Underfloor, low-temperature radiators, radiators, hot water, or process or district heat.
   Flow and return temperatures plus the condenser approach set the condensing temperature.
4. **Refrigerant and compressor.** R290, R32, R410A, R134a, R1234yf, R1234ze(E) and R717. Choose a rotary, scroll,
   screw or piston compressor, and set the isentropic and drive efficiency, superheat, subcooling and speed.
5. **Installation.** Outdoor unit, indoor unit or plant room. Indoor units get the room charge limit for flammable
   refrigerants, m = 2.5 · LFL^1.25 · h0 · √A.

## What you get

- **Results:** heat load, COP against the Carnot COP, electrical input, system COP (including fan or source pump),
  heat from the source, evaporating and condensing temperatures and pressures, discharge temperature, pressure ratio,
  refrigerant mass flow and compressor displacement.
- **Engineering warnings:** discharge above about 120 °C, high pressure ratio, condensing near the critical point,
  pressure above 42 bar, a lot of flash gas, a heat exchanger pinch, a charge above the room limit, ammonia outside a
  plant room, high GWP, and a load outside the compressor's usual range.
- **Charts** (with hover readouts):
  - the cycle on the refrigerant's pressure–enthalpy chart (saturation dome, isotherms);
  - the temperature–entropy chart, with the heating water and the source;
  - temperature profiles through the condenser and the evaporator, with zone boundaries and the pinch;
  - an energy-flow chart;
  - a table comparing all seven refrigerants at the same conditions.
- **Tables:** all eight cycle states, and cards for the compressor, condenser, evaporator, boreholes, refrigerant
  lines (copper, or steel for ammonia), expansion valve, and charge and safety.

The design is stored in the page address, so **Copy link** shares it.

## How it works

- **Properties.** Refrigerant properties come from tables generated with
  [CoolProp](http://www.coolprop.org) (`tools/build_props.py`). They cover saturation every 0.5 K (bubble and dew
  pressures), plus superheated vapour and subcooled liquid on grids over ln p and degrees of superheat or subcooling.
  The browser interpolates them (`src/props.js`).
- **Cycle.** `src/cycle.js` models a single-stage, subcritical cycle with the compressor's isentropic efficiency and
  a volumetric-efficiency model per compressor type.
- **System.** `src/system.js` covers the heat load and the source and heating-circuit temperatures. It splits each
  heat exchanger into zones (desuperheating, condensing and subcooling; evaporating and superheating), each sized as
  Q / (U · LMTD). It also computes flows, fan and pump power, boreholes, pipes, charge and the charge limit.

## Tests

| Test | What it checks |
|---|---|
| `tests/props.test.js` | the tables against CoolProp at 560 random states, for all seven refrigerants |
| `tests/cycle.test.js` | ten complete CoolProp reference cycles (COP within 0.5 %, discharge temperature within 0.5 K), plus the energy balance, the Carnot limit, trends, and the system calculations |
| `tests/i18n.test.js`, `tests/release.test.js` | translations complete, and script versions consistent |

Rebuilding the data needs CoolProp (`pip install CoolProp`):
`python heat-pump-studio/tools/build_props.py`. The translations are generated with
`python heat-pump-studio/tools/build_i18n.py`.

## Limits and next steps

Pressure drops are neglected. U-values, volumetric efficiencies, the charge estimate and the borehole values are
typical figures for a first design. CO₂ (R744, transcritical) is not covered yet.

Next: seasonal performance (the EN 14825 bin method, balance point, backup heat, running costs and CO₂ against a gas
boiler). After that: detailed heat exchangers, a printable datasheet and a guided tour.
