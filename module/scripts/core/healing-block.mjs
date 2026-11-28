/**
 * §334, §505: who an item with `blocksHealing: true` prevents from regaining Hit Points. Pure: no dependency on Foundry.
 *
 *  - an item that places effects (Chill Touch): the bearers of those effects — not its owner, who is only the caster;
 *  - a trait with no effect at all (Swarm: "The swarm can't regain Hit Points"): the creature that bears the trait. With no
 *    effect to place, the rule can only speak of it.
 */

/**
 * Does the trait block the healing of the creature that bears it?
 * @param {{rule?: true|string[]|null, effects?: number}} trait  `rule`: `blocksHealing` of the item; `effects`: its effects.
 * @returns {boolean}
 */
export function traitBlocksHealing({ rule = null, effects = 0 } = {}) {
  return (rule === true) && !(Number(effects) > 0);
}
