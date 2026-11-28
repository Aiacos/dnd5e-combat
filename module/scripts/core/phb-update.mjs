/**
 * §438: what separates an item on a sheet from its Player's Handbook reference, since Handbook 3.0.0 (dnd5e 6.1 SRD identifiers,
 * activities and effects redone). Pure: both sides are read as simple objects (adapter: runtime/diagnostic/checks.mjs).
 *
 * Form read: `{ identifier, activities: { id: { type, effects: [id], damage: [formule], level: "min-max" } },
 * effects: { id: [changement] },
 * advancement: nombre }` — nothing that is specific to the sheet (spent uses, preparation, translated name).
 */

/** Do the two lists have the same elements, in any order? */
const sameSet = (a, b) => (a.length === b.length) && a.every(x => b.includes(x));

/**
 * The reasons to replace the item with its reference, in order: `identifier`, `activities` (ids added or removed), `effects`
 * (same), `content` (same ids, different content: type, effects applied, damage, level range of an activity; changes of an
 * effect), `advancement` (the reference carries advancements that the item does not — a choice to redo on the sheet).
 * Nothing: `[]`.
 */
export function phbDifferences(own, reference) {
  const out = [];
  if ( reference.identifier && (own.identifier !== reference.identifier) ) out.push("identifier");
  const ownActs = Object.keys(own.activities ?? {}), refActs = Object.keys(reference.activities ?? {});
  const ownEffs = Object.keys(own.effects ?? {}), refEffs = Object.keys(reference.effects ?? {});
  if ( !sameSet(ownActs, refActs) ) out.push("activities");
  if ( !sameSet(ownEffs, refEffs) ) out.push("effects");
  const shared = (a, b) => a.filter(id => b.includes(id));
  const differs = shared(ownActs, refActs).some(id => JSON.stringify(own.activities[id]) !== JSON.stringify(reference.activities[id]))
    || shared(ownEffs, refEffs).some(id => JSON.stringify(own.effects[id]) !== JSON.stringify(reference.effects[id]));
  if ( differs ) out.push("content");
  if ( (reference.advancement ?? 0) > (own.advancement ?? 0) ) out.push("advancement");
  return out;
}

/**
 * The compared form of an item (source data, `toObject()` or `_source`): what makes up its automation, not its state.
 * @param {object} data      `{ system, effects }` of the item.
 */
export function phbShape(data) {
  const system = data?.system ?? {};
  const activities = {};
  for ( const [id, a] of Object.entries(system.activities ?? {}) ) {
    activities[id] = {
      type: a?.type ?? null,
      effects: (a?.effects ?? []).map(e => e?.uuid ?? e?._id ?? null).sort(),
      damage: (a?.damage?.parts ?? []).map(p => (p?.custom?.enabled ? p.custom.formula : `${p?.number ?? ""}d${p?.denomination ?? ""}${p?.bonus ? `+${p.bonus}` : ""}`)),
      level: `${a?.visibility?.level?.min ?? ""}-${a?.visibility?.level?.max ?? ""}`,
      // A "forward" activity: the activity it casts (undefined otherwise, so absent from the comparison).
      forwardTo: (a?.type === "forward") ? (a?.activity?.id ?? null) : undefined
    };
  }
  const effects = {};
  for ( const e of data?.effects ?? [] ) {
    effects[e._id] = (e.system?.changes ?? e.changes ?? []).map(c => `${c.key}|${c.type ?? c.mode ?? ""}|${c.value}`).sort();
  }
  return { identifier: system.identifier ?? "", activities, effects, advancement: Object.keys(system.advancement ?? {}).length };
}

/**
 * §547: the activities a spell grant added to the sheet's copy — dnd5e gives a spell granted with free uses a "forward" activity
 * casting each slot-consuming activity, under a random id (`SpellConfigurationData#applySpellChanges`, spell-config.mjs:101-117). The
 * Handbook's reference never has it: compared as is, a granted spell (Divine Smite, Darkness of a drow…) was listed again after every
 * replacement. Returns the ids of the own forward activities absent from the reference whose target is an activity of the reference.
 * @param {ReturnType<typeof phbShape>} own
 * @param {ReturnType<typeof phbShape>} reference
 */
export function grantedForwards(own, reference) {
  const refIds = Object.keys(reference.activities ?? {});
  return Object.entries(own.activities ?? {})
    .filter(([id, a]) => !refIds.includes(id) && (a.type === "forward") && refIds.includes(a.forwardTo))
    .map(([id]) => id);
}

/** The own shape without the activities its spell grant added (`grantedForwards`), to compare with the reference. */
export function withoutGrantedForwards(own, reference) {
  const drop = grantedForwards(own, reference);
  if ( !drop.length ) return own;
  return { ...own, activities: Object.fromEntries(Object.entries(own.activities).filter(([id]) => !drop.includes(id))) };
}

/** The `sourceItem` of a spell given by a renamed subclass (`subclass:<ancien>` → `subclass:<nouveau>`), otherwise null. */
export function renamedSourceItem(sourceItem, from, to) {
  return (sourceItem === `subclass:${from}`) ? `subclass:${to}` : null;
}

/** Does an item's data cite the subclass under its old identifier (`@scale.<id>.`, `@subclasses.<id>.`)? */
export function citesSubclass(system, identifier) {
  const text = JSON.stringify(system ?? {});
  return text.includes(`@scale.${identifier}.`) || text.includes(`@subclasses.${identifier}.`);
}
