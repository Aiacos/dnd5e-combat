/**
 * §251: the real-time clock (world setting `realTimeClock`, off by default). The active GM advances world time out of
 * combat, one second per real second, in steps of a round (core/clock.mjs): stopped while paused and in combat (the core already
 * counts 6 s per round there), stood down in front of a module that already runs the clock (Simple Timekeeping, Simple Calendar,
 * Calendaria…). The engine only reads world time everywhere else; this is the only place where it advances it by itself.
 */
import { MODULE_ID } from "../constants.mjs";
import { clockHalt, clockTick, rivalClock } from "../core/clock.mjs";
import { route } from "./router.mjs";
import { isExecutor, log } from "./shared.mjs";

export const CLOCK_SETTING = "realTimeClock";
const TICK_MS = 1000;

let counted = null;
let halted = undefined;

const enabled = () => {
  try { return game.settings.get(MODULE_ID, CLOCK_SETTING) === true; } catch { return false; }
};

const rival = () => rivalClock(id => game.modules.get(id)?.active === true);

/** Why the engine's clock is not running (null: it is running) — for the API and the scenarios. */
export function clockState() {
  return clockHalt({ enabled: enabled(), executor: isExecutor(), rival: rival(), paused: game.paused === true,
    inCombat: game.combats?.some?.(c => c.started) === true });
}

async function tick() {
  const halt = clockState();
  if ( halt !== halted ) {
    if ( halt === "rival" ) log(`real-time clock: left to ${rival()}`);
    else if ( (halt === null) || (halted === null) ) log(`real-time clock: ${halt === null ? "running" : `stopped (${halt})`}`);
    halted = halt;
  }
  if ( halt !== null ) { counted = null; return; }
  const step = clockTick(counted, Date.now());
  counted = step.counted;
  if ( step.advance > 0 ) await game.time.advance(step.advance);
}

export function registerClock() {
  game.settings.register(MODULE_ID, CLOCK_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLOCK_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLOCK_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => { counted = null; }
  });
  route("ready", () => {
    setInterval(() => tick().catch(err => console.error(`${MODULE_ID} | real-time clock`, err)), TICK_MS);
  }, { label: "real-time clock: not started" });
}
