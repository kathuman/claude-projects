// The parameters panel: every solver parameter with its range, default and a tooltip that says what it changes.
// Labels and tips are English here and translated through T() when the panel is built.

import { DEFAULT_PARAMS, type SolverParams } from "../core/solver";
import { T, fx, int } from "./i18n";

export interface UiParams extends SolverParams { workingRes: number }

export const DEFAULT_UI: UiParams = { ...DEFAULT_PARAMS, workingRes: 700 };

interface Def {
  key: keyof UiParams;
  label: string;
  tip: string;
  min: number;
  max: number | ((p: UiParams) => number);
  step: number;
  unit?: string;
  digits: number;
}

// The English strings are written out in full in each T() call so the language test can find them.
function defs(): Def[] {
  return [
    { key: "boardMm", label: T("Board diameter"), tip: T("Diameter of the nail circle on the real board. A bigger board shows finer detail and uses more thread."), min: 200, max: 1500, step: 10, unit: "mm", digits: 0 },
    { key: "nails", label: T("Nails"), tip: T("How many nails around the circle. More nails give finer detail but take longer to wind."), min: 100, max: 400, step: 1, digits: 0 },
    { key: "threadMm", label: T("Thread diameter"), tip: T("Thicker thread darkens faster: each line covers more of the board."), min: 0.1, max: 1, step: 0.01, unit: "mm", digits: 2 },
    { key: "maxLines", label: T("Most lines"), tip: T("The most lines to wind. The solver stops earlier if no line improves the picture any more."), min: 500, max: 8000, step: 100, digits: 0 },
    { key: "minSkip", label: T("Minimum nail skip"), tip: T("No line may join nails closer than this. Short lines near the rim only add clutter."), min: 1, max: (p) => Math.floor(p.nails / 2), step: 1, digits: 0 },
    { key: "maxReuse", label: T("Uses per line"), tip: T("How many times the thread may join the same two nails."), min: 1, max: 5, step: 1, digits: 0 },
    { key: "startNail", label: T("Start nail"), tip: T("The nail where the thread is tied on. Nail 0 is at the top; numbers run clockwise."), min: 0, max: (p) => p.nails - 1, step: 1, digits: 0 },
    { key: "workingRes", label: T("Working resolution"), tip: T("Size of the picture the solver compares against, in pixels. Higher is more precise but slower and uses more memory."), min: 400, max: 1200, step: 50, unit: "px", digits: 0 },
    { key: "darkness", label: T("Darkness factor"), tip: T("How dark one pass of thread counts. Above 1 the solver reaches the same darkness with fewer lines; below 1 it uses more."), min: 0.3, max: 2, step: 0.05, digits: 2 },
    { key: "beta", label: T("Length penalty β"), tip: T("Above 0, long lines count for less: a line's score is divided by its length to this power. It brings out detail near the edge."), min: 0, max: 1, step: 0.05, digits: 2 },
    { key: "epsilon", label: T("Stop threshold ε"), tip: T("Stop once the best line improves the picture by less than this for 20 lines in a row. 0 stops when lines stop helping."), min: 0, max: 1, step: 0.01, digits: 2 }
  ];
}

const maxOf = (d: Def, p: UiParams) => (typeof d.max === "function" ? d.max(p) : d.max);

function shown(d: Def, v: number): string {
  const n = d.digits ? fx(v, d.digits) : int(v);
  return d.unit ? `${n} ${d.unit}` : n;
}

/** Build the panel into `host`; calls onChange with the new parameters after every change. */
export function buildParams(host: HTMLElement, initial: UiParams, onChange: (p: UiParams) => void): { get(): UiParams; set(p: UiParams): void; disable(on: boolean): void } {
  let p: UiParams = { ...initial };
  const D = defs();
  host.innerHTML = D.map((d, i) =>
    `<div class="ctl" data-k="${d.key}">
       <div class="row"><label for="p-${d.key}">${d.label}</label>
         <button type="button" class="tipbtn" aria-label="${T("What does this do?")}" aria-expanded="false" aria-controls="tip-${i}" title="${d.tip}">?</button>
         <output id="o-${d.key}"></output></div>
       <input type="range" id="p-${d.key}" min="${d.min}" step="${d.step}" aria-describedby="tip-${i}" />
       <p class="tip" id="tip-${i}" hidden>${d.tip}</p>
     </div>`).join("");
  const sync = () => {
    for (const d of D) {
      const inp = host.querySelector<HTMLInputElement>(`#p-${d.key}`)!, mx = maxOf(d, p);
      inp.max = String(mx);
      const v = Math.min(mx, Math.max(d.min, p[d.key] as number));
      (p[d.key] as number) = v;
      inp.value = String(v);
      host.querySelector<HTMLOutputElement>(`#o-${d.key}`)!.textContent = shown(d, v);
    }
  };
  for (const d of D) {
    const inp = host.querySelector<HTMLInputElement>(`#p-${d.key}`)!;
    inp.addEventListener("input", () => { (p[d.key] as number) = Number(inp.value); sync(); onChange({ ...p }); });
  }
  host.querySelectorAll<HTMLButtonElement>(".tipbtn").forEach((b) => b.addEventListener("click", () => {
    const tip = document.getElementById(b.getAttribute("aria-controls")!)!, open = tip.hidden;
    tip.hidden = !open; b.setAttribute("aria-expanded", String(open));
  }));
  sync();
  return {
    get: () => ({ ...p }),
    set: (q) => { p = { ...q }; sync(); },
    disable: (on) => host.querySelectorAll("input").forEach((i) => { (i as HTMLInputElement).disabled = on; })
  };
}
