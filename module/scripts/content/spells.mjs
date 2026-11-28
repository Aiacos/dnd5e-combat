/**
 * Spell rules (SPEC §16.47), by dnd5e identifier: they hold for any creature that has the spell, PC or NPC, whatever the
 * item format (PHB premium 5.x or compendium 6.x — none depends on an activity id).
 */

/** The spell's effects end when their bearer attacks, deals damage or casts a spell (Invisibility, PHB 2024). */
export const BREAKS_ON = Object.freeze({
  "invisibility": ["attack", "damage", "spell"],
  // §53: Potion of Invisibility — "the effect ends if you make an attack roll, deal damage or cast a spell".
  "potion-of-invisibility": ["attack", "damage", "spell"],
  // §42.2: Sanctuary — "the spell ends if the warded creature makes an attack roll, casts a spell or deals
  // damage"; Mislead — "ends immediately after you make an attack roll, deal damage or
  // cast a spell".
  "sanctuary": ["attack", "damage", "spell"],
  "mislead": ["attack", "damage", "spell"]
});

/** The bearer of an effect of the spell cannot take a Reaction (Arms of Hadar: until the start of the target's next turn). */
export const NO_REACTIONS = Object.freeze(["arms-of-hadar", "confusion", "fetid-cloud", "slow"]);

/** §77: "an action or a Bonus Action on its turn, not both" — Stinking Cloud (Dretch, Monster Manual 2024), Slow. */
// C12-d: Abjure Enemy — "the Frightened creature can, on each of its turns, only move, or take an action, or a Bonus
// Action": the action OR the Bonus Action (the movement in addition is left to the GM).
export const ACTION_OR_BONUS = Object.freeze(["fetid-cloud", "slow", "abjure-foes"]);
/** §267: "it can make only one attack if it takes the Attack action" (Slow). */
export const SINGLE_ATTACK = Object.freeze(["slow"]);
/** §283: "if it casts a spell with a somatic component, there is a 25 percent chance the spell fails" (Slow). */
export const SPELL_FAILURES = Object.freeze({ "slow": { chance: 25, component: "somatic" } });
/** §269: "the target can neither attack nor cast spells" (Gaseous Form). */
// Wind Walk (SRD 5.2): "in this cloud form, the only actions possible are the Dash action or a Magic action
// to return to normal form" — neither attack nor spell.
export const NO_ATTACKS_OR_SPELLS = Object.freeze(["gaseous-form", "wind-walk"]);
/** §284: "can't cast spells or take the Magic action" (Feeblemind). */
export const NO_SPELLS = Object.freeze(["befuddlement"]);
/**
 * §284: "you always know where the target is; it can't Hide from you, and the Invisible condition gives it
 * nothing against you" (Mind Spike) — holds for the caster only.
 */
export const KNOWN_TO_ORIGIN = Object.freeze(["mind-spike"]);

/**
 * §285: control spells (runtime/control.mjs). Fear — "drops what it is holding" and, Frightened, "takes the Dash action and
 * moves away from you on each of its turns"; Eyebite, Panicked (Kj1GwWXD5k0Zen75) — likewise, and "if it ends up 18 m or more
 * from you, at a place where it can't see you, this effect ends". Confusion (VxmsgUz9OIUet6WC, empty in the data):
 * no Bonus Action or Reaction, 1d10 at the start of each of its turns. Crown of Madness (0zixJ8ZoYFgSJtMV): the imposed
 * attack before moving, and "on your later turns, you must take the Magic action to maintain control, or the spell ends".
 * Tasha's Hideous Laughter: "it can't end the Prone condition" (`keepsProne`).
 */
export const CONTROL = Object.freeze({
  "fear": { panic: { drop: true } },
  "eyebite": { panic: { effect: "Kj1GwWXD5k0Zen75", endsAt: { distance: 60, units: "ft" } } },
  "confusion": { confusion: "VxmsgUz9OIUet6WC", noBonus: "VxmsgUz9OIUet6WC" },
  "crown-of-madness": { forcedAttack: "0zixJ8ZoYFgSJtMV", upkeep: true },
  "tashas-hideous-laughter": { keepsProne: true },
  "hideous-laughter": { keepsProne: true }
});

/**
 * §19: effects placed only on a SUCCESSFUL save. Ray of Enfeeblement — "on a success, the target has Disadvantage
 * on its next attack roll before the start of your next turn" ("Brief Enfeeblement", yril8uhQgO1dR507, PHB 2.2.0).
 */
export const SAVED_EFFECTS = Object.freeze({
  "ray-of-enfeeblement": ["yril8uhQgO1dR507"],
  // §43.1: Flesh to Stone — on a successful save, "its Speed is 0 until the start of your next turn"
  // ("Unable to Move", which `effectEnds` drops: content/spell-rules.mjs).
  "flesh-to-stone": ["sFyjp6wt9bjyIl9W"],
  // §43.2: Otto's Irresistible Dance — on a success, "it dances until the end of its next turn" ("Short Dance").
  "ottos-irresistible-dance": ["UhFtBDEZEDpVgz9G"]
});

/** The spell ends ONE of these conditions on its target, of your choice (Lesser Restoration). */
export const CURES = Object.freeze({
  "lesser-restoration": ["blinded", "deafened", "paralyzed", "poisoned"],
  // §160: Greater Restoration — "… ends one of these effects: one level of Exhaustion, Charmed, Petrified" (the curse:
  // content/spell-rules.mjs, §366; the reduction of an ability score or of max HP: up to the GM).
  "greater-restoration": ["charmed", "petrified", "exhaustion"],
  // Protection from Poison: "if the target is Poisoned, that condition ends".
  "protection-from-poison": ["poisoned"],
  // Raise Dead: the Dead condition ends, however it was placed (the engine only removes by itself
  // the Death that it placed, when HP rise again — adapter/death.mjs).
  "revivify": ["dead"],
  "raise-dead": ["dead"],
  "resurrection": ["dead"],
  "true-resurrection": ["dead"]
});

/** "It has Advantage on the saving throw if you or your allies are fighting it." C12-e: Modify Memory ("if you are fighting it"). */
export const FIGHTING_ADVANTAGE = Object.freeze([
  "charm-person", "charm-monster", "dominate-beast", "dominate-person", "dominate-monster", "modify-memory"
]);

/**
 * Change size (§16.58, `resize`): by the id of the item's effect, the number of categories. Enlarge/Reduce
 * — "the target's size increases (or decreases) by one category"; same ids in the PHB and in the dnd5e 6 SRD.
 */
export const SIZE_CHANGES = Object.freeze({
  "enlarge-reduce": { "Wi2E10l7n6Ka8k6u": 1, "NXdtOxX4HvPeodml": -1 }
});

/**
 * Imposed order (§16.59, `orders`): Command — "Approach, Drop, Flee, Grovel, Halt" (PHB 2024), chosen by the author;
 * on a failed Wisdom save, played on the target's next turn (runtime/orders.mjs).
 */
/** §147: the target that fails its save flees the caster with its Reaction (runtime/flee.mjs). */
export const FLEE_ON_FAILED_SAVE = Object.freeze({ "dissonant-whispers": { fleeOnFailedSave: true } });

export const ORDER_LISTS = Object.freeze({ "command": ["approach", "drop", "flee", "grovel", "halt"] });
