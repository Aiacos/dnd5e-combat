/** The effects placed by an item, completed according to its content (SPEC §16.38, adapter/effects.mjs). */

import { setRestExpiry, setTextExpiry } from "../adapter/effects.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const EXPIRY_LABEL = {
  targetStart: "at the start of their next turn", targetEnd: "at the end of their next turn",
  sourceStart: "at the start of the source's next turn", sourceEnd: "at the end of the source's next turn"
};

/**
 * §146: an effect that is born already expired. dnd5e applies an activity's effect from its source — and, when the sheet's item has
 * lost it, from the compendium (`compendiumSource`), with the start date that stayed there (`start.time`: 72 s for the pre-made
 * Barbarian's Rage); Foundry keeps a supplied date (ActiveEffect#_preCreate: "Prefer user-defined duration data"). A 10-minute Rage
 * "started" at 72 s is expired as soon as it is created: on the next turn, no more +2 or Resistances. On an actor, an
 * effect whose duration in seconds has already elapsed at its creation restarts from now. An effect copied while still running
 * (form, transfer) keeps its start.
 */
function freshStart(effect) {
  if ( !(effect.parent instanceof Actor) ) return;
  const start = Number(effect._source.start?.time);
  const d = effect._source.duration ?? {};
  // Time units only: a duration in rounds or turns cannot be compared with the world clock. Do not read
  // `duration.seconds`: in V14 it is a deprecated core shortcut (compatibility warning), null outside the "seconds" unit.
  const seconds = (d.units === "seconds") ? Number(d.value) : (d.units === "minutes") ? Number(d.value) * 60
    : (d.units === "hours") ? Number(d.value) * 3600 : (d.units === "days") ? Number(d.value) * 86400 : NaN;
  if ( !Number.isFinite(start) || !(seconds > 0) || (start + seconds > game.time.worldTime) ) return;
  effect.updateSource({ start: CONFIG.ActiveEffect.documentClass.getEffectStart?.() ?? { time: game.time.worldTime } });
  log(`${effect.parent.name}: ${effect.name} was created already expired (start ${start} s) — starts now`);
}

export function registerEffects() {
  route("preCreateActiveEffect", freshStart, { label: "effect: stale start not reset" });
  route("preCreateActiveEffect", effect => {
    const rest = setRestExpiry(effect);
    if ( rest ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends on a ${rest === "longRest" ? "Long Rest" : "Short Rest"}`);
    // M4 (§18.7): the duration written in the text ("until the end of its next turn"), for an effect placed without a duration.
    const turn = rest ? null : setTextExpiry(effect);
    if ( turn ) log(`${effect.parent?.name ?? "?"}: ${effect.name} ends ${EXPIRY_LABEL[turn]}`);
  }, { label: "effect: end on rest or next turn not applied" });
}
