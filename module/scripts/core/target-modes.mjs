/**
 * §249: Advantage or Disadvantage given **per target** by whoever uses the activity (a neighbor: the GM judging the players'
 * roleplay in front of a trap). It travels in the use message, `flags.dnd5e-combat.targetModes` = `[{ token: <uuid du
 * token>, mode: "advantage" | "disadvantage" }]`, and applies to the saving throw requested of that target; for an attack, it
 * is **inverted** on the attack roll against it (a favored target is harder to hit). A list and not an object indexed by
 * UUID: the core expands the dotted keys of a flag (`Scene.x.Token.y` became a nested object, seen in play on 2026-10-27).
 */

const MODES = new Set(["advantage", "disadvantage"]);

/** The given modes, by token UUID, unknown values removed; null if there are none. */
export function normalizeTargetModes(raw) {
  if ( !Array.isArray(raw) ) return null;
  const out = Object.fromEntries(raw.filter(e => e?.token && MODES.has(e.mode)).map(e => [e.token, e.mode]));
  return Object.keys(out).length ? out : null;
}

/** The mode of this target's saving throw: `{ advantage, disadvantage }`. */
export function saveModeFor(modes, uuid) {
  const mode = modes?.[uuid];
  return { advantage: mode === "advantage", disadvantage: mode === "disadvantage" };
}

/**
 * The attack roll against these targets (one attack, one roll for all): each target's inverted mode. Targets with no given mode
 * count as "normal". If they do not agree, nothing is set (`agreed: false`): the caller must make one attack per group.
 * @param {(string|null)[]} perTarget  The given mode of each target.
 * @returns {{ advantage: boolean, disadvantage: boolean, agreed: boolean }}
 */
export function attackModeAgainst(perTarget) {
  const flipped = perTarget.map(m => (m === "advantage") ? -1 : (m === "disadvantage") ? 1 : 0);
  if ( !flipped.length ) return { advantage: false, disadvantage: false, agreed: true };
  const agreed = flipped.every(v => v === flipped[0]);
  if ( !agreed ) return { advantage: false, disadvantage: false, agreed: false };
  return { advantage: flipped[0] === 1, disadvantage: flipped[0] === -1, agreed: true };
}
