# Heat Pump Studio

**Live:** https://kathuman.github.io/claude-projects/heat-pump-studio/

Design a heat pump the way an engineer does, from the building to the compressor. It handles homes and larger
commercial and industrial machines (up to megawatts). English, Spanish (Latin America) and Danish.

## Learn

`learn.html` introduces heat pumps for readers from about 15. It explains:
- what a heat pump is, as a fridge working backwards that pumps heat "uphill";
- the energy balance and COP;
- the four steps of the cycle, with everyday comparisons;
- the Carnot limit in kelvin, with a slider comparing it to a real heat pump;
- the nine design equations: heat load, temperatures, enthalpy, mass flow, compressor work and efficiency, heat
  exchanger area and pinch, compressor displacement, SCOP, and money and CO₂;
- a glossary.

Each equation has a worked example computed live with the studio's own code, for a renovated 150 m² house in
Copenhagen.

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

6. **Year round.** Choose the climate data, how much of the design load the heat pump covers, the heating limit,
   weather compensation, and hot water per year.
7. **Costs and CO₂.** Electricity and gas prices, the gas boiler's efficiency, the grid's CO₂ per kWh, and the extra
   investment.

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
- **Year round** (seasonal performance by the EN 14825 bin method, using real climates):
  - SCOP and system SCOP, the heat pump's share, the balance point and the largest backup load;
  - a chart of the building's load against the heat pump's full-speed capacity, with the backup region shaded;
  - annual heat per outdoor-temperature bin, split between heat pump and electric heater;
  - hot water, plus running costs, CO₂ and simple payback against a gas boiler.
- **Installation diagram:** a live schematic of the whole system.
  - The source side matches the chosen source: air coil and fan, boreholes, wells or waste heat.
  - The refrigerant circuit shows state points 1–4 with temperatures and pressures.
  - The heating circuit includes the circulation pump, electric backup heater, emitters and hot-water tank.
  - A frame shows what sits in the outdoor unit, indoor unit or machinery room.
- **Heat exchanger selection:** brazed-plate units are chosen by plate size and number of plates, aiming for a water
  channel velocity of about 0.3 m/s (accepted range 0.1–0.8 m/s). Air coils get a face area at 2.5 m/s and a number of
  rows at a 2.5 mm fin pitch.
- **Datasheet:** a printable A4 summary with the diagram, design basis, results, cycle states, components, year-round
  figures and warnings. `?sheet=1` in the address opens it directly.
- **Guided tour:** 13 steps through the design.
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
| `tests/design.test.js` | heat exchanger selection, plus the installation diagram in all 48 variants |
| `tests/i18n.test.js`, `tests/release.test.js` | translations complete, and script versions consistent |

`tests/seasonal.test.js` checks the climate data (8 766 hours a year), the energy balance per bin, SCOP trends and
ranges, backup and the balance point, the cycling and defrost formulas, and the economics.

The climate bins come from 10 years (2015–2024) of hourly temperatures from the
[Open-Meteo](https://open-meteo.com) historical weather API (ERA5 reanalysis, CC BY 4.0), built with
`python heat-pump-studio/tools/build_climate.py`.

Rebuilding the data needs CoolProp (`pip install CoolProp`):
`python heat-pump-studio/tools/build_props.py`. The translations are generated with
`python heat-pump-studio/tools/build_i18n.py`.

## Limits and next steps

Pressure drops are neglected. U-values, volumetric efficiencies, the charge estimate and the borehole values are
typical figures for a first design. CO₂ (R744, transcritical) is not covered yet.

The seasonal model is an inverter that runs down to 30 % of full capacity, with typical defrost losses and
weather-compensation curves.

Later: CO₂ (R744, transcritical), two-stage and vapour-injection cycles, and hot-water priority.
