/**
 * §181: factions in play — settings, core table kept up to date, deduced disposition, grudges, API.
 *
 * - The core table (`core/factions.mjs`) is reloaded when the canvas loads, when the setting changes and when the grudges
 *   of the displayed scene change; hook `dnd5e-combat.factionsChanged` afterwards (auras recalculate).
 * - **Deduced disposition** (active GM): only an **explicit** relation of a faction with the PCs (`party`) sets the disposition of
 *   its tokens (hostile → Hostile, neutral → Neutral, allied → Friendly), at token creation, at assignment and when
 *   the matrix changes. Without an explicit relation, the disposition is left to the GM.
 * - **Grudge** (active GM, attack resolution output): attacking a creature whose faction is not hostile to yours,
 *   **per an explicit matrix relation**, makes both factions hostile on that scene (flag `grudges`). Without
 *   an explicit relation, nothing changes: this keeps a world without factions as it was.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { pairKey, normalizeFactions, suggestedRelations, dispositionFor, factionRelation, RELATIONS } from "../core/factions.mjs";
import {
  FACTIONS_SETTING, RULES_SETTING, NONE, PARTY, defaultFactions, refreshFactionTable, factionSettings, factionOf, sideOf,
  relationBetween, factionName, explicitFaction
} from "../adapter/factions.mjs";


/** Reload the table and notify (auras, neighbors). */
function changed(scene=canvas?.scene ?? null) {
  refreshFactionTable(scene);
  // §181: on this client, after each reload of the factions table (load, displayed scene, settings, grudges of the displayed
  // scene; and from the caller of `assign` / `stance`): `({ scene })`. Auras recalculate; read-only.
  Hooks.callAll(`${MODULE_ID}.factionsChanged`, { scene });
}

/* -------------------------------------------- */
/*  Setting                                      */
/* -------------------------------------------- */

/** Write the setting (GM): normalized, then dispositions resynchronized. */
export async function saveFactions(value) {
  const before = factionSettings();
  const next = normalizeFactions(value);
  await game.settings.set(MODULE_ID, FACTIONS_SETTING, next);
  const touched = next.factions.map(f => f.id)
    .filter(id => (before.relations[pairKey(id, PARTY)] ?? null) !== (next.relations[pairKey(id, PARTY)] ?? null));
  if ( touched.length ) await syncDispositions({ factions: touched });
  return next;
}

/** Add a faction (id derived from the name). Returns its id. */
export async function addFaction({ name, color }={}) {
  const current = factionSettings();
  const base = (name ?? "faction").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "faction";
  let id = base;
  for ( let n = 2; current.factions.some(f => f.id === id); n++ ) id = `${base}-${n}`;
  await saveFactions({ ...current, factions: [...current.factions, { id, name: name ?? id, color: color ?? "#888888", rules: {} }] });
  return id;
}

/** Remove a faction: its relations go with it; flags that name it are ignored (unknown faction). */
export async function removeFaction(id) {
  if ( id === PARTY ) return false;
  const current = factionSettings();
  await saveFactions({ ...current, factions: current.factions.filter(f => f.id !== id) });
  return true;
}

/** Set a relation (`null`: follow the disposition). */
export async function setRelation(a, b, relation) {
  if ( a === b ) return;
  const current = factionSettings();
  const relations = { ...current.relations };
  if ( RELATIONS.includes(relation) ) relations[pairKey(a, b)] = relation;
  else delete relations[pairKey(a, b)];
  await saveFactions({ ...current, relations });
}

/** The suggested relations, below those already set. */
export async function applySuggested() {
  const current = factionSettings();
  await saveFactions({ ...current, relations: { ...suggestedRelations(current.factions), ...current.relations } });
}

/* -------------------------------------------- */
/*  Affectation                                  */
/* -------------------------------------------- */

const docOf = t => t?.document ?? t ?? null;

/**
 * Assign tokens (or actors) to a faction; `null`: remove the assignment (back to the rules), `"none"`: no
 * faction. An actor: applies to all its tokens that do not have one of their own.
 */
export async function assignFaction(documents, id) {
  const list = (Array.isArray(documents) ? documents : [documents]).map(docOf).filter(Boolean);
  for ( const d of list ) {
    if ( (id === null) || (id === undefined) ) await d.unsetFlag(MODULE_ID, "faction");
    else await d.setFlag(MODULE_ID, "faction", id);
  }
  // An assigned actor: its tokens that carried their own faction keep it; everything that depends on it is resynchronized.
  await syncDispositions({ documents: list });
  changed();
  return list.length;
}

/* -------------------------------------------- */
/*  Deduced disposition                          */
/* -------------------------------------------- */

/** The tokens to bring back in line: those of the affected factions, or of these documents (tokens, or tokens of these actors). */
async function syncDispositions({ factions=null, documents=null }={}) {
  if ( !game.user.isGM ) return;
  refreshFactionTable();
  const actors = new Set((documents ?? []).filter(d => d.documentName === "Actor"));
  const tokens = new Set((documents ?? []).filter(d => d.documentName === "Token"));
  for ( const scene of game.scenes ) {
    const updates = [];
    for ( const token of scene.tokens ) {
      const concerned = factions ? factions.includes(factionOf(token))
        : (tokens.has(token) || actors.has(token.baseActor) || actors.has(token.actor));
      if ( !concerned || token.getFlag(MODULE_ID, "stance") ) continue;
      const wanted = dispositionFor(factionOf(token));
      if ( (wanted !== null) && (wanted !== token.disposition) ) updates.push({ _id: token.id, disposition: wanted });
    }
    if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, { [MODULE_ID]: { faction: true } });
  }
}

/** A token placed: the disposition its faction imposes, if it imposes one. */
function onPreCreateToken(token, data) {
  const wanted = dispositionFor(factionOf(token));
  if ( (wanted !== null) && (wanted !== token.disposition) ) token.updateSource({ disposition: wanted });
}

/* -------------------------------------------- */
/*  Rancunes                                     */
/* -------------------------------------------- */

/** Make two sides hostile on a scene (faction ids or token uuid); `clear`: lift that grudge (or all of them). */
export async function grudge(scene, a, b, { clear=false }={}) {
  if ( !scene ) return [];
  let list = (scene.getFlag(MODULE_ID, "grudges") ?? []).filter(g => Array.isArray(g) && (g.length === 2));
  const same = ([x, y]) => ((x === a) && (y === b)) || ((x === b) && (y === a));
  if ( clear ) list = (a && b) ? list.filter(g => !same(g)) : [];
  else if ( a && b && (a !== b) && !list.some(same) ) list = [...list, [a, b]];
  else return list;
  await scene.setFlag(MODULE_ID, "grudges", list);
  return list;
}

/** Attack resolution output: the victim of a non-hostile faction (explicit relation) holds a grudge for it. */
async function onResolution(resolution) {
  if ( !resolution?.plan?.attack ) return;
  const scene = canvas.scene;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const attacker = source?.isToken ? source.token : source?.getActiveTokens?.(false, true)?.find(t => t.parent === scene)?.document;
  if ( !attacker || (attacker.parent !== scene) ) return;
  const a = sideOf(attacker);
  for ( const t of resolution.targets ?? [] ) {
    const target = fromUuidSync(t.token ?? "", { strict: false });
    if ( !target || (target === attacker) || (target.parent !== scene) ) continue;
    const b = sideOf(target);
    if ( !a.faction || !b.faction || (a.faction === b.faction) ) continue;
    const relation = factionRelation(a, b);
    if ( !relation || (relation === "hostile") ) continue;
    await grudge(scene, a.faction, b.faction);
    log(`factions: ${a.faction} attacked ${b.faction} — grudge on this scene`);
    // A grudge against the PCs: the disposition of the victim's tokens follows, on that scene.
    const other = a.faction === PARTY ? b.faction : (b.faction === PARTY ? a.faction : null);
    if ( other ) {
      const updates = scene.tokens.filter(tok => (factionOf(tok) === other) && !tok.getFlag(MODULE_ID, "stance") && (tok.disposition !== -1))
        .map(tok => ({ _id: tok.id, disposition: -1 }));
      if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, { [MODULE_ID]: { faction: true } });
    }
  }
}

/* -------------------------------------------- */
/*  API et inscription                           */
/* -------------------------------------------- */

/** `api.factions` (§181): read for everyone, write for the GM. */
export const factionsApi = Object.freeze({
  /**
   * A token's faction id (set on the token, else on the actor, else `party` for a PC, else the setting's rules), or null.
   */
  of: token => factionOf(token),
  /** The faction set by hand (token, else actor), without the rules or `party`; null if none. */
  explicit: token => explicitFaction(token),
  /** The relation of two tokens: `"hostile"`, `"neutral"` or `"allied"` (factions matrix, else deduced from the dispositions). */
  relation: (a, b) => relationBetween(a, b),
  /** A token's side as the engine compares it: `{ disposition, faction, uuid, stance }`. */
  side: token => sideOf(token),
  /** The setting's factions, each with its displayed name (`label`). */
  list: () => factionSettings().factions.map(f => ({ ...f, label: factionName(f) })),
  /** A copy of the relations matrix: `{ "<id>|<id>": relation }` (an absent pair follows the disposition). */
  relations: () => ({ ...factionSettings().relations }),
  /** The displayed name of faction `id` (translated, unless the GM renamed it). */
  name: id => factionName(factionSettings().factions.find(f => f.id === id)),
  /**
   * Sets faction `id` (null: removes it) on tokens or actors — write permission on these documents required (the GM);
   * returns their count.
   */
  assign: (documents, id) => assignFaction(documents, id),
  setRelation, add: addFaction, remove: removeFaction, suggest: applySuggested,
  /**
   * Makes two sides (faction ids or token uuid) hostile on a scene (the displayed scene by default), or lifts that grudge
   * (`clear`); writes the scene (GM) and returns the list of grudges.
   */
  grudge: (a, b, { clear=false, scene=canvas?.scene }={}) => grudge(scene, a, b, { clear }),
  /** A scene's grudges (the displayed scene by default): `[[a, b], …]`. */
  grudges: (scene=canvas?.scene) => scene?.getFlag(MODULE_ID, "grudges") ?? [],
  /** Poser ou lever l'attitude d'un token (`"neutral"` : rendu, l'ennemi de personne hors de sa faction). */
  stance: async (token, stance=null) => {
    const d = docOf(token);
    if ( stance ) await d.setFlag(MODULE_ID, "stance", stance);
    else await d.unsetFlag(MODULE_ID, "stance");
    changed();
  },
  NONE, PARTY
});

export function registerFactions() {
  game.settings.register(MODULE_ID, FACTIONS_SETTING, {
    scope: "world", config: false, type: Object, default: defaultFactions(),
    onChange: () => changed()
  });
  game.settings.register(MODULE_ID, RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: () => changed()
  });
  refreshFactionTable(null);
  const label = { label: "factions: table refreshed" };
  route("ready", () => changed(), label);
  route("canvasReady", canvas => changed(canvas.scene), label);
  route("updateScene", (scene, changes) => {
    if ( (scene === canvas?.scene) && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) changed(scene);
  }, label);
  route("preCreateToken", onPreCreateToken, { label: "factions: disposition from faction" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "factions: grudge not recorded" });
}
