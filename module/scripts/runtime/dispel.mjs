/**
 * §37.2 : Dissipation de la magie. Au message d'utilisation d'un sort dont le contenu déclare `dispel` (MJ actif) : pour chaque cible
 * du message, les sorts en cours (adapter/dispel.mjs) cessent d'office jusqu'au niveau 3 ou à celui de l'emplacement, les autres sur
 * un test de la caractéristique d'incantation du lanceur contre DD 10 + niveau (core/dispel.mjs, lancé par le moteur). Une carte dit
 * ce qui a cessé et ce qui a résisté (flag `dispel`, lu par les scénarios).
 * §403 : « une créature, un objet ou un effet magique à portée » — sans créature désignée, le lanceur choisit une zone de sort à portée
 * (Toile, Rayon de lune, Ténèbres… ; adapter/dispel.mjs, `spellZonesNear`), qui cesse comme un sort sur une créature : sa concentration
 * retirée, sinon la zone. Les objets (enchantement d'une arme) : au MJ.
 * §496 (brique B16) : `dispel: { upTo, beyond, keepBySlot }` — plafond fixe ; au-delà rien (`none`) ou le test ; `keepBySlot` : avant
 * qu'un sort de concentration ne cesse, la créature qui s'y concentre peut, par sa Réaction (Neutralisée ou sans Réaction : non), dépenser
 * un emplacement de niveau 1 ou plus pour le garder (question à son joueur, sinon au MJ ; « le laisser finir » est la première option).
 */

import { MODULE_ID } from "../constants.mjs";
import { dispelPlan, dispelRule } from "../core/dispel.mjs";
import { spellsOn, endSpell, castingAbilityOf, castingCheck, spellZonesNear } from "../adapter/dispel.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { speakerTokenOf } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { reactionState } from "../adapter/reactions.mjs";
import { slotsFor, spendSlot } from "../adapter/ready.mjs";
import { spendBudget } from "./neighbours.mjs";

async function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const item = message.getAssociatedItem?.();
  const rule = dispelRule(contentOf(item).entry?.dispel);
  if ( !rule ) return;
  const caster = message.getAssociatedActor?.() ?? item.actor;
  const slot = Number(message.system?.level) || Number(item.system?.level) || 3;
  const targets = message.system?.targets ?? [];
  if ( !targets.length ) return dispelZone(message, item, caster, slot, rule);
  for ( const t of targets ) {
    const token = await fromUuid(t.token ?? "");
    const actor = token?.actor ?? (await fromUuid(t.actor ?? ""));
    if ( !actor ) continue;
    const spells = spellsOn(actor, { except: item });
    const byKey = new Map(spells.map(s => [s.key, s]));
    const ended = [];
    const resisted = [];
    const kept = [];
    for ( const step of dispelPlan(spells, slot, rule) ) {
      const spell = byKey.get(step.key);
      const r = await resolveStep(item, caster, spell, step, rule);
      if ( r.kept ) kept.push({ name: spell.name, level: spell.level, by: r.kept.by, slot: r.kept.slot });
      else if ( r.ends ) ended.push({ name: spell.name, level: spell.level, total: r.total });
      else resisted.push({ name: spell.name, level: spell.level, total: r.total, dc: step.dc, ...(step.none ? { beyond: true } : {}) });
      log(`${item.name} on ${actor.name}: ${spell.name} (level ${spell.level}) ${r.kept ? `kept by ${r.kept.by} (slot ${r.kept.slot})` : (r.ends ? "ends" : "resists")}`
        + `${step.none ? " — beyond the ceiling, no check" : (step.auto ? "" : ` — check ${r.total} vs DC ${step.dc}`)}`);
    }
    const lines = [
      ...ended.map(s => loc("Dissipation.Cesse", { spell: s.name, level: s.level })),
      ...resisted.map(s => s.beyond ? loc("Dissipation.HorsPortee", { spell: s.name, level: s.level })
        : loc("Dissipation.Resiste", { spell: s.name, level: s.level, total: s.total ?? "—", dc: s.dc })),
      ...kept.map(s => loc("Dissipation.Garde", { spell: s.name, level: s.level, name: s.by, slot: s.slot }))
    ];
    await ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
      content: `<p><strong>${loc("Dissipation.Titre", { item: item.name, name: actor.name })}</strong></p>`
        + (lines.length ? lines.map(l => `<p>${l}</p>`).join("") : `<p>${loc("Dissipation.Rien")}</p>`),
      flags: { [MODULE_ID]: { dispel: { target: t.token ?? actor.uuid, slot, ended, resisted, kept } } }
    });
  }
}

/**
 * Un sort face à la dissipation : il cesse d'office, sur un test, ou reste (au-delà du plafond avec `none`, test raté) ; §496 : avant
 * de cesser, la créature concentrée peut le garder (`keepBySlot`). Rend `{ ends, total, kept }` (`kept` : `{ by, slot }`).
 */
async function resolveStep(item, caster, spell, step, rule) {
  if ( step.none ) return { ends: false, total: null, kept: null };
  let ends = step.auto;
  let total = null;
  if ( !ends ) {
    // §306 (repasse C11) : Briseur de sorts (Abjurateur 10) — « vous ajoutez votre bonus de maîtrise au test » de Dissipation de la magie.
    const breaker = (identifierOf(item).id === "dispel-magic") && caster.items.some(i => identifierOf(i).id === "spell-breaker");
    total = await castingCheck(caster, castingAbilityOf(item, caster), step.dc, { bonus: breaker ? (Number(caster.system.attributes?.prof) || 0) : 0 });
    if ( breaker ) log(`${caster.name}: Spell Breaker, proficiency bonus added to the check (${total})`);
    ends = (total !== null) && (total >= step.dc);
  }
  if ( !ends ) return { ends, total, kept: null };
  const kept = rule.keepBySlot ? await keepWithSlot(item, spell) : null;
  if ( !kept ) await endSpell(spell);
  return { ends: !kept, total, kept };
}

/**
 * §496 : la créature concentrée sur ce sort le garde-t-elle, par sa Réaction et un emplacement de niveau 1+ ? Chez le MJ actif ; la
 * question va à son joueur (sinon au MJ). Rend `{ by, slot }` (nom, niveau de l'emplacement dépensé), ou null.
 */
async function keepWithSlot(item, spell) {
  const concentration = spell.concentration ? await fromUuid(spell.concentration) : null;
  const holder = concentration?.parent;
  if ( !(holder instanceof Actor) ) return null;
  const state = reactionState(holder);
  if ( state.incapacitated || !state.reactionAvailable ) { log(`${item.name}: ${holder.name} cannot react to keep ${spell.name}`); return null; }
  const slots = slotsFor(holder, 1);
  if ( !slots.length ) { log(`${item.name}: ${holder.name} has no spell slot left to keep ${spell.name}`); return null; }
  const answer = await askChoice(holder, { actor: holder.uuid, item: item.name,
    prompt: loc("Dissipation.GarderQuestion", { spell: spell.name, level: spell.level }),
    options: [{ id: "end", label: loc("Dissipation.Laisser"), icon: "fa-solid fa-xmark" },
      ...slots.map(s => ({ id: s.key, label: loc("Dissipation.GarderEmplacement", { level: s.level, value: s.value }), icon: "fa-solid fa-shield-halved" }))] });
  const chosen = slots.find(s => s.key === answer?.id);
  if ( !chosen ) { log(`${item.name}: ${holder.name} lets ${spell.name} end`); return null; }
  if ( !(await spendSlot(holder, chosen.key)) ) return null;
  await spendBudget(holder, "reaction");
  const token = holder.token ?? holder.getActiveTokens?.(false, true)?.[0] ?? null;
  notice(token, { key: "Dissipation.Avis", data: { spell: spell.name } }, "reaction", { all: true, action: "dispelKept", outcome: "success" });
  log(`${item.name}: ${holder.name} keeps ${spell.name} with their Reaction and a level ${chosen.level} slot`);
  return { by: holder.name, slot: chosen.level };
}

/** §403 : sans créature désignée, une zone de sort à portée, au choix du lanceur (aucune : rien). */
async function dispelZone(message, item, caster, slot, rule) {
  const casterToken = speakerTokenOf(message) ?? caster?.getActiveTokens?.(false, true)?.[0] ?? null;
  const range = item.system?.range ?? {};
  const reach = Number.isFinite(Number(range.value)) && casterToken
    ? lengthIn(Number(range.value), range.units || "ft", casterToken.parent.grid.units) : 0;
  const zones = casterToken ? spellZonesNear(casterToken, reach, { except: item }) : [];
  if ( !zones.length ) { log(`${item.name}: no target designated and no spell area in range, nothing to dispel`); return; }
  const answer = await askChoice(caster, { actor: caster.uuid, item: item.name, prompt: loc("Dissipation.Zone"),
    options: [{ id: "none", label: loc("Dissipation.AucuneZone") }, ...zones.map(z => ({ id: z.key, label: loc("Dissipation.ZoneNom", { spell: z.name, level: z.level, caster: z.caster }) }))] });
  const zone = zones.find(z => z.key === answer?.id);
  if ( !zone ) { log(`${item.name}: no area chosen`); return; }
  const [step] = dispelPlan([zone], slot, rule);
  const { ends, total, kept } = await resolveStep(item, caster, zone, step, rule);
  log(`${item.name} on the area ${zone.name} (level ${zone.level}): ${kept ? `kept by ${kept.by}` : (ends ? "ends" : "resists")}`
    + `${step.none ? " — beyond the ceiling, no check" : (step.auto ? "" : ` — check ${total} vs DC ${step.dc}`)}`);
  const line = kept ? loc("Dissipation.Garde", { spell: zone.name, level: zone.level, name: kept.by, slot: kept.slot })
    : ends ? loc("Dissipation.Cesse", { spell: zone.name, level: zone.level })
    : step.none ? loc("Dissipation.HorsPortee", { spell: zone.name, level: zone.level })
    : loc("Dissipation.Resiste", { spell: zone.name, level: zone.level, total: total ?? "—", dc: step.dc });
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
    content: `<p><strong>${loc("Dissipation.TitreZone", { item: item.name, spell: zone.name })}</strong></p><p>${line}</p>`,
    flags: { [MODULE_ID]: { dispel: { zone: zone.key, slot, ended: ends ? [{ name: zone.name, level: zone.level, total }] : [],
      resisted: (ends || kept) ? [] : [{ name: zone.name, level: zone.level, total, dc: step.dc, ...(step.none ? { beyond: true } : {}) }],
      kept: kept ? [{ name: zone.name, level: zone.level, ...kept }] : [] } } }
  });
}

export function registerDispel() {
  route("createChatMessage", onUsage, { executor: true, label: "Dispel Magic: nothing dispelled" });
}
