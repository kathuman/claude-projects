// Warehouse Model — Spanish (Latin America). T: strings used by the scripts, keyed by their English text ({name}
// placeholders kept); H: page text keyed by data-i18n; P: patterns for the data-import messages; PARAMS: every
// parameter's name and description; CHOICES: choice labels; RACK: rack types and their trucks. The code names of the
// parameters (warehouse_length…) stay as they are: they are what every formula, the FreeCAD script and the files use.
(function (root) {
  "use strict";
  var T = {
    // ---- rail, units, view
    "Could not load parameters.json: {e}": "No se pudo cargar parameters.json: {e}",
    "Shadows switched off to keep the view smooth on this device · drag to orbit · right-drag to pan · scroll to zoom": "Sombras desactivadas para que la vista fluya en este dispositivo · arrastre para orbitar · arrastre con el botón derecho para desplazar · use la rueda para acercar",
    "Click to type a value": "Haga clic para escribir un valor", "{name}: click to type a value": "{name}: haga clic para escribir un valor",
    "{d} deep · {s}% selective · {truck}, aisle ≥ {a}": "{d} de fondo · {s}% de selectividad · {truck}, pasillo ≥ {a}",
    "Building": "Edificio", "Racking": "Racks", "Docks & Flow": "Andenes y flujo", "Operations": "Operación", "Simulation": "Simulación", "Cost": "Costos",
    "Units:": "Unidades:", "imperial": "imperiales", "metric": "métricas",
    // ---- simulated day
    "Truck wait in the peak hour (min)": "Espera de camiones en la hora punta (min)", "no limit": "sin límite", "Truck wait, whole day (min)": "Espera de camiones, día completo (min)",
    "Trucks waiting over 30 min": "Camiones que esperan más de 30 min", "Longest yard queue (trucks)": "Cola más larga en el patio (camiones)",
    "Door utilization, day (in / out)": "Utilización de puertas, día (entrada / salida)", "Lift-truck utilization ({n} trucks)": "Utilización de montacargas ({n} montacargas)",
    "Dual-command share": "Proporción de ciclo doble", "Most pallets waiting in staging": "Máximo de pallets esperando en preparación", "Tasks left at closing": "Tareas pendientes al cierre",
    "Work finishes after closing (min)": "El trabajo termina después del cierre (min)", "Analytic": "Analítico", "Simulated (mean)": "Simulado (media)", "10–90% of days": "10–90% de los días",
    "{n} simulated days · {ms} ms": "{n} días simulados · {ms} ms", "Average truck arrivals, yard queue and lift-truck use per hour over the simulated days": "Llegadas de camiones, cola en el patio y uso de montacargas por hora, en promedio sobre los días simulados",
    "{v} trucks": "{v} camiones", "after closing": "después del cierre", "trucks arriving / h (left axis)": "camiones que llegan / h (eje izquierdo)",
    "trucks waiting in the yard (right axis)": "camiones esperando en el patio (eje derecho)", "lift trucks busy (0–100%)": "montacargas ocupados (0–100%)",
    "(after closing)": "(después del cierre)", "1 truck waiting": "1 camión esperando", "{n} trucks waiting": "{n} camiones esperando", "{b} of {n} lift trucks busy": "{b} de {n} montacargas ocupados", "day complete": "día completo",
    // ---- key results
    "Storage Capacity": "Capacidad de almacenaje", "positions · {u} usable": "posiciones · {u} utilizables", "Utilization": "Utilización", "{n} pallets over capacity": "{n} pallets sobre la capacidad",
    "ceiling {c}% for this rack": "techo de {c}% para este rack", "Rack Rows": "Filas de racks", "{b} bays × {l} levels": "{b} módulos × {l} niveles", "Selectivity": "Selectividad",
    "pallets reachable directly": "pallets accesibles directamente", "Time per Move": "Tiempo por movimiento", "single {s} s · dual {d} s/pallet": "simple {s} s · doble {d} s/pallet",
    "{d} round trip + lift": "{d} ida y vuelta + elevación", "Lift Trucks": "Montacargas", "for the peak hour (avg {a})": "para la hora punta (prom. {a})", "Dock Utilization": "Utilización de andenes",
    "peak hour · in {i} / out {o}": "hora punta · entrada {i} / salida {o}", "Truck Wait (Peak)": "Espera de camiones (punta)", "{t} trucks/day · {w}% wait": "{t} camiones/día · {w}% esperan",
    "Capital Cost": "Inversión", "build ${b}M + trucks ${t}M": "construcción ${b}M + montacargas ${t}M", "Annual Cost": "Costo anual", "total cost of ownership / year": "costo total de propiedad / año",
    "Cost per Move": "Costo por movimiento", "per pallet in or out": "por pallet que entra o sale", "Footprint": "Superficie", "{h} hectares": "{h} hectáreas",
    "ⓘ Design notes": "ⓘ Notas de diseño", "⚠ Engineering warnings": "⚠ Advertencias de ingeniería",
    // ---- traceability sections
    "Layout (geometry fit)": "Distribución (ajuste geométrico)", "Storage capacity": "Capacidad de almacenaje", "Lift-truck cycle and fleet": "Ciclo y flota de montacargas", "Docks and trucks": "Andenes y camiones",
    // ---- floor plan and charts
    "WAREHOUSE MODEL — FLOOR PLAN (LIVE)": "MODELO DE ALMACÉN — PLANTA (EN VIVO)", "Dimensioned floor plan of the current design: {r} rack rows, {p} positions.": "Planta acotada del diseño actual: {r} filas de racks, {p} posiciones.",
    "Cost Breakdown": "Desglose de la inversión", "Racking": "Racks", "Docks": "Andenes", "Annual Cost of Ownership (${v}M / year)": "Costo anual de propiedad (${v}M / año)", "Capital": "Capital", "Drivers": "Operadores",
    "Truck running": "Operación de montacargas", "Where a Lift-Truck Cycle Goes ({v} s)": "En qué se va un ciclo de montacargas ({v} s)", "Driving": "Traslado", "Lifting": "Elevación", "Handling": "Manipulación",
    "Capacity vs. Inventory": "Capacidad frente a inventario", "Capacity {v}": "Capacidad {v}", "Inventory {v}": "Inventario {v}", "planning ceiling — {v} pallets": "techo de planificación — {v} pallets",
    // ---- inspector
    "ABC class": "Clase ABC", "beam height": "altura de la viga", "putaway cycle": "ciclo de guardado", "retrieval cycle": "ciclo de retiro", "vs. average": "frente al promedio", "route shown": "ruta mostrada",
    "positions here": "posiciones aquí", "served by": "atendido por", "dimensions": "dimensiones", "role": "función", "truck turn": "tiempo por camión",
    "Click a rack in the 3D view to see that slot's route and cycle time, or a dock door to inspect it.": "Haga clic en un rack en la vista 3D para ver la ruta y el tiempo de ciclo de esa posición, o en una puerta de andén para inspeccionarla.",
    "Showing the real FreeCAD export (freecad/warehouse_model.FCStd) at its baseline parameter values. It does not move when you drag a slider — that's the honest limit of a static mesh.": "Se muestra la exportación real de FreeCAD (freecad/warehouse_model.FCStd) con sus valores de parámetros base. No cambia al mover un control: ese es el límite honesto de una malla estática.",
    "Could not load the FreeCAD GLB export — run freecad/create_model.py to generate web/models/warehouse_baseline.glb, then reload.": "No se pudo cargar la exportación GLB de FreeCAD: ejecute freecad/create_model.py para generar web/models/warehouse_baseline.glb y vuelva a cargar.",
    "average cycle time per position": "tiempo de ciclo promedio por posición",
    "<span class=\"cls a\"></span>A {a}% of moves · <span class=\"cls b\"></span>B {b}% · <span class=\"cls c\"></span>C {c}% — A = the quickest 20% of positions": "<span class=\"cls a\"></span>A {a}% de los movimientos · <span class=\"cls b\"></span>B {b}% · <span class=\"cls c\"></span>C {c}% — A = el 20% de posiciones más rápidas",
    "Storage slot · {rack}": "Posición de almacenaje · {rack}", "{c} ({p}% of moves)": "{c} ({p}% de los movimientos)", "Row {r} · bay {b} · level {l}": "Fila {r} · módulo {b} · nivel {l}",
    "{v} s (in)": "{v} s (entrada)", "{v} s (out)": "{v} s (salida)", "from/to the nearest doors": "desde/hacia las puertas más cercanas", "Dock door": "Puerta de andén",
    "Receiving Dock {n}": "Andén de recepción {n}", "Shipping Dock {n}": "Andén de despacho {n}", "{v} m bay": "{v} m de vano", "Inbound": "Entrada", "Outbound": "Salida",
    // ---- blueprint
    "RECEIVING + SHIPPING STAGING": "PREPARACIÓN DE RECEPCIÓN + DESPACHO", "RECEIVING STAGING": "PREPARACIÓN DE RECEPCIÓN", "CROSS-AISLE": "PASILLO TRANSVERSAL", "SHIPPING STAGING": "PREPARACIÓN DE DESPACHO",
    "{r} ROWS": "{r} FILAS", "{b} BAYS/ROW": "{b} MÓDULOS/FILA", "IN {n} SEGMENTS": "EN {n} TRAMOS", "{p} POSITIONS": "{p} POSICIONES", "{n}× RECEIVING": "{n}× RECEPCIÓN", "{n}× SHIPPING": "{n}× DESPACHO",
    "{l} inside (+ 2 × {w} mm wall)": "{l} interior (+ 2 × {w} mm de muro)", "{l} inside": "{l} interior", "bay {l}": "módulo {l}", "aisle {l}": "pasillo {l}", "WAREHOUSE MODEL — FLOOR PLAN": "MODELO DE ALMACÉN — PLANTA",
    "calculations.js layout &#183; same rows as the 3D view and the FreeCAD model &#183; scale bar above": "distribución de calculations.js &#183; las mismas filas que la vista 3D y el modelo de FreeCAD &#183; escala gráfica arriba",
    "CAPACITY": "CAPACIDAD", "{v} pos": "{v} pos.", "RACK ROWS": "FILAS DE RACKS", "FOOTPRINT": "SUPERFICIE", "DOCKS": "ANDENES", "{i} in / {o} out": "{i} entrada / {o} salida",
    // ---- the model's warnings
    "Warehouse is too short for even one rack bay once the cross-aisles are reserved.": "El almacén es demasiado corto para siquiera un módulo de rack una vez reservados los pasillos transversales.",
    "Warehouse is too narrow to fit a single pair of rack rows plus an aisle.": "El almacén es demasiado angosto para un solo par de filas de racks más un pasillo.",
    "{n} levels in a {h} m rack leaves {pitch} m per level — a {load} m load plus beam and lift-off gap needs {need} m.": "{n} niveles en un rack de {h} m dejan {pitch} m por nivel: una carga de {load} m más la viga y la holgura de elevación necesita {need} m.",
    "Top beam ({h} m) + load ({load} m) + sprinkler clearance ({sc} m) = {need} m, above the {clear} m clear height.": "Viga superior ({h} m) + carga ({load} m) + separación de rociadores ({sc} m) = {need} m, por encima de la altura libre de {clear} m.",
    "A {a} m aisle is too narrow for the {truck} that serves {rack} racking (needs about {min} m).": "Un pasillo de {a} m es demasiado angosto para el {truck} que atiende racks {rack} (necesita unos {min} m).",
    "VNA turret trucks work in aisles of about {min}–1.9 m; at {a} m the layout gives away most of VNA's space advantage.": "Los montacargas trilaterales VNA trabajan en pasillos de unos {min}–1.9 m; con {a} m la distribución pierde la mayor parte de la ventaja de espacio del VNA.",
    "Mid cross-aisles ({m} m) are narrower than the aisles ({a} m) — trucks need room to turn out of an aisle.": "Los pasillos transversales intermedios ({m} m) son más angostos que los pasillos ({a} m): los montacargas necesitan espacio para salir de un pasillo.",
    "U-flow puts all {n} doors ({w} m) on the {W} m west wall — they don't fit.": "El flujo en U pone las {n} puertas ({w} m) en el muro oeste de {W} m: no caben.",
    "Receiving docks ({w} m of wall) don't fit along a {W} m end wall.": "Los andenes de recepción ({w} m de muro) no caben en un muro de {W} m.",
    "Shipping docks ({w} m of wall) don't fit along a {W} m end wall.": "Los andenes de despacho ({w} m de muro) no caben en un muro de {W} m.",
    "Inventory ({inv}) exceeds storage capacity ({cap}) by {over} pallets.": "El inventario ({inv}) supera la capacidad de almacenaje ({cap}) en {over} pallets.",
    "Inventory is above the {c}% planning ceiling for {rack} racking — expect part-empty lanes you can't use and slow putaway.": "El inventario supera el techo de planificación de {c}% para racks {rack}: habrá carriles a medio llenar que no se pueden usar y guardado lento.",
    "At the peak hour, trucks arrive faster than the {side} doors can turn them — the yard queue grows without limit; docks, not storage, are the bottleneck.": "En la hora punta los camiones llegan más rápido de lo que las puertas {side} pueden atenderlos: la cola en el patio crece sin límite; los andenes, no el almacenaje, son el cuello de botella.",
    "receiving": "de recepción", "shipping": "de despacho",
    "At the peak hour the {side} doors run at {u}% and trucks wait about {w} min on average — expect a yard queue.": "En la hora punta las puertas {side} trabajan al {u}% y los camiones esperan unos {w} min en promedio: habrá cola en el patio.",
    "Here a dual-command trip takes longer per pallet ({d} s) than a single-command one ({s} s)": "Aquí un viaje de ciclo doble tarda más por pallet ({d} s) que uno de ciclo simple ({s} s)",
    ": with I-flow the truck finishes at the shipping end and drives back empty.": ": con flujo en I el montacargas termina en el extremo de despacho y vuelve vacío.",
    "With I-flow, a bay near one end is far from the other end's doors, so ABC slotting only gains across the width and in height; U-flow lets it gain along the aisles too.": "Con flujo en I, un módulo cerca de un extremo queda lejos de las puertas del otro, así que la ubicación ABC solo gana a lo ancho y en altura; el flujo en U le permite ganar también a lo largo de los pasillos.",
    // ---- traceability rows
    "Usable length (racking zone)": "Largo utilizable (zona de racks)", "Segments": "Tramos", "(usable − mid_aisles × mid_width) / (mid_aisles + 1)": "(utilizable − pasillos_intermedios × ancho_intermedio) / (pasillos_intermedios + 1)",
    "Bays per row": "Módulos por fila", "segments × floor(segment / bay_width)": "tramos × piso(tramo / bay_width)", "Row depth": "Fondo de fila", "pallets_deep ({rack}) × rack_depth": "pallets_de_fondo ({rack}) × rack_depth",
    "Width per aisle unit": "Ancho por unidad de pasillo", "Aisle units that fit": "Unidades de pasillo que caben", "floor((warehouse_width + flue) / (unit + flue))": "piso((warehouse_width + chimenea) / (unidad + chimenea))",
    "Rack rows": "Filas de racks", "Level pitch": "Paso entre niveles", "rack_height / (levels − 1)  ≥  load_height + {b} m": "rack_height / (niveles − 1)  ≥  load_height + {b} m", "{v} m (needs {n})": "{v} m (necesita {n})",
    "Clear height needed": "Altura libre necesaria", "{v} m of {c} m": "{v} m de {c} m", "Positions per bay": "Posiciones por módulo", "levels × pallets_side_by_side × pallets_deep": "niveles × pallets_lado_a_lado × pallets_de_fondo", "Total bays": "Módulos totales", "{v} positions": "{v} posiciones",
    "Practical capacity": "Capacidad práctica", "capacity × planning ceiling ({p}% for {rack})": "capacidad × techo de planificación ({p}% para {rack})", "{v} pallets": "{v} pallets",
    "Directly reachable": "Accesibles directamente", "capacity × selectivity ({p}%)": "capacidad × selectividad ({p}%)", "Planning ceiling": "Techo de planificación", "practical / physical capacity": "capacidad práctica / física",
    "Storage policy": "Política de ubicación", "ABC: A = fastest 20% of cells, B = next 30%, C = rest; F(u) = u^{k}": "ABC: A = 20% de celdas más rápidas, B = 30% siguiente, C = resto; F(u) = u^{k}",
    "random: every cell equally likely": "aleatoria: todas las celdas igual de probables", "A {a}% · B {b}% · C {c}% of moves": "A {a}% · B {b}% · C {c}% de los movimientos", "uniform": "uniforme",
    "Putaway cycle (single command)": "Ciclo de guardado (ciclo simple)", "Σ weight × [2 × (door-to-aisle + to bay) / v + 2 × lift / v_lift + overhead]": "Σ peso × [2 × (puerta-a-pasillo + hasta el módulo) / v + 2 × elevación / v_elev + tiempo fijo]",
    "Retrieval cycle (single command)": "Ciclo de retiro (ciclo simple)", "same, from the shipping doors": "igual, desde las puertas de despacho", "Single-command cycle": "Ciclo simple",
    "(putaway + retrieval) / 2": "(guardado + retiro) / 2", "{d} driving + {l} lifting + {o} = {c} s": "{d} traslado + {l} elevación + {o} = {c} s", "Dual-command cycle": "Ciclo doble",
    "in door → A → B → out door → back; A→B via the shorter cross-aisle ({n} sampled pairs)": "puerta de entrada → A → B → puerta de salida → regreso; A→B por el pasillo transversal más corto ({n} pares muestreados)",
    "{v} s for 2 moves": "{v} s para 2 movimientos", "Time per pallet move": "Tiempo por movimiento de pallet", "(1 − dual_share) × single + dual_share × dual / 2": "(1 − proporción_doble) × simple + proporción_doble × doble / 2",
    "Peak-hour work": "Trabajo en la hora punta", "moves / hours × peak_factor × time per move": "movimientos / horas × factor_punta × tiempo por movimiento", "{m} moves/h × {t} s = {w} truck-h/h": "{m} mov./h × {t} s = {w} montacargas-h/h",
    "Lift trucks needed": "Montacargas necesarios", "ceil(peak truck-hours per hour / efficiency)": "techo(montacargas-hora punta por hora / eficiencia)", "{n} (average {a})": "{n} (promedio {a})",
    "Trucks per day (each way)": "Camiones por día (cada sentido)", "throughput / 2 / pallets_per_truck": "flujo / 2 / pallets_per_truck", "Peak trucks per hour": "Camiones por hora en la punta",
    "trucks_per_day / hours × peak_factor": "camiones_por_día / horas × factor_punta", "Door capacity (in / out)": "Capacidad de puertas (entrada / salida)", "doors × 60 / truck_turn_time": "puertas × 60 / truck_turn_time",
    "{a} / {b} trucks/h": "{a} / {b} camiones/h", "Peak door utilization (in / out)": "Utilización de puertas en la punta (entrada / salida)", "peak trucks/h ÷ door capacity": "camiones/h en la punta ÷ capacidad de puertas",
    "Chance a truck waits (in / out)": "Probabilidad de que un camión espere (entrada / salida)", "Erlang C(doors, peak trucks/h × turn time)": "Erlang C(puertas, camiones/h en la punta × tiempo por camión)",
    "Mean wait at the peak (in / out)": "Espera media en la punta (entrada / salida)", "Building footprint": "Superficie del edificio", "(length + 2 × wall) × (width + 2 × wall)": "(largo + 2 × muro) × (ancho + 2 × muro)",
    "Racking cost": "Costo de racks", "Building shell cost": "Costo de la nave", "Dock cost": "Costo de andenes", "Build cost": "Costo de construcción", "racking + building + docks": "racks + edificio + andenes",
    "Lift-truck fleet": "Flota de montacargas", "trucks × price of a {truck}": "montacargas × precio de un {truck}", "Annual capital cost": "Costo anual del capital",
    "Σ cost × CRF({r}%, life) — building {b} y, racking/docks {k} y, trucks {t} y": "Σ costo × FRC({r}%, vida) — edificio {b} años, racks/andenes {k} años, montacargas {t} años",
    "trucks × hours/day × days/year × labour_cost_per_hour": "montacargas × horas/día × días/año × labour_cost_per_hour", "Truck running cost": "Costo de operación de montacargas",
    "working truck-hours/day × days × running cost/h": "montacargas-hora trabajadas/día × días × costo de operación/h", "Total cost of ownership": "Costo total de propiedad",
    "annual capital + drivers + running": "capital anual + operadores + operación", "${v} / year": "${v} / año", "Cost per pallet move": "Costo por movimiento de pallet", "TCO / (throughput × days)": "CTP / (flujo × días)",
    // ---- data panel
    "sample-movements.csv (18,000 rows)": "sample-movements.csv (18,000 filas)", "sample-inventory.csv (600 SKUs)": "sample-inventory.csv (600 SKU)",
    "Choose a movements file (or try the sample) to begin.": "Elija un archivo de movimientos (o pruebe el ejemplo) para comenzar.", "Pallet moves per day": "Movimientos de pallets por día", "Peak-hour factor": "Factor de hora punta",
    "Operating hours per day": "Horas de operación por día", "Pallets on hand": "Pallets en existencia", "Demand skew (moves from fastest 20%)": "Concentración de la demanda (movimientos del 20% más rápido)",
    "{r} rows · {d} days · {s} SKUs · {p} pallets moved": "{r} filas · {d} días · {s} SKU · {p} pallets movidos", "({p}% in)": "({p}% de entrada)", "Input": "Dato", "From your data": "Según sus datos", "Model now": "Modelo ahora",
    "Apply to the model": "Aplicar al modelo",
    "Product mix: {s} SKUs, {p} pallets each on average. {a}% of pallets belong to SKUs with 4 or more (enough to fill double-deep lanes on both sides), {b}% to SKUs with 10 or more (drive-in lanes). The rest need selective or VNA racking — use this for the optimiser's selectivity target.":
      "Mezcla de productos: {s} SKU, {p} pallets cada uno en promedio. El {a}% de los pallets pertenece a SKU con 4 o más (suficiente para llenar carriles de doble fondo a ambos lados), el {b}% a SKU con 10 o más (carriles drive-in). El resto necesita racks selectivos o VNA: úselo para la meta de selectividad del optimizador.",
    "Applied ✓": "Aplicado ✓", "Share of moves against share of {b}, fastest movers first": "Proporción de movimientos frente a proporción de {b}, primero los de mayor rotación", "pallets": "pallets",
    "{p}% of moves": "{p}% de los movimientos", "share of {b}, fastest-moving first": "proporción de {b}, primero los de mayor rotación", "share of moves": "proporción de movimientos",
    "Switch to the Live Parametric View to export the 3D model.": "Cambie a la Vista paramétrica en vivo para exportar el modelo 3D.", "Building the 3D file…": "Generando el archivo 3D…",
    "3D export failed: {e}": "La exportación 3D falló: {e}", "3D model saved ({v} MB).": "Modelo 3D guardado ({v} MB).", "Command copied.": "Comando copiado.", "Select the command and copy it.": "Seleccione el comando y cópielo.",
    // ---- decisions
    "positions": "posiciones", "Lift trucks": "Montacargas", "trucks": "montacargas", "Truck wait, peak hour": "Espera de camiones, hora punta", "Capital cost (incl. trucks)": "Inversión (incl. montacargas)",
    "Annual cost of ownership": "Costo anual de propiedad", "$/y": "$/año", "Scenario {n}": "Escenario {n}", "Current design": "Diseño actual", "Load": "Cargar", "Delete {name}": "Eliminar {name}",
    "Rack type": "Tipo de rack", "Building (inside)": "Edificio (interior)", "Link copied — it opens this exact design.": "Enlace copiado: abre exactamente este diseño.", "Copy this link: {url}": "Copie este enlace: {url}",
    "Tornado chart: effect of a ±10% change in each input on {k}": "Gráfico de tornado: efecto de un cambio de ±10% en cada dato sobre {k}", "change in {k} from {v}": "cambio en {k} desde {v}",
    "input −10%": "dato −10%", "input +10%": "dato +10%", "Nothing in the inputs moves this result by ±10%.": "Ningún dato mueve este resultado con ±10%.", "{k} as {n} varies over its range": "{k} según varía {n} en su rango",
    "now {v}": "ahora {v}", "Searching {n} candidate designs…": "Buscando entre {n} diseños candidatos…",
    "No design in the search space meets these targets — relax the wait target or the selectivity, or reduce the inventory.": "Ningún diseño del espacio de búsqueda cumple estas metas: flexibilice la meta de espera o la selectividad, o reduzca el inventario.",
    "{n} candidates, {f} feasible ({ms} ms). Cheapest: <b>{rack}, {l} levels, {L} × {W} m</b> at {c}/year — {cmp} the current design.": "{n} candidatos, {f} factibles ({ms} ms). El más barato: <b>{rack}, {l} niveles, {L} × {W} m</b> a {c}/año, {cmp} el diseño actual.",
    "{p}% below": "{p}% por debajo de", "{p}% above": "{p}% por encima de", "Levels · height": "Niveles · altura", "Doors in/out": "Puertas ent./sal.", "Positions": "Posiciones", "s / move": "s / mov.",
    "Trucks": "Montacargas", "Annual cost": "Costo anual", "$ / move": "$ / mov.", "Pareto front: nothing else is both cheaper and quicker": "Frontera de Pareto: ningún otro es a la vez más barato y más rápido",
    "{l} · {h} m (clear {c})": "{l} · {h} m (libre {c})", "Apply": "Aplicar", "Every feasible design: annual cost against time per pallet move": "Cada diseño factible: costo anual frente a tiempo por movimiento de pallet",
    "current": "actual", "time per pallet move → (annual cost ↑)": "tiempo por movimiento de pallet → (costo anual ↑)", "★ / outlined = Pareto front · ◇ = current design": "★ / con borde = frontera de Pareto · ◇ = diseño actual"
  };

  var H = {
    "title.index": "Modelo de Almacén — Entorno interactivo de razonamiento de ingeniería", "title.about": "Acerca del Modelo de Almacén",
    "meta.index": "Un modelo paramétrico de almacén que conecta un modelo de ingeniería real en FreeCAD, un modelo analítico de capacidad, utilización, recorridos y costos, y una visualización 3D interactiva en vivo: cambie un parámetro y vea juntas las consecuencias físicas, matemáticas y financieras.",
    "meta.about": "El Modelo de Almacén conecta un modelo de ingeniería en FreeCAD, un modelo analítico de capacidad, recorridos y costos, y una vista 3D en vivo mediante un único conjunto de parámetros. Diseñado y construido por Daniel Alberto Sepulveda Estay, PhD.",
    "attr.ver": "Versión de la aplicación", "brand.sub": "FREECAD · MODELO ANALÍTICO · 3D EN VIVO — UNA SOLA FUENTE DE VERDAD",
    "attr.units": "Cambiar las unidades mostradas (el modelo siempre calcula en métrico)", "nav.about": "Acerca de", "nav.projects": "← Proyectos",
    "rail.h1": "Parámetros", "rail.reset": "Restablecer todo",
    "rail.note": "Cada control de esta lista se lee directamente de <code>data/parameters.json</code>, el mismo archivo que lee <code>freecad/create_model.py</code>. Nada en esta interfaz es una copia aparte, escrita a mano, de un número que vive en otro lugar. Debajo de cada nombre aparece su nombre en el código, el que usan todas las fórmulas.",
    "view.live": "Vista paramétrica en vivo", "view.ref": "Modelo de referencia (FreeCAD)", "aria.color": "Colorear los pallets según",
    "color.stock": "Inventario", "attr.stock": "El inventario actual, ubicado al azar", "color.heat": "Tiempo de recorrido", "attr.heat": "Cada posición, coloreada según su tiempo de ciclo promedio de montacargas",
    "color.class": "Clase ABC", "attr.class": "Qué posiciones guardan los productos A, B y C (ubicación por clases)", "btn.play": "▶ Reproducir un día", "attr.play": "Reproducir un día simulado en la vista 3D",
    "btn.walls": "Muros", "btn.resetview": "Restablecer vista", "aria.speed": "Velocidad de reproducción", "aria.stop": "Detener la reproducción", "heat.small": "tiempo de ciclo promedio por posición",
    "caption": "Arrastre para orbitar · arrastre con el botón derecho para desplazar · use la rueda para acercar · haga clic en un rack para ver la ruta y el tiempo de ciclo de esa posición",
    "h.kpi": "Resultados clave", "h.insp": "Inspector", "insp.hint": "Haga clic en una fila de racks o en una puerta de andén en la vista 3D para inspeccionarla.",
    "h.plan": "Planta (plano)", "btn.svg": "Descargar SVG",
    "plan.note": "Una planta acotada dibujada con los mismos resultados de <code>calculations.js</code> que todo lo demás en esta página —las mismas posiciones de filas y pasillos que usan la vista 3D y el modelo de FreeCAD— y redibujada en cada cambio. Las líneas discontinuas dentro de una fila son los carriles de los tipos de rack profundos; las punteadas son los ejes de los pasillos.",
    "h.sim": "Día simulado",
    "sim.note": "Los resultados clave de arriba son promedios y una fórmula de colas en régimen estable. Esto simula el día evento a evento —camiones que llegan al azar durante el día (la hora más intensa = el factor de hora punta), hacen cola por las puertas, montacargas que retiran y guardan cada pallet— <span id=\"sim-reps\">30</span> veces con llegadas aleatorias distintas, y muestra el promedio y el rango entre esos días. Presione <b>▶ Reproducir un día</b> sobre la vista 3D para ver uno.",
    "h.dec": "Decisiones", "aria.dtabs": "Herramientas de decisión", "tab.scn": "Escenarios", "tab.sens": "Sensibilidad", "tab.opt": "Optimizador",
    "scn.note": "Guarde el diseño actual como escenario, cambie cosas y vuelva a guardar: cada escenario se recalcula aquí lado a lado (el mejor valor de cada fila destacado). Los escenarios quedan en este navegador; un enlace para compartir lleva un diseño a cualquier persona.",
    "ph.scn": "Nombre del escenario", "scn.save": "Guardar el diseño actual", "scn.link": "Copiar enlace", "scn.json": "Exportar JSON", "scn.csv": "Exportar CSV",
    "scn.empty": "Aún no hay escenarios guardados: la tabla muestra solo el diseño actual.",
    "sens.note": "¿Qué datos importan más? El tornado mueve cada dato un 10% hacia abajo y hacia arriba (de a uno) y muestra cuánto se mueve el resultado elegido; el barrido recorre un dato en todo su rango.",
    "sens.kpi": "Resultado", "sens.param": "Dato a recorrer",
    "opt.note": "Busca los diseños más baratos (costo anual de propiedad) que guardan el inventario actual dentro del techo de planificación de cada tipo de rack y mantienen la espera de camiones en la hora punta bajo una meta, para el flujo, la punta, la distribución, la política de ubicación y los costos actuales. Prueba cada tipo de rack, número de niveles y ancho de edificio; el ancho de pasillo, la altura del rack y la altura libre, el largo y la cantidad de puertas se dimensionan después para que calcen. Aplique cualquier resultado para explorarlo.",
    "opt.wait": "Espera máx. de camiones en la punta", "aria.optwait": "Espera máxima de camiones en la hora punta, minutos", "opt.sel": "Selectividad de al menos",
    "opt.o1": "100% (todos los pallets accesibles)", "opt.o2": "50% (permite doble fondo)", "opt.o3": "cualquiera (permite push-back, drive-in)", "opt.run": "Buscar diseños",
    "h.data": "Datos y archivos", "imp.h": "Importe sus datos",
    "imp.note": "Un CSV de movimientos (una fila por movimiento de pallet o línea de pedido: fecha y hora, SKU, pallets, y entrada/salida si lo tiene) y, opcionalmente, un CSV de inventario (SKU, pallets en existencia). Los nombres de columna se reconocen en forma flexible, en inglés o en español (fecha, cantidad, artículo, entrada/salida…). Los archivos se leen en su navegador: no se sube nada.",
    "imp.mv": "CSV de movimientos", "imp.none": "ninguno", "imp.inv": "CSV de inventario", "imp.noneopt": "ninguno (opcional)", "imp.sample": "Probar los datos de ejemplo", "imp.sampledl": "Descargar los CSV de ejemplo",
    "exp.h": "Exporte el diseño", "exp.note": "El diseño actual, en formatos que abren las herramientas CAD y BIM. Toda la geometría viene de la misma distribución que la vista 3D y la planta. Los archivos exportados quedan en inglés, como es habitual en el intercambio CAD/BIM.",
    "exp.ifc": "Edificio, muros, losas, un elemento por fila de racks, puertas de andén y espacios, con cada dato y resultado clave como conjuntos de propiedades. Verificado contra el esquema IFC4 con IfcOpenShell.",
    "exp.dxf": "La planta en metros en capas con nombre (muros, racks con líneas de módulo, pasillos, andenes, zonas, notas): AutoCAD R12, se abre casi en cualquier parte.",
    "exp.glb": "El modelo 3D en vivo como archivo .glb: racks, pallets, edificio y remolques.", "exp.svg": "La planta acotada de arriba.",
    "exp.fc": "Regenere este diseño exacto como un modelo paramétrico real de FreeCAD (ejecútelo desde la carpeta <code>warehouse-model</code>):", "exp.copy": "Copiar",
    "h.charts": "Análisis visual", "h.trace": "Trazabilidad: de dónde sale cada número", "trace.note": "Cada indicador de arriba se obtiene exactamente con estos pasos. Nada es una caja negra.",
    "why.sum": "¿Por qué importa? Cómo leer el modelo",
    "why.body": "<p><b>La capacidad de almacenaje</b> es pura geometría: cuántas filas de racks caben a lo ancho del edificio, cuántos módulos caben a lo largo, por niveles y posiciones por módulo. Cambie <code>aisle_width</code> y vea cómo <em>caben más o menos filas</em>: una consecuencia física, no una perilla que ajusta directamente la capacidad.</p>" +
      "<p><b>La utilización</b> es deliberadamente independiente de la capacidad: <code>current_inventory_pallets</code> es un hecho operativo real (cuánto hay de verdad en el edificio ahora), así que reducir la capacidad sin cambiar la demanda es exactamente como la utilización supera el 100%: una condición de desborde real, no un valor recortado.</p>" +
      "<p><b>El tipo de rack</b> fija la profundidad de cada carril. Los carriles más profundos (doble fondo, push-back, drive-in) necesitan menos pasillos, así que el mismo piso guarda más pallets, pero se puede llegar directamente a menos de ellos (<em>selectividad</em>), y como un carril solo guarda un producto, los carriles a medio llenar desperdician espacio, de modo que el techo realista (<em>capacidad práctica</em>) es menor. El VNA mantiene todos los pallets accesibles y ahorra espacio con pasillos muy angostos, a cambio de un montacargas trilateral guiado.</p>" +
      "<p><b>El ajuste vertical</b> se verifica como lo haría un diseñador de racks: cada nivel debe alojar una carga más la viga y una holgura de elevación, y la carga superior debe quedar a la distancia de los rociadores bajo la obstrucción más baja (0.46 m para rociadores estándar, 0.91 m para ESFR según NFPA 13).</p>" +
      "<p><b>El tiempo de ciclo</b> es un promedio exacto sobre esta distribución, no una aproximación de manual: desde cada puerta de recepción o despacho a cada pasillo, módulo y nivel, por una ruta rectilínea (puerta → a través de la zona de preparación → por el pasillo). Los montacargas elevan la carga solo después de detenerse, así que el tiempo de elevación se suma al de traslado; por eso los racks más altos cuestan tiempo aunque el piso se achique. Los viajes son de ciclo simple (un pallet por viaje, ubicación aleatoria); la ubicación inteligente y los viajes combinados vienen en una versión posterior.</p>" +
      "<p><b>Los andenes</b> se dimensionan por camiones, no por pallets: cada puerta atiende un camión cada <code>truck_turn_time</code> minutos, las puertas de recepción y de despacho son distintas (una puede ser el cuello de botella mientras la otra está ociosa) y se dimensionan para la <b>hora punta</b>, no para el promedio diario. Los camiones llegan al azar, así que hacen cola mucho antes de que las puertas estén 100% ocupadas: la espera viene de la fórmula de colas <b>Erlang C</b> (M/M/c), corregida para tiempos de atención menos variables que los puramente aleatorios (Allen–Cunneen). La flota de montacargas también se dimensiona para la hora punta, considerando la parte de cada hora que un montacargas realmente trabaja.</p>" +
      "<p><b>Ubicación y flujo.</b> Con ubicación <b>por clases (ABC)</b> los pallets de mayor rotación viven en las posiciones más rápidas. Cuánto ahorra depende de la concentración de la demanda y de dónde están las puertas. Con <b>flujo en I</b> (recibir en un extremo y despachar desde el otro), un módulo cerca de las puertas de recepción queda lejos de las de despacho, así que ABC solo gana a lo ancho y en altura; con <b>flujo en U</b> (ambas en un mismo muro) gana también a lo largo de los pasillos. Los viajes de <b>ciclo doble</b> guardan un pallet y retiran otro en el mismo viaje; los <b>pasillos transversales intermedios</b> acortan el trayecto entre ambos, a costa de algunos módulos.</p>" +
      "<p><b>Los costos</b> usan tarifas planas ilustrativas (vea los controles de Costos): muestran cómo se desplazan entre sí los costos de racks, nave y andenes a medida que cambia el diseño, no una cotización.</p>",
    "exp2.sum": "Experimentos guiados: pruebe estos",
    "exp2.list": "<li><b>Geometría.</b> Duplique <code>warehouse_length</code>. ¿Se duplica también la capacidad de almacenaje? (Mire <code>bays_per_row</code> en el panel de Trazabilidad: los dos pasillos transversales son un costo fijo, así que un edificio más largo es algo más eficiente por metro, no exactamente el doble.)</li>" +
      "<li><b>Capacidad sin superficie.</b> Sin tocar <code>warehouse_length</code> ni <code>warehouse_width</code>, ¿puede aumentar la capacidad cambiando solo <code>rack_height</code> y <code>levels_per_rack</code>? ¿Qué debe cumplir <code>clear_height</code> para que funcione?</li>" +
      "<li><b>Utilización con capacidad fija.</b> Congele los parámetros de edificio y racks. Suba <code>current_inventory_pallets</code> por sobre la capacidad que muestran los Resultados clave. ¿Qué advertencia aparece y qué significa en la operación?</li>" +
      "<li><b>Un compromiso.</b> Angoste <code>aisle_width</code> para que quepan más filas. La capacidad sube, pero ¿el <code>Avg. Round Trip</code> sube, baja o se mantiene? ¿Por qué una instalación real podría evitar igual el pasillo más angosto permitido?</li>" +
      "<li><b>El cuello de botella se mueve.</b> Suba <code>daily_throughput_pallets</code> sin cambiar la cantidad de andenes. ¿En qué punto la <b>Utilización de andenes</b>, y no el almacenaje, pasa a ser la restricción? Ahora suba <code>peak_hour_factor</code>: el día promedio no cambió, ¿por qué necesita más puertas?</li>" +
      "<li><b>Tipos de rack.</b> Cambie a <b>Doble fondo</b> y luego a <b>Drive-in</b>. La capacidad sube: ¿qué pasa con la selectividad y la capacidad práctica? Luego pruebe <b>VNA</b> y angoste el pasillo a 1.8 m: ¿cómo se compara con el doble fondo en capacidad, y por qué igual elegiría uno u otro?</li>" +
      "<li><b>Ubicación.</b> Cambie <code>storage_policy</code> a ABC y abra la vista <b>Clase ABC</b>. ¿Cuánto baja el tiempo por movimiento? Ahora cambie <code>flow_layout</code> a flujo en U: ¿por qué ABC ahorra de pronto mucho más?</li>" +
      "<li><b>Ciclo doble.</b> Con flujo en I, suba <code>dual_command_share</code>: el tiempo por movimiento <em>empeora</em>. Lea la nota de diseño, cambie a flujo en U y vuelva a intentarlo. Luego agregue dos <code>mid_cross_aisles</code> en un edificio de 200 m: ¿qué gana y qué cede?</li>" +
      "<li><b>Colas antes que capacidad.</b> Duplique <code>daily_throughput_pallets</code>. La utilización de puertas sigue bajo 100%, ¿por qué se dispara la <b>Espera de camiones</b>? Agregue una puerta y vea cómo la espera baja mucho más que la utilización.</li>" +
      "<li><b>¿Qué deberíamos construir?</b> Abra <b>Decisiones → Optimizador</b> y presione <b>Buscar diseños</b>. ¿Por qué el diseño más barato usa racks altos y una superficie pequeña? Permita una selectividad \"cualquiera\": ¿qué gana, y qué tendría que saber de los productos antes de elegirlo?</li>" +
      "<li><b>¿Qué importa más?</b> En <b>Sensibilidad</b>, mire el costo anual: los sueldos de los operadores suelen encabezar el tornado, por eso menos viajes y más rápidos (ubicación, flujo en U) valen más que racks más baratos.</li>" +
      "<li><b>Los promedios esconden colas.</b> Suba <code>peak_hour_factor</code> a 2.5. Los totales diarios no cambian, pero mire el <b>Día simulado</b>: crecen la espera de la hora más intensa y la cola en el patio. Luego fije <code>sim_lift_trucks</code> en uno menos que lo recomendado: el trabajo se extiende después del cierre y los camiones de salida esperan sus pallets en las puertas.</li>" +
      "<li><b>Hacia arriba.</b> Agregue un nivel (5 niveles) sin cambiar la altura del rack. ¿Qué advertencia aparece? Suba <code>rack_height</code> hasta que desaparezca, y observe el tiempo de ciclo y la verificación de altura libre.</li>",
    "arch.sum": "Cómo está construido: arquitectura",
    "arch.body": "<p><code>freecad/create_model.py</code> es el modelo de ingeniería autoritativo: lee <code>data/parameters.json</code>, construye el almacén en FreeCAD (piso, muros y techo con <code>Part::Box</code>, una <code>Spreadsheet::Sheet</code> viva que guarda cada parámetro como una celda con nombre, unidad y expresión asociable) y exporta una instantánea GLB teselada. Active <b>Modelo de referencia</b> arriba para cargar esa exportación real.</p>" +
      "<p><code>web/src/calculations.js</code> es el modelo analítico: la misma aritmética de distribución que ejecuta el script de FreeCAD, reimplementada en JS para recalcular al instante mientras mueve un control, con cada función devolviendo un arreglo <code>trace</code> (vea el panel de Trazabilidad). Las pruebas unitarias lo verifican con cálculos a mano, sobre miles de diseños aleatorios y contra un recorrido exhaustivo de todas las posiciones; una prueba de paridad ejecuta el código de distribución del script de FreeCAD sobre los mismos diseños aleatorios y exige resultados idénticos.</p>" +
      "<p><code>web/src/visualization.js</code> es la vista 3D en vivo: geometría procedural de Three.js construida con los mismos parámetros y los mismos números de distribución, reconstruida en cada cambio. <em>No</em> es el GLB —una malla horneada no puede redimensionarse— y la aplicación nunca sugiere lo contrario.</p>" +
      "<p><code>web/src/simulation.js</code> es una simulación de eventos discretos del día que toma cada tiempo de tarea de montacargas de las mismas fórmulas por posición; sus pruebas verifican que el trabajo de montacargas por pallet coincida con el modelo analítico y que las esperas en las puertas coincidan con la fórmula de colas. <code>web/src/optimizer.js</code> busca diseños con el mismo modelo; sus pruebas vuelven a verificar cada diseño que entrega. <code>web/src/exporters.js</code> escribe los archivos IFC y DXF (probados abriéndolos en IfcOpenShell y FreeCAD), y <code>web/src/dataimport.js</code> convierte los datos de movimientos e inventario en datos de entrada del modelo.</p>",
    "foot.consult": "Modelo de Almacén <span id=\"ver-foot\"></span> · <a href=\"about.html\">Acerca de</a>",
    "foot.note": "Un modelo paramétrico de almacén: geometría real de FreeCAD, un modelo analítico trazable y una vista 3D interactiva en vivo que comparten una sola fuente de verdad para los parámetros. Construido con <a href=\"https://claude.com\" target=\"_blank\" rel=\"noopener\">Claude</a>.",
    // about
    "a.sub": "ACERCA DE LA APLICACIÓN", "a.open": "Abrir el modelo", "a.eyebrow": "Acerca de la aplicación", "a.h1": "Modelo de Almacén",
    "a.lede": "Un almacén sobre el que se puede razonar antes de construirlo. Un único conjunto de parámetros alimenta un modelo de ingeniería real en FreeCAD, un modelo analítico trazable y una vista 3D en vivo. Cambie los racks, los andenes o el flujo, y las consecuencias físicas, operativas y financieras se actualizan juntas. En inglés o en español.",
    "a.openbtn": "<a class=\"open\" href=\"index.html\">Abrir el Modelo de Almacén →</a>", "a.what.h": "Qué hace",
    "a.what.list": "<li><b>Diseña el edificio</b>Racks, pasillos, andenes de recepción y despacho y el edificio que los rodea, distribuidos a partir de los parámetros y mostrados en 3D.</li>" +
      "<li><b>Calcula capacidad y costos</b>Capacidad de almacenaje, utilización, recorridos de montacargas, colas en andenes y de camiones, mano de obra y costo anual de propiedad. Cada resultado muestra cómo se obtuvo.</li>" +
      "<li><b>Simula un día de trabajo</b>Llegadas aleatorias de camiones, colas en el patio y tareas de montacargas, repetidas durante 30 días para mostrar el rango en torno a cada resultado.</li>" +
      "<li><b>Apoya la decisión</b>Escenarios guardados lado a lado, gráficos de sensibilidad y un optimizador que encuentra el diseño más barato que cumple sus metas.</li>" +
      "<li><b>Entrega a ingeniería</b>Exporta a IFC (BIM), plantas DXF y glTF 3D, e importa datos reales de movimientos e inventario para fijar los datos de entrada.</li>",
    "a.how.h": "Cómo está construido",
    "a.how.p": "Cada dato de entrada vive en un único archivo de parámetros, que leen tanto el script de FreeCAD como la aplicación web, así que el modelo CAD y los cálculos no pueden distanciarse. Las pruebas automáticas verifican los cálculos, la simulación, el optimizador y las exportaciones, y confirman que el modelo de FreeCAD y la aplicación web distribuyen los mismos diseños de forma idéntica. La aplicación se ejecuta por completo en su navegador.",
    "a.author.h": "Autor",
    "a.author.p": "El Modelo de Almacén fue diseñado y construido por <b>Daniel Alberto Sepulveda Estay, PhD</b>, fundador de <a href=\"https://kathuman.github.io/estay-dynamics/\" target=\"_blank\" rel=\"noopener\">Estay Dynamics</a>. Trabaja en dinámica de sistemas, simulación y optimización de redes para cadenas de suministro y operaciones. Es doctor de la Universidad Técnica de Dinamarca (DTU) y magíster del Instituto Tecnológico de Massachusetts (MIT), y es miembro del consejo de la System Dynamics Society.",
    "a.author.links": "<a href=\"https://kathuman.github.io/estay-dynamics/about.html\" target=\"_blank\" rel=\"noopener\">Más sobre Daniel →</a>",
    "a.cite": "<b>Para citar:</b> Sepulveda Estay, D. A. (2026). <em>Warehouse Model</em> (versión <span id=\"cite-ver\">7.1.0</span>) [Software]. https://kathuman.github.io/claude-projects/warehouse-model/web/",
    "a.foot": "Modelo de Almacén v7.1.0 · <a href=\"index.html\">Abrir el modelo</a>",
    "a.foot.note": "Un modelo paramétrico de almacén: geometría real de FreeCAD, un modelo analítico trazable y una vista 3D interactiva en vivo que comparten una sola fuente de verdad para los parámetros. Construido con <a href=\"https://claude.com\" target=\"_blank\" rel=\"noopener\">Claude</a>."
  };

  // ---- the data-import messages (produced in English by dataimport.js)
  var P = [
    ["^The movements file has no data rows\\.$", "El archivo de movimientos no tiene filas de datos."],
    ["^No SKU / item column found \\(looked for: (.*)\\)\\.$", "No se encontró una columna de SKU / artículo (se buscó: $1)."],
    ["^No date column found \\(looked for: date, datetime, timestamp…\\)\\.$", "No se encontró una columna de fecha (se buscó: date, fecha, datetime, timestamp…)."],
    ["^No quantity column — each row counted as one pallet\\.$", "Sin columna de cantidad: cada fila se cuenta como un pallet."],
    ["^No usable rows \\(check the date and quantity columns\\)\\.$", "No hay filas utilizables (revise las columnas de fecha y cantidad)."],
    ["^1 row skipped \\(missing SKU, date or quantity\\)\\.$", "1 fila omitida (falta SKU, fecha o cantidad)."],
    ["^([\\d,]+) rows skipped \\(missing SKU, date or quantity\\)\\.$", "$1 filas omitidas (falta SKU, fecha o cantidad)."],
    ["^Hourly profile from ([\\d,]+) time-stamped rows: (\\d+) active hours, busiest hour ([\\d.]+)× the average\\.$", "Perfil horario a partir de $1 filas con hora: $2 horas activas, la hora más intensa es $3× el promedio."],
    ["^No time of day in the data — the peak-hour factor and operating hours are left as they are\\.$", "Los datos no traen la hora del día: el factor de hora punta y las horas de operación quedan como están."],
    ["^Inventory file: no SKU or pallets column found — ignored\\.$", "Archivo de inventario: no se encontró columna de SKU o de pallets; se ignora."],
    ["^1 SKU moved but not in the inventory file — counted as one pallet each\\.$", "1 SKU con movimientos pero sin inventario: se cuenta como un pallet."],
    ["^(\\d+) SKUs moved but not in the inventory file — counted as one pallet each\\.$", "$1 SKU con movimientos pero sin inventario: se cuenta un pallet por cada uno."],
    ["^No inventory file — demand skew measured across SKUs rather than pallets\\.$", "Sin archivo de inventario: la concentración de la demanda se mide por SKU en lugar de por pallets."],
    ["^Some values are beyond the model's slider ranges and were capped\\.$", "Algunos valores superan los rangos de los controles del modelo y se limitaron."]
  ];

  // ---- the parameters: Spanish names and descriptions (the code names stay)
  var PARAMS = {
    warehouse_length: { label: "Largo del almacén", description: "Largo interior del edificio (de cara a cara de muro), en la dirección de los pasillos de racks: la dirección en que más viaja un montacargas." },
    warehouse_width: { label: "Ancho del almacén", description: "Ancho interior del edificio, a través de los pasillos: es lo que limita cuántas filas de racks caben lado a lado." },
    clear_height: { label: "Altura libre", description: "Altura libre desde el piso hasta la obstrucción más baja (estructura del techo o cañerías de rociadores). Debe alojar la viga superior, la carga sobre ella y la separación de rociadores sobre esa carga." },
    wall_thickness: { label: "Espesor de muro", description: "Espesor del muro perimetral (rango de paneles de hormigón prefabricado). Se suma por fuera de las dimensiones interiores, así que cuenta para la superficie del edificio y su costo." },
    rack_type: { label: "Tipo de rack", description: "Sistema de almacenaje. Fija cuántos pallets de fondo tiene cada carril, a cuántos pallets se puede llegar directamente (selectividad), el pasillo más angosto en que puede trabajar su montacargas y qué tan lleno se puede operar de forma realista." },
    rack_height: { label: "Altura del rack", description: "Altura del nivel de viga superior. Los racks más altos meten más niveles en la misma superficie, pero necesitan montacargas más altos (y caros) y un edificio más alto." },
    levels_per_rack: { label: "Niveles por rack", description: "Número de niveles de almacenaje, incluido el nivel de piso; los niveles de viga se reparten de forma pareja hasta la viga superior." },
    load_height: { label: "Altura de la carga", description: "Altura de una carga sobre pallet, incluido el pallet. Cada nivel debe ser lo bastante alto para una carga más la viga y una holgura de elevación; la carga superior también debe librar los rociadores." },
    rack_depth: { label: "Fondo de la posición", description: "Fondo de una posición de pallet (de adelante hacia atrás). Un carril mide esto por la profundidad en pallets del tipo de rack; las filas van espalda con espalda entre pasillos." },
    bay_width: { label: "Ancho del módulo", description: "Ancho de un módulo de rack (de puntal a puntal): el módulo que se repite a lo largo de la fila." },
    positions_per_level_per_bay: { label: "Pallets por nivel y módulo", description: "Pallets lado a lado en un nivel de viga de un módulo (2 es típico para un módulo de 2.7 m con pallets de 1.2 m). La profundidad la fija el tipo de rack, no este dato." },
    aisle_width: { label: "Ancho de pasillo", description: "Pasillo de trabajo libre entre dos filas de racks enfrentadas, fijado por el montacargas que atiende el tipo de rack; el modelo advierte cuando es más angosto de lo que ese montacargas necesita." },
    flue_space: { label: "Espacio de chimenea", description: "Separación entre filas espalda con espalda (la chimenea longitudinal), que se mantiene libre para que el agua de los rociadores y el calor suban a través de los racks. Normas como NFPA 13 exigen al menos 150 mm; 300 mm es la práctica habitual." },
    mid_cross_aisles: { label: "Pasillos transversales intermedios", description: "Pasillos transversales por el medio de los racks, que dividen cada fila en tramos iguales. Cuestan módulos de almacenaje, pero permiten que un montacargas cambie de pasillo sin ir hasta el extremo, lo que acorta los viajes de ciclo doble." },
    mid_cross_aisle_width: { label: "Ancho del pasillo transversal intermedio", description: "Ancho libre de cada pasillo transversal intermedio: al menos el ancho de pasillo, para que un montacargas pueda salir de un pasillo hacia él." },
    sprinkler_clearance: { label: "Separación de rociadores", description: "Separación mínima entre la parte superior de la carga más alta y los deflectores de los rociadores: 0.46 m (18 in) para rociadores de techo estándar, 0.91 m (36 in) para ESFR según NFPA 13." },
    flow_layout: { label: "Distribución del flujo", description: "Dónde están las puertas. El flujo en I (de paso) recibe en un extremo y despacha desde el otro; el flujo en U pone ambas en el mismo muro, así que las puertas necesitan más muro, pero los pallets de mayor rotación pueden quedar cerca de ambas." },
    num_receiving_docks: { label: "Andenes de recepción", description: "Puertas de andén para camiones de entrada, en el muro de recepción (oeste)." },
    num_shipping_docks: { label: "Andenes de despacho", description: "Puertas de andén para camiones de salida, en el muro de despacho (este)." },
    dock_bay_width: { label: "Ancho por andén", description: "Ancho asignado a cada puerta de andén a lo largo del muro, determinado por el ancho del remolque." },
    cross_aisle_width: { label: "Ancho de la zona de preparación", description: "Zona libre de preparación en cada extremo de los racks, entre las puertas de andén y el primer módulo: reservada para preparación y tránsito transversal, no para almacenaje." },
    pallets_per_truck: { label: "Pallets por camión", description: "Pallets por camión completo (26 llenan un remolque estadounidense de 53 ft en una altura; 33 llenan un remolque europeo de 13.6 m con europallets)." },
    truck_turn_time: { label: "Tiempo por camión", description: "Tiempo que un camión ocupa una puerta: estacionarse, descargar o cargar cada pallet, papeleo y salir." },
    current_inventory_pallets: { label: "Inventario actual (pallets)", description: "Pallets actualmente almacenados, fijados a propósito en forma independiente de la capacidad física: es lo que permite ver la utilización superar el 100% cuando se reduce la capacidad sin reducir la demanda." },
    daily_throughput_pallets: { label: "Flujo diario (pallets)", description: "Pallets movidos por día, de entrada más de salida (se supone la mitad cada uno): determina la carga de los andenes y el trabajo de los montacargas." },
    storage_policy: { label: "Política de ubicación", description: "Cómo se asignan los pallets a las posiciones. La aleatoria usa cualquier posición libre; la ABC por clases guarda los pallets de mayor rotación (clase A) en las posiciones más rápidas, los siguientes (B) en las siguientes más rápidas y el resto (C) más lejos." },
    demand_skew: { label: "Concentración de la demanda", description: "Proporción de movimientos que vienen del 20% de pallets de mayor rotación: 80 es la regla clásica de Pareto, 20 significa que todos los pallets se mueven igual de seguido. Solo importa con ubicación por clases." },
    dual_command_share: { label: "Proporción de ciclo doble", description: "Proporción de movimientos hechos en viajes de ciclo doble: guardar un pallet y retirar otro en el mismo viaje, en lugar de volver vacío." },
    operating_hours_per_day: { label: "Horas de operación por día", description: "Horas por día en que los andenes y el piso operan activamente (por ejemplo, dos turnos = 16 h)." },
    peak_hour_factor: { label: "Factor de hora punta", description: "Volumen de la hora más intensa respecto de la hora promedio. Los andenes y los montacargas deben dimensionarse para la punta, no para el promedio diario." },
    forklift_speed: { label: "Velocidad del montacargas", description: "Velocidad promedio de traslado con carga, incluidas aceleración y curvas (los montacargas retráctiles en pasillos angostos van más lento que los contrabalanceados en piso abierto)." },
    lift_speed: { label: "Velocidad de elevación", description: "Velocidad promedio de elevación y descenso del mástil. Los montacargas elevan la carga después de detenerse en el módulo (elevar en marcha es inseguro), así que el tiempo de elevación se suma al de traslado: los niveles más altos tardan más." },
    forklift_cycle_overhead: { label: "Tiempo fijo por ciclo", description: "Tiempo fijo por viaje que no es traslado ni elevación: tomar y dejar el pallet, posicionarse en el módulo, escanear, entrar al pasillo." },
    truck_efficiency: { label: "Eficiencia del montacargas", description: "Proporción de cada hora de operación en que un montacargas realmente trabaja (las pausas, los cambios de batería, la congestión y las esperas se llevan el resto)." },
    sim_lift_trucks: { label: "Montacargas en la simulación", description: "Montacargas en el día simulado. 0 usa la flota que recomienda el modelo analítico (Montacargas en los Resultados clave); fije un número para ver qué pasa con menos o más." },
    cost_per_rack_position: { label: "Costo por posición de rack", description: "Costo instalado por posición de almacenaje (racks, herrajes, instalación): ilustrativo, no una cotización." },
    cost_per_sqm_building: { label: "Costo por m² de edificio", description: "Costo de la nave por metro cuadrado de superficie (por fuera de los muros): ilustrativo; su aumento con la altura libre no está modelado." },
    operating_days_per_year: { label: "Días de operación por año", description: "Días al año que opera el almacén: convierte el trabajo y el flujo diarios en costos anuales." },
    labour_cost_per_hour: { label: "Costo por hora de operador", description: "Costo total de una hora de operador de montacargas (sueldo, beneficios, supervisión). Cada montacargas de la flota tiene operador durante todo el día de operación." },
    truck_running_cost_per_hour: { label: "Costo de operación por hora de montacargas", description: "Energía, neumáticos y mantenimiento por hora en que un montacargas trabaja." },
    discount_rate: { label: "Tasa de descuento", description: "Costo del capital, usado para convertir la inversión inicial en un costo anual equivalente sobre la vida de cada activo (edificio 30 años, racks y andenes 20, montacargas 8)." },
    cost_per_dock: { label: "Costo por andén", description: "Costo instalado por puerta de andén (rampa niveladora, sello, puerta, control): ilustrativo." }
  };
  var CHOICES = {
    flow_layout: { i_flow: "Flujo en I: recibir en el oeste, despachar en el este", u_flow: "Flujo en U: recibir y despachar en el muro oeste" },
    storage_policy: { random: "Aleatoria (cualquier posición libre)", abc: "ABC por clases (los de mayor rotación más cerca de las puertas)" }
  };
  var RACK = {
    selective: { label: "Selectivo (simple fondo)", truck: "montacargas retráctil" },
    double_deep: { label: "Doble fondo", truck: "montacargas retráctil con horquillas telescópicas" },
    vna: { label: "Pasillo muy angosto (VNA)", truck: "montacargas trilateral guiado" },
    push_back: { label: "Push-back (3 de fondo)", truck: "montacargas contrabalanceado" },
    drive_in: { label: "Drive-in (5 de fondo)", truck: "montacargas contrabalanceado" }
  };

  root.WH_ES = { T: T, H: H, P: P, PARAMS: PARAMS, CHOICES: CHOICES, RACK: RACK };
  if (typeof module === "object" && module.exports) module.exports = root.WH_ES;
})(typeof self !== "undefined" ? self : this);
