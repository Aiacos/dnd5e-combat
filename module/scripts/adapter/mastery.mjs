/**
 * Weapon mastery properties (SPEC §21) read and written in dnd5e 6.0: the mastery property used by an attack, the marks that
 * Sap, Vex and Slow place (engine effects, `flags["dnd5e-combat"].mastery`), the Advantage and Disadvantage that they
 * give, and the creatures that Cleave can reach. The rules are in core/mastery.mjs.
 *
 * Verified in dnd5e 6.0.3:
 *  - the attack message carries the mastery property used in `system.mastery` (data/chat-message/attack-message-data.mjs:29),
 *    chosen among the weapon's `masteryOptions` — only if the actor has mastery of the base weapon (data/item/weapon.mjs:331);
 *  - the attack's ability is `system.ability` of the same message;
 *  - Speed is reduced through `system.attributes.movement.bonus`, added to each non-zero speed (attributes.mjs:563-567).
 */

import { MODULE_ID } from "../constants.mjs";
import { isWithinRange } from "../core/units.mjs";
import { readUnitFactors, lengthIn } from "./units.mjs";
import { distanceBetween, reachOf, combatantFor, currentTurnKey } from "./turn.mjs";
import { isObjectToken } from "./bodies.mjs";
import { isDeadActor } from "./death.mjs";
import { areEnemies } from "./factions.mjs";
import { masterySources, standingMastery, standingChoiceToStore } from "../core/mastery.mjs";

const loc = (key, data) => game.i18n.format(`DND5ECOMBAT.Botte.${key}`, data ?? {});

/** The mastery property used by this attack roll, or null. */
export const masteryOf = attackMessage => attackMessage?.system?.mastery ?? null;

/** The modifier of the ability used for this attack roll. */
export function attackModOf(attackMessage) {
  const actor = attackMessage?.getAssociatedActor?.();
  const ability = attackMessage?.system?.ability;
  return Number(actor?.system?.abilities?.[ability]?.mod) || 0;
}

/** The mastery marks of one kind carried by an actor. */
export function marksOn(actor, kind=null) {
  return Array.from(actor?.effects ?? []).filter(e => {
    const m = e.getFlag?.(MODULE_ID, "mastery");
    return m && (!kind || (m.kind === kind));
  });
}

const IMAGES = Object.freeze({ sap: "icons/svg/downgrade.svg", vex: "icons/svg/target.svg", slow: "icons/svg/net.svg", studied: "icons/svg/eye.svg",
  reckless: "icons/svg/sword.svg" });

/**
 * A mark's effect. `bearer`: who carries it (the target for Sap and Slow, the attacker for Vex).
 * @param {"sap"|"vex"|"slow"} kind
 * @param {{source: TokenDocument, target: TokenDocument, weapon: Item5e, turnKey: string|null}} context
 */
export function markData(kind, { source, target, weapon, turnKey }) {
  const changes = [];
  if ( kind === "slow" ) {
    // "Reduce its Speed by 10 feet": 10 ft, in the speed unit of the slowed creature.
    const units = target.actor?.system?.attributes?.movement?.units ?? "ft";
    let value = lengthIn(10, "ft", units);
    changes.push({ key: "system.attributes.movement.bonus", value: String(-value), type: "add" });
  }
  return {
    name: loc(`Marque.${kind}`, { source: source.name, target: target.name, weapon: weapon?.name ?? "" }),
    img: IMAGES[kind],
    transfer: false, disabled: false,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    origin: weapon?.uuid ?? null,
    // Out of combat, a mark lasts only one round (up to the GM to remove it earlier); in combat, the engine removes
    // it at the right time.
    duration: { value: 12, units: "seconds" },
    system: { changes },
    flags: { [MODULE_ID]: { mastery: {
      kind, source: source.actor?.uuid ?? null, sourceToken: source.uuid, target: target.uuid,
      combatant: combatantFor(source.actor)?.id ?? null, placedOn: turnKey
    } } }
  };
}

/**
 * The Advantage and Disadvantage that the marks give for an attack by `sourceToken` against `targetToken`: Sap carried by
 * the attacker (Disadvantage on their next roll), Vex carried by the attacker against this target (Advantage).
 * @returns {{advantage: string[], disadvantage: string[], consumed: ActiveEffect[]}}
 */
export function markModifiers(sourceToken, targetToken, activity=null) {
  const out = { advantage: [], disadvantage: [], consumed: [] };
  const attacker = sourceToken?.actor;
  if ( !attacker ) return out;
  // §22: Reckless Attack — "Advantage on attack rolls using Strength", and "attack rolls against you have Advantage".
  // Until the start of their next turn; nothing is consumed.
  if ( (activity?.ability === "str") ) for ( const effect of marksOn(attacker, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(targetToken?.actor, "reckless") ) out.advantage.push(effect.name);
  for ( const effect of marksOn(attacker, "sap") ) {
    out.disadvantage.push(effect.name);
    out.consumed.push(effect);
  }
  // Vex, and the Fighter's Studied Attacks (§21): Advantage against the marked creature only.
  for ( const effect of [...marksOn(attacker, "vex"), ...marksOn(attacker, "studied")] ) {
    if ( effect.getFlag(MODULE_ID, "mastery").target !== targetToken?.uuid ) continue;
    out.advantage.push(effect.name);
    out.consumed.push(effect);
  }
  return out;
}

/**
 * Cleave: the creatures that a second attack can target — hostile to the attacker, other than the first, within 5 feet
 * of it and within the weapon's reach, neither dead nor hidden, not objects.
 * @param {TokenDocument} attacker
 * @param {TokenDocument} first
 * @param {Activity} activity
 */
export function cleaveCandidates(attacker, first, activity) {
  const factors = readUnitFactors();
  const r = reachOf(activity);
  const reach = { value: r.value ?? 5, units: r.units ?? "ft" };   // reach not set: 5 ft
  const near = (a, b, range) => { try { return isWithinRange(distanceBetween(a, b), range, factors); } catch { return false; } };
  return first.parent.tokens.filter(t => (t !== first) && (t !== attacker) && t.actor && !t.hidden && !isObjectToken(t)
    && !isDeadActor(t.actor) && ((t.actor.system.attributes?.hp?.value ?? 1) > 0)
    && areEnemies(attacker, t)
    && near(first, t, { value: 5, units: "ft" }) && near(attacker, t, reach));
}

/** Cleave already used this combat turn by this actor? ("once per turn"; out of combat, never.) */
export const cleaveSpent = actor => !!currentTurnKey() && (actor?.getFlag(MODULE_ID, "cleaveTurn") === currentTurnKey());

/* -------------------------------------------- */
/*  Les bottes choisies (§222)                  */
/* -------------------------------------------- */

/**
 * The actor flag set at the end of a Long Rest: `{ allowance }`, the number of mastery properties the player can still change.
 * Removed once spent, or when the actor enters combat.
 */
export const MASTERY_REST_FLAG = "masteryRest";

/** The chosen mastery properties, as recorded (not those an effect adds): `system.traits.weaponProf.mastery.value`. */
export const chosenMasteries = actor => Array.from(actor?._source?.system?.traits?.weaponProf?.mastery?.value ?? []);

/** Ce qu'un Repos long laisse encore changer. */
export const restAllowanceOf = actor => Math.max(0, Number(actor?.getFlag?.(MODULE_ID, MASTERY_REST_FLAG)?.allowance) || 0);

/**
 * The actor's mastery sources (core/mastery.mjs `masterySources`): "Trait" advancements in "mastery" mode on its items —
 * class (data/item/class.mjs, `system.levels`), subclass (its class's level, `item.class`), feat or other (always).
 * Read from the item's source (`_source.system.advancement`, object by id in dnd5e 6).
 */
export function masterySourcesOf(actor) {
  const items = [];
  for ( const item of actor?.items ?? [] ) {
    const advancements = Object.values(item._source?.system?.advancement ?? {})
      .filter(a => (a?.type === "Trait") && (a.configuration?.mode === "mastery"))
      .map(a => ({ level: Number(a.level) || 0,
        count: (a.configuration?.grants?.length ?? 0) + (a.configuration?.choices ?? []).reduce((n, c) => n + (Number(c.count) || 0), 0) }));
    if ( !advancements.length ) continue;
    const owner = classOwnerOf(item);
    const classLevel = (owner.type === "class") ? Number(owner.system.levels)
      : (owner.type === "subclass") ? Number(owner.class?.system?.levels ?? NaN) : null;
    items.push({ item: item.id, label: (owner.type === "class") ? `${owner.name} ${classLevel}` : owner.name,
      identifier: (owner.type === "subclass") ? (owner.system.classIdentifier ?? "") : (owner.system.identifier ?? ""),
      kind: owner.type, classLevel, advancements });
  }
  return masterySources(items);
}

/**
 * The class (or subclass) an item gets its mastery advancements from: itself if it is one; otherwise the root of its
 * assignment when dnd5e links it there (dnd5e 6.1 / PHB 3.0: the "Weapon Mastery" feature granted by the class carries the tiers,
 * `system.advancementRootItem` + `advancementClassLinked`, data/abstract/item-data-model);
 * otherwise the item (a feat: all of it counts).
 */
function classOwnerOf(item) {
  if ( (item.type === "class") || (item.type === "subclass") ) return item;
  if ( item.system?.advancementClassLinked === false ) return item;
  const root = item.system?.advancementRootItem;
  return ((root?.type === "class") || (root?.type === "subclass")) ? root : item;
}

/** The feature or feat that opens the mastery window: a class's "Weapon Mastery", "Weapon Master". */
export const MASTERY_FEATURES = Object.freeze(["weapon-mastery", "weapon-master"]);

let weaponIndex = null;

/**
 * dnd5e's base weapons (`CONFIG.DND5E.weaponIds`): key, name (`Trait.keyLabel`, translated), melee or ranged, category
 * (`weaponProficienciesMap`), mastery property (`system.mastery` of the compendium item, read from its index).
 * The index is read once.
 * @returns {Promise<Array<{key: string, label: string, melee: boolean, category: string|null, mastery: string|null}>>}
 */
export async function baseWeapons() {
  if ( weaponIndex ) return weaponIndex;
  const fields = ["system.mastery", "system.type.value"];
  const packs = new Map();
  const out = [];
  for ( const [key, id] of Object.entries(CONFIG.DND5E.weaponIds ?? {}) ) {
    const uuid = dnd5e.documents.Trait.getBaseItemUUID(id);
    const { collection, documentId } = foundry.utils.parseUuid(uuid);
    let entry = null;
    if ( collection ) {
      const pack = collection.metadata.id;
      if ( !packs.has(pack) ) packs.set(pack, await collection.getIndex({ fields }).catch(() => null));
      entry = packs.get(pack)?.get(documentId) ?? null;
    }
    const type = entry?.system?.type?.value ?? "";
    out.push({ key, label: dnd5e.documents.Trait.keyLabel(key, { trait: "weapon" }) ?? key, melee: !type.endsWith("R"),
      category: CONFIG.DND5E.weaponProficienciesMap?.[type] ?? null, mastery: entry?.system?.mastery || null });
  }
  weaponIndex = out.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
  return weaponIndex;
}

/** Is the actor proficient with this base weapon (its category or itself, prepared `system.traits.weaponProf.value`)? */
export function proficientWith(actor, weapon) {
  const prof = actor?.system?.traits?.weaponProf?.value;
  const has = k => (prof?.has?.(k) ?? Array.from(prof ?? []).includes(k));
  return has(weapon.key) || (!!weapon.category && has(weapon.category));
}

/**
 * The base weapons, as the rule judges them for this actor: `{ clé: { melee, proficient } }`. Synchronous (for a `pre…` hook):
 * empty until `baseWeapons()` has been read once (the engine reads it at `ready`).
 */
export function weaponFacts(actor) {
  return Object.fromEntries((weaponIndex ?? []).map(w => [w.key, { melee: w.melee, proficient: proficientWith(actor, w) }]));
}

/* -------------------------------------------- */
/*  Standing mastery per weapon (§537, #160)    */
/* -------------------------------------------- */

/** The weapon flag holding the standing choice (`flags["dnd5e-combat"].standingMastery`): a mastery key; absent = the weapon's own. */
export const STANDING_FLAG = "standingMastery";

/**
 * The masteries an attack with this weapon may use, its own first: dnd5e `system.masteryOptions` (data/item/weapon.mjs:331 — null
 * unless the actor has mastery of the base weapon; extras from `weaponProf.mastery.bonus`, which Tactical Master's effect fills).
 * @returns {string[]}
 */
export const masteryChoicesOf = item => (item?.system?.masteryOptions ?? []).map(o => o.value).filter(Boolean);

/** The stored choice, as written (may no longer be offered). */
export const storedStandingOf = item => item?.getFlag?.(MODULE_ID, STANDING_FLAG) ?? null;

/** The mastery the next attack with this weapon uses, or null when there is nothing to choose (core `standingMastery`). */
export const standingMasteryOf = item => standingMastery(masteryChoicesOf(item), storedStandingOf(item));

/** The actor's weapons that offer a choice of mastery: equipped first, then the others. */
export function weaponsWithChoice(actor) {
  const weapons = Array.from(actor?.items ?? []).filter(i => (i.type === "weapon") && (masteryChoicesOf(i).length > 1));
  return weapons.sort((a, b) => Number(!!b.system?.equipped) - Number(!!a.system?.equipped));
}

/** The translated label of a mastery key (dnd5e `CONFIG.DND5E.weaponMasteries`). */
export const masteryLabel = key => game.i18n.localize(CONFIG.DND5E.weaponMasteries?.[key]?.label ?? key);

/**
 * Store a new standing choice on the weapon: unset for its own mastery. Returns the mastery now used, or undefined when the weapon
 * does not offer `choice`.
 */
export async function storeStanding(item, choice) {
  const options = masteryChoicesOf(item);
  const value = standingChoiceToStore(options, choice);
  if ( value === undefined ) return undefined;
  if ( value === null ) await item.unsetFlag(MODULE_ID, STANDING_FLAG);
  else await item.setFlag(MODULE_ID, STANDING_FLAG, value);
  return standingMastery(options, value);
}
