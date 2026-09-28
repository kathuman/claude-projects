/*
 * mapView.js — renders a network in one of two layouts:
 *
 *   'geo'     a plain equirectangular (lat/lon -> x/y) projection. Not a
 *             real basemap (no coastlines/borders) -- this app's networks
 *             are synthetic/user-defined, so a projection that's easy to
 *             reason about matters more than geographic accuracy. A faint
 *             lon/lat grid stands in for a basemap.
 *   'diagram' an abstract layered layout -- three columns (production /
 *             warehouse / consumer), nodes spread evenly down each column
 *             by id. Geography is often the wrong lens for understanding
 *             TOPOLOGY: at a few hundred nodes, region-clustered geo
 *             coordinates put many lanes on top of each other, while the
 *             diagram view makes "how many hops, how many parallel paths"
 *             immediately legible regardless of where things sit on Earth.
 *
 * Both layouts share the same render/pan/zoom/selection code -- only the
 * per-node (x,y) source differs.
 *
 * Zoom does not resize nodes or lanes on screen: wheel-zoom only rescales
 * the viewBox (so it changes how much of the layout is visible / how far
 * apart things are), while node circles are re-computed to a constant
 * on-screen pixel radius after every zoom step, and lane strokes use SVG's
 * native `vector-effect="non-scaling-stroke"` so their pixel width is
 * never affected by the viewBox transform at all. Earlier versions let
 * both scale with the viewBox, so zooming in also ballooned every marker
 * and line into a hard-to-read wall of ink -- exactly backwards from what
 * zoom is for.
 *
 * Browser-only (renders into a real SVG element) -- not dual-exported
 * for Node like the solver/generator modules, since there is nothing to
 * unit-test here without a DOM.
 */
(function (global) {
  "use strict";

  const NODE_R_PX = 3.6, NODE_R_SELECTED_PX = 5.8;
  const DIAGRAM_COLUMN_X = { production: -140, warehouse: 0, consumer: 140 };
  const DIAGRAM_COLUMN_LABEL = { production: "PRODUCTION", warehouse: "WAREHOUSE", consumer: "CONSUMER" };

  function createMapView(svgEl, handlers) {
    const NS = "http://www.w3.org/2000/svg";
    let viewBox = { x: -180, y: -90, w: 360, h: 180 };
    let network = { nodes: [], edges: [] };
    let scenario = null;
    let edgeFlowById = null; // Map edgeId -> flow, or null for "no solve yet"
    let selection = null; // {type:'node'|'edge', id}
    let layoutMode = "geo"; // 'geo' | 'diagram'
    let diagramPositions = new Map();

    function applyViewBox() {
      svgEl.setAttribute("viewBox", viewBox.x + " " + viewBox.y + " " + viewBox.w + " " + viewBox.h);
    }
    applyViewBox();

    function computeDiagramPositions(net) {
      const positions = new Map();
      Object.keys(DIAGRAM_COLUMN_X).forEach((type) => {
        const nodesOfType = net.nodes.filter((n) => n.type === type).sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const n = nodesOfType.length;
        nodesOfType.forEach((node, i) => {
          const y = n <= 1 ? 0 : -80 + (160 * i) / (n - 1);
          positions.set(node.id, { x: DIAGRAM_COLUMN_X[type], y });
        });
      });
      return positions;
    }

    function projectNode(n) {
      if (layoutMode === "diagram") {
        return diagramPositions.get(n.id) || { x: 0, y: 0 };
      }
      return { x: n.lon, y: -n.lat };
    }

    function buildGeoGrid() {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "map-grid");
      for (let lon = -180; lon <= 180; lon += 30) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", lon); l.setAttribute("x2", lon);
        l.setAttribute("y1", -90); l.setAttribute("y2", 90);
        l.setAttribute("stroke", "rgba(125,211,252,0.07)"); l.setAttribute("stroke-width", "0.3");
        g.appendChild(l);
      }
      for (let lat = -90; lat <= 90; lat += 30) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("y1", -lat); l.setAttribute("y2", -lat);
        l.setAttribute("x1", -180); l.setAttribute("x2", 180);
        l.setAttribute("stroke", "rgba(125,211,252,0.07)"); l.setAttribute("stroke-width", "0.3");
        g.appendChild(l);
      }
      return g;
    }

    function buildDiagramGuides() {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "map-grid");
      Object.keys(DIAGRAM_COLUMN_X).forEach((type) => {
        const x = DIAGRAM_COLUMN_X[type];
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", x); l.setAttribute("x2", x);
        l.setAttribute("y1", -95); l.setAttribute("y2", 95);
        l.setAttribute("stroke", "rgba(125,211,252,0.09)"); l.setAttribute("stroke-width", "0.4");
        g.appendChild(l);
        const label = document.createElementNS(NS, "text");
        label.setAttribute("x", x); label.setAttribute("y", -100);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "map-diagram-label");
        label.textContent = DIAGRAM_COLUMN_LABEL[type];
        g.appendChild(label);
      });
      return g;
    }

    function modeColorClass(mode) { return "mode-" + (mode || "road"); }

    function currentUnitsPerPixel() {
      const rect = svgEl.getBoundingClientRect();
      return rect.width > 0 ? viewBox.w / rect.width : 1;
    }

    // Recomputes node circle radii to a constant ON-SCREEN pixel size,
    // given the current viewBox scale -- called after every render AND
    // after every wheel-zoom step (pan alone doesn't change scale, so it
    // doesn't need this). Lanes don't need an equivalent pass: their
    // `vector-effect="non-scaling-stroke"` already keeps stroke width in
    // screen pixels natively, with no recomputation required.
    function rescaleNodes() {
      const upp = currentUnitsPerPixel();
      const nodes = svgEl.querySelectorAll(".map-node");
      for (let i = 0; i < nodes.length; i++) {
        const c = nodes[i];
        c.setAttribute("r", (c.classList.contains("selected") ? NODE_R_SELECTED_PX : NODE_R_PX) * upp);
      }
    }

    function render() {
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      svgEl.appendChild(layoutMode === "diagram" ? buildDiagramGuides() : buildGeoGrid());

      const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
      const edgeLayer = document.createElementNS(NS, "g");
      const nodeLayer = document.createElementNS(NS, "g");

      network.edges.forEach((e) => {
        const from = nodeById.get(e.from), to = nodeById.get(e.to);
        if (!from || !to) return;
        const p1 = projectNode(from), p2 = projectNode(to);
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
        line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
        line.setAttribute("vector-effect", "non-scaling-stroke");
        const isDisabled = scenario && scenario.disabledEdges && scenario.disabledEdges.has(e.id);
        const isSelected = selection && selection.type === "edge" && selection.id === e.id;
        let width = 1.3; // screen pixels (non-scaling-stroke), not viewBox units
        if (edgeFlowById) {
          const flow = edgeFlowById.get(e.id) || 0;
          width = flow > 0 ? Math.min(4.5, 1.0 + Math.sqrt(flow) * 0.3) : 0.5;
        }
        line.setAttribute("stroke-width", isSelected ? width + 1.3 : width);
        line.setAttribute("class", "map-edge " + modeColorClass(e.mode) + (isDisabled ? " disabled" : "") + (isSelected ? " selected" : ""));
        if (edgeFlowById) {
          const flow = edgeFlowById.get(e.id) || 0;
          line.setAttribute("opacity", flow > 0 ? 0.9 : 0.12);
        } else {
          line.setAttribute("opacity", 0.55);
        }
        line.addEventListener("click", (ev) => { ev.stopPropagation(); handlers.onSelectEdge && handlers.onSelectEdge(e.id); });
        const title = document.createElementNS(NS, "title");
        title.textContent = e.id + ": " + e.from + " -> " + e.to + " (" + e.mode + ", cap " + e.capacity + ")" + (edgeFlowById ? ", flow " + (edgeFlowById.get(e.id) || 0) : "");
        line.appendChild(title);
        edgeLayer.appendChild(line);
      });

      network.nodes.forEach((n) => {
        const p = projectNode(n);
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
        const isDisabled = scenario && scenario.disabledNodes && scenario.disabledNodes.has(n.id);
        const isSelected = selection && selection.type === "node" && selection.id === n.id;
        c.setAttribute("class", "map-node type-" + n.type + (isDisabled ? " disabled" : "") + (isSelected ? " selected" : ""));
        c.addEventListener("click", (ev) => { ev.stopPropagation(); handlers.onSelectNode && handlers.onSelectNode(n.id); });
        const title = document.createElementNS(NS, "title");
        title.textContent = n.id + " (" + n.type + ")";
        c.appendChild(title);
        nodeLayer.appendChild(c);
      });

      svgEl.appendChild(edgeLayer);
      svgEl.appendChild(nodeLayer);
      rescaleNodes();
    }

    // pan/zoom
    let isPanning = false, panStart = null, viewBoxStart = null;
    svgEl.addEventListener("mousedown", (ev) => {
      isPanning = true; svgEl.classList.add("panning");
      panStart = { x: ev.clientX, y: ev.clientY }; viewBoxStart = Object.assign({}, viewBox);
    });
    window.addEventListener("mousemove", (ev) => {
      if (!isPanning) return;
      const rect = svgEl.getBoundingClientRect();
      const scaleX = viewBox.w / rect.width, scaleY = viewBox.h / rect.height;
      viewBox.x = viewBoxStart.x - (ev.clientX - panStart.x) * scaleX;
      viewBox.y = viewBoxStart.y - (ev.clientY - panStart.y) * scaleY;
      applyViewBox();
    });
    window.addEventListener("mouseup", () => { isPanning = false; svgEl.classList.remove("panning"); });
    svgEl.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      const mx = viewBox.x + ((ev.clientX - rect.left) / rect.width) * viewBox.w;
      const my = viewBox.y + ((ev.clientY - rect.top) / rect.height) * viewBox.h;
      const factor = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
      viewBox.w = Math.max(8, Math.min(720, viewBox.w * factor));
      viewBox.h = Math.max(4, Math.min(360, viewBox.h * factor));
      viewBox.x = mx - ((mx - viewBox.x) * factor);
      viewBox.y = my - ((my - viewBox.y) * factor);
      applyViewBox();
      rescaleNodes(); // viewBox scale changed -- keep node markers a constant screen size
    }, { passive: false });
    svgEl.addEventListener("click", () => { handlers.onSelectBackground && handlers.onSelectBackground(); });

    return {
      setNetwork(net) { network = net; diagramPositions = computeDiagramPositions(net); render(); },
      setScenario(s) { scenario = s; render(); },
      setFlow(map) { edgeFlowById = map; render(); }, // Map edgeId->flow, or null to clear
      setSelection(sel) { selection = sel; render(); },
      setLayoutMode(mode) { layoutMode = mode === "diagram" ? "diagram" : "geo"; render(); },
      getLayoutMode() { return layoutMode; },
      resetView() { viewBox = { x: -180, y: -90, w: 360, h: 180 }; applyViewBox(); rescaleNodes(); },
      render,
    };
  }

  global.NST = global.NST || {};
  global.NST.mapView = { createMapView };
})(typeof window !== "undefined" ? window : globalThis);
