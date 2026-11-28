/**
 * Light and darkness of spells (SPEC §16.31, `light` key of core/content.mjs). Texts of PHB 2.2.0 (FR) and of dnd5e 6:
 *  - Darkness: "magical Darkness spreads […] a 4.50 m Sphere"; "Darkvision can't see through it, and nonmagical light can't
 *    illuminate it" — utility activity with a 15 ft Sphere, nothing else;
 *  - Daylight: "a Sphere of Bright Light with an 18 m radius, and Dim Light for 18 m more"; "if any part of the
 *    area overlaps Darkness created by a spell of level 3 or lower, that spell is dispelled";
 *  - Starry Wisp: the target glows with Dim Light for 3 m ("Illuminated" effect, no change);
 *  - Faerie Fire: "affected objects and creatures shed Dim Light in a 3 m radius" ("Haloed" effect);
 *  - Light: the touched object "sheds Bright Light for 6 m and Dim Light for 6 m more";
 *    "the spell ends if you cast it again" — summoning activity of an object "Light" (TP, light 20/40 on the token);
 *  - Continual Flame: same setup, no end on recast.
 * `carried` (§16.35): "You touch an object" — when cast, the object is placed on the ground or held by the caster, as chosen.
 */

/**
 * "Can't benefit from the Invisible condition" (§16.36, `revealsInvisible`) — Starry Wisp: until the end of the caster's next
 * turn, the target glows and loses the benefit of Invisible; Faerie Fire: "for the duration of the spell,
 * the affected creatures […] can't benefit from the Invisible condition".
 */
export const REVEALS_INVISIBLE = Object.freeze(["starry-wisp", "faerie-fire"]);

export const LIGHTS = Object.freeze({
  // §287: Darkness — "if any part of the area overlaps Bright or Dim Light created by a spell of level 2 or lower, that
  // spell is dispelled".
  "darkness": { on: "area", darkness: true, dispels: 2 },
  // §158: Hunger of Hadar — "the Sphere is filled with magical Darkness" (whoever is entirely in it sees nothing: vision
  // judges that).
  "hunger-of-hadar": { on: "area", darkness: true },
  "daylight": { on: "area", bright: 60, dim: 120, units: "ft", dispels: 3 },
  "starry-wisp": { on: "effect", dim: 10, units: "ft" },
  "faerie-fire": { on: "effect", dim: 10, units: "ft" },
  // §157: Branding Smite — "the target sheds Bright Light in a 1.50 m radius".
  "shining-smite": { on: "effect", bright: 5, dim: 5, units: "ft" },
  // Flame Blade (§16.41): "the blade sheds Bright Light in a 3 m radius and Dim Light for 3 m more" — on the
  // trace the engine places on the caster.
  "flame-blade": { on: "effect", bright: 10, dim: 20, units: "ft" },
  // "Flames" (§16.42): "Bright Light in a 6 m radius and Dim Light for 6 m more".
  "produce-flame": { on: "effect", bright: 20, dim: 40, units: "ft" },
  // §266: Fire Shield — "the flames shed Bright Light in a 3 m radius and Dim Light for 3 m more".
  "fire-shield": { on: "effect", bright: 10, dim: 20, units: "ft" },
  // §170: Wall of Fire — the text says nothing of the light; table choice (2026-10-12): that of a large flame, on each side.
  "wall-of-fire": { on: "wall", bright: 10, dim: 20, units: "ft", color: "#ff8a2b", animation: { type: "torch", speed: 3, intensity: 3 } },
  // §173: Prismatic Wall — "Bright Light in a 30 m radius and Dim Light for 30 m more".
  "prismatic-wall": { on: "wall", bright: 100, dim: 200, units: "ft" },
  // §287: Sunbeam — "a brilliant point of radiance shines above you: Bright Light in a 9 m radius and Dim Light for 9 m more.
  // This light is sunlight" — at the "Initial Cast" (o3kffaumfNGjVvg9), not at the new ray.
  "sunbeam": { on: "caster", activity: "o3kffaumfNGjVvg9", bright: 30, dim: 60, units: "ft", color: "#fff1c4" },
  "light": { on: "summon", carried: true, single: true },
  "continual-flame": { on: "summon", carried: true }
});
