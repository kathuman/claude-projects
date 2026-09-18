/*
 * model.js — parameter state management.
 *
 * Loads data/parameters.json (the single source of truth also read by
 * freecad/create_model.py) and holds the live working copy of every
 * parameter's current value. Nothing here computes an engineering result —
 * that's calculations.js's job. This module only knows about parameter
 * definitions, current values, and who to notify when a value changes.
 */
(function (global) {
  "use strict";

  function ParameterModel() {
    this.schema = null;      // raw parameters.json .parameters
    this.values = {};        // name -> current numeric value
    this.defaults = {};      // name -> original default value
    this.listeners = [];
  }

  ParameterModel.prototype.load = function (url, done) {
    const self = this;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200 && xhr.status !== 0) {
        done(new Error("Failed to load " + url + " (HTTP " + xhr.status + ")"));
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        self.schema = data.parameters;
        self.units = data.units;
        for (const name in self.schema) {
          self.values[name] = self.schema[name].value;
          self.defaults[name] = self.schema[name].value;
        }
        done(null);
      } catch (e) {
        done(e);
      }
    };
    xhr.send();
  };

  ParameterModel.prototype.get = function (name) { return this.values[name]; };

  ParameterModel.prototype.getAll = function () {
    // Returns a plain {name: value} snapshot, exactly what calculations.js
    // and visualization.js expect as their single "p" argument.
    const snap = {};
    for (const name in this.values) snap[name] = this.values[name];
    return snap;
  };

  ParameterModel.prototype.set = function (name, value) {
    const def = this.schema[name];
    if (!def) throw new Error("Unknown parameter: " + name);
    const clamped = Math.max(def.minimum, Math.min(def.maximum, value));
    if (this.values[name] === clamped) return;
    this.values[name] = clamped;
    this._notify(name);
  };

  ParameterModel.prototype.resetOne = function (name) {
    this.set(name, this.defaults[name]);
  };

  ParameterModel.prototype.resetAll = function () {
    for (const name in this.defaults) this.values[name] = this.defaults[name];
    this._notify(null);
  };

  ParameterModel.prototype.onChange = function (cb) { this.listeners.push(cb); };

  ParameterModel.prototype._notify = function (changedName) {
    this.listeners.forEach(function (cb) { cb(changedName); });
  };

  // Ordered category list — drives the order rail sections render in.
  ParameterModel.CATEGORY_ORDER = ["Building", "Racking", "Docks & Flow", "Operations", "Cost"];

  global.WH = global.WH || {};
  global.WH.ParameterModel = ParameterModel;
})(window);
