/**
 * The merging of the layers of an entry (module < world overlay < item flag). Pure functions, no dependency on Foundry.
 */

import { isObject } from "./shared.mjs";

/**
 * How a key passes from one layer to the next:
 *  - `replace`   the value of the most specific layer, as is;
 *  - `shallow`   a setting object merged field by field (fix a radius without restating the rest);
 *  - `copy`      an object replaced whole (a copy); `list`: a list replaced whole (a copy);
 *  - `deep`      a deep copy (nested objects);
 *  - `triggers`  the list of declarations, replaced whole (a single declaration becomes a list);
 *  - `trace`     an object merged field by field, or a simple value that replaces it.
 */
const STRATEGIES = Object.freeze({
  replace: (prev, value) => value,
  shallow: (prev, value) => ({ ...(prev ?? {}), ...value }),
  copy: (prev, value) => ({ ...value }),
  list: (prev, value) => [...value],
  deep: (prev, value) => JSON.parse(JSON.stringify(value)),
  triggers: (prev, value) => (Array.isArray(value) ? [...value] : [value]),
  trace: (prev, value) => ((typeof value === "object") ? { ...((typeof prev === "object") ? prev : {}), ...value } : value)
});

/** The strategy of each entry key (all those of `ENTRY_KEYS`, tests/content.test.mjs), in the order they are written. */
export const MERGE = Object.freeze({
  triggers: "triggers", endsWhen: "shallow", banishes: "replace", singleAttack: "replace", spellFailure: "replace", untypedDamage: "replace", noAttacksOrSpells: "replace", noTeleport: "replace", noSpells: "replace", knownToOrigin: "replace", panic: "replace", confusion: "replace", noBonus: "replace", forcedAttack: "replace", upkeep: "replace", keepsProne: "replace", afterSmite: "replace", wardsConditions: "replace", aura: "shallow", onHit: "shallow", choice: "shallow", targets: "shallow", spellTargets: "replace", trace: "trace",
  enchantTarget: "replace", ranges: "shallow", tether: "shallow", pact: "shallow", damageShield: "shallow", rangedDefense: "replace", exclusiveWeapon: "replace", minRange: "replace", swornEnemy: "replace", markSplash: "replace", devours: "replace", critFeeds: "replace", maxSpellDamageVs: "replace", wrath: "replace", hardToPerceive: "replace", coats: "replace", castDuration: "replace", backfire: "replace", gmAlert: "replace", hitFollowUp: "replace",
  hitDiceHeal: "shallow", teleport: "shallow", lineDash: "shallow", absorb: "shallow", summon: "shallow",
  movable: "shallow", burst: "shallow", recast: "replace", obscures: "replace", silences: "replace", revealsInvisible: "replace",
  effectsExpire: "replace", usageLimits: "shallow", healMax: "replace", duplicates: "replace", reactiveSpell: "replace", freeSomatic: "replace",
  saveAdvantage: "list", onFell: "shallow", bonusAttack: "shallow", projectiles: "shallow", leap: "shallow", chain: "replace", curesOn: "replace", endsOnUse: "replace", drawsOnEnd: "shallow", endActivity: "shallow", noRangedWeapons: "replace", catalyst: "replace",
  bolt: "shallow", light: "shallow", atTurnStart: "shallow", breaksOn: "list", breaksOnActivity: "shallow", breaksOnOrigin: "list", noReactions: "replace",
  saveReflect: "replace",
  actionOrBonus: "replace", leavesEffects: "replace", onUsesSpent: "replace", pickTargets: "replace", flurryStrikes: "replace", effectDurations: "shallow", grantsConditionImmunities: "list", zoneMax: "replace", healPool: "copy", spellsInAttack: "copy", duringRage: "copy", quietPose: "replace", zoneBound: "replace", effectsFirst: "replace", healRaisesMax: "replace", hitDefense: "replace", brutalStrike: "replace", enterOnPose: "replace", killsAtZero: "replace", retort: "replace", grants: "replace", summonEffectsOnCaster: "replace", sniper: "replace", hidesBehindLarger: "replace", checkPoses: "replace", saveAutoSuccess: "replace", saveAutoSuccessAgainst: "replace", spellAttacksMiss: "replace", saveIgnoresCover: "replace", attackIgnoresCover: "replace", saveAutoFail: "replace", saveResist: "replace", fadesOnLongRest: "replace", magicEvasion: "replace", saveAdvantageFrom: "replace", breathAdvantage: "replace", leash: "replace", compels: "replace", durationByLevel: "replace", keepsSpeed: "replace", windward: "replace", formLock: "replace", suspends: "replace", zoneLasts: "replace", magical: "replace", antimagicZone: "replace", regainOnShortRest: "list", absorbsDamage: "list", dataFixes: "replace", spellFixes: "replace", includesOrigin: "replace", cures: "list", curesAll: "list", potionEffect: "replace", castTargets: "replace",
  effectChanges: "shallow", advantageIfFighting: "replace", emanation: "shallow", regeneration: "replace",
  fortitude: "replace", reducesForcedMove: "replace", onDamageTaken: "replace", castFromBearer: "replace", extraTurns: "replace", damageByCount: "replace", noOpportunity: "replace", sharesSpace: "replace", placesSummons: "replace", targetedSummon: "replace", drain: "replace",
  swallow: "replace", savedEffects: "list", ignoresCloseCombat: "replace", sharedHp: "replace", failMargins: "shallow",
  multiattackPlan: "replace",
  mount: "copy", commands: "copy",
  resize: "shallow", orders: "list", reactions: "copy", lastStand: "copy", counter: "copy", difficultTerrain: "copy",
  storm: "copy", stableAtZero: "replace", wardsAtZero: "replace", zoneCharges: "replace", noDamage: "list", dropsEffects: "list",
  selfZone: "deep", zoneAffects: "replace", pendingDie: "copy", maxDamage: "copy", maxNextHit: "replace", weaponDamageTypes: "copy", grappleSize: "copy", inescapable: "replace", grappleCover: "replace", rolledAc: "copy", swapPlaces: "copy", sweep: "copy",
  commandStrike: "copy", zoneEnd: "copy", onNatural1: "copy", casterPulse: "deep", searchBonus: "copy", lifesteal: "copy",
  rerollInitiative: "copy", effectStatuses: "deep", atZero: "deep", afterSneak: "copy", saveDamage: "shallow",
  afterTeleport: "deep", effectsIf: "replace", contest: "copy", forOneAttack: "replace", basicActions: "shallow",
  secondPhase: "shallow", changesForm: "shallow", grapples: "shallow", afterUse: "copy", empower: "shallow", discharge: "shallow", healsDownedMax: "replace",
  sneakAttack: "replace", evasion: "replace", avoidance: "replace", elusive: "replace", holdsStill: "replace", cunningStrikeMax: "replace",
  grantsAction: "replace", movesAfter: "replace", studiedAttacks: "replace", heroicWarrior: "replace",
  greatWeaponFighting: "replace", thrownDamage: "replace", rage: "replace", persistentRage: "replace", reckless: "replace",
  relentless: "replace", blocksHealing: "replace", blocksTempHp: "replace", noOpportunityAttacks: "replace", byWounds: "replace",
  oneAttack: "replace", martialArts: "replace", flurry: "replace", stunningStrike: "replace", openHand: "replace",
  smite: "replace", supremeHealing: "replace", discipleOfLife: "replace", blessedHealer: "replace",
  potentCantrip: "replace", cantripVitality: "replace", sculptSpells: "replace", endurance: "replace", replacesAttack: "replace", hitRider: "replace", heldEffect: "replace",
  metamagic: "replace", freeCast: "replace", overchannel: "replace", metamagicRules: "replace", portent: "replace", dispel: "replace", zoneEffects: "replace", rollBonus: "replace", keepsConcentration: "replace", concentration: "replace", spellDamageTypes: "replace", critMove: "replace", combatInspiration: "replace", endsOwnConditions: "replace", turnStartHeal: "replace", deathSaveCritical: "replace", spellDamageRerolls: "replace", regainOnInitiative: "replace", grantsResistances: "replace", scoreFloor: "replace", cantripRange: "replace", fleetStep: "replace", extraFirstTurn: "replace",
  transpose: "replace", stabilizes: "replace", carriedLight: "replace", kindles: "replace", scatter: "replace", flammable: "replace", climbsCeilings: "replace", grantsSpeeds: "replace", climbsOnTurn: "replace", slippery: "replace", notOnSlippery: "replace", saveAdvantageSize: "replace", jump: "replace", burns: "replace", savageAttacker: "replace",
  initiativeSwap: "replace", healingRerolls: "replace", effectWhile: "replace", rangedFeat: "replace", piercer: "replace",
  critMark: "replace", grappleDamage: "replace", haltOnReaction: "replace", concentrationBreaker: "replace",
  interposeShield: "replace", elementalAdept: "replace", ignoresResistance: "replace", rollDisadvantage: "replace", rollAdvantage: "replace", quickStand: "replace",
  quickSearch: "replace", opportunityDisadvantage: "replace", peerlessAim: "replace", fortifiedHealing: "replace",
  overwhelmingStrike: "replace", spellRecall: "replace", savesCharges: "replace", lastStandHeal: "replace", reactiveStrike: "replace",
  ritualAdept: "replace", slotRecovery: "replace", fleeOnFailedSave: "replace", halfOnMiss: "replace",
  saveDisadvantageAgainst: "replace",
  saveDisadvantageFor: "replace", limitedAction: "replace", oneThingPerTurn: "replace", noActions: "replace", hpTiers: "replace",
  endsCurses: "replace", tempHpPool: "replace", revivesFull: "replace", standsWithReaction: "replace", seesInvisible: "replace", seesThroughOwnDarkness: "replace", sense: "replace", wardsDetection: "replace", detectedAs: "replace", senseNeeds: "replace", etherealShift: "replace", encloses: "replace", willingFails: "replace", globe: "replace",
  blink: "replace", walls: "replace", pointWall: "replace", barrier: "replace", recastCost: "replace", levitate: "replace",
  prismatic: "replace", wallSide: "replace", cellWall: "replace", coverThrough: "replace", thinWall: "replace",
  wallAura: "replace", effectEnds: "shallow", effectThen: "shallow", actionEnds: "shallow", sneakBonus: "shallow",
  cunningStrikes: "shallow"
});

/** The rank of each key in `MERGE`: the order of the keys of a merged entry. */
const RANK = new Map(Object.keys(MERGE).map((key, rank) => [key, rank]));

/**
 * Combines the layers, from the least to the most specific (module → world → item), key by key according to `MERGE`.
 * @param {Array<object|null|undefined>} layers
 * @returns {object|null}  null if no layer says anything.
 */
export function mergeEntries(layers) {
  let out = null;
  for ( const layer of layers ) {
    if ( !isObject(layer) ) continue;
    const own = Object.keys(layer);
    if ( !own.length ) continue;
    out ??= {};
    // The keys of the layer (a handful), not the hundreds of `MERGE`: called for each item of each actor (`contentOf`).
    // Arranged in the order of `MERGE`, as before — the key order of the merged entry does not change.
    const keys = own.filter(key => RANK.has(key));
    if ( keys.length > 1 ) keys.sort((a, b) => RANK.get(a) - RANK.get(b));
    for ( const key of keys ) out[key] = STRATEGIES[MERGE[key]](out[key], layer[key]);
  }
  return out;
}
