/**
 * §181: a token's faction and its "side", read from Foundry; the core table (`core/factions.mjs`) kept up to date.
 *
 * A token's faction, in order: token flag `flags.dnd5e-combat.faction` (the GM set it on this token) > actor flag
 * (set on the actor: applies to all its tokens, linked or not) > `party` for a PC or what a player owns >
 * the first type rule that matches (setting `factionRules`) > none. A value `"none"` in a flag means
 * "no faction" and stops the search.
 *
 * World setting `factions`: `{ factions: [{ id, name, color, rules }], relations: { "a|b": relation } }` (normalized by the
 * core). Grudges: scene flag `flags.dnd5e-combat.grudges`, pairs `[a, b]` of faction ids or token uuids.
 */

import { MODULE_ID } from "../constants.mjs";
import { settingOr } from "./settings.mjs";
import {
  PARTY, GENERIC_FACTIONS, normalizeFactions, factionByRules, useFactionTable, factionTable, hostileSides, alliedSides,
  targetRelation, factionRelation
} from "../core/factions.mjs";

export const FACTIONS_SETTING = "factions";
export const RULES_SETTING = "factionRules";
export const NONE = "none";

/** The default setting: PCs and generic factions, no relation (everything follows disposition). */
export function defaultFactions() {
  return { factions: [{ id: PARTY, color: "#3a7bd5", rules: {} }, ...GENERIC_FACTIONS.map(f => ({ ...f, name: "", rules: { ...f.rules } }))], relations: {} };
}

let settings = normalizeFactions(defaultFactions());

/** A faction's display name (generic: translated, if the GM has not renamed it). */
export function factionName(faction) {
  if ( !faction ) return "";
  if ( faction.name ) return faction.name;
  const key = faction.id === PARTY ? "DND5ECOMBAT.Factions.Party" : `DND5ECOMBAT.Factions.Generic.${faction.id}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : faction.id;
}

/** The normalized setting, as the core reads it. */
export function factionSettings() {
  return settings;
}

const readSetting = () => {
  return settingOr(FACTIONS_SETTING, null);
};
const rulesOn = () => {
  return settingOr(RULES_SETTING, true) !== false;
};

/** Reload the core table: setting + grudges of the displayed scene. */
export function refreshFactionTable(scene=globalThis.canvas?.scene ?? null) {
  settings = normalizeFactions(readSetting() ?? defaultFactions());
  const grudges = (scene?.getFlag?.(MODULE_ID, "grudges") ?? []).filter(g => Array.isArray(g) && (g.length === 2));
  useFactionTable({ factions: settings.factions, relations: settings.relations, grudges });
}

const doc = t => t?.document ?? t ?? null;

/** A PC, or a creature a player owns (familiar, summon)? */
function isParty(actor) {
  return !!actor && ((actor.type === "character") || !!actor.hasPlayerOwner);
}

/** A token's faction (document or object), or null. */
export function factionOf(token) {
  const t = doc(token);
  if ( !t ) return null;
  const known = id => settings.factions.some(f => f.id === id);
  const own = t.getFlag?.(MODULE_ID, "faction");
  if ( own === NONE ) return null;
  if ( own && known(own) ) return own;
  const actor = t.actor ?? null;
  const fromActor = actor?.getFlag?.(MODULE_ID, "faction");
  if ( fromActor === NONE ) return null;
  if ( fromActor && known(fromActor) ) return fromActor;
  if ( isParty(actor) ) return PARTY;
  if ( !actor || !rulesOn() ) return null;
  const details = actor.system?.details ?? {};
  return factionByRules(settings.factions, {
    type: details.type?.value ?? null, subtype: details.type?.subtype ?? null, identifier: actor.system?.identifier ?? null
  });
}

/** The faction set by hand (token, otherwise actor), without the rules: for the interface. */
export function explicitFaction(token) {
  const t = doc(token);
  return t?.getFlag?.(MODULE_ID, "faction") ?? t?.actor?.getFlag?.(MODULE_ID, "faction") ?? null;
}

/**
 * A token's side, what the core compares: `{ disposition, faction, uuid, stance }`. `disposition` can be forced
 * (a controlled object takes its caster's, `runtime/actions.mjs` `hostileTo`).
 */
export function sideOf(token, { disposition }={}) {
  const t = doc(token);
  if ( !t ) return { disposition: disposition ?? null };
  return {
    disposition: disposition ?? t.disposition, faction: factionOf(t), uuid: t.uuid ?? null,
    stance: t.getFlag?.(MODULE_ID, "stance") ?? null
  };
}

/** Ennemis ? (factions, sinon Amical contre Hostile) */
export function areEnemies(a, b) {
  return hostileSides(sideOf(a), sideOf(b));
}

/** Same side? (factions, otherwise same disposition) */
export function areAllies(a, b) {
  return alliedSides(sideOf(a), sideOf(b));
}

/** For targeting: "same", "opposed", "neutral". */
export function relationForTargeting(a, b) {
  return targetRelation(sideOf(a), sideOf(b));
}

/** The public relation: `hostile`, `neutral` or `allied` (factions, otherwise deduced from the dispositions). */
export function relationBetween(a, b) {
  const sa = sideOf(a), sb = sideOf(b);
  const r = factionRelation(sa, sb);
  if ( r ) return r;
  if ( hostileSides(sa, sb) ) return "hostile";
  return alliedSides(sa, sb) ? "allied" : "neutral";
}

export { factionTable, PARTY };

/** Declared allies: same side **and** not neutral (no allies for neutrals) — factions, else Friendly/Friendly or Hostile/Hostile. */
export function areSworn(a, b) {
  const sa = sideOf(a), sb = sideOf(b);
  const r = factionRelation(sa, sb);
  if ( r ) return r === "allied";
  return [1, -1].includes(sa.disposition) && (sa.disposition === sb.disposition);
}
