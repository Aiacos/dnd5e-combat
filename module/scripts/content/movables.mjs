/**
 * Movable areas (SPEC §16.14, `movable` key of core/content.mjs): recasting the spell while its area is there moves it.
 * The cost is the activation of the spell's activity (Moonbeam: action → the Magic action of the 2024 rules).
 * Text verified in packs/_source/spells24 of dnd5e 6.0.3 and in the extraction of the PHB 2.2.0.
 */

export const MOVABLES = Object.freeze({
  // "You can take a Magic action on your later turns to move the Cylinder up to 18 m."
  "moonbeam": { distance: 60, units: "ft" },
  // §158: Cloud of Daggers — "as a Magic action on your later turns, you can teleport the Cube up to 9 m".
  "cloud-of-daggers": { distance: 30, units: "ft" },
  // §164: Summon Celestial — "when you move on your turn, you can also move the Cylinder up to 9 m" (SRD 5.2; the item's text
  // says so too): no Magic action, unlike the two spells above.
  "conjure-celestial": { distance: 30, units: "ft", cost: "none" }
});
