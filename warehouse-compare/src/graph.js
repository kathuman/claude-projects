/*
 * graph.js — travel distance for any warehouse layout.
 *
 * The original Warehouse Model computes travel with closed-form rectilinear
 * formulas, which only work for straight rack rows. Here every layout (A:
 * moving racks, B: semicircular, C: rectangular) is described the same way —
 * as points joined by paths a picker or robot can travel — and distance is
 * always the shortest path through that network. One engine, so the three
 * layouts are measured on equal terms.
 *
 *   nodes   { x, y, kind }            positions in metres (plan view)
 *   edges   undirected, with a length  (straight lines by default; arcs pass
 *                                       their own length)
 *   keys    the nodes we need distances between: picking points and the
 *           access points where a picker stops to reach storage locations.
 *           keyMatrix() gives the all-pairs shortest distance between keys.
 *
 * Pure, no DOM: window.WC.graph in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.graph = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function Graph() {
    this.x = []; this.y = []; this.kind = [];
    this.adj = [];          // adj[i] = [j, len, j, len, ...]
    this.edges = [];        // [a, b, len] — for drawing and checks
    this.keys = [];         // node ids that are keys, in key order
    this.keyOf = [];        // node id -> key index, or -1
  }

  Graph.prototype.addNode = function (x, y, kind) {
    const id = this.x.length;
    this.x.push(x); this.y.push(y); this.kind.push(kind || "path");
    this.adj.push([]); this.keyOf.push(-1);
    return id;
  };

  Graph.prototype.addEdge = function (a, b, len) {
    if (a === b) return;
    const L = len === undefined ? Math.hypot(this.x[a] - this.x[b], this.y[a] - this.y[b]) : len;
    if (!(L >= 0)) throw new Error("edge length must be ≥ 0");
    this.adj[a].push(b, L); this.adj[b].push(a, L);
    this.edges.push([a, b, L]);
  };

  // Join a list of nodes in order of their position along one coordinate
  // ("x" or "y") with straight edges — an aisle or a cross-aisle.
  Graph.prototype.chain = function (ids, axis) {
    const c = axis === "y" ? this.y : this.x;
    const s = ids.slice().sort(function (a, b) { return c[a] - c[b]; });
    for (let i = 1; i < s.length; i++) this.addEdge(s[i - 1], s[i]);
    return s;
  };

  Graph.prototype.markKey = function (id) {
    if (this.keyOf[id] >= 0) return this.keyOf[id];
    this.keyOf[id] = this.keys.length;
    this.keys.push(id);
    return this.keyOf[id];
  };

  Graph.prototype.size = function () { return this.x.length; };

  // Single-source shortest paths (Dijkstra with a binary heap).
  Graph.prototype.dijkstra = function (src, prev) {
    const n = this.x.length, dist = new Float64Array(n).fill(Infinity);
    if (prev) prev.fill(-1);
    const heapN = [], heapD = [];
    function push(v, d) {
      let i = heapN.length; heapN.push(v); heapD.push(d);
      while (i > 0) { const p = (i - 1) >> 1; if (heapD[p] <= d) break; heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p; }
      heapN[i] = v; heapD[i] = d;
    }
    function pop() {
      const top = heapN[0], lastN = heapN.pop(), lastD = heapD.pop(), m = heapN.length;
      if (m > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= m) break;
          if (c + 1 < m && heapD[c + 1] < heapD[c]) c++;
          if (heapD[c] >= lastD) break;
          heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c;
        }
        heapN[i] = lastN; heapD[i] = lastD;
      }
      return top;
    }
    dist[src] = 0; push(src, 0);
    const done = new Uint8Array(n);
    while (heapN.length) {
      const d0 = heapD[0], u = pop();
      if (done[u]) continue; done[u] = 1;
      const a = this.adj[u];
      for (let k = 0; k < a.length; k += 2) {
        const v = a[k], nd = d0 + a[k + 1];
        if (nd < dist[v]) { dist[v] = nd; if (prev) prev[v] = u; push(v, nd); }
      }
    }
    return dist;
  };

  // The node ids of one shortest path from a to b (for drawing a route).
  Graph.prototype.path = function (a, b) {
    const prev = new Int32Array(this.x.length), d = this.dijkstra(a, prev);
    if (!isFinite(d[b])) return null;
    const out = [b];
    while (out[out.length - 1] !== a) out.push(prev[out[out.length - 1]]);
    return out.reverse();
  };

  // All-pairs shortest distance between key nodes: Float64Array K×K, row-major.
  Graph.prototype.keyMatrix = function () {
    const K = this.keys.length, M = new Float64Array(K * K);
    for (let i = 0; i < K; i++) {
      const d = this.dijkstra(this.keys[i]);
      for (let j = 0; j < K; j++) M[i * K + j] = d[this.keys[j]];
    }
    return { K: K, D: M, at: function (i, j) { return M[i * K + j]; } };
  };

  // Every node reachable from the first key? (A disconnected layout is a bug.)
  Graph.prototype.connected = function () {
    if (!this.keys.length) return true;
    const d = this.dijkstra(this.keys[0]);
    for (let i = 0; i < this.keys.length; i++) if (!isFinite(d[this.keys[i]])) return false;
    return true;
  };

  return { Graph: Graph };
});
