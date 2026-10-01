// Wires dynamics.mjs + controller.mjs into a runnable loop: physics
// integrates at a fixed, fine timestep for accuracy; the controller runs
// at its own (configurable, coarser) rate and holds its torque output
// constant between updates -- a zero-order hold, exactly like a real
// microcontroller's control loop sitting on top of continuous physics.
//
// Shared by the browser (main.mjs, driven by requestAnimationFrame) and
// the Node test suite, so the tests exercise the exact code path the
// simulator runs.

import { rk4Step, restState } from './dynamics.mjs';

export function createSimLoop(params, controller, physicsHz = 2000) {
  let state = restState();
  let desiredVelocity = 0;
  let desiredYawRate = 0;
  let lastCommand = { tauL: 0, tauR: 0 };
  const physicsDt = 1 / physicsHz;

  return {
    setCommand(velocity, yawRate) {
      desiredVelocity = velocity;
      desiredYawRate = yawRate;
    },
    setState(s) {
      state = s;
    },
    getState() {
      return state;
    },
    getLastCommand() {
      return lastCommand;
    },
    /** Advance by exactly one control period: one controller update (ZOH torque), then enough fine physics substeps to cover that period. Defaults to the controller's own configured rate (realism.controlLoopHz); pass an explicit controlHz to override it (e.g. to demonstrate what a slower loop does). */
    advance(controlHz = controller.getRealism().controlLoopHz) {
      const controlDt = 1 / controlHz;
      lastCommand = controller.update(state, desiredVelocity, desiredYawRate, controlDt, params.motor.maxTorque);
      const substeps = Math.max(1, Math.round(controlDt / physicsDt));
      for (let i = 0; i < substeps; i++) {
        state = rk4Step(state, lastCommand.tauL, lastCommand.tauR, params, physicsDt);
      }
    },
    /** Advance physics only, with an externally supplied constant torque (no controller) -- used for open-loop tests and "fell over" freefall. */
    advanceOpenLoop(tauL, tauR, dt) {
      const substeps = Math.max(1, Math.round(dt / physicsDt));
      const h = dt / substeps;
      for (let i = 0; i < substeps; i++) {
        state = rk4Step(state, tauL, tauR, params, h);
      }
    },
  };
}
