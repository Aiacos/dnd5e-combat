/**
 * Self-teleports on use (SPEC §16.10, key `teleport` of core/content.mjs): the distance that the rule text
 * gives and that the item's data do not carry. The system's SRD spells have a native "teleport" activity
 * (Misty Step, Dimension Door of spells24); those of the PHB premium module, which the table uses,
 * do not (utility, or damage for Dimension Door). The engine takes the native activity when it exists.
 *
 * Identifiers checked in the PHB 2.2.0 extraction (translation project, work/phb-en).
 */

export const TELEPORTS = Object.freeze({
  // "You teleport up to 9 m to an unoccupied space you can see" (Bonus Action).
  "misty-step": { distance: 30, units: "ft" },
  // "…up to 150 m"; §264: "a willing creature… within 1.50 m of you… to a space within 1.50 m of your destination".
  // C12-b: "a place you can see, or one you describe" — behind a wall, out of sight: allowed (`unseen`).
  "dimension-door": { distance: 500, units: "ft", passengers: { count: 1, within: 5, units: "ft" }, unseen: true },
  // Goliath, Cloud Giant's Jaunt: "up to 9 m to an unoccupied space you can see".
  "clouds-jaunt": { distance: 30, units: "ft" },
  // Boon of Dimensional Travel, Blinking Steps: "…after the Attack or Magic action, up to 9 m".
  "boon-of-dimensional-travel": { distance: 30, units: "ft" },
  // C12-d: Travel along the Tree (World Tree 10) — "as a Bonus Action, teleport up to 18 m to an unoccupied space you
  // can see" (the short activity; the long one, 45 m with six passengers, is left to the player).
  "travel-along-the-tree": { distance: 60, units: "ft", activity: "4e13OzT2UzbhQICL" }
});
