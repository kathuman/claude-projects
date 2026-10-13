// Real Options for Network Design — the tutorial: three levels of guided steps. Each step names its page, the element
// it points at, the scenario it sets up (values in the units shown on the sliders), and optionally a quick question.
// Claims that a question makes about the model are checked against the engines by tests/tutorial.test.js.
// {{tokens}} in the text are filled in from the live results (see TOKENS).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROTourContent = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var TOKENS = ["flex", "top", "bestK", "vsFull", "fullNpv", "deferNpv", "leaseBreak", "mothValue", "netTop", "netFlex"];

  var LEVELS = [
    { id: "beginner", title: "Beginner", minutes: 8, blurb: "What a real option is, the five strategies, and how to read the answer.", steps: [
      { id: "b-welcome", illus: "options", page: "index", title: "What this tool answers", target: ".intro h1", setup: { shown: {} },
        body: "A network study usually picks one design for the expected forecast and commits. But demand is uncertain. This tool asks: <b>what is it worth to keep your options open</b>, for example by waiting, starting small, or renting? Use <b>Next</b> to move on; you can leave at any time with ×." },
      { id: "b-strategies", illus: "strategy:stage", page: "index", title: "Five ways to build capacity", target: "#scorecards", setup: { shown: {} },
        body: "Each card is a strategy with its value (NPV, in $ millions). <b>Commit now</b> builds the full site today. <b>Best fixed</b> builds the best single size today. <b>Wait &amp; see</b> uses a 3PL and builds later. <b>Stage &amp; expand</b> starts small and grows. <b>Lease &amp; break</b> rents, with the right to hand the space back. The best one has a badge." },
      { id: "b-headline", illus: "baseline", page: "index", title: "The answer in one number", target: "#headline", setup: { shown: {} },
        body: "The big number is the <b>value of flexibility</b>: the best flexible strategy minus the best fixed design. Here it is <b>{{flex}}</b>. It is compared with the best fixed design on purpose: comparing with a deliberately oversized \"commit now\" plan would flatter flexibility ({{vsFull}})." },
      { id: "b-vol-q", illus: "fan", page: "index", title: "What drives option value?", target: "#c_sigma", setup: { shown: { sigma: 10 } },
        body: "Volatility is how uncertain demand is. It is now set low, at 10%, and the value of flexibility is {{flex}}.",
        quiz: { q: "If volatility rises to 40%, what happens to the value of flexibility?", options: ["It rises", "It falls", "It stays the same"], answer: 0, claim: "vol-raises-flex",
          explain: "Flexibility lets you act only in the futures where acting pays. The wider the range of futures, the more that is worth. Next we set 40% so you can see it." } },
      { id: "b-vol-high", page: "index", title: "More uncertainty, more value", target: "#headline", setup: { shown: { sigma: 40 } },
        body: "At 40% volatility the value of flexibility is <b>{{flex}}</b>, and the best strategy is <b>{{top}}</b>. Flexibility is worth most exactly when you know least. Try the volatility slider yourself and watch the cards." },
      { id: "b-map", illus: "trigger", page: "index", title: "When to act", target: "#mapChart", setup: { shown: {} },
        body: "The shaded fan shows where demand may go. The coloured lines are the <b>triggers</b>: wait &amp; see builds when demand rises above its line; stage &amp; expand adds a step above its own. Hover over the chart to read the numbers for any year." },
      { id: "b-decline", illus: "strategy:lease", page: "index", title: "A market in decline", target: "#scorecards", setup: { preset: "Structural decline" },
        body: "Presets load complete scenarios. This one is a product in structural decline.",
        quiz: { q: "In a declining market, which strategy do you expect to win?", options: ["Commit now", "Stage & expand", "Lease & break"], answer: 2, claim: "decline-lease",
          explain: "Renting with break clauses means you can hand the space back as demand falls, and you never sink capital into a shrinking business. The card with the badge confirms it." } },
      { id: "b-risk", illus: "payoff", page: "index", title: "Not just the average", target: "#distChart", setup: { shown: {} },
        body: "Values are averages over many possible futures. This chart shows the spread: flexible strategies usually cut the losses in the bad futures. The caption gives the 5th percentile and the chance of a loss." },
      { id: "b-done", page: "index", title: "You know the basics", target: "#tourBtn", setup: { shown: {} },
        body: "You can read the answer, see what drives it and when to act. The <b>intermediate</b> level shows how to question the assumptions behind it: lead times, the 3PL, leases, resale, calibrating from your data and the decision report." }
    ] },
    { id: "intermediate", title: "Intermediate", minutes: 12, blurb: "Question the assumptions: lead times, the 3PL, leases, resale, your own data, comparisons and the report.", steps: [
      { id: "i-baseline", illus: "baseline", page: "index", title: "A fair baseline", target: "#scorecards", setup: { shown: {} },
        body: "Commit now ({{fullNpv}}) builds the full footprint. The best fixed design builds the size that maximises NPV ({{bestK}}). Measuring flexibility against the best fixed design ({{flex}}) instead of commit now ({{vsFull}}) is the honest comparison." },
      { id: "i-bridge-q", illus: "bridge", page: "index", title: "Waiting is not free", target: "#c_outCap", setup: { shown: { outCap: 0, penalty: 40 } },
        body: "While you wait, a 3PL serves demand. Here the 3PL limit is set to 0% and lost sales cost $40 a unit.",
        quiz: { q: "With no interim supply and expensive lost sales, what does wait & see do?", options: ["It still waits for demand to be confirmed", "It builds at once, so it is worth exactly what committing now is worth", "It never builds"], answer: 1, claim: "no-bridge-builds-now",
          explain: "Every quarter of waiting loses sales at $40 each, more than the information is worth. Compare the Wait & see and Commit now cards: {{deferNpv}} against {{fullNpv}}." } },
      { id: "i-window", illus: "window", page: "index", title: "How long the option lasts", target: "#c_window", setup: { shown: { window: 2 } },
        body: "The decision window is how long you can still build or expand (the land, the permits, the market opening). With only 2 years the value of flexibility is {{flex}}. A longer window never lowers it: drag the slider to 12 and compare." },
      { id: "i-tornado", page: "index", title: "Which assumptions matter", target: "#torChart", setup: { shown: {} },
        body: "Each bar moves one assumption down and up. The long bars are the ones to pin down before committing; the short ones barely change the answer. The chart updates a moment after the rest of the page." },
      { id: "i-lease", illus: "strategy:lease", page: "index", title: "Rent with an exit", target: "#scorecards", setup: { preset: "Volatile & flat" },
        body: "In a volatile, flat market <b>{{top}}</b> is best. The lease card shows what its break clauses are worth ({{leaseBreak}}): the right to hand the space back if demand disappears." },
      { id: "i-resale-q", illus: "sellidle", page: "index", title: "Generic or specialised?", target: "#c_salvF", setup: { shown: { salvF: 0 } },
        body: "An owned site can be sold if demand collapses. Its resale value depends on the design: a generic warehouse resells well, a highly automated or specialised one does not. Here resale is set to zero.",
        quiz: { q: "Raising the resale value makes the best fixed design…", options: ["worth more", "worth less", "no different"], answer: 0, claim: "resale-raises-best",
          explain: "The right to sell is an exit option: it cuts the losses in the futures where demand collapses. It is part of every owned design, including the baseline, so the comparison stays fair." } },
      { id: "i-payoff", illus: "payoff", page: "index", title: "The shape of an option", target: "#payChart", setup: { shown: {} },
        body: "Each dot is one possible future. A fixed design's value falls steeply when demand disappoints. The flexible strategies bend: they give up a little in the middle and lose much less at the bottom. That bend is the option." },
      { id: "i-calib", illus: "calibrate", page: "index", title: "Use your own data", target: "#calib", setup: { shown: {}, open: "#calib", sample: "Volatile industrial (monthly)" },
        body: "Paste a demand history or load a CSV, and the panel estimates growth and volatility with 90% intervals. Here a sample is loaded. Notice how wide the growth interval is: growth depends on how many years the history spans, so treat it with care. <b>Apply to the model</b> sets the sliders." },
      { id: "i-compare", page: "index", title: "Compare scenarios", target: "#comparePanel", setup: { shown: {} },
        body: "Name and save the scenario you are looking at, change assumptions, save again: the table compares them side by side, highlighting the best strategy in each. Saved scenarios stay in this browser." },
      { id: "i-report", illus: "report", page: "index", title: "The decision report", target: "#reportLink", setup: { shown: {} },
        body: "<b>Report</b> opens a printable decision report for the current scenario: the recommendation, every strategy's value and risk, the decision triggers year by year, the main sensitivities, all assumptions and the method. Print it or save it as a PDF." }
    ] },
    { id: "advanced", title: "Advanced", minutes: 15, blurb: "Valuation theory, switching and hysteresis, and options across a two-region network.", steps: [
      { id: "a-rn-q", illus: "riskneutral", page: "index", title: "Which discount rate?", target: "[data-basis='rn']", setup: { shown: { wacc: 8, rf: 8, lambda: 0 }, basis: "rn" },
        body: "Practitioners discount expected cash flows at a WACC. Option theory says to value risk-neutrally: reduce the drift by the market price of demand risk λ, then discount at the risk-free rate. Here the risk-neutral basis is on, with λ = 0, and the risk-free rate and the WACC are both 8%.",
        quiz: { q: "With λ = 0 and the risk-free rate equal to the WACC, the risk-neutral values are…", options: ["exactly the WACC values", "higher", "lower"], answer: 0, claim: "rn-equals-wacc",
          explain: "With no price of risk the drift is unchanged, and both bases then discount the same cash flows at the same rate. With λ > 0 they differ, and the risk-neutral basis is the consistent one for options." } },
      { id: "a-lattice", illus: "lattice", page: "index", title: "No silent shortcuts", target: "#derived", setup: { shown: { sigma: 5, g: 12 } },
        body: "A binomial lattice can only represent a growth rate up to a limit for a given volatility. Here 12% growth with 5% volatility needs finer steps, so the lattice switches from quarterly to monthly or weekly steps and the page says so, rather than quietly changing your growth. The step and probabilities are shown under the controls." },
      { id: "a-moth", illus: "hysteresis", page: "index", title: "Mothballing and hysteresis", target: "#mapChart", setup: { preset: "Specialised site" },
        body: "A specialised site cannot be resold, but it can be <b>mothballed</b> (idled, with demand going to the 3PL) and restarted. On the decision map the dotted line is where it is idled and the thin line where it is restarted. Switching costs open a band between them, so the site is not switched back and forth. Mothballing adds {{mothValue}} here." },
      { id: "a-sell-q", illus: "sellidle", page: "index", title: "Sell or idle?", target: "#headline", setup: { preset: "Specialised site", shown: { salvF: 30 } },
        body: "The same site, but now it resells at 30% of its cost.",
        quiz: { q: "What is the right to mothball worth now?", options: ["About the same as before", "Almost nothing: selling beats idling", "Much more"], answer: 1, claim: "resale-kills-moth",
          explain: "Idling keeps part of the holding cost and only pays off if demand returns. Selling ends the cost for good and brings cash. With any meaningful resale value, selling wins: here mothballing adds {{mothValue}}." } },
      { id: "a-vol-curve", illus: "fan", page: "index", title: "When staging stops paying", target: "#volChart", setup: { shown: {} },
        body: "Option value against volatility. Waiting rises steadily; staging rises and then falls under the WACC basis, because at very high volatility it pays to wait rather than commit to a first stage. On the risk-neutral basis both rise with volatility, as theory says; the tests check that." },
      { id: "a-net-pool", illus: "pooling", page: "network", title: "From one site to a network", target: "#scorecards", setup: { preset: "Pooling pays" },
        body: "The network page values two regions together. In this preset their demands move in opposite directions and shipping between them is cheap, so <b>{{netTop}}</b> is best: one hub's spare capacity covers whichever region is busy (pooling)." },
      { id: "a-net-rho-q", illus: "net:central", page: "network", title: "Pooling and correlation", target: "#rhoChart", setup: { shown: {} },
        body: "This chart shows each strategy's value as the correlation between the regions changes.",
        quiz: { q: "As the regions' demands become more correlated, a central hub is worth…", options: ["less", "more", "the same"], answer: 0, claim: "rho-lowers-central",
          explain: "When both regions are busy at the same time, spare capacity is rarely available to share, so pooling helps less. With low or negative correlation one hub can serve both." } },
      { id: "a-net-learn-q", illus: "compound", page: "network", title: "A compound option", target: "#n_learn", setup: { shown: { learn: 0 } },
        body: "Opening one hub can make the next cheaper (systems, people, supplier terms). That makes a pilot hub a <b>compound option</b>: buying it also buys a cheaper option on the second. The saving is set to zero here.",
        quiz: { q: "Raising the second-hub saving makes the pilot strategy…", options: ["worth more", "worth less", "no different"], answer: 0, claim: "learn-raises-pilot",
          explain: "The option on the second hub gets cheaper to exercise, so the first hub is worth more. The headline reports what the saving is worth at your settings." } },
      { id: "a-net-map", illus: "map2d", page: "network", title: "A map in two dimensions", target: "#netMap", setup: { shown: {}, mapState: "A", mapYear: 4 },
        body: "With two regions, each decision depends on both demands. This map shows, for year 4 and with hub A already open, the demand combinations at which hub B should be opened. Change the year or the network in place with the controls above the map." },
      { id: "a-net-wait", illus: "net:wait", page: "network", title: "When waiting wins", target: "#scorecards", setup: { preset: "Both markets uncertain", mapState: "none" },
        body: "Usually the pilot hub and waiting coincide: waiting simply opens the first hub at once. When both markets are uncertain, waiting really pays: <b>{{netTop}}</b> is best, by {{netFlex}} over the best fixed network. On many paths it opens nothing for a while, or never." },
      { id: "a-done", page: "network", title: "Where to go from here", target: "#calib", setup: { shown: {}, mapState: "none" },
        body: "You can calibrate each region from data here, and produce a decision report for any single-site scenario. The model's limits are listed in the Model section of each page: one product, no competition, and a quarterly lattice for the network. Use them as a guide to the direction and rough size of the value of flexibility, and to the triggers." }
    ] }
  ];
  return { LEVELS: LEVELS, TOKENS: TOKENS };
});
