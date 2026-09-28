/*
 * modeDefaults.js — characteristic parameters per transport mode, plus the
 * distance-based helpers that turn two lat/lon points into a default lead
 * time, cost and failure rate for a candidate lane. These are starting
 * points, not fixed truths: every value here is meant to be overridden
 * per-edge once a network is built (matches the "mode-characteristic
 * defaults, with the option of manually defining them later" scope).
 *
 * The relative shape of the defaults is the important part, not the exact
 * numbers: air is fast and expensive with disruptions that are rarer but
 * severe (airspace closures); sea is slow and cheap with disruptions that
 * are less frequent than road but often long (port/canal closures); road
 * is fastest for short hops and moderate cost, but the most exposed to
 * frequent, usually-brief disruption (congestion, border delays, weather).
 */
(function (global) {
  "use strict";

  const MODE_DEFAULTS = {
    air: {
      speedKmPerDay: 6000,
      fixedDays: 0.5, // ground handling / customs, independent of distance
      costPerUnitKm: 0.12,
      fixedCostPerUnit: 8, // handling cost, independent of distance
      baseFailureRate: 0.01, // probability of a disruption event per period
      meanDisruptionDays: 4,
    },
    sea: {
      speedKmPerDay: 650,
      fixedDays: 3,
      costPerUnitKm: 0.008,
      fixedCostPerUnit: 3,
      baseFailureRate: 0.02,
      meanDisruptionDays: 18,
    },
    road: {
      speedKmPerDay: 700,
      fixedDays: 0.25,
      costPerUnitKm: 0.05,
      fixedCostPerUnit: 1,
      baseFailureRate: 0.05,
      meanDisruptionDays: 3,
    },
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function defaultsForLane(lat1, lon1, lat2, lon2, mode) {
    const d = MODE_DEFAULTS[mode];
    const distanceKm = haversineKm(lat1, lon1, lat2, lon2);
    return {
      distanceKm: distanceKm,
      leadTimeDays: d.fixedDays + distanceKm / d.speedKmPerDay,
      costPerUnit: d.fixedCostPerUnit + distanceKm * d.costPerUnitKm,
      baseFailureRate: d.baseFailureRate,
      meanDisruptionDays: d.meanDisruptionDays,
    };
  }

  const mod = { MODE_DEFAULTS: MODE_DEFAULTS, haversineKm: haversineKm, defaultsForLane: defaultsForLane };
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  else { global.NST = global.NST || {}; global.NST.modeDefaults = mod; }
})(typeof window !== "undefined" ? window : globalThis);
