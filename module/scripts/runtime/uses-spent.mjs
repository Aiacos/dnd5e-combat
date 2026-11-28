/**
 * §458: `onUsesSpent: { activity?, effects }` — when the item's uses are exhausted, these effects of the item are placed on its
 * bearer, once. The six books of the Dungeon Master's Guide (Manual of Bodily Health, Manual of Gainful Exercise, Manual of
 * Quickness of Action; Tome of Clear Thought, Tome of Leadership and Influence, Tome of Understanding): "Read" (`activity`, for
 * the record) ticks off an hour of reading (48 uses); the +2 to the ability score comes after the full 48 hours, not at each hour
 * (the data forgot it, or placed it at every reading).
 *
 * On the counter update (`updateItem`, `system.uses.spent`), active GM: at `dnd5e.postUseActivity`, the item does not yet show
 * the use that was just counted down (seen on the test bench: 47 / 48 at the hook of the 48th reading). "Reset Progress" sets the
 * counter to zero: it triggers nothing. Only once: an effect already placed by this book (`usesSpent` mark) is not placed again.
 * Feedback for the whole table: text and sound, chat card.
 */

import { MODULE_ID } from "../constants.mjs";
import { CORE_SOUNDS } from "../core/action-feedback.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { locEsc, log, notice, say } from "./shared.mjs";

const tokenOfActor = actor => actor?.getActiveTokens?.(false, true)?.[0] ?? null;

async function onUpdateItem(item, changes) {
  if ( !foundry.utils.hasProperty(changes, "system.uses.spent") ) return;
  const actor = item?.actor;
  if ( !actor ) return;
  const rule = contentOf(item).entry?.onUsesSpent;
  if ( !rule ) return;
  const uses = item.system?.uses;
  if ( !(Number(uses?.max) > 0) || (Number(uses.value) > 0) ) return;
  const source = item._stats?.compendiumSource ?? item.uuid;
  const already = actor.effects.filter(e => e.getFlag(MODULE_ID, "usesSpent")?.source === source).map(e => e.getFlag(MODULE_ID, "usesSpent").effect);
  const data = rule.effects.filter(id => !already.includes(id)).map(id => item.effects.get(id)).filter(Boolean).map(effect => {
    const d = effect.toObject();
    delete d._id;
    d.transfer = false;
    d.disabled = false;
    d.origin = source;
    foundry.utils.setProperty(d, `flags.${MODULE_ID}.usesSpent`, { source, effect: effect.id });
    return d;
  });
  if ( !data.length ) return;
  const created = await actor.createEmbeddedDocuments("ActiveEffect", data);
  const names = created.map(e => e.name).join(", ");
  notice(tokenOfActor(actor), { key: "Retour.Acheve", data: { item: item.name, effect: names } }, "gain", { all: true, sound: CORE_SOUNDS.chime });
  await say({ actor }, [locEsc("Retour.AcheveCarte", { actor: actor.name, item: item.name, effect: names })]);
  log(`${actor.name}: ${item.name} completed, ${names} applied`);
}

export function registerUsesSpent() {
  route("updateItem", onUpdateItem, { executor: true, label: "effect of a completed item not applied" });
}
