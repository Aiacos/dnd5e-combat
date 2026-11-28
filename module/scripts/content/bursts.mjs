/**
 * Bursts (SPEC §16.19, `burst` key of core/content.mjs): once the attack is decided — hit **or missed** —, the engine
 * plays a sibling activity of the item on the target and on each creature within `radius` of it. Text verified in dnd5e 6
 * (spells24) and the PHB 2.2.0:
 *  - Ice Knife: whether the attack hits or not, the shard bursts; the target and its neighbors within 1.50 m make a
 *    Dexterity save against 2d6 cold damage — "Shard Explosion" activity (`dnd5eactivity100`).
 *  - Heat Metal (§16.21): "if a creature holding or wearing the object takes the damage, it must succeed on a Constitution
 *    saving throw or drop the object" — after "Cast and Heat" or "Reheat", on the target alone
 *    (`radius: 0`), if it took damage.
 */

export const BURSTS = Object.freeze({
  "ice-knife": { activity: "dnd5eactivity100", radius: 5, units: "ft" },
  "heat-metal": { activity: "dnd5eactivity000", radius: 0, units: "ft", from: ["2jWlvr2titPfBMEm", "YPEmwJHX7g68307N"] }
});

/**
 * Spells that are recast while they last (§16.21, `recast` key): Call Lightning — "while the spell lasts, you
 * can take a Magic action to call down lightning again"; §120: Vampiric Touch — "make the attack again on each
 * of your turns with a Magic action". Witch Bolt and Heat Metal do not need it:
 * dnd5e 6 gives them a Bonus Action activity, with no slot.
 */
// C12-a: Alter Self — "with a Magic action, you can change your option" with no new slot or new Concentration.
export const RECASTS = Object.freeze(["call-lightning", "vampiric-touch", "alter-self"]);

/** "Each creature within 1.50 m of the point" (§16.21, `bolt`): Call Lightning, whose cloud dnd5e has placed (60 ft). */
export const BOLTS = Object.freeze({ "call-lightning": { radius: 5, units: "ft" } });

/** Areas that heavily obscure (§16.24, `obscures`): Fog Cloud — "the sphere is an area of zero visibility". */
// §158: Cloudkill, Incendiary Cloud, Stinking Cloud, Sleet Storm ("heavily obscured"); Wall of Fire ("opaque").
export const OBSCURES = Object.freeze(["fog-cloud", "cloudkill", "incendiary-cloud", "stinking-cloud", "sleet-storm"]);

/** Maximum healing (§16.24, `healMax`): Beacon of Hope — "whenever a target regains HP, it regains the maximum". */
export const HEAL_MAX = Object.freeze(["beacon-of-hope"]);

/** Duplicates (§16.25, `duplicates`): Mirror Image — the spell's three "Duplicate" effects are the duplicates. */
export const DUPLICATES = Object.freeze(["mirror-image"]);

/**
 * Advantage on saves against a condition (§16.25, `saveAdvantage`): Fey Ancestry — "to avoid or end
 * Charmed". `"magic"`: against spells and magical effects — Magic Resistance, 76 MM creatures (§18.9).
 */
export const SAVE_ADVANTAGES = Object.freeze({ "fey-ancestry": ["charmed"], "magic-resistance": ["magic"],
  // Protection from Poison: "Advantage on saving throws to avoid or end the Poisoned condition" — the bearer
  // of the spell's effect, not the caster (adapter/saves.mjs, saveAdvantageAgainst).
  "protection-from-poison": ["poisoned"],
  // §302: "Averted Fascination" (Gloom Stalker 11) — "Advantage on saves to avoid or end Charmed or Frightened".
  "beguiling-twist": ["charmed", "frightened"] });

/**
 * Fallen enemy (§16.25, `onFell`): Dark One's Blessing — "when you reduce an enemy to 0 HP […], or if someone
 * else reduces an enemy to 0 HP within 3 m of you"; dnd5e 6's "heal" activity (Temporary Hit Points).
 */
/**
 * Bonus Action attack after a hit (§16.26, `bonusAttack`): Great Weapon Master, "Hew" — a melee Critical Hit, or a creature
 * reduced to 0 HP by the weapon, immediately opens one more attack with the same weapon, as a Bonus Action
 * (PHB 2.2.0, feats).
 */
export const BONUS_ATTACKS = Object.freeze({ "great-weapon-master": { after: ["critical", "felled"], melee: true } });

/**
 * Reactive spell (§16.26, `reactiveSpell`): War Caster — in place of the Opportunity Attack a creature provokes by
 * leaving reach, the Reaction can be used to cast a spell at it, provided it is cast in one action and targets
 * only it (PHB 2.2.0).
 */
export const REACTIVE_SPELLS = Object.freeze(["war-caster"]);

/**
 * Somatic component without a free hand (§409, issue #44, `freeSomatic`): War Caster — somatic components can be performed
 * even with weapons or a shield in one or both hands (PHB 2024).
 */
export const FREE_SOMATIC = Object.freeze(["war-caster"]);

/**
 * Several projectiles per casting (§16.27, `projectiles`); dnd5e 6 makes only one, the number is only in the
 * description (spells24: "[[2 + @item.level]]", "[[@item.level + 1]]{Total Rays}", "[[(floor((@details.level+1)/6)+1)]]").
 */
export const PROJECTILES = Object.freeze({
  "magic-missile": { count: "2 + @item.level", attack: false },
  "scorching-ray": { count: "@item.level + 1", attack: true },
  "eldritch-blast": { count: "floor((@details.level + 1) / 6) + 1", attack: true },
  // C12-j: Steel Wind Strike — "up to five creatures: a melee spell attack roll against each". §402:
  // "you can then teleport to an unoccupied space you can see within 1.50 m of one of the targets" (`teleportNear`).
  // §403: "up to five creatures… against each" — at most one attack per creature (`onePerTarget`), fewer than five possible.
  "steel-wind-strike": { count: "5", attack: true, onePerTarget: true, teleportNear: { distance: 5, units: "ft" } }
});

/**
 * Bounce (§16.27, `leap`): Chromatic Orb — a double (or better) among the d8 of damage makes the orb leap to another
 * target chosen within 9 m of the first, with a new attack roll and new damage; the number of leaps is bounded by
 * the slot's level, and each creature is targeted only once per casting.
 */
export const LEAPS = Object.freeze({ "chromatic-orb": { radius: 30, units: "ft", max: "@item.level" } });

export const ON_FELL = Object.freeze({ "dark-ones-blessing": { activity: "p3YSnjGDlLIbiLpC", radius: 10, units: "ft" } });

/** Activity offered at the start of the caster's turn (§16.21, `atTurnStart`): Aura of Vitality, "Start of Turn Heal". */
export const TURN_STARTS = Object.freeze({
  "aura-of-vitality": { activity: "0vYjMbBcXaMfGWR2" },
  // §19: Phantasmal Force — "on each of your turns, this phantasm can deal 2d8 psychic damage to the target",
  // the "Phantasmal Damage" activity (QCUpctimdMH6E6F8) of the PHB 2.2.0.
  "phantasmal-force": { activity: "QCUpctimdMH6E6F8" }
});
