/**
 * Pools that absorb damage (SPEC §16.11, `absorb` key of core/content.mjs), by dnd5e identifier.
 * Identifiers verified in the PHB 2.2.0 extraction (work/phb-en).
 */

export const ABSORBS = Object.freeze({
  // Arcane Ward (Abjurer wizard, PHB classes, phbwzdArcaneWard): HP = the item's uses; created by
  // the activity Hha69hPMTYWhDE4A (once per Long Rest); an abjuration spell cast with a slot restores to it twice
  // the level of that slot.
  "arcane-ward": { activeAfter: "Hha69hPMTYWhDE4A", recharge: { school: "abj", perLevel: 2 } }
});
