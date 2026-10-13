// Lag Lab — Spanish (Latin America). T: strings used by the scripts, keyed by their English text ({name} placeholders
// kept); H: page text keyed by data-i18n; P: patterns for the model's validation messages; EQ: the equations' overlay
// (names, units, equations and meanings by variable id, with exactly the same {references} as the English).
(function (root) {
  "use strict";
  var T = {
    // ---- controls
    "Demand change": "Cambio de la demanda", "Step size": "Tamaño del escalón", "Change in customer orders, as a share of the old rate": "Cambio en los pedidos de los clientes, como proporción de la tasa anterior",
    "Step at week": "Escalón en la semana", "wk": "sem", "Delays": "Demoras", "Production lead time": "Plazo de producción", "From production start to finished goods": "Desde el inicio de producción hasta el producto terminado",
    "Hiring delay": "Demora de contratación", "From opening a vacancy to filling it": "Desde que se abre una vacante hasta que se llena",
    "Training ramp": "Período de formación", "Recruits work at half productivity until trained": "Los nuevos trabajan a media productividad hasta formarse",
    "Replenishment policy": "Política de reposición", "Inventory adjustment time (TAI)": "Tiempo de ajuste del inventario (TAI)", "How fast production closes the inventory gap": "Qué tan rápido la producción cierra la brecha de inventario",
    "Supply-line adjustment time (TASL)": "Tiempo de ajuste de la línea de suministro (TASL)", "Supply-line weight (w_SL)": "Peso de la línea de suministro (w_SL)",
    "1 = the work already in the pipeline counts fully": "1 = el trabajo que ya está en proceso cuenta por completo",
    "Forecast smoothing time": "Tiempo de suavizado del pronóstico", "How fast expected demand follows actual demand": "Qué tan rápido la demanda esperada sigue a la demanda real",
    "Hiring policy": "Política de contratación", "Workforce adjustment time (TAW)": "Tiempo de ajuste de la fuerza laboral (TAW)", "Vacancy weight (w_V)": "Peso de las vacantes (w_V)",
    "1 = open vacancies count fully": "1 = las vacantes abiertas cuentan por completo", "Hire on the…": "Contratar según la…",
    "Inventory gap: blind to the work already in the pipeline": "Brecha de inventario: ciega al trabajo que ya está en proceso",
    "Typical plant": "Planta típica", "Textbook rules (w = 1, hire on capacity)": "Reglas de manual (w = 1, contratar según capacidad)",
    "Fire-fighting (fast, pipeline ignored)": "Apagar incendios (rápido, ignora lo que está en proceso)", "Good rules, slow forecast": "Buenas reglas, pronóstico lento", "Long hiring pipeline": "Contratación lenta",
    "Preset": "Escenario predefinido", "Custom": "Personalizado", "Hiring driver": "Criterio de contratación", "Capacity gap": "Brecha de capacidad", "Inventory gap": "Brecha de inventario",
    "Run": "Corrida", "Run length": "Duración de la corrida", "{n} years": "{n} años", "Reset": "Restablecer",
    // ---- charts
    "{v}k": "{v} mil", "step": "escalón", "week {n}": "semana {n}",
    "(a) your plan": "(a) su plan", "(b) perfect forecast": "(b) pronóstico perfecto", "(c) full accounting": "(c) contabilidad completa",
    "Production starts": "Inicios de producción", "Above the demand line is overproduction. Shading shows where it comes from: refill and structure (green), policy (amber), forecast (magenta).": "Sobre la línea de demanda hay sobreproducción. El sombreado muestra de dónde viene: reposición y estructura (verde), política (ámbar), pronóstico (magenta).",
    "Finished inventory": "Inventario terminado", "The gap between the runs: policy (b → c) and forecast (a → b).": "La diferencia entre las corridas: política (b → c) y pronóstico (a → b).",
    "Backlog": "Pedidos pendientes", "Orders waiting to ship.": "Pedidos que esperan despacho.", "Effective workforce": "Fuerza laboral efectiva", "Experienced workers plus trainees at half productivity.": "Trabajadores con experiencia más personas en formación a media productividad.",
    "Demand and expected demand": "Demanda y demanda esperada", "The forecast's lag behind the step.": "El rezago del pronóstico tras el escalón.",
    "Starts, completions, shipments": "Inicios, terminaciones, despachos", "Production starts lead; completions follow after the production lead time.": "Los inicios de producción van primero; las terminaciones siguen tras el plazo de producción.",
    "Inventory and its target": "Inventario y su meta", "The target moves with expected demand.": "La meta se mueve con la demanda esperada.",
    "Supply line and its target": "Línea de suministro y su meta", "Work in the production pipeline.": "Trabajo en proceso de producción.",
    "Workforce, trainees, vacancies": "Fuerza laboral, en formación, vacantes", "People arrive through vacancies and training.": "Las personas llegan a través de vacantes y formación.",
    "Utilisation": "Utilización", "Working time against normal: the band is 0.8 to 1.2.": "Tiempo de trabajo frente al normal: la banda va de 0.8 a 1.2.",
    "refill and structure": "reposición y estructura", "policy": "política", "forecast": "pronóstico", "demand": "demanda", "expected demand": "demanda esperada",
    "starts": "inicios", "completions": "terminaciones", "shipments": "despachos", "inventory": "inventario", "target": "meta", "supply line": "línea de suministro", "backlog": "pedidos pendientes",
    "effective": "efectiva", "experienced": "con experiencia", "trainees": "en formación", "vacancies": "vacantes", "utilisation": "utilización",
    // ---- the answer
    "These settings can't be simulated": "Esta configuración no se puede simular",
    "No demand change: nothing to decompose.": "Sin cambio de demanda: no hay nada que descomponer.", "Set a step size to see how the overshoot splits.": "Fije un tamaño de escalón para ver cómo se divide el exceso.",
    "Only <span class=\"big\">{p}</span> of the overshoot is a forecasting problem.": "Solo el <span class=\"big\">{p}</span> del exceso es un problema de pronóstico.",
    "None of the overshoot is a forecasting problem: the forecast's lag <span class=\"big\">reduced it by {n} units</span>.": "Nada del exceso es un problema de pronóstico: el rezago del pronóstico <span class=\"big\">lo redujo en {n} unidades</span>.",
    "After the demand rise, your plan produced {n} units above demand.": "Tras el alza de la demanda, su plan produjo {n} unidades por encima de la demanda.",
    "After the demand fall, your plan produced {n} units below demand.": "Tras la caída de la demanda, su plan produjo {n} unidades por debajo de la demanda.",
    "Planning would book all of it as forecast error. {a} was the necessary refill and structure, and {b} came from the decision rules.": "La planificación lo registraría todo como error de pronóstico. El {a} fue la reposición necesaria y la estructura, y el {b} vino de las reglas de decisión.",
    "{name}: {n} units, {p}": "{name}: {n} unidades, {p}", "{n} units · {p}": "{n} unidades · {p}", "(reduced the overshoot)": "(redujo el exceso)",
    "Run {runs} is still moving at the end of the run, so these numbers cover only what happened in it. Lengthen the run, or calm the policy.": "La corrida {runs} todavía se mueve al final, así que estas cifras cubren solo lo ocurrido en ella. Alargue la corrida o suavice la política.",
    "Your policy already is full accounting, so there is no policy layer: run (b) and run (c) are the same.": "Su política ya es de contabilidad completa, así que no hay capa de política: las corridas (b) y (c) son iguales.",
    "Your plan forecasts perfectly, so there is no forecast layer.": "Su plan pronostica a la perfección, así que no hay capa de pronóstico.",
    "Necessary refill": "Reposición necesaria", "Structure": "Estructura", "Policy": "Política", "Forecast": "Pronóstico",
    "Arithmetic, not error: a bigger inventory target and a longer pipeline must be filled. Only shorter delays or lower targets reduce it.": "Aritmética, no error: hay que llenar una meta de inventario mayor y una línea de proceso más larga. Solo demoras más cortas o metas más bajas la reducen.",
    "The dynamics left even with a perfect forecast and full accounting: delays in production and hiring. Shorter delays reduce it.": "La dinámica que queda incluso con pronóstico perfecto y contabilidad completa: demoras de producción y contratación. Demoras más cortas la reducen.",
    "Decision rules: under-weighting the supply line, aggressive adjustment times, hiring on the inventory gap. Fixed by changing the rules.": "Reglas de decisión: subponderar la línea de suministro, tiempos de ajuste agresivos, contratar según la brecha de inventario. Se corrige cambiando las reglas.",
    "The lag in expected demand. Only this part is a forecasting problem.": "El rezago de la demanda esperada. Solo esta parte es un problema de pronóstico.",
    // ---- the plan in detail
    "Inventory": "Inventario", "Expected demand": "Demanda esperada", "Your plan (a)": "Su plan (a)", "Before": "Antes", "After": "Después", "Peak": "Máximo", "Overshoot": "Exceso",
    "Settles in": "Se estabiliza en", "Oscillates": "Oscila", "yes": "sí", "no": "no",
    "Link copied": "Enlace copiado", "Share": "Compartir", "Copy the address bar": "Copie la barra de direcciones",
    // ---- the diagram and the equations
    "Stock-and-flow diagram of the Lag Lab model": "Diagrama de niveles y flujos del modelo de Lag Lab", "{name} ({kind}): show its equation": "{name} ({kind}): ver su ecuación",
    "stock": "nivel", "flow": "flujo", "auxiliary": "auxiliar", "input": "entrada",
    "Click any stock, flow or auxiliary in the diagram, or any name in the equation list below, to see its equation, what it reads, what reads it, and the values at a chosen week of your plan.": "Haga clic en cualquier nivel, flujo o auxiliar del diagrama, o en cualquier nombre de la lista de ecuaciones más abajo, para ver su ecuación, qué lee, quién la lee y sus valores en una semana elegida de su plan.",
    "Initial value: {v} (the model starts in equilibrium)": "Valor inicial: {v} (el modelo parte en equilibrio)", "Values in your plan at week <b>{n}</b>": "Valores en su plan en la semana <b>{n}</b>",
    "change over the next week": "cambio en la semana siguiente", "Flows in and out": "Flujos de entrada y salida", "Reads": "Lee", "Parameters": "Parámetros", "Read by": "La leen",
    "Stocks": "Niveles", "Flows": "Flujos", "Auxiliaries": "Auxiliares", "Input": "Entrada", "initial: {v}": "inicial: {v}", "Parameters (current values)": "Parámetros (valores actuales)",
    "capacity": "capacidad", "smooth": "suavizado", "perfect": "perfecto"
  };

  var H = {
    "title.index": "Lag Lab — Capacidad que va detrás de la demanda", "title.about": "Acerca de Lag Lab",
    "meta.index": "Tras un escalón de demanda, la planificación llama error de pronóstico al exceso. Lag Lab lo divide en la reposición necesaria, la estructura, las reglas de decisión y el pronóstico, con un modelo de producción y fuerza laboral al estilo de Sterman, para ver cuánto es realmente un problema de pronóstico.",
    "meta.about": "Lag Lab divide el exceso tras un escalón de demanda en reposición necesaria, estructura, política y pronóstico, para mostrar cuánto es realmente error de pronóstico. Diseñado y construido por Daniel Alberto Sepulveda Estay, PhD.",
    "attr.ver": "Versión de la aplicación", "brand.sub": "CAPACIDAD QUE VA DETRÁS DE LA DEMANDA · ¿QUÉ ES REALMENTE ERROR DE PRONÓSTICO?",
    "nav.share": "Compartir", "attr.share": "Copiar un enlace a esta configuración exacta", "nav.about": "Acerca de", "nav.projects": "← Proyectos", "aria.rail": "Escalón y política",
    "tab.dec": "Descomposición", "tab.run": "Detalle del plan", "tab.model": "Modelo",
    "runs.a": "<b>(a) Su plan.</b> La política tal como está a la izquierda, con su pronóstico suavizado. Es lo que realmente ocurre.",
    "runs.b": "<b>(b) Pronóstico perfecto.</b> La misma política, pero la demanda esperada siempre acierta. La diferencia (a)–(b) es la parte del pronóstico.",
    "runs.c": "<b>(c) Pronóstico perfecto, contabilidad completa.</b> La línea de suministro y las vacantes ponderadas por completo (w = 1) y la contratación según la brecha de capacidad. La diferencia (b)–(c) es la parte de la política. Lo que queda por encima de la reposición es estructura.",
    "btn.csv": "Descargar corridas (CSV)",
    "model.intro": "El modelo como diagrama de niveles y flujos: los <b>niveles</b> son cajas, los <b>flujos</b> son válvulas sobre tuberías, los <b>auxiliares</b> son círculos y las nubes marcan el límite del modelo. Las flechas curvas se dibujan a partir de las propias ecuaciones. Haga clic en cualquier variable para ver su ecuación, qué lee, quién la lee y sus valores en la corrida de su plan.",
    "model.key": "<span><svg width=\"30\" height=\"16\"><rect x=\"1\" y=\"2\" width=\"28\" height=\"12\" rx=\"2\" fill=\"#0d3a63\" stroke=\"#bfe4ff\"/></svg>nivel</span><span><svg width=\"22\" height=\"16\"><path d=\"M2,2 L20,14 L20,2 L2,14 z\" fill=\"#0d3a63\" stroke=\"#bfe4ff\"/></svg>flujo</span><span><svg width=\"16\" height=\"16\"><circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"#082444\" stroke=\"#8fd0f2\"/></svg>auxiliar</span><span><svg width=\"30\" height=\"10\"><line x1=\"0\" y1=\"5\" x2=\"30\" y2=\"5\" stroke=\"#bfe4ff\" stroke-width=\"6\"/><line x1=\"0\" y1=\"5\" x2=\"30\" y2=\"5\" stroke=\"#0d3a63\" stroke-width=\"2\"/></svg>material</span><span><svg width=\"30\" height=\"10\"><path d=\"M0,8 Q15,0 28,6\" fill=\"none\" stroke=\"#6fa8c9\" stroke-width=\"1.4\"/></svg>información</span><span><svg width=\"30\" height=\"10\"><path d=\"M0,8 Q15,0 28,6\" fill=\"none\" stroke=\"#7dd3fc\" stroke-width=\"2.2\"/></svg>lee (seleccionada)</span><span><svg width=\"30\" height=\"10\"><path d=\"M0,8 Q15,0 28,6\" fill=\"none\" stroke=\"#e0558f\" stroke-width=\"2.2\"/></svg>la leen (seleccionada)</span>",
    "model.all": "Todas las ecuaciones",
    "how.sum": "Cómo funcionan el modelo y la descomposición",
    "how.p1": "El modelo es una cadena de producción y fuerza laboral al estilo de Sterman, <i>Business Dynamics</i>, cap. 17–19. Los pedidos forman <b>pedidos pendientes</b> y se despachan desde el <b>inventario</b>. Los inicios de producción entran a una <b>línea de suministro</b> (una demora de tercer orden del plazo de producción) antes de pasar a inventario. La producción sigue a la <b>fuerza laboral</b>, con ±20% de tiempo de trabajo flexible. Las personas nuevas llegan a través de las <b>vacantes</b> (la demora de contratación) y la <b>formación</b> (con la mitad de productividad hasta formarse).",
    "how.p2": "<b>Reglas de decisión (anclaje y ajuste).</b> Inicios de producción = demanda esperada + brecha de inventario / TAI + w<sub>SL</sub> · brecha de la línea de suministro / TASL. Contratación = bajas + brecha de fuerza laboral / TAW + w<sub>V</sub> · brecha de vacantes / TAV. La meta de fuerza laboral sigue la <b>capacidad</b> que necesita el plan de producción o la <b>brecha de inventario</b>, que es ciega al trabajo que ya está en proceso.",
    "how.p3": "<b>La descomposición.</b> El exceso es la producción por encima de la demanda tras el escalón (por debajo, en un escalón a la baja), contada solo donde ocurre: en una corrida completa la producción extra neta siempre es igual a la reposición, así que una medida neta ocultaría la oscilación. La <b>reposición necesaria</b> es (cobertura de inventario + plazo − plazo de entrega) × el cambio en la demanda: un inventario y una línea de proceso mayores que llenar, y menos esperando como pedidos pendientes. La <b>estructura</b> es lo que la corrida (c) produce más allá de eso. La <b>política</b> es (b) − (c), y el <b>pronóstico</b> es (a) − (b). Las cuatro suman exactamente el exceso de su plan. Una capa puede ser negativa: un pronóstico lento a veces amortigua una política agresiva.",
    "how.p4": "El modelo, la descomposición y sus pruebas están en <a href=\"https://github.com/kathuman/claude-projects/tree/main/lag-lab\" target=\"_blank\" rel=\"noopener\">lag-lab/</a>: una verificación analítica de la demora y el suavizado, la conservación exacta de material y personas, y los resultados de manual de que ignorar la línea de suministro hace oscilar al sistema y la contabilidad completa no.",
    "foot.consult": "Lag Lab <span id=\"ver-foot\"></span> · <a href=\"about.html\">Acerca de</a> · Disponible para consultorías — <a href=\"https://github.com/kathuman\" target=\"_blank\" rel=\"noopener\">contáctenos</a>",
    "foot.note": "Un simulador de capacidad que va detrás de la demanda: divide el exceso tras un escalón de demanda en reposición necesaria, estructura, política y pronóstico. Construido con <a href=\"https://claude.com\" target=\"_blank\" rel=\"noopener\">Claude</a>.",
    // about
    "a.sub": "ACERCA DE LA APLICACIÓN", "a.open": "Abrir Lag Lab", "a.eyebrow": "Acerca de la aplicación",
    "a.lede": "Cuando la demanda sube en escalón, la producción se excede y la planificación lo llama error de pronóstico. Lag Lab muestra que ese suele ser el diagnóstico equivocado, y en qué medida: divide el exceso en la parte que es simple aritmética, la parte que las demoras hacen inevitable, la parte causada por las reglas de decisión y la parte que realmente es un problema de pronóstico. En inglés o en español.",
    "a.openbtn": "Abrir Lag Lab →", "a.what.h": "Qué hace",
    "a.what.list": "<li><b>Corre el mismo escalón de demanda de tres maneras</b>Su plan tal como es; el mismo plan con pronóstico perfecto; y un pronóstico perfecto con la línea de proceso y las vacantes contabilizadas por completo y contratación según la brecha de capacidad.</li>" +
      "<li><b>Divide el exceso</b>La reposición necesaria de un inventario y una línea de proceso mayores, la estructura que queda, la parte de la política y la parte del pronóstico. Suman exactamente, y cada una viene con su remedio.</li>" +
      "<li><b>Permite cambiar las reglas</b>Tamaño y momento del escalón, demoras de producción, contratación y formación, tiempos de ajuste del inventario y de la línea de suministro, pesos de la línea de suministro y de las vacantes, suavizado del pronóstico, y si la contratación sigue la brecha de inventario o la de capacidad.</li>" +
      "<li><b>Muestra el modelo mismo</b>Un diagrama de niveles y flujos con cada nivel, flujo y regla de decisión. Haga clic en cualquier variable para ver su ecuación, qué lee, quién la lee y su valor en cualquier semana, con la lista completa de ecuaciones y parámetros.</li>" +
      "<li><b>Muestra el plan completo</b>Inventario, pedidos pendientes, la línea de suministro, la fuerza laboral, las personas en formación y las vacantes, y la utilización semana a semana, con exceso, tiempo de estabilización y oscilación para cada uno, y exportación a CSV.</li>",
    "a.how.h": "Cómo está construida",
    "a.how.p": "El modelo es una cadena de producción y fuerza laboral al estilo de <i>Business Dynamics</i> de Sterman (capítulos 17 a 19): pedidos pendientes, inventario, una línea de producción de tercer orden, fuerza laboral, personas en formación, vacantes y demanda esperada suavizada, con reglas de decisión de anclaje y ajuste. Sus pruebas verifican la demora y el pronóstico frente a sus soluciones exactas, que el material y las personas se conserven exactamente, y los resultados de manual de que ignorar la línea de suministro hace oscilar al inventario mientras que la contabilidad completa no. La descomposición se prueba para que sume exactamente y se anule al quitar su causa. Todo se ejecuta en su navegador.",
    "a.author.h": "Autor",
    "a.author.p": "Lag Lab fue diseñado y construido por <b>Daniel Alberto Sepulveda Estay, PhD</b>, fundador de <a href=\"https://kathuman.github.io/estay-dynamics/\" target=\"_blank\" rel=\"noopener\">Estay Dynamics</a>. Trabaja en dinámica de sistemas y optimización de redes para la resiliencia de la cadena de suministro. Es doctor de la Universidad Técnica de Dinamarca (DTU) y magíster del Instituto Tecnológico de Massachusetts (MIT), y es miembro del consejo de la System Dynamics Society.",
    "a.author.links": "<a href=\"https://kathuman.github.io/estay-dynamics/about.html\" target=\"_blank\" rel=\"noopener\">Más sobre Daniel →</a> · <a href=\"https://kathuman.github.io/estay-dynamics/contact.html\" target=\"_blank\" rel=\"noopener\">Contáctenos</a>",
    "a.cite": "<b>Para citar:</b> Sepulveda Estay, D. A. (2026). <em>Lag Lab: capacity that lags demand</em> (versión 1.2.0) [Software]. https://kathuman.github.io/claude-projects/lag-lab/",
    "a.foot": "Lag Lab v1.2.0 · <a href=\"./\">Abrir la aplicación</a> · Disponible para consultorías — <a href=\"https://github.com/kathuman\" target=\"_blank\" rel=\"noopener\">contáctenos</a>"
  };

  // ---- the model's validation messages
  var P = [
    ["(\\w+) must be a positive number", "$1 debe ser un número positivo"],
    ["inventoryCoverage must be at least minProcessingTime, or the target inventory cannot ship the demand", "inventoryCoverage debe ser al menos minProcessingTime, o el inventario meta no puede despachar la demanda"],
    ["need 0 < uMin ≤ 1 ≤ uMax", "se requiere 0 < uMin ≤ 1 ≤ uMax"],
    ["(\\w+) must be in \\[0, 1\\]", "$1 debe estar en [0, 1]"],
    ["dt (-?[\\d.]+) is too large for the shortest time constant (-?[\\d.]+) \\(use dt ≤ (-?[\\d.]+)\\)", "dt $1 es demasiado grande para la constante de tiempo más corta $2 (use dt ≤ $3)"],
    ["(\\w+) must be '(\\w+)' or '(\\w+)'", "$1 debe ser '$2' o '$3'"]
  ];

  // ---- the equations: same ids and the same {references} as src/equations.js
  var EQ = {
    vars: {
      backlog: { name: "Pedidos pendientes", units: "unidades", eq: "d/dt {backlog} = {demand} − {shipments}", init: "{p:targetDeliveryDelay} × demanda inicial", about: "Pedidos recibidos y todavía no despachados." },
      inventory: { name: "Inventario", units: "unidades", eq: "d/dt {inventory} = {completions} − {shipments}", init: "{p:inventoryCoverage} × demanda inicial", about: "Producto terminado listo para despachar." },
      supplyLine: { name: "Línea de suministro", units: "unidades", eq: "d/dt {supplyLine} = {starts} − {completions}", init: "{p:productionLeadTime} × demanda inicial",
        about: "Trabajo en proceso de producción. Se mantiene en tres etapas iguales, cada una se vacía a 3 × etapa / {p:productionLeadTime}: una demora de tercer orden, así que las terminaciones llegan repartidas alrededor del plazo y no todas a la vez." },
      vacancies: { name: "Vacantes", units: "personas", eq: "d/dt {vacancies} = {vacancyCreation} − {vacancyCancellation} − {hires}", init: "bajas × {p:hiringDelay}", about: "Puestos abiertos a la espera de ser llenados." },
      trainees: { name: "En formación", units: "personas", eq: "d/dt {trainees} = {hires} − {graduations}", init: "bajas × {p:trainingTime}", about: "Personas nuevas que todavía aprenden el trabajo, con {p:rookieProductivity} de la productividad completa." },
      workforce: { name: "Fuerza laboral", units: "personas", eq: "d/dt {workforce} = {graduations} − {attrition} − {layoffs}", init: "demanda inicial / ({p:productivity} × (1 + {p:rookieProductivity} × {p:trainingTime} / {p:averageTenure}))", about: "Personas con experiencia y plena productividad." },
      expectedDemand: { name: "Demanda esperada", units: "unidades/semana", eq: function (p) { return p.forecast === "perfect" ? "{expectedDemand} = {demand}   (pronóstico perfecto)" : "d/dt {expectedDemand} = {forecastChange}"; }, init: "demanda inicial",
        about: "El pronóstico: la demanda real suavizada exponencialmente, así que sigue un cambio con un rezago de alrededor de {p:forecastTime}." },
      demand: { name: "Pedidos (demanda)", units: "unidades/semana", eq: function (p) { var d = p.demand; return d.type === "step" ? "{p:demand.base} antes de la semana {p:demand.at}; luego {p:demand.base} × (1 + {p:demand.size})" : "el patrón de demanda " + d.type; }, about: "Los pedidos de los clientes: la entrada que mueve todo lo demás." },
      forecastChange: { name: "Cambio de la demanda esperada", units: "unidades/semana²", eq: "({demand} − {expectedDemand}) / {p:forecastTime}", about: "Qué tan rápido el pronóstico alcanza a la demanda." },
      shipments: { name: "Despachos", units: "unidades/semana", eq: "mín({backlog} / {p:targetDeliveryDelay}, {inventory} / {p:minProcessingTime})", about: "Pedidos despachados: normalmente los pedidos pendientes divididos por el plazo de entrega meta, pero nunca más de lo que permite el inventario. Los pedidos no atendidos quedan pendientes." },
      starts: { name: "Inicios de producción", units: "unidades/semana", eq: function (p) { return p.capacity === "unconstrained" ? "{desiredStarts}   (capacidad sin restricción)" : "{capacity} × {utilisation}"; }, about: "Trabajo iniciado: la producción sigue a la fuerza laboral, con un tiempo de trabajo que se flexibiliza dentro de la banda de utilización." },
      completions: { name: "Terminaciones", units: "unidades/semana", eq: "3 × (tercera etapa de {supplyLine}) / {p:productionLeadTime}", about: "Producción terminada que entra a inventario: la salida de la demora de tercer orden." },
      vacancyCreation: { name: "Creación de vacantes", units: "personas/semana", eq: "si {desiredHiring} ≥ 0: máx(0, {desiredHiring} + {p:wV} × ({desiredVacancies} − {vacancies}) / {p:TAV}); si no, 0", about: "Puestos abiertos. Con {p:wV} = 1 las vacantes abiertas cuentan por completo; con 0 se ignoran." },
      vacancyCancellation: { name: "Cancelación de vacantes", units: "personas/semana", eq: "si {desiredHiring} ≥ 0: mín({vacancies} / {p:TAV}, máx(0, −({desiredHiring} + {p:wV} × ({desiredVacancies} − {vacancies}) / {p:TAV}))); si no, {vacancies} / {p:TAV}", about: "Puestos retirados cuando se necesitan menos personas." },
      hires: { name: "Contrataciones", units: "personas/semana", eq: "{vacancies} / {p:hiringDelay}", about: "Vacantes llenadas, en promedio tras la demora de contratación." },
      graduations: { name: "Egresos de formación", units: "personas/semana", eq: "{trainees} / {p:trainingTime}", about: "Personas en formación que alcanzan la productividad completa." },
      attrition: { name: "Bajas voluntarias", units: "personas/semana", eq: "{workforce} / {p:averageTenure}", about: "Personas que se van por su cuenta." },
      layoffs: { name: "Despidos", units: "personas/semana", eq: "si {desiredHiring} < 0: mín(−{desiredHiring}, {workforce} / {p:TAW}); si no, 0", about: "Personas desvinculadas además de las bajas cuando la fuerza laboral supera su meta." },
      desiredInventory: { name: "Inventario deseado", units: "unidades", eq: "{p:inventoryCoverage} × {expectedDemand}", about: "La meta de inventario: semanas de cobertura a la demanda esperada." },
      desiredSupplyLine: { name: "Línea de suministro deseada", units: "unidades", eq: "{p:productionLeadTime} × {expectedDemand}", about: "El trabajo que debería estar en proceso para entregar la demanda esperada." },
      desiredStarts: { name: "Inicios deseados", units: "unidades/semana", eq: "máx(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI} + {p:wSL} × ({desiredSupplyLine} − {supplyLine}) / {p:TASL})",
        about: "La regla de inicios de producción (anclaje y ajuste): la demanda esperada, corregida por la brecha de inventario y, ponderada por {p:wSL}, por la brecha de la línea de suministro." },
      effectiveWorkforce: { name: "Fuerza laboral efectiva", units: "personas", eq: "{workforce} + {p:rookieProductivity} × {trainees}", about: "Equivalentes de tiempo completo de trabajo productivo." },
      capacity: { name: "Capacidad", units: "unidades/semana", eq: "{p:productivity} × {effectiveWorkforce}", about: "Producción con el tiempo de trabajo normal." },
      utilisation: { name: "Utilización", units: "fracción", eq: "acotar({desiredStarts} / {capacity}, {p:uMin}, {p:uMax})", about: "Tiempo de trabajo frente al normal: jornada reducida hasta {p:uMin}, horas extra hasta {p:uMax}." },
      desiredWorkforce: { name: "Fuerza laboral deseada", units: "personas",
        eq: function (p) { return p.hiringDriver === "capacity" ? "{desiredStarts} / {p:productivity}   (contratación según la brecha de capacidad)" : "máx(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI}) / {p:productivity}   (contratación según la brecha de inventario)"; },
        alt: function (p) { return p.hiringDriver === "capacity" ? "Según la brecha de inventario sería: máx(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI}) / {p:productivity}, ciega a la línea de suministro." : "Según la brecha de capacidad sería: {desiredStarts} / {p:productivity}, la capacidad que necesita el plan de producción."; },
        about: "La meta de fuerza laboral. Qué regla se aplica depende del criterio de contratación." },
      desiredHiring: { name: "Contratación deseada", units: "personas/semana", eq: "{attrition} + ({desiredWorkforce} − {effectiveWorkforce}) / {p:TAW}",
        about: "La regla de contratación (anclaje y ajuste): reponer las bajas y cerrar la brecha de fuerza laboral en {p:TAW}. Negativa significa que la fuerza laboral es demasiado grande." },
      desiredVacancies: { name: "Vacantes deseadas", units: "personas", eq: "máx(0, {desiredHiring}) × {p:hiringDelay}", about: "Las vacantes necesarias para sostener la contratación deseada a lo largo de la demora de contratación." }
    },
    params: {
      "demand.base": ["Demanda antes del escalón", "unidades/semana"], "demand.size": ["Tamaño del escalón", "fracción"], "demand.at": ["Momento del escalón", "semana"],
      productionLeadTime: ["Plazo de producción", "semanas"], targetDeliveryDelay: ["Plazo de entrega meta", "semanas"], minProcessingTime: ["Tiempo mínimo de proceso de pedidos", "semanas"],
      inventoryCoverage: ["Cobertura de inventario", "semanas"], productivity: ["Productividad", "unidades/persona/semana"], hiringDelay: ["Demora de contratación", "semanas"],
      trainingTime: ["Tiempo de formación", "semanas"], rookieProductivity: ["Productividad relativa en formación", "fracción"], averageTenure: ["Permanencia promedio", "semanas"],
      uMin: ["Utilización mínima", "fracción"], uMax: ["Utilización máxima", "fracción"],
      TAI: ["Tiempo de ajuste del inventario", "semanas"], TASL: ["Tiempo de ajuste de la línea de suministro", "semanas"], wSL: ["Peso de la línea de suministro", "0–1"],
      TAW: ["Tiempo de ajuste de la fuerza laboral", "semanas"], TAV: ["Tiempo de ajuste de las vacantes", "semanas"], wV: ["Peso de las vacantes", "0–1"],
      forecastTime: ["Tiempo de suavizado del pronóstico", "semanas"], hiringDriver: ["Criterio de contratación", "capacidad o inventario"], forecast: ["Pronóstico", "suavizado o perfecto"]
    },
    labels: { "demand.size": "escalón", "demand.at": "t_esc", productionLeadTime: "plazo", targetDeliveryDelay: "plazo de entrega", minProcessingTime: "tiempo mín. de proceso",
      inventoryCoverage: "cobertura", productivity: "productividad", hiringDelay: "demora de contratación", trainingTime: "tiempo de formación", averageTenure: "permanencia", forecastTime: "tiempo de pronóstico" }
  };

  root.LL_ES = { T: T, H: H, P: P, EQ: EQ };
  if (typeof module === "object" && module.exports) module.exports = root.LL_ES;
})(typeof self !== "undefined" ? self : this);
