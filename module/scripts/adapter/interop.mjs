/**
 * What other modules also automate (SPEC §16.11, §156): the rule belongs to the engine, which must work without them; an
 * animation module keeps only its images and sounds.
 *
 * BLFX (Boss Loot, "boss-loot-assets-premium" 3.5.2, scripts/macros/spell/customSpells2.js, `wardingBondCreateAE`): Warding
 * Bond places on the effect `flags["boss-loot-assets-premium"].blfxCustom` with `trigger: "applyDamage"`, and its hook
 * `dnd5e.applyDamage` (scripts/hooks.js:710, `_applyDamage`) then makes the caster take the bearer's damage
 * (`wardingBondApplyDamage`). The engine sharing it itself, this trigger is disarmed: its value changes, the rest of the mark
 * (persistent ray, removal) is kept. Nothing is patched: we write a flag on the effect, like BLFX itself.
 */

import { MODULE_ID } from "../constants.mjs";

const BLFX = "boss-loot-assets-premium";

/** The value the disarmed trigger takes: `_applyDamage` only keeps `"applyDamage"`. */
export const DISARMED_TRIGGER = `${MODULE_ID}:applyDamage`;

/**
 * Would another module also make the caster take the damage that this effect shares? Returns its name, or null.
 * @param {ActiveEffect} effect
 */
export function foreignDamageShare(effect) {
  if ( !effect ) return null;
  if ( game.modules.get(BLFX)?.active && (effect.flags?.[BLFX]?.blfxCustom?.trigger === "applyDamage") ) return "BLFX";
  return null;
}

/**
 * Disarms another module's damage sharing on this effect. Active GM.
 * @param {ActiveEffect} effect
 * @returns {Promise<string|null>}  The module disarmed, or null.
 */
export async function disarmForeignDamageShare(effect) {
  const owner = foreignDamageShare(effect);
  if ( owner !== "BLFX" ) return null;
  await effect.update({ [`flags.${BLFX}.blfxCustom.trigger`]: DISARMED_TRIGGER });
  return owner;
}

/**
 * §474: DDB Importer ("ddb-importer", src/effects/enhancers/DDBEnhancers.ts, `_preUpdateActorHooks`) hooks on load,
 * if its world settings `allow-arcane-ward-enhancer` / `allow-warding-bond-enhancer` (true by default, hidden) allow it, a
 * `preUpdateActor` that redoes the Arcane Ward of every Abjurer wizard (ClassFeatures/Wizard/ArcaneWard.ts, `applyDamage`): it
 * re-reads the HP update, already reduced by the engine's ward (adapter/absorb.mjs), and makes it absorb a second time by the
 * same pool, which the engine spends only after the write. What got past the ward never reached the wizard. Same for
 * the Warding Bond that DDB places itself (Spells/WardingBond.ts). The engine holding these rules, these two settings are
 * turned off; DDB re-reads them only on the next load. DDB declares its settings after the engine's `ready` (seen on the test
 * bench on 2026-11-19: `game.settings.get` still throws there): we wait for them to exist.
 */
const DDB = "ddb-importer";
const DDB_ENHANCERS = Object.freeze(["allow-arcane-ward-enhancer", "allow-warding-bond-enhancer"]);

/** The DDB Importer settings that duplicate an engine rule and are still active. */
export function foreignEnhancers() {
  if ( !game.modules.get(DDB)?.active ) return [];
  return DDB_ENHANCERS.filter(key => {
    try { return game.settings.get(DDB, key) === true; } catch { return false; }
  });
}

/**
 * Turns these settings off, once DDB has declared them (at most `waitMs`). Active GM.
 * @returns {Promise<string[]>}  The settings turned off.
 */
export async function disarmForeignEnhancers({ waitMs=30000, stepMs=500 }={}) {
  if ( !game.modules.get(DDB)?.active ) return [];
  const declared = () => DDB_ENHANCERS.every(key => game.settings.settings.has(`${DDB}.${key}`));
  for ( const stop = Date.now() + waitMs; !declared() && (Date.now() < stop); ) await new Promise(r => setTimeout(r, stepMs));
  const keys = foreignEnhancers();
  for ( const key of keys ) await game.settings.set(DDB, key, false);
  return keys;
}
