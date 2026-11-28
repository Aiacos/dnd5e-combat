/**
 * Summoned creatures that join combat (SPEC §16.13, key `summon` of core/content.mjs). Attachment to
 * Concentration holds for any summon from a Concentration spell, without declaring anything.
 * Text checked in the PHB 2.2.0 extraction (work/phb-en): the summon takes the caster's Initiative and acts right
 * after it (`after`), or rolls its own Initiative and plays its own turn (`own`).
 *
 * Piloted objects (§16.15, B19): they line up right after the caster, their turn is skipped, and the caster commands them
 * during its own. 2024 texts (dnd5e 6 spells24, PHB 2.2.0):
 *  - Spiritual Weapon: "you can immediately make an attack"; "as a Bonus Action on your later turns,
 *    you can move the force 6 m and repeat the attack";
 *  - Flaming Sphere: "as a Bonus Action, you can move the sphere 9 m"; "any creature that ends its
 *    turn within 1.50 m of the sphere makes a Dexterity saving throw" (`pulse`, "Flames" item of the sphere);
 *  - Bigby's Hand (`bigbys-hand` in the PHB, `arcane-hand` in the SRD): "when you cast the spell and as a Bonus Action
 *    on your later turns, you can move the hand 18 m and then" choose an effect; "the hand doesn't occupy
 *    its space"; "if it drops to 0 Hit Points, the spell ends".
 *  - Arcane Eye: "as a Bonus Action, you can move the eye 9 m in any direction"; invisible,
 *    invulnerable;
 *  - Dancing Lights: the Bonus Action moves them up to 18 m, within range; they stay within 6 m of one
 *    another and go out when out of range.
 *  Neither of the two acts: they do not join combat (`none`) and hinder no one.
 *  - Invoke Duplicity (Trickery Domain, PHB 2.2.0): an illusory double of the cleric, without substance, that does not block
 *    its cell; it disappears if the cleric is Incapacitated; the cleric can cast spells from the double's cell; a
 *    Bonus Action moves the double 9 m to a free, visible cell, at most 36 m from the cleric. No Concentration.
 * `endsSpell`: at the user's request (2026-09-25), removing the object ends the spell — for these three only,
 * not for the summonings.
 */

const after = { initiative: "after" };
// §259: "it disappears when it drops to 0 Hit Points or when the spell ends" (the PHB 2024 summoning spells).
const vanishing = { ...after, vanishesAtZero: true };
const piloted = (distance, onCast, more={}) => ({
  initiative: "after", endsSpell: true,
  pilot: { cost: "bonus", distance, units: "ft", ...(onCast ? { onCast } : {}), ...(more.pilot ?? {}) },
  ...(more.summon ?? {})
});
const hand = piloted(60, "command", { pilot: { occupies: false }, summon: { endsAtZero: true } });

export const SUMMONS = Object.freeze({
  "summon-aberration": vanishing, "summon-beast": vanishing, "summon-celestial": vanishing, "summon-construct": vanishing,
  "summon-dragon": vanishing, "summon-elemental": vanishing, "summon-fey": vanishing, "summon-fiend": vanishing, "summon-undead": vanishing,
  // §390 (issue #38, user's decision): Animate Objects with no object to target; the size (Huge, Large, Medium, Small, Tiny —
  // only one per casting, simplification) and the number of your choice, up to the `count` of its profile
  // ("floor(@attributes.spell.mod / 3)" for Huge…).
  "animate-objects": { ...after, chooseCount: true }, "giant-insect": vanishing,
  // §385 (issue #38, user's decision): Create Undead with no body to target; the caster chooses how many ghouls
  // ("up to three", more above), or ghasts / wights / mummies depending on the level. They play on their own Initiative.
  "create-undead": { initiative: "own", chooseCount: true },
  // §387 (issue #38, user's request): Animate Dead likewise — with no bones or corpse to target, Skeleton or Zombie, and
  // how many: the data only say so in the spell's target ("@item.level * 2 - 5": 1 at level 3, +2 per level). Its
  // data place nothing (`summon.prompt` false): PLACES_SUMMONS. A targeted corpse is still raised in place by a neighbor (§118).
  "animate-dead": { initiative: "own", chooseCount: "@item.level * 2 - 5" },
  // §259: "if it drops to 0 Hit Points, the spell ends" — without Concentration, the servant disappears.
  "unseen-servant": { initiative: "none", vanishesAtZero: true },
  // §107: `familiar` — basic actions except the attack, vision, pocket dimension. The Pact of the Chain (Warlock, PHB
  // 2024) carries its own "Find Familiar" summoning activities: the summon originates from the pact item.
  "find-familiar": { initiative: "own", familiar: true },
  "pact-of-the-chain": { initiative: "own", familiar: true },
  // Wild Companion (Druid, PHB 2024, §16.39): "you cast Find Familiar without material components"; "the
  // familiar lasts a number of hours equal to half your Druid level" — no other end (dnd5e: `inst`).
  // §305: 2024 rule — "the familiar lasts until the end of your next Long Rest" (the duration in hours was the 2014 one).
  "wild-companion": { initiative: "own", familiar: true, endsOnLongRest: true },
  // §305: "Chain Master's Engagement" — its familiar summoning activities: a familiar like the Pact's.
  "investment-of-the-chain-master": { initiative: "own", familiar: true },
  // §305: Phantasmal Creatures (Illusionist 6) — the summon cast by the feature follows the spell's rule (after the caster,
  // disappears at 0 HP).
  "phantasmal-creatures": vanishing,
  // §305: Primal Companion (Beast Master 3) and "Reanimated Companion" (Ravenloft) — "acts on your turn, right after you"; a
  // new summoning replaces the old one; "if… you die, it disappears". C12-c: "the only action it takes is Dodge, unless
  // you command it as a Bonus Action" — the "Command" activity (`commanded`). (Sacrificing an attack to command it:
  // up to the player.)
  "primal-companion": { initiative: "after", replaces: true, vanishesWithCaster: true, commanded: { activity: "Jtr7GXnCHb85xHg8" } },
  "reanimated-companion": { initiative: "after", replaces: true, vanishesWithCaster: true },
  "spiritual-weapon": piloted(20, "use"),
  // §403: Grasping Vine — "make a melee spell attack against a creature within 9 m of the vine… As a Bonus Action on your later
  // turns, you can repeat the attack": the vine, placed (`placesSummons`), does not move (command of 0 m); its attack
  // goes off at casting (`onCast: "use"`), then as a Bonus Action; it occupies no space. The pull and the Grappled condition: the
  // "Vine Attack" item (content/triggers.mjs).
  "grasping-vine": piloted(0, "use", { pilot: { occupies: false } }),
  // §402: "if you roll it over a creature, that creature makes the save" — approximated like the pack: the sphere that comes within
  // 1.50 m of a creature while being moved (`moves`), in addition to the end of turn (once per turn and per creature).
  // §403: "and the sphere stops moving this turn" (`stopsOnContact`).
  "flaming-sphere": piloted(30, null, { summon: { pulse: { item: "flames", radius: 5, units: "ft", on: ["turnEnd", "moves"], stopsOnContact: true } } }),
  "bigbys-hand": hand,
  "arcane-hand": hand,
  "invoke-duplicity": {
    initiative: "none", mimic: true, endsIfIncapacitated: true, castFrom: true,
    pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false, tether: { distance: 120, units: "ft" } }
  },
  // Conjure Animals (PHB 2.2.0): a pack of Large spirits, without substance, that the caster can move 9 m
  // when moving on its turn; as soon as it comes within 3 m of a visible creature, or such a creature enters within 3 m of it
  // or ends its turn there, that creature may have to make a Dexterity save, at most once per turn (§16.22).
  // §368: "a creature that you can see" — a creature that the caster cannot see (Invisible…) is spared.
  "conjure-animals": {
    initiative: "none", endsSpell: true,
    pilot: { cost: "free", distance: 30, units: "ft", occupies: false },
    pulse: { item: "pack-damage", radius: 10, units: "ft", on: ["turnEnd", "enter", "moves"], affects: "enemy", seenBy: "caster" }
  },
  // §159 (spell survey, batch 3). Find Steed: "shares your Initiative and acts right after you". Mordenkainen's Sword:
  // "attacks when it appears, then as a Bonus Action, moves 9 m and attacks" ("Move and Attack"). Summon Fey:
  // the spirit attacks when it appears, then as a Bonus Action "teleports 9 m and attacks" (the pilot moves it: the
  // teleportation is approximated by a move, without Opportunity Attack). Guardian of Faith: "an enemy that comes within 3 m
  // of the guardian for the first time on a turn or starts its turn there" makes the save of "Guarded Area" (§259: it disappears
  // once it has dealt 60 damage in total, `vanishesAfterDamage`). Mordenkainen's Faithful Hound: "at the start of your turn,
  // the hound tries to bite an enemy within 1.50 m of it".
  // §230: "If you already have a steed from this spell, it is replaced by the new one"; the flying mount ("Fly 60 ft. (requires
  // level 4+ spell)", Foundry note: "Summon Flying Steed" activity from a level 4 spell slot) — the free casting
  // of Faithful Steed (Paladin level 5, at spell level 2) does not give it.
  // §430: `minLevels` only applies to data from before SRD 6.1 (dnd5e 6.0.x, PHB premium module, existing sheets). In
  // the dnd5e 6.1.0 SRD, the "Summon Flying Steed" activity no longer exists: the only "Summon Steed" activity (`dnd5eactivity000`)
  // carries the "Flying Steed" effect (`phbeffFlyingStee`, Fly 60 ft) with `level.min: 4`, and dnd5e only applies it to the
  // steed from a level 4 spell (data/activity/base-activity.mjs `applicableEffects`, by `relevantLevel`;
  // documents/activity/summon.mjs, "Add applied effects"). The rule has nothing to do there: no entry for `dnd5eactivity000`,
  // so no gate, no warning.
  // §259: "the mount disappears if it drops to 0 Hit Points".
  // §305: "the steed disappears… if you die".
  "find-steed": { ...vanishing, replaces: true, vanishesWithCaster: true, minLevels: { o4YsONnsS8rOOEaS: 4 } },
  // §164: Summon Elemental — "when a creature enters the spirit's space or starts its turn within 1.50 m of it", the
  // save of the element (8d8, Restrained); one item per element (air, earth, fire, water). The spirit does not act. ("Only one
  // creature Restrained at a time": up to the GM.)
  "conjure-elemental": { initiative: "none", pulse: { item: ["air-element", "earth-element", "fire-element", "water-element"], radius: 5, units: "ft", on: ["enter", "turnStart"], affects: "enemy" } },
  "mordenkainens-sword": piloted(30, "use"),
  "conjure-fey": piloted(30, "use"),
  // §402: Phantom Steed — "if it takes damage, it disappears" (the spell continues, like a summon that disappears).
  "phantom-steed": { initiative: "none", vanishesWhenHurt: true },
  "guardian-of-faith": { initiative: "none", vanishesAfterDamage: 60, pulse: { item: "guarded-area", radius: 10, units: "ft", on: ["enter", "turnStart"], affects: "enemy" } },
  "mordenkainens-faithful-hound": { initiative: "none", pulse: { item: "bite", radius: 5, units: "ft", on: ["casterTurnStart"], affects: "enemy" } },
  "arcane-eye": { initiative: "none", endsSpell: true, pilot: { cost: "bonus", distance: 30, units: "ft", occupies: false } },
  // SRD 5.2: what these spells place is not a creature that acts — an image (Silent Image, Major Image, Programmed
  // Illusion, Project Image, the double of Mislead), a sensor (Clairvoyance, Scrying), a disk, a chest, a
  // light. Without a declaration, the "Start Combat" window registered them with their own Initiative.
  ...Object.fromEntries(["silent-image", "major-image", "programmed-illusion", "project-image", "mislead", "clairvoyance",
    "scrying", "tensers-floating-disk", "secret-chest", "light", "continual-flame"].map(id => [id, { initiative: "none" }])),
  "dancing-lights": { initiative: "none", endsSpell: true, pilot: {
    cost: "bonus", distance: 60, units: "ft", occupies: false, shared: true, cluster: { distance: 20, units: "ft" }, leash: true
  } }
});

/**
 * §109: PHB 2.2.0 spells whose summoning activity has `summon.prompt: false` (dnd5e documents/activity/summon.mjs:68: the
 * "place the summons" checkbox starts unchecked) although the spell does always summon. Without the dnd5e window (§68),
 * nothing was placed (session feedback, 2026-10-08: the Conjure Animals pack did not appear). Left unchecked, on purpose,
 * are those where the summoning is optional: Light and Continual Flame (on an object), Animate Dead (raising a corpse).
 */
export const PLACES_SUMMONS = Object.freeze(["conjure-animals", "summon-undead", "grasping-vine", "phantom-steed", "project-image", "animate-dead"]);

/**
 * §394: the only summons that are aimed with a click. Since §394, a "summon" activity no longer goes into aiming based on its
 * target in the data: Carpet of Flying and the Driftglobe designate themselves there ("object"), the Efreeti Bottle says
 * "creature" for a free cell — the engine waited for a click on a target that does not exist, and the object could not be used.
 * Finger of Death, on the other hand, raises the slain creature: its target is a corpse, which a neighbor raises in its
 * place (§118, darsh-loot).
 */
export const TARGETED_SUMMONS = Object.freeze(["finger-of-death"]);
