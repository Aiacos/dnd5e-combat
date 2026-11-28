/**
 * §120: the author regains a share of the damage they deal (key `lifesteal`) — Vampiric Touch: "the target takes 3d6 Necrotic
 * damage, and you regain Hit Points equal to half the Necrotic damage dealt".
 * Same circuit as the Vampiric Bite (runtime/empower.mjs): the amount is read when damage is computed, Resistances included, on
 * the client that applies it; the author's HP are restored once the target's are written. No question: the healing is due.
 */

import { MODULE_ID } from "../constants.mjs";
import { lifestealAmount } from "../core/drain.mjs";
import { damageSourceItem } from "../adapter/drain.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = item ? contentOf(item).entry?.lifesteal : null;
  if ( !rule || !item.actor || (item.actor === actor) ) return;
  const n = lifestealAmount(damages, rule);
  if ( n > 0 ) (options[MODULE_ID] ??= {}).lifesteal = { n, item: item.uuid };
}

async function onApplyDamage(victim, amount, options) {
  const l = options?.[MODULE_ID]?.lifesteal;
  if ( !l ) return;
  const item = fromUuidSync(l.item, { strict: false });
  const caster = item?.actor;
  if ( !caster?.isOwner || ((caster.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  await caster.applyDamage([{ value: l.n, type: "healing" }]);
  const token = tokenOf(caster);
  if ( token ) notice(token, loc("Vol.Retour", { n: l.n }), "gain");
  log(`${item.name}: ${caster.name} regains ${l.n} HP from ${victim.name}`);
}

export function registerLifesteal() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "life steal: amount not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "life steal: HP not regained" });
}
