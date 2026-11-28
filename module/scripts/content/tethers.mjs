/**
 * Tethers (SPEC §16.43, keys `tether` and `ranges`). Witch Bolt (PHB 2024, range 18 m, Concentration 1 minute): a lightning arc
 * links the caster to the target; on later turns, a Bonus Action deals 1d12 lightning to it without a roll, whether the first
 * attack hit or not; the tether breaks if the target leaves range or is behind Total Cover. dnd5e 6 (PHB 2.2.0):
 * the attack (`dnd5eactivity000`, "self" range in the data), the "Continuing Lightning" effect placed on a hit
 * only, and "Bonus Action Damage" (`ffuqn0xdclG9YAQt`, 1d12, no target).
 */

export const TETHERS = Object.freeze({
  "witch-bolt": {
    ranges: { "dnd5eactivity000": { value: 60, units: "ft" } },
    tether: { attack: "dnd5eactivity000", activity: "ffuqn0xdclG9YAQt", range: { value: 60, units: "ft" } },
    atTurnStart: { activity: "ffuqn0xdclG9YAQt" }
  }
});
