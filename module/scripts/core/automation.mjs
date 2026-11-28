/**
 * What the engine does with an item, for the sheet badge (SPEC §9.2): a classification readable by the GM,
 * not a rule. Nothing here decides a resolution.
 *
 *   rule     a rule specific to the engine (declared content, recognized identifier, variants read from the text)
 *   auto     the common path: an activity that rolls, places an effect, summons, transforms or casts a spell
 *   passive  no gesture: permanent effects (transfer) that dnd5e applies on its own
 *   manual   none of the above: an empty activity, or no activity at all
 *   none     gear with nothing to play (loot, container, focus): no badge, the flag stays
 */

/** dnd5e 6 activity types that the common path resolves with nothing more (data/activity/, `metadata.type`). */
export const AUTO_ACTIVITY_TYPES = Object.freeze(["attack", "save", "damage", "heal", "check", "summon", "enchant",
  "transform", "cast", "forward"]);

/**
 * @param {object} desc
 * @param {string[]} [desc.rules]  what the engine recognizes on its own (content keys, "multiattack"…)
 * @param {Array<{type: string, roll?: boolean, effects?: number}>} [desc.activities]
 * @param {number} [desc.passiveEffects]  active transferred effects, or what dnd5e computes on its own (an armor's AC)
 * @param {boolean} [desc.gear]  gear (item, loot, container), not a capability or a spell
 * @returns {{level: "rule"|"auto"|"passive"|"manual"|"none", rules: string[]}}
 */
export function automationOf({ rules=[], activities=[], passiveEffects=0, gear=false }={}) {
  if ( rules.length ) return { level: "rule", rules: [...rules] };
  const acts = activities.some(a => AUTO_ACTIVITY_TYPES.includes(a.type) || a.roll || (a.effects > 0));
  if ( acts ) return { level: "auto", rules: [] };
  if ( passiveEffects > 0 ) return { level: "passive", rules: [] };
  return { level: (gear && !activities.length) ? "none" : "manual", rules: [] };
}

/**
 * The reports grouped by actor, for the end-of-game summary.
 * @param {Record<string, {actor: string, item: string, note?: string, at: number}>} entries
 * @returns {Array<{actor: string, items: Array<{key: string, item: string, note: string, at: number}>}>}
 */
export function reportsByActor(entries={}) {
  const groups = new Map();
  for ( const [key, e] of Object.entries(entries) ) {
    const list = groups.get(e.actor) ?? [];
    list.push({ key, item: e.item, note: e.note ?? "", at: e.at ?? 0 });
    groups.set(e.actor, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([actor, items]) => ({ actor, items: items.sort((a, b) => a.item.localeCompare(b.item)) }));
}

/** The summary as plain text, to paste into a conversation. */
export function reportsText(entries={}) {
  return reportsByActor(entries).map(({ actor, items }) =>
    [`${actor}`, ...items.map(i => `  - ${i.item}${i.note ? ` : ${i.note}` : ""}`)].join("\n")).join("\n");
}
