/**
 * §204: an item or an actor created from a translated compendium (Babele) immediately takes the translation of what stayed
 * in the original language — what the "Texts left in the original language" diagnostic repairs after the fact (§203). Cases
 * seen: a player without the right to browse files (Babele translates nothing for them), a client set to another language, a
 * translation that does not translate effect names ("Projectile percutant", enchantment "Walloping Ammunition").
 *
 * Done by the active GM, in the language of their client, on `createItem` / `createActor` (for an actor: it and its items, created
 * with it without `createItem`). Same rule as the diagnostic (adapter/retranslate.mjs): only texts still identical to
 * the original change; identifiers and activity and effect ids do not move. `autoTranslate` world setting.
 */
import { MODULE_ID } from "../constants.mjs";
import { referenceReader, retranslationOf, applyRetranslation, sourceOf } from "../adapter/retranslate.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const AUTO_TRANSLATE_SETTING = "autoTranslate";

const enabled = () => !!game.babele && game.settings.get(MODULE_ID, AUTO_TRANSLATE_SETTING);

/** Does the document still exist? Compendium read done, it may have been deleted in the meantime. */
function exists(doc) {
  try { return !!fromUuidSync(doc.uuid, { strict: false }); } catch { return false; }
}

async function retranslate(docs) {
  const reference = referenceReader();
  for ( const doc of docs ) {
    const plan = await retranslationOf(doc, reference);
    if ( !plan.fields.length ) continue;
    // Wild Shape at 0 HP (scenario `forme-sauvage`, test bench 2026-11-11): the transformed actor is removed during the
    // reading of the reference, and its update failed ("The Actor … does not exist in actors"). Nothing to translate.
    if ( !exists(doc) ) continue;
    try { await applyRetranslation(doc, plan); }
    catch(err) { if ( exists(doc) ) throw err; continue; }
    log(`translation applied on creation: ${doc.name} (${[...new Set(plan.fields)].join(", ")})`);
  }
}

function onCreateItem(item) {
  if ( !enabled() ) return;
  // No own source nor sheet from a compendium: nothing to take over (read avoided for handmade items).
  if ( !sourceOf(item) && !sourceOf(item.parent) ) return;
  return retranslate([item]);
}

function onCreateActor(actor) {
  if ( !enabled() ) return;
  if ( !sourceOf(actor) && !actor.items.some(i => sourceOf(i)) ) return;
  return retranslate([actor, ...actor.items]);
}

export function registerAutoTranslate() {
  game.settings.register(MODULE_ID, AUTO_TRANSLATE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_TRANSLATE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_TRANSLATE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  const executor = { executor: true };
  route("createItem", onCreateItem, { ...executor, label: "translation on creation: item left in the original language" });
  route("createActor", onCreateActor, { ...executor, label: "translation on creation: creature left in the original language" });
}
