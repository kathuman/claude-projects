# Heat Pump Studio — texts added in 1.2 (installation diagram, heat exchanger selection, datasheet, tour).
# Merged by tools/build_i18n.py. Each value is (español, dansk).
T = {
 "Plates": ("Placas", "Plader"), "size {s}": ("tamaño {s}", "størrelse {s}"), "Channel velocity": ("Velocidad en el canal", "Hastighed i kanalen"),
 "low": ("baja", "lav"), "high": ("alta", "høj"), "Face area": ("Área frontal", "Frontareal"), "Rows": ("Filas", "Rækker"),
 "Installation diagram": ("Esquema de la instalación", "Anlægsdiagram"), "Fan": ("Ventilador", "Ventilator"),
 "Brine pump": ("Bomba de salmuera", "Brinepumpe"), "Source pump": ("Bomba de la fuente", "Kildepumpe"), "Circulation pump": ("Bomba de circulación", "Cirkulationspumpe"),
 "Electric heater {p} kW": ("Resistencia eléctrica {p} kW", "Elpatron {p} kW"), "Electric heater (standby)": ("Resistencia eléctrica (reserva)", "Elpatron (reserve)"),
 "Hot-water tank": ("Acumulador de agua caliente", "Varmtvandsbeholder"),
 "Outdoor unit (monobloc)": ("Unidad exterior (monobloque)", "Udendørs enhed (monoblok)"), "Indoor unit": ("Unidad interior", "Indendørs enhed"),
 "Machinery room": ("Sala de máquinas", "Maskinrum"),
 "{n} boreholes × {d} m": ("{n} perforaciones × {d} m", "{n} boringer × {d} m"), "supply and return wells": ("pozos de captación y de retorno", "indvindings- og returboringer"),
 "{p} kW electric": ("{p} kW eléctricos", "{p} kW el"), "in {a} °C → out {b} °C": ("entra {a} °C → sale {b} °C", "ind {a} °C → ud {b} °C"),
 "flow {f} °C · return {r} °C": ("impulsión {f} °C · retorno {r} °C", "fremløb {f} °C · returløb {r} °C"), "heat {q} kW": ("calor {q} kW", "varme {q} kW"),
 "hot water {e} kWh/yr": ("agua caliente {e} kWh/año", "varmt vand {e} kWh/år"), "charged at {t} °C": ("cargado a {t} °C", "opvarmet til {t} °C"),
 "hot gas and heating flow": ("gas caliente e impulsión de calefacción", "trykgas og fremløb"), "liquid refrigerant": ("refrigerante líquido", "flydende kølemiddel"),
 "refrigerant after the valve (liquid and vapour)": ("refrigerante tras la válvula (líquido y vapor)", "kølemiddel efter ventilen (væske og damp)"),
 "cold vapour and heating return": ("vapor frío y retorno de calefacción", "kold damp og returløb"), "heat source": ("fuente de calor", "varmekilde"),
 "Heat pump design: {q} kW, {f}, {src}": ("Diseño de bomba de calor: {q} kW, {f}, {src}", "Varmepumpedesign: {q} kW, {f}, {src}"),
 "Design outdoor": ("Exterior de diseño", "Dim. udetemperatur"), "Heat source": ("Fuente de calor", "Varmekilde"), "Emitters": ("Emisores", "Varmegivere"),
 "Flow / return": ("Impulsión / retorno", "Frem- / returløb"), "Installation": ("Instalación", "Installation"), "Heating capacity": ("Capacidad de calefacción", "Varmeydelse"),
 "Pressures": ("Presiones", "Tryk"), "system": ("sistema", "system"), "Climate data": ("Datos climáticos", "Klimadata"), "gas boiler": ("caldera de gas", "gaskedel"),
 "Heat Pump Studio · refrigerant properties CoolProp · climate Open-Meteo (ERA5, CC BY 4.0) · typical figures for a first design; check against manufacturers’ data and local standards.":
  ("Heat Pump Studio · propiedades del refrigerante CoolProp · clima Open-Meteo (ERA5, CC BY 4.0) · cifras típicas para un primer diseño; verifique con los datos de los fabricantes y las normas locales.",
   "Heat Pump Studio · kølemiddeldata CoolProp · klima Open-Meteo (ERA5, CC BY 4.0) · typiske tal til en første dimensionering; kontrollér mod producenternes data og lokale standarder."),
 "1 · The building": ("1 · El edificio", "1 · Bygningen"),
 "Start with how much heat the building needs on the coldest day: estimate it from floor area and insulation, or type it in.":
  ("Comience por cuánto calor necesita el edificio el día más frío: estímelo a partir de la superficie y el aislamiento, o ingréselo.", "Start med, hvor meget varme bygningen skal bruge på den koldeste dag: beregn det ud fra areal og isolering, eller indtast det."),
 "2 · The heat source": ("2 · La fuente de calor", "2 · Varmekilden"),
 "Choose where the heat comes from. The source temperature sets the evaporating temperature — the warmer the source, the better the COP.":
  ("Elija de dónde viene el calor. La temperatura de la fuente fija la de evaporación: cuanto más cálida la fuente, mejor el COP.", "Vælg, hvor varmen kommer fra. Kildens temperatur bestemmer fordampningstemperaturen — jo varmere kilde, jo bedre COP."),
 "3 · The heating circuit": ("3 · El circuito de calefacción", "3 · Varmekredsen"),
 "Floor heating needs about 35 °C, old radiators 55 °C or more. Every degree of flow temperature costs efficiency.":
  ("El suelo radiante necesita unos 35 °C, los radiadores antiguos 55 °C o más. Cada grado de impulsión cuesta eficiencia.", "Gulvvarme skal bruge ca. 35 °C, gamle radiatorer 55 °C eller mere. Hver grad fremløb koster effektivitet."),
 "4 · Refrigerant and compressor": ("4 · Refrigerante y compresor", "4 · Kølemiddel og kompressor"),
 "Pick the refrigerant and compressor. Each refrigerant suits a range of temperatures; its safety class and GWP matter too.":
  ("Elija el refrigerante y el compresor. Cada refrigerante sirve para un rango de temperaturas; su clase de seguridad y su GWP también importan.", "Vælg kølemiddel og kompressor. Hvert kølemiddel passer til et temperaturområde; sikkerhedsklasse og GWP betyder også noget."),
 "5 · Installation": ("5 · Instalación", "5 · Installation"),
 "Where the unit stands decides how much flammable refrigerant it may hold.": ("Dónde se ubica el equipo decide cuánto refrigerante inflamable puede contener.", "Hvor enheden står, afgør, hvor meget brandbart kølemiddel den må indeholde."),
 "6 · Year round": ("6 · Todo el año", "6 · Hele året"),
 "The coldest day is rare. Choose the climate, how much of the peak the heat pump covers, and weather compensation.":
  ("El día más frío es raro. Elija el clima, cuánto del máximo cubre la bomba de calor y la compensación climática.", "Den koldeste dag er sjælden. Vælg klimaet, hvor meget af spidsen varmepumpen dækker, og vejrkompensering."),
 "7 · Costs and CO₂": ("7 · Costos y CO₂", "7 · Udgifter og CO₂"),
 "Prices and the grid’s CO₂ turn the energy into running costs and emissions, compared with a gas boiler.":
  ("Los precios y el CO₂ de la red convierten la energía en costos de operación y emisiones, frente a una caldera de gas.", "Priser og elnettets CO₂ gør energien til driftsudgifter og udledning sammenlignet med en gaskedel."),
 "The results": ("Los resultados", "Resultaterne"),
 "Heating capacity, COP against the Carnot limit, power, pressures and temperatures at the design point, and the seasonal SCOP.":
  ("Capacidad, COP frente al límite de Carnot, potencia, presiones y temperaturas en el punto de diseño, y el SCOP estacional.", "Varmeydelse, COP mod Carnot-grænsen, effekt, tryk og temperaturer i dimensioneringspunktet samt sæson-SCOP."),
 "Engineering checks": ("Verificaciones de ingeniería", "Tekniske kontroller"),
 "Problems and things to check appear here: hot discharge, high pressure ratio, pinch in a heat exchanger, charge limits, high GWP.":
  ("Aquí aparecen los problemas y lo que hay que revisar: descarga caliente, relación de presiones alta, pinch en un intercambiador, límites de carga, GWP alto.", "Her vises problemer og ting at kontrollere: varm trykgas, højt trykforhold, pinch i en varmeveksler, fyldningsgrænser, høj GWP."),
 "The installation": ("La instalación", "Anlægget"),
 "The whole system as designed, with the temperatures, pressures, flows and powers at every point.":
  ("Todo el sistema tal como está diseñado, con las temperaturas, presiones, caudales y potencias en cada punto.", "Hele systemet som dimensioneret med temperaturer, tryk, flow og effekter i hvert punkt."),
 "The cycle": ("El ciclo", "Kredsprocessen"),
 "The refrigerant’s pressure–enthalpy chart: the horizontal lengths are the heat from the source, the compressor work and the heat delivered.":
  ("El diagrama presión–entalpía del refrigerante: las longitudes horizontales son el calor de la fuente, el trabajo del compresor y el calor entregado.", "Kølemidlets tryk–entalpi-diagram: de vandrette længder er varmen fra kilden, kompressorarbejdet og den leverede varme."),
 "The year": ("El año", "Året"),
 "How the heat pump does over a real year at this location: SCOP, the balance point, backup heat, costs and CO₂.":
  ("Cómo funciona la bomba de calor durante un año real en esta ubicación: SCOP, punto de equilibrio, calor de respaldo, costos y CO₂.", "Hvordan varmepumpen klarer sig gennem et rigtigt år her: SCOP, balancepunkt, tillægsvarme, udgifter og CO₂."),
 "The datasheet": ("La hoja de datos", "Databladet"),
 "A printable summary of the design, with the installation diagram, for a client or an installer.":
  ("Un resumen imprimible del diseño, con el esquema de la instalación, para un cliente o un instalador.", "Et printbart resumé af dimensioneringen med anlægsdiagrammet til en kunde eller en installatør."),
 # datasheet and tour controls (src/extras.js)
 "Print": ("Imprimir", "Udskriv"), "Close": ("Cerrar", "Luk"), "Datasheet": ("Hoja de datos", "Datablad"),
 "Design basis": ("Bases de diseño", "Dimensioneringsgrundlag"), "Results at the design point": ("Resultados en el punto de diseño", "Resultater i dimensioneringspunktet"),
 "Cycle states": ("Estados del ciclo", "Tilstande i kredsprocessen"), "Year round": ("Todo el año", "Hele året"),
 "Notes and warnings": ("Notas y advertencias", "Noter og advarsler"), "Back": ("Atrás", "Tilbage"), "Finish": ("Terminar", "Afslut"), "Next": ("Siguiente", "Næste"),
}
H = {
 "nav.tour": ("Recorrido", "Rundtur"), "nav.sheet": ("Hoja de datos", "Datablad"), "tab.plant": ("Instalación", "Anlæg"),
 "pl.lede": ("Toda la instalación tal como está diseñada: la fuente de calor, el circuito de refrigerante y el circuito de calefacción, con las temperaturas, presiones, caudales y potencias en el punto de diseño. El marco discontinuo es lo que va dentro del equipo.",
             "Hele anlægget som dimensioneret: varmekilden, kølekredsen og varmekredsen med temperaturer, tryk, flow og effekter i dimensioneringspunktet. Den stiplede ramme er det, der sidder i varmepumpeenheden."),
 "about.ver": ("Heat Pump Studio, versión 1.2.0", "Heat Pump Studio version 1.2.0"),
 "about.next": ("Más adelante: CO₂ (R744, transcrítico), ciclos de dos etapas y con inyección de vapor, y prioridad de agua caliente.", "Senere: CO₂ (R744, transkritisk), totrinsanlæg og dampindsprøjtning samt prioritering af varmt vand."),
}
