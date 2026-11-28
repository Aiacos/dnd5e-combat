/**
 * What the conditions (2024 rules) change on a roll, when it depends on TWO creatures or on the
 * situation. Pure functions, no dependency on Foundry.
 *
 * One owner per effect: everything a condition does to the one who bears it, dnd5e 6.0
 * already applies (CONFIG.DND5E.conditionEffects, config.mjs:3799-3819) and is NOT taken up here:
 * Poisoned (Disadvantage on attacks and checks), Restrained (Disadvantage on Dexterity saving throws),
 * Dodge (Advantage on Dexterity saving throws), encumbrance, Exhaustion,
 * Initiative. The only deliberate exception: the attacker Restrained, Prone, Blinded or Frightened, which the
 * system does not handle.
 */

/** Attacker conditions that give it Disadvantage on the attack. */
const ATTACKER_DISADVANTAGE = ["blinded", "frightened", "prone", "restrained"];
/** Attacker conditions that give it Advantage on the attack. */
const ATTACKER_ADVANTAGE = ["invisible"];
/** Target conditions that give Advantage to whoever attacks it. */
const TARGET_ADVANTAGE = ["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious"];
/** Target conditions that give Disadvantage to whoever attacks it. */
const TARGET_DISADVANTAGE = ["invisible", "dodging"];
/** Conditions that automatically fail Strength and Dexterity saving throws. */
const AUTO_FAIL_SAVE = ["paralyzed", "petrified", "stunned", "unconscious"];
/** Conditions that turn any attack that hits from 5 ft or less into a Critical Hit. */
const AUTO_CRITICAL = ["paralyzed", "unconscious"];

/**
 * @typedef {object} Reason
 * @property {"attacker"|"target"|"situation"|"content"} who
 * @property {string} key  dnd5e condition identifier, situation key ("longRange", "closeCombat", "proneFar"),
 *                         or, for "content", the name of the item that declares it (SPEC §16, B6).
 */

/**
 * Conditions that VISION subsumes when we know who sees whom (2024 rules, "unseen attackers and
 * targets"): Blinded and Invisible are worth only what they let one see or not — and Blindsight
 * sees an invisible creature. Without vision facts, these conditions keep their flat effect.
 */
const SUBSUMED_BY_VISION = ["blinded", "invisible"];

/**
 * Sources of Advantage and Disadvantage of an attack against ONE target.
 * @param {object} context
 * @param {string[]} context.attacker       Attacker conditions.
 * @param {string[]} context.target         Target conditions.
 * @param {boolean} context.adjacent        The target is 5 ft away or less.
 * @param {boolean} context.ranged          Ranged attack (ranged weapon, thrown weapon, ranged spell).
 * @param {boolean} [context.longRange]     Target beyond normal range.
 * @param {boolean} [context.closeCombat]   A valid enemy stands 5 ft from the attacker.
 * @param {{attackerSees: boolean, targetSees: boolean}|null} [context.vision]
 *        Who sees whom, if known (P1): attacking without seeing = Disadvantage, attacking without being seen = Advantage.
 * @param {boolean|null} [context.grappledElsewhere]
 *        Grappled (2024 rule): Disadvantage on attacks against any target other than the one grappling.
 *        true = the attacker is Grappled and the target is not its grappler; null = unknown (no Disadvantage).
 * @param {boolean} [context.helped]
 *        Help (2024): an ally of the attacker distracted the target — Advantage.
 * @param {string|null} [context.flankedWith]
 *        Flanking (§369, optional rule): the name of the ally standing on the other side of the target — Advantage in
 *        melee. null: no flanking (or rule disabled).
 * @param {boolean|null} [context.frightenedSourceSeen]
 *        Frightened: "while the source of the fear is in line of sight". false = no known source is
 *        in sight, the condition does not hinder the attack; null = source unknown or not judged, the condition applies.
 * @param {{advantage?: string[], disadvantage?: string[]}} [context.declared]
 *        What the content declares (§16, B6: Faerie Fire, Pack Tactics…), by item name.
 * @returns {{advantage: Reason[], disadvantage: Reason[]}}
 */
export function attackModifiers({ attacker, target, adjacent, ranged, longRange=false, closeCombat=false, vision=null, frightenedSourceSeen=null, grappledElsewhere=null, helped=false, flankedWith=null, declared=null, elusive=false, untrainedArmor=false, heavyTooWeak=false }) {
  const advantage = (declared?.advantage ?? []).map(key => ({ who: "content", key }));
  const disadvantage = (declared?.disadvantage ?? []).map(key => ({ who: "content", key }));
  const kept = key => !vision || !SUBSUMED_BY_VISION.includes(key);
  for ( const key of ATTACKER_ADVANTAGE ) if ( attacker.includes(key) && kept(key) ) advantage.push({ who: "attacker", key });
  for ( const key of ATTACKER_DISADVANTAGE ) {
    if ( !attacker.includes(key) || !kept(key) ) continue;
    if ( (key === "frightened") && (frightenedSourceSeen === false) ) continue;
    disadvantage.push({ who: "attacker", key });
  }
  for ( const key of TARGET_ADVANTAGE ) if ( target.includes(key) && kept(key) ) advantage.push({ who: "target", key });
  for ( const key of TARGET_DISADVANTAGE ) {
    if ( !target.includes(key) || !kept(key) ) continue;
    // Dodge (2024): Disadvantage only if the target sees the attacker.
    if ( (key === "dodging") && vision && !vision.targetSees ) continue;
    disadvantage.push({ who: "target", key });
  }
  if ( vision ) {
    if ( !vision.attackerSees ) disadvantage.push({ who: "target", key: "unseen" });
    if ( !vision.targetSees ) advantage.push({ who: "attacker", key: "unseen" });
  }
  if ( grappledElsewhere === true ) disadvantage.push({ who: "attacker", key: "grappled" });
  if ( helped === true ) advantage.push({ who: "situation", key: "helped" });
  // §369: Flanking (optional rule of the 2014 DMG, setting `flanking`) — the name of the ally who catches the target from behind.
  if ( flankedWith && !ranged ) advantage.push({ who: "situation", key: "flanking", ally: String(flankedWith) });
  // Prone: Advantage for whoever is adjacent, Disadvantage for all the others.
  if ( target.includes("prone") ) (adjacent ? advantage : disadvantage).push({ who: "target", key: adjacent ? "prone" : "proneFar" });
  if ( ranged && longRange ) disadvantage.push({ who: "situation", key: "longRange" });
  if ( ranged && closeCombat ) disadvantage.push({ who: "situation", key: "closeCombat" });
  // §214: armor worn without training — Disadvantage on Strength or Dexterity attacks.
  if ( untrainedArmor ) disadvantage.push({ who: "situation", key: "untrainedArmor" });
  // O5a (§339): Heavy weapon wielded without 13 in Strength (melee) or in Dexterity (ranged).
  if ( heavyTooWeak ) disadvantage.push({ who: "situation", key: "heavyWeapon" });
  // §20: Elusive — "no attack roll can have Advantage against you": the reasons for Advantage no longer count.
  if ( elusive ) return { advantage: [], disadvantage };
  return { advantage, disadvantage };
}

/**
 * The roll's mode: as soon as there is at least one Advantage AND one Disadvantage, they all cancel out,
 * whatever their number.
 * @returns {1|0|-1}
 */
export function netMode({ advantage, disadvantage }) {
  if ( advantage.length && !disadvantage.length ) return 1;
  if ( disadvantage.length && !advantage.length ) return -1;
  return 0;
}

/**
 * Several targets, one roll: we only decide if all the targets give the same mode.
 * @param {Array<{advantage: Reason[], disadvantage: Reason[]}>} perTarget
 * @returns {{mode: 1|0|-1, agreed: boolean}}
 */
export function combineTargets(perTarget) {
  const modes = new Set(perTarget.map(netMode));
  if ( modes.size <= 1 ) return { mode: perTarget.length ? netMode(perTarget[0]) : 0, agreed: true };
  return { mode: 0, agreed: false };
}

/**
 * §480: the Disadvantage decided by the engine, dismissed by hand at the moment of the roll (Discord, Archibald, 2026-11-13).
 * dnd5e lets the player choose: the Advantage key (Alt) combines it with the Disadvantage (both: normal roll,
 * D20Roll.applyKeybindings), the "Advantage" or "Normal" button of the roll window replaces it
 * (D20RollConfigurationDialog#_finalizeConfig). Neither sets
 * `options.advantage`: a real source of Advantage (an effect, the engine) sets it, and then the normal roll is the rule.
 * @param {{agreed?: boolean, advantage?: object[], disadvantage?: object[]}|null} modifiers  The engine's reasons (flag
 *   `modifiers`).
 * @param {{advantage?: boolean, advantageMode?: number}|null} options  The options of the roll made.
 * @returns {"cancelled"|"replaced"|null}  Normal roll or with Advantage despite the Disadvantage; null otherwise.
 */
export function manualModeOverride(modifiers, options) {
  if ( !modifiers?.agreed || !modifiers.disadvantage?.length || modifiers.advantage?.length ) return null;
  if ( !options || options.advantage ) return null;
  if ( options.advantageMode === 1 ) return "replaced";
  if ( options.advantageMode === 0 ) return "cancelled";
  return null;
}

/** Is an attack that hits this target automatically a Critical Hit? */
export function isAutoCritical(targetStatuses, adjacent) {
  return adjacent && AUTO_CRITICAL.some(s => targetStatuses.includes(s));
}

/**
 * The condition that automatically fails this saving throw, or null.
 * @param {string[]} statuses
 * @param {string} ability  Ability of the saving throw ("str", "dex"…).
 */
export function autoFailSave(statuses, ability) {
  if ( !["str", "dex"].includes(ability) ) return null;
  return AUTO_FAIL_SAVE.find(s => statuses.includes(s)) ?? null;
}

/** Conditions that make a spell with a verbal component impossible (Silence 2024: casting such a spell is impossible). */
const NO_VERBAL = ["silenced"];

/**
 * The condition that prevents casting this spell, or null. Only the verbal component is at issue: a spell
 * cast by an item that waives it ("cast" activity, dnd5e 6 `documents/activity/cast.mjs:171-174`) goes through.
 * @param {string[]} statuses
 * @param {{spell: boolean, verbal: boolean}} use  Is the item used a spell, and does it keep its V component?
 */
export function verbalSpellBlocked(statuses, { spell, verbal }) {
  if ( !spell || !verbal ) return null;
  return NO_VERBAL.find(s => statuses.includes(s)) ?? null;
}

/** Conditions that incapacitate (2024 rules: Incapacitated, and the conditions that cause it). */
export const INCAPACITATING = Object.freeze(["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"]);

/**
 * Does this creature, 5 ft from the attacker, give it Disadvantage on a ranged attack? (2024 PHB "Ranged Attacks in Close
 * Combat": "an enemy who can see you and who isn't under the Incapacitated condition".) A dead creature hinders
 * no one; `seesAttacker` null (vision out of service): we don't know, it hinders.
 * @param {{hostile: boolean, statuses: string[], dead?: boolean, seesAttacker?: boolean|null}} other
 */
export function hampersRangedAttack({ hostile, statuses, dead=false, seesAttacker=null }) {
  if ( !hostile || dead ) return false;
  if ( INCAPACITATING.some(s => statuses.includes(s)) ) return false;
  return seesAttacker !== false;
}

/**
 * Does a grapple still hold? (2024 rule) It ends if the grappler is Incapacitated or if the
 * distance between it and the target exceeds the reach of the grapple.
 * @param {object} context
 * @param {string[]} context.grapplerStatuses  Conditions of the grappler.
 * @param {boolean} context.withinReach        Is the target still within reach of the grapple?
 */
export function grappleHolds({ grapplerStatuses, withinReach }) {
  if ( INCAPACITATING.some(s => grapplerStatuses.includes(s)) ) return false;
  return withinReach;
}

/* -------------------------------------------- */
/*  §17.3: what the conditions forbid           */
/* -------------------------------------------- */

/**
 * Incapacitated (2024): "you can't take any action, Bonus Action, or Reaction". Also for the conditions that
 * cause it (Stunned, Paralyzed, Petrified, Unconscious) and Dead.
 * §409: also for any spell cast (`castsSpell`: ritual, spell of one minute or more) and any long activity (`longActivation`:
 * minute, hour, day).
 * @param {{statuses: string[], cost: string|null, castsSpell?: boolean, longActivation?: boolean}} use  User's conditions, cost.
 * @returns {string[]}  ["incapacitated"], ["incapacitatedCasting"] (spell or long activity without action cost), or [].
 */
export function conditionUseIssues({ statuses, cost, noReactions=false, actionOrBonus=false, budget=null, castsSpell=false, longActivation=false }) {
  // §409 (issue #44): casting a spell (ritual or casting time of one minute or more included) or a long activity requires acting,
  // turn after turn — an Incapacitated creature cannot, whatever the cost read.
  const acting = ["action", "bonus", "reaction"].includes(cost);
  if ( !acting && !castsSpell && !longActivation ) return [];
  if ( INCAPACITATING.some(s => statuses.includes(s)) ) return [acting ? "incapacitated" : "incapacitatedCasting"];
  if ( !acting ) return [];
  // §16.47: "can't take a Reaction" (Arms of Hadar).
  if ( (cost === "reaction") && noReactions ) return ["noReactions"];
  // §77: "an action or a Bonus Action on its turn, not both" (Dretch's Fetid Cloud, Slow) — the other already spent.
  if ( actionOrBonus && budget ) {
    const actionTaken = (budget.action < 1) || ((budget.attacks?.used ?? 0) > 0);
    if ( ((cost === "action") && (budget.bonus < 1)) || ((cost === "bonus") && actionTaken) ) return ["actionOrBonus"];
  }
  return [];
}

/**
 * Charmed (2024): "you can't attack the charmer or target the charmer with damaging abilities or magical
 * effects".
 * @param {{attack: boolean, damage: boolean, magical: boolean}} use
 */
export function forbiddenAgainstCharmer({ attack, damage, magical }) {
  return !!(attack || damage || magical);
}

/**
 * "A creature that you can see" in the description (English, or French of the PHB-fr: "une créature que vous
 * voyez", "parmi celles que vous voyez"). A point or space that one sees does not count: only the target counts.
 */
const SIGHT_PATTERN = /\b(?:creatures?|targets?|one|ones)\b[^.<]{0,40}\b(?:that )?you can see\b|\b(?:cr[ée]atures?|cibles?|celles|ceux)\b[^.<]{0,40}\bque vous (?:voyez|pouvez voir)\b/i;
export function requiresSight(text) {
  return SIGHT_PATTERN.test(String(text ?? ""));
}

/**
 * Frightened (2024): "you can't willingly move closer to the source of your fear". One point of the path
 * closer to the source than the start is enough.
 * @param {number} start      Distance to the source at the start.
 * @param {number[]} steps    Distance to the source at each point of the path.
 */
export function movesCloser(start, steps) {
  return steps.some(d => d < start - 1e-6);
}

/* -------------------------------------------- */
/*  §16.47: spell rules                         */
/* -------------------------------------------- */

/**
 * What a use ends among the `breaksOn` effects of its author: an attack roll (at the roll), a use
 * with damage, a spell. An attack only counts at the roll (invisibility benefits the roll itself).
 * @param {{attack: boolean, damage: boolean, spell: boolean}} use
 * @returns {string[]}  The moments reached.
 */
export function breakMoments({ attack, damage, spell }) {
  const out = [];
  if ( attack ) out.push("attack");
  if ( damage ) out.push("damage");
  if ( spell ) out.push("spell");
  return out;
}

/**
 * §438: the moments that end an item's effect — those of the whole item (`breaksOn`), plus those of the activity that placed it
 * (`breaksOnActivity`), when known.
 * @param {object} entry              The content entry of the original item.
 * @param {string|null} activityId    The activity that placed the effect.
 * @returns {string[]}
 */
export function effectBreakMoments(entry, activityId=null) {
  const out = new Set(entry?.breaksOn ?? []);
  for ( const m of ((activityId && entry?.breaksOnActivity?.[activityId]) || []) ) out.add(m);
  return [...out];
}

/** The conditions of `cures` that the target really has. */
export function curable(statuses, cures) {
  return (cures ?? []).filter(s => statuses.includes(s));
}

/** "If you or your allies are fighting it": the target is in combat, hostile to the caster. */
export function fightingAdvantage({ targetInCombat, hostile }) {
  return !!(targetInCombat && hostile);
}

/**
 * Automatic success or failure of a saving throw according to the creature's type (`saveAutoSuccess.types`, `saveAutoFail.types`):
 * Flesh to Stone — a Construct succeeds; Blight — a Plant fails. The automatic failure takes precedence if both apply.
 * @param {{success?: string[], fail?: string[]}} rules  the types declared by the item
 * @param {string|null|undefined} type                   the creature's type
 * @returns {{autoFail: string}|{autoSucceed: string}|null}  the reason, in the format `type:<type>`
 */
export function typeAutoSave({ success=[], fail=[] }={}, type) {
  if ( !type ) return null;
  if ( (fail ?? []).includes(type) ) return { autoFail: `type:${type}` };
  if ( (success ?? []).includes(type) ) return { autoSucceed: `type:${type}` };
  return null;
}
