/**
 * Search (SPEC §16.49, 2024 rules), on the searcher's client — like Stealth (runtime/hide.mjs),
 * it is the one who rolls the die:
 *  - the Search item used: the hostile Hidden creatures of the scene are judged (adapter/search.mjs); a Wisdom
 *    (Perception) check, at Disadvantage if one of them is in a Lightly Obscured area for it (core/search.mjs);
 *  - a creature found stops being Hidden ("if an enemy finds you"): its Stealth effect is removed — by the active
 *    GM when it does not belong to the searcher.
 * Searching for an object or a clue stays with the GM: the check is rolled anyway.
 */

import { MODULE_ID } from "../constants.mjs";
import { actsFor, needsCheck } from "../core/requests.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { hiddenEffectsOf } from "../adapter/hide.mjs";
import { searchCandidates, perceptionRollParts, hiddenDcOf } from "../adapter/search.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { searchRollMode, searchVerdicts, searchBonuses } from "../core/search.mjs";
import { wornOrNotEquipment } from "../adapter/triggers.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc, notice, viaOwnerOrGM, rolledAndShown } from "./shared.mjs";
import { spendItemUses } from "../adapter/uses.mjs";

export const SEARCH_QUERY = `${MODULE_ID}.search`;

async function removeHiding(targetUuid, searcherUuid=null, user=null) {
  const target = await fromUuid(targetUuid);
  // §472: from a player, only a Hidden enemy of their own searcher, on the same scene (safety refusal, not forceable).
  if ( needsCheck(user) ) {
    const searcher = searcherUuid ? await fromUuid(searcherUuid) : null;
    if ( !searcher?.actor || !target?.actor || !actsFor(user, searcher.actor) || (searcher.parent !== target.parent)
      || !areEnemies(searcher, target) || (hiddenDcOf(target.actor) === null) ) {
      console.warn(`${MODULE_ID} | search query from ${user.name} refused: ${target?.name ?? targetUuid} is not a hidden enemy of their searcher`);
      return 0;
    }
  }
  const actor = target?.actor;
  const ids = hiddenEffectsOf(actor).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

async function reveal(token, searcher) {
  return viaOwnerOrGM(!!token.actor?.isOwner, SEARCH_QUERY, ({ target, searcher: by }) => removeHiding(target, by),
    { target: token.uuid, searcher: searcher?.uuid ?? null }, { fallback: 0 });
}

async function onPostUse(activity) {
  if ( basicActionOf(activity.item) !== "search" ) return;
  const actor = activity.actor;
  const searcher = usageTokenOf(activity);
  if ( !actor || !searcher ) return;
  const candidates = searchCandidates(searcher);
  const mode = searchRollMode(candidates);
  // §94: what traits add to the search — a die (Lookouts), Advantage (Keen Eye, one use of the item if any remain).
  // An object (Eyes of the Eagle, Robe of Eyes) only counts when worn, and attuned if it requires it.
  const { parts, keen } = searchBonuses(actor.items.map(i => ({ item: i, rule: contentOf(i).entry?.searchBonus ?? null,
    counts: wornOrNotEquipment(i), usesMax: i.system.uses?.max, usesLeft: i.system.uses?.value })));
  // §252: the verdict waits for the 3D dice to finish, then is seen and heard by everyone.
  const rolls = await rolledAndShown(() => actor.rollSkill({ skill: "prc", disadvantage: mode === "disadvantage",
    ...(keen ? { advantage: true } : {}), ...(parts.length ? { rolls: [{ parts }] } : {}) }, { configure: false }));
  const roll = rolls?.[0];
  if ( !Number.isFinite(roll?.total) ) return;
  const verdicts = searchVerdicts(candidates, perceptionRollParts(roll));
  const byId = new Map(candidates.map(c => [c.id, c.token]));
  log(`search: ${actor.name} (${roll.total}, ${mode}) - `
    + (verdicts.map(v => `${byId.get(v.id)?.name} DC ${v.dc}: ${v.found ? "found" : "no"} (${v.reason}${v.total !== undefined ? ` ${v.total}` : ""})`).join("; ") || "no hidden creature"));
  const found = verdicts.filter(v => v.found).map(v => byId.get(v.id)).filter(Boolean);
  // Keen Eye: "if the check fails, the use is not expended".
  if ( keen && found.length && Number(keen.item.system.uses?.max) ) await spendItemUses(keen.item);
  if ( parts.length || keen ) log(`search: ${[...parts, ...(keen ? [`Advantage (${keen.item.name})`] : [])].join(", ")}`);
  for ( const token of found ) {
    await reveal(token, searcher);
    notice(token, { key: "Chercher.Trouve" }, "ended", { all: true, sound: null });
  }
  notice(searcher, { key: found.length ? "Retour.Action.Trouve" : "Retour.Action.Rien" }, found.length ? "gain" : "ended",
    { all: true, action: "search", outcome: found.length ? "success" : "failure" });
  if ( found.length ) ui.notifications.info(loc("Chercher.Trouves", { name: actor.name, names: found.map(t => t.name).join(", ") }));
  else ui.notifications.info(loc("Chercher.Rien", { name: actor.name, total: roll.total }));
}

export function registerSearch() {
  CONFIG.queries[SEARCH_QUERY] = ({ target, searcher=null }={}, { user=null }={}) => removeHiding(target, searcher, user);
  route("dnd5e.postUseActivity", activity => { onPostUse(activity).catch(err => console.error(`${MODULE_ID} | search`, err)); },
    { label: "search" });
}
