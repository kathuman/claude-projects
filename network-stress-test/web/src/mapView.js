/*
 * mapView.js — a plain equirectangular (lat/lon -> x/y) SVG projection.
 * Not a real basemap (no coastlines/borders) -- this app's networks are
 * synthetic/user-defined, so a projection that's easy to reason about
 * (straight lon->x, straight lat->y) matters more than geographic
 * accuracy. A faint lon/lat grid stands in for a basemap.
 *
 * Browser-only (renders into a real SVG element) -- not dual-exported
 * for Node like the solver/generator modules, since there is nothing to
 * unit-test here without a DOM.
 */
(function (global) {
  "use strict";

  function createMapView(svgEl, handlers) {
    const NS = "http://www.w3.org/2000/svg";
    let viewBox = { x: -180, y: -90, w: 360, h: 180 };
    let network = { nodes: [], edges: [] };
    let scenario = null;
    let edgeFlowById = null; // Map edgeId -> flow, or null for "no solve yet"
    let selection = null; // {type:'node'|'edge', id}

    function applyViewBox() {
      svgEl.setAttribute("viewBox", viewBox.x + " " + viewBox.y + " " + viewBox.w + " " + viewBox.h);
    }
    applyViewBox();

    function project(lat, lon) {
      return { x: lon, y: -lat };
    }

    function buildGrid() {
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

    function modeColorClass(mode) { return "mode-" + (mode || "road"); }

    function render() {
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
      svgEl.appendChild(buildGrid());

      const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
      const edgeLayer = document.createElementNS(NS, "g");
      const nodeLayer = document.createElementNS(NS, "g");

      network.edges.forEach((e) => {
        const from = nodeById.get(e.from), to = nodeById.get(e.to);
        if (!from || !to) return;
        const p1 = project(from.lat, from.lon), p2 = project(to.lat, to.lon);
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
        line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
        const isDisabled = scenario && scenario.disabledEdges && scenario.disabledEdges.has(e.id);
        const isSelected = selection && selection.type === "edge" && selection.id === e.id;
        let width = 0.4;
        if (edgeFlowById) {
          const flow = edgeFlowById.get(e.id) || 0;
          width = flow > 0 ? Math.min(2.2, 0.3 + Math.sqrt(flow) * 0.12) : 0.15;
        }
        line.setAttribute("stroke-width", isSelected ? width + 0.6 : width);
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
        const p = project(n.lat, n.lon);
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
        const isDisabled = scenario && scenario.disabledNodes && scenario.disabledNodes.has(n.id);
        const isSelected = selection && selection.type === "node" && selection.id === n.id;
        c.setAttribute("r", isSelected ? 2.6 : 1.7);
        c.setAttribute("class", "map-node type-" + n.type + (isDisabled ? " disabled" : "") + (isSelected ? " selected" : ""));
        c.addEventListener("click", (ev) => { ev.stopPropagation(); handlers.onSelectNode && handlers.onSelectNode(n.id); });
        const title = document.createElementNS(NS, "title");
        title.textContent = n.id + " (" + n.type + ")";
        c.appendChild(title);
        nodeLayer.appendChild(c);
      });

      svgEl.appendChild(edgeLayer);
      svgEl.appendChild(nodeLayer);
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
    }, { passive: false });
    svgEl.addEventListener("click", () => { handlers.onSelectBackground && handlers.onSelectBackground(); });

    return {
      setNetwork(net) { network = net; render(); },
      setScenario(s) { scenario = s; render(); },
      setFlow(map) { edgeFlowById = map; render(); }, // Map edgeId->flow, or null to clear
      setSelection(sel) { selection = sel; render(); },
      resetView() { viewBox = { x: -180, y: -90, w: 360, h: 180 }; applyViewBox(); },
      render,
    };
  }

  global.NST = global.NST || {};
  global.NST.mapView = { createMapView };
})(typeof window !== "undefined" ? window : globalThis);
