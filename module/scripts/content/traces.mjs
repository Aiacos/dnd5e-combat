/**
 * Items whose use leaves a trace on the caster (SPEC §16.9, key `trace` of core/content.mjs): an
 * effect that carries their declarations `via: "effect"`, for lack of an effect in the item's data.
 */

export const TRACES = Object.freeze([
  // Armor of Agathys (PHB, spells): Temporary Hit Points (healing activity) and a retaliation (damage activity), no effect.
  "armor-of-agathys"
]);

/**
 * Specified traces (§16.41, `trace: { activity, show, attack }`). Flame Blade (PHB 2024): "you cause a fiery blade to appear
 * in your free hand; it lasts for the spell's duration" (Concentration, 10 minutes); "as a Magic action, you
 * can make a melee spell attack with the blade" — "Summon Blade" activities (`OIU1htXAoSF0cU3U`, which
 * spends the slot) and the attack (`dnd5eactivity000`, no slot). dnd5e places no effect: nothing showed the
 * blade, nor removed it at the end of Concentration.
 */
export const TRACE_RULES = Object.freeze({
  "flame-blade": { activity: "OIU1htXAoSF0cU3U", show: true, attack: "dnd5eactivity000" },
  // Produce Flame (PHB 2024): "a flickering flame appears in your hand and remains there for the duration" (10 minutes, no
  // Concentration); "the spell ends if you cast it again" (the trace is replaced); "until the spell ends, you
  // can take a Magic action to hurl the flame" — "Cast" (`MModRd17Oi6hhztj`), "Hurl Flame"
  // (`tqKlIEdglRYdqHrp`).
  "produce-flame": { activity: "MModRd17Oi6hhztj", show: true, attack: "tqKlIEdglRYdqHrp" },
  // "Defensive Veil" (§16.46, PHB 2024: Concentration, 1 minute): the activity places no effect — the trace carries it.
  "blade-ward": { activity: "1wca3rjsdb0agWqk", show: true }
});
