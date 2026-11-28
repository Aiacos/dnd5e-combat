/**
 * The enumerations of the content schema (core/content.mjs): versions, step types, moments, allowed values.
 * Pure functions, no dependency on Foundry.
 */
/** Schema version. An overlay of another version is ignored with a warning. */
export const CONTENT_VERSION = 1;

export const STEP_TYPES = Object.freeze(["lift", "disarm", "use", "replay", "damage", "move", "status", "resave", "remove", "halve", "uncrit", "consume", "advantage", "disadvantage", "ward", "attackBonus", "endCondition", "reduce", "miss", "penalty", "bonus", "absorb", "interpose", "mark", "save", "breakConcentration", "cancel", "intercept", "redirect", "banish", "revertForm", "reroll", "cancelForSelf", "resist"]);
/** The "hit" windows: the creature hit itself, or another one that reacts for it (Sentinel at Death's Door). */
export const HIT_WINDOWS = Object.freeze(["isHit", "allyIsHit"]);
/** §301: the fall windows, where a reaction reduces (`reduce`) or cancels (`cancel`) the fall damage. */
export const FALL_WINDOWS = Object.freeze(["falls", "allyFalls"]);
/** The basic actions an activity can take as the cost of its activation (`basicActions`). */
export const BASIC_ACTION_KINDS = Object.freeze(["dash", "disengage", "dodge", "hide", "help"]);   // §72: "help" (Tactical Master)
/** The dnd5e sizes, from the smallest to the largest (`actorSizes`). */
export const SIZES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
/** The six abilities (dnd5e keys). */
export const ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
/** The damage types of the 2024 Player's Handbook (dnd5e keys). */
export const DAMAGE_TYPES = Object.freeze(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
/** §206: is this size at least `min`? An unknown size counts as Medium. */
export const sizeAtLeast = (size, min) => SIZES.indexOf(SIZES.includes(size) ? size : "med") >= SIZES.indexOf(min);
/** The steps that only apply before an attack roll (preAttackRoll moment). */
export const ATTACK_STEPS = Object.freeze(["advantage", "disadvantage", "attackBonus"]);
/** §497: `random` — in a direction rolled on a die among `directions` (Infestation). */
export const MOVE_MODES = Object.freeze(["push", "pull", "random"]);
/** §497: the directions of a random movement, in the order of a Confusion 1d8 (north, then clockwise). */
export const MOVE_DIRECTIONS = Object.freeze(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
/** §497: a blocked arrival cell — stay in place (`stay`), or go as far as possible (`stop`, the default). */
export const MOVE_IF_BLOCKED = Object.freeze(["stay", "stop"]);
/** The recipients of a `damage` step: the attacker (retort), the caster of the effect (sharing), the bearer (their turn). */
export const DAMAGE_TO = Object.freeze(["source", "origin", "bearer", "self"]);
/** The share of the outcome damage on a successful save (`damage` at the failedSave moment). */
export const DAMAGE_ON_SAVE = Object.freeze(["half", "none"]);
/** The steps that only run when a resolution is applied (hit, failedSave moments). */
export const OUTCOME_STEPS = Object.freeze(["lift", "move", "status", "disarm", "mark", "breakConcentration", "banish", "revertForm"]);
export const VIA = Object.freeze(["effect"]);
/** §403: `summoner` — only the creature that summoned the bearer (Conjure Animals: "you have Advantage… within 1.5 m of the pack"). */
export const AURA_AFFECTS = Object.freeze(["ally", "enemy", "any", "summoner"]);
/** §16.47: what the bearer of a `breaksOn` effect does to make it end. */
export const BREAK_MOMENTS = Object.freeze(["attack", "damage", "spell", "save", "forcesSave"]);
/** When an item effect ends (`effectEnds`, §23): at the start or end of the caster's next turn, at the start or end of the bearer's next turn. */
export const EFFECT_ENDS = Object.freeze(["casterTurnStart", "casterTurnEnd", "bearerTurnStart", "bearerTurnEnd",
  "currentTurnEnd"]);
/** §258: generic endings (`endsWhen`) — the armor donned, the moment when the distance to the caster is judged, what counts as
 * "no one affected". */
export const ENDS_ARMOR = Object.freeze(["any", "heavy"]);
export const ENDS_APART_AT = Object.freeze(["move", "casterTurnEnd"]);
export const ENDS_UNAFFECTED = Object.freeze(["failedSave", "noHits", "noTargets"]);
/** What opens an attack as a Bonus Action (`bonusAttack.after`). */
export const BONUS_ATTACK_AFTER = Object.freeze(["critical", "felled"]);

export const ENTRY_KEYS = Object.freeze(["smite", "multiattackPlan", "metamagic", "freeCast", "overchannel", "metamagicRules", "endurance", "replacesAttack", "hitRider", "heldEffect", "potentCantrip", "cantripVitality", "sculptSpells", "supremeHealing", "discipleOfLife", "blessedHealer", "martialArts", "flurry", "stunningStrike", "openHand", "effectEnds", "effectThen", "actionEnds", "blocksHealing", "noOpportunityAttacks", "byWounds", "oneAttack", "rage", "persistentRage", "reckless", "relentless", "grantsAction", "movesAfter", "studiedAttacks", "heroicWarrior", "greatWeaponFighting", "thrownDamage", "sneakAttack", "sneakBonus", "cunningStrikes", "cunningStrikeMax", "evasion", "avoidance", "elusive", "holdsStill", "empower", "discharge", "healsDownedMax", "failMargins", "reactions", "lastStand", "forOneAttack", "basicActions", "sharedHp", "secondPhase", "savedEffects", "ignoresCloseCombat", "triggers", "aura", "onHit", "choice", "targets", "trace", "teleport", "lineDash", "absorb", "summon", "movable", "burst", "recast", "atTurnStart", "bolt", "obscures", "silences", "healMax", "duplicates", "saveAdvantage", "onFell", "bonusAttack", "reactiveSpell", "projectiles", "leap", "light", "revealsInvisible", "effectsExpire", "usageLimits", "enchantTarget", "ranges", "tether", "pact", "damageShield", "hitDiceHeal", "breaksOn", "breaksOnActivity", "breaksOnOrigin", "noReactions", "cures", "advantageIfFighting", "emanation", "regeneration", "fortitude", "noOpportunity", "drain", "swallow", "resize", "orders", "portent", "dispel", "counter", "zoneEffects", "rollBonus", "transpose", "stabilizes", "carriedLight", "kindles", "curesAll", "potionEffect", "castTargets", "effectChanges", "difficultTerrain", "storm", "stableAtZero", "effectsIf", "contest", "wardsAtZero", "zoneCharges", "noDamage", "dropsEffects", "selfZone", "zoneAffects", "pendingDie", "rolledAc", "swapPlaces", "sweep", "commandStrike", "casterPulse", "zoneEnd", "afterTeleport", "saveDamage", "onNatural1", "searchBonus", "atZero", "afterSneak", "effectStatuses", "changesForm", "actionOrBonus", "sharesSpace", "placesSummons", "targetedSummon", "lifesteal", "rerollInitiative", "savageAttacker", "initiativeSwap", "healingRerolls", "effectWhile", "rangedFeat", "piercer", "critMark", "grappleDamage", "haltOnReaction", "concentrationBreaker", "interposeShield", "elementalAdept", "ignoresResistance", "quickStand", "quickSearch", "opportunityDisadvantage", "peerlessAim", "fortifiedHealing", "overwhelmingStrike", "spellRecall", "savesCharges", "lastStandHeal", "reactiveStrike", "ritualAdept", "slotRecovery", "fleeOnFailedSave", "halfOnMiss", "saveDisadvantageFor", "limitedAction", "oneThingPerTurn", "noActions", "hpTiers", "endsCurses", "tempHpPool", "revivesFull", "standsWithReaction", "seesInvisible", "globe", "blink", "walls", "pointWall", "barrier", "recastCost", "levitate", "prismatic", "wallSide", "cellWall", "coverThrough", "thinWall", "wallAura", "scatter", "flammable", "climbsCeilings", "grantsSpeeds", "climbsOnTurn", "slippery", "notOnSlippery", "saveAdvantageSize", "jump", "burns", "etherealShift", "encloses", "willingFails", "keepsConcentration", "concentration", "spellDamageTypes", "critMove", "combatInspiration", "endsOwnConditions", "regainOnInitiative", "turnStartHeal", "deathSaveCritical", "spellDamageRerolls", "grantsResistances", "scoreFloor", "cantripRange", "fleetStep", "extraFirstTurn", "endsWhen", "banishes", "singleAttack", "wardsConditions", "noAttacksOrSpells", "afterSmite", "maxDamage", "maxNextHit", "weaponDamageTypes", "grappleSize", "inescapable", "grappleCover", "spellFailure", "untypedDamage", "noSpells", "knownToOrigin", "panic", "confusion", "noBonus", "forcedAttack", "upkeep", "keepsProne", "chain", "curesOn", "endsOnUse", "drawsOnEnd", "endActivity", "noRangedWeapons", "catalyst", "pickTargets", "flurryStrikes", "effectDurations", "grantsConditionImmunities", "zoneMax", "healPool", "spellsInAttack", "duringRage", "quietPose", "zoneBound", "effectsFirst", "hitDefense", "brutalStrike", "enterOnPose", "killsAtZero", "retort", "grants", "summonEffectsOnCaster", "sniper", "hidesBehindLarger", "regainOnShortRest", "absorbsDamage", "dataFixes", "includesOrigin", "rangedDefense", "exclusiveWeapon", "minRange", "swornEnemy", "markSplash", "devours", "critFeeds", "maxSpellDamageVs", "wrath", "hardToPerceive", "coats", "castDuration", "backfire", "gmAlert", "hitFollowUp", "checkPoses", "saveAutoSuccess", "saveAutoFail", "fadesOnLongRest", "leavesEffects", "onUsesSpent", "magicEvasion", "saveAdvantageFrom", "leash", "compels", "durationByLevel", "keepsSpeed", "windward", "formLock", "suspends", "zoneLasts", "freeSomatic", "magical", "antimagicZone", "seesThroughOwnDarkness", "sense", "grapples", "afterUse", "blocksTempHp",
  "mount", "commands",
  "wardsDetection", "detectedAs", "senseNeeds", "rollDisadvantage", "rollAdvantage", "saveIgnoresCover", "attackIgnoresCover", "spellTargets", "noTeleport", "saveAutoSuccessAgainst", "spellAttacksMiss", "healRaisesMax", "breathAdvantage", "spellFixes", "onDamageTaken", "saveDisadvantageAgainst", "saveResist", "saveReflect", "reducesForcedMove", "castFromBearer", "extraTurns", "damageByCount"]);
export const CHOICE_EFFECTS = Object.freeze(["one"]);
/** §38, §90 : les jets auxquels un `rollBonus` s'ajoute. */
export const ROLL_BONUS_ON = Object.freeze(["save", "check", "attack", "initiative"]);
/** §484: the rolls a `rollDisadvantage` hits — ability checks (skills and Initiative included), saving throws. */
export const ROLL_DISADVANTAGE_ON = Object.freeze(["check", "save"]);
/** §37: what a failed repeated save also imposes (`resave.onFail`): the Dodge action (Bestow Curse). */
export const RESAVE_ON_FAIL = Object.freeze(["dodge"]);
/** §43.2: who ends the effect with an action, by which roll, under which label. */
export const ACTION_END_BY = Object.freeze(["bearer", "other"]);
export const ACTION_END_ROLLS = Object.freeze(["save", "check"]);
export const ACTION_END_VERBS = Object.freeze(["wake"]);
/** §49: the condition the bearer takes by ending the effect (Alchemist's Fire: "inflicting the Prone condition on yourself"). */
export const ACTION_END_STATUSES = Object.freeze(["prone"]);
/** §32: the Metamagic options that the engine applies to the next spell. */
export const METAMAGIC_KINDS = Object.freeze(["quickened", "careful", "heightened", "distant", "subtle", "twinned", "extended"]);
/** The rests that end the effects of an item (`effectsExpire`): the expiry events of dnd5e (config.mjs:4750). */
export const EFFECT_EXPIRIES = Object.freeze(["longRest", "shortRest"]);

export const PILOT_COSTS = Object.freeze(["action", "bonus", "free"]);
export const PULSE_MOMENTS = Object.freeze(["turnEnd", "enter", "moves", "turnStart", "casterTurnStart"]);
export const PILOT_ON_CAST = Object.freeze(["use", "command"]);

/** §279: the weapon kinds a rule can name — "unarmed" (Unarmed Strike) and the dnd5e weapon types (config.mjs). */
export const WEAPON_KINDS = Object.freeze(["unarmed", "simpleM", "simpleR", "martialM", "martialR", "natural", "improv", "siege"]);
