/**
 * Smite spells (SPEC §25) read and spent in dnd5e 6.0: which Smites the author of a hit can cast, at which levels,
 * what they add to the damage roll. On the author's client (they are its slots).
 *
 * Verified in dnd5e 6.0.3: the remaining slots are in `system.spells.spell<N>.value` and `system.spells.pact`
 * (`value`, `level`); a spell with a free use (the paladin's Divine Smite) carries `system.uses` (max 1, Long Rest); a
 * "whole" damage part grows by `scaling.number` dice per level above the spell's.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { unpreparedSpell } from "./resources.mjs";
import { combatantFor, readBudget } from "./turn.mjs";
import { creatureTypeOf, originItemOf, carriesEffectFrom, weaponKind } from "./facts.mjs";
import { riderAffordable } from "../core/held-effect.mjs";
import { timedWait } from "./dialogs.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { spendItemUses } from "./uses.mjs";

const t = (key, data) => game.i18n.format(`DND5ECOMBAT.Chatiment.${key}`, data ?? {});

/** A melee hit with a weapon or an Unarmed Strike? */
export function meleeWeaponHit(activity, attackMode) {
  const mode = attackMode ?? "";
  return (activity?.type === "attack") && (activity.attack?.type?.value === "melee") && !mode.startsWith("thrown")
    && ((activity.item?.type === "weapon") || (activity.attack?.type?.classification === "unarmed"));
}

/**
 * §128: a Smite's rule for THIS copy of the spell. An older copy (the Searing Smite of the Player's Handbook
 * pregenerated characters: a single save activity, which carries the dice) does not have the declared damage activity —
 * so we take the object's one that carries dice, and drop what the copy lacks (save, effect, "fiends" activity).
 * null: nothing to cast.
 */
export function smiteRuleOf(item, rule) {
  const activities = item?.system?.activities;
  if ( !rule || !activities ) return null;
  // §164: a Smite with no dice added to the hit (Hail of Thorns: the damage is that of its save).
  if ( !rule.damage ) return rule;
  if ( activities.get(rule.damage) ) return rule;
  const dice = a => (a.damage?.parts ?? []).some(p => p.number && p.denomination);
  const damaged = activities.find(a => (a.id !== rule.save) && dice(a));
  if ( !damaged ) return null;
  return { ...rule, damage: damaged.id, fiends: activities.get(rule.fiends) ? rule.fiends : undefined,
    save: activities.get(rule.save) ? rule.save : undefined, effect: item.effects?.get(rule.effect) ? rule.effect : undefined };
}

/** §164: a ranged hit with a weapon (Hail of Thorns). */
export function rangedWeaponHit(activity, attackMode) {
  const mode = attackMode ?? "";
  return (activity?.type === "attack") && (activity.item?.type === "weapon")
    && ((activity.attack?.type?.value === "ranged") || mode.startsWith("thrown"));
}

/**
 * The possible Smites: for each spell that declares one, each remaining slot level (and the pact slot), and
 * the item's free use if it has one. Nothing without a Bonus Action available in combat.
 * @returns {Array<{item: Item5e, rule: object, level: number, slot: string|null, free: boolean, label: string}>}
 */
export function smiteOptions(actor, { ranged=false }={}) {
  const combatant = combatantFor(actor);
  if ( combatant && !((readBudget(combatant)?.bonus ?? 1) >= 1) ) return [];
  const spells = actor?.system?.spells ?? {};
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = isSpellCast(item) ? smiteRuleOf(item, contentOf(item).entry?.smite) : null;
    // A Smite that is not prepared is not offered (issue #144) — the same rule as at casting (`unprepared`), except for
    // the copy that an object casts (`cachedFor`).
    if ( rule && unpreparedSpell(item) && !item.getFlag?.("dnd5e", "cachedFor") ) continue;
    // §206: `any` — after any weapon attack, melee as well as ranged (Ensnaring Strike).
    if ( !rule || (!rule.any && (!!rule.ranged !== ranged)) ) continue;
    const base = Number(item.system.level) || 1;
    const uses = item.system.uses;
    if ( Number(uses?.max) && ((uses.value ?? (Number(uses.max) - (uses.spent ?? 0))) > 0) ) {
      out.push({ item, rule, level: base, slot: null, free: true, label: t("Gratuit", { item: item.name }) });
    }
    for ( let level = base; level <= 9; level++ ) {
      if ( (Number(spells[`spell${level}`]?.value) || 0) > 0 ) out.push({ item, rule, level, slot: `spell${level}`, free: false, label: t("Niveau", { item: item.name, level }) });
    }
    const pact = spells.pact;
    if ( ((Number(pact?.value) || 0) > 0) && ((pact.level ?? 0) >= base) ) {
      out.push({ item, rule, level: pact.level, slot: "pact", free: false, label: t("Niveau", { item: item.name, level: pact.level }) });
    }
  }
  return out;
}

/**
 * "Once per turn" (Eldritch Smite): any turn, in combat — the combat where the actor is fighting, not `game.combat` (the displayed
 * combat, which may be another one).
 */
function turnKey(actor) {
  const combat = combatantFor(actor)?.parent ?? null;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

/**
 * §372: how many times a "once per turn" boon has been used this turn — the mark is worth the turn (once) or "turn#n".
 * The options of the same list share their item's mark.
 */
function usedThisTurn(actor, key, turn) {
  const mark = String(actor?.getFlag?.(MODULE_ID, `oncePerTurn.${key}`) ?? "");
  if ( !turn || !mark ) return 0;
  if ( mark === turn ) return 1;
  const [at, n] = mark.split("#");
  return (at === turn) ? (Number(n) || 1) : 0;
}

/** §372: a boon's limit per turn — raised (`perTurn.count`) as long as an effect of the item `perTurn.while` is carried. */
function perTurnLimit(actor, rule) {
  return (rule.perTurn && carriesEffectFrom(actor, rule.perTurn.while)) ? rule.perTurn.count : 1;
}

/**
 * Is the hit's weapon enchanted by the item `id` (pact weapon: "pact-of-the-blade")? If none of the actor's weapons is
 * (pact never placed on this sheet, weapon bound to the hand in Midi's days), any melee weapon counts.
 */
function wieldsBound(activity, actor, id) {
  const bound = item => (item?.effects ?? []).some(e => !e.disabled && (e.isAppliedEnchantment ?? (e.type === "enchantment"))
    && (identifierOf(originItemOf(e) ?? {}).id === id));
  if ( bound(activity?.item) ) return true;
  return !(actor?.items ?? []).some(i => (i.type === "weapon") && bound(i));
}

/**
 * What can be added to a hit that lands (`hitRider`): §31, the species boons (Giant Ancestry — Fire's Burn, Frost's
 * Chill, Hill's Tumble), as long as the item has a use; §47 bis, Eldritch Smite (pact slot, pact weapon in melee,
 * once per turn). The condition (Prone) only works against a target of size `sizeAtMost` or smaller; a
 * boon that does only that is not offered against a larger one.
 */
export function riderOptions(actor, target, activity=null, attackMode=null) {
  const sizes = ["tiny", "sm", "med", "lg", "huge", "grg"];
  const turn = turnKey(actor);
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const declared = contentOf(item).entry?.hitRider;
    if ( !declared ) continue;
    // §372: a list — mutually exclusive options of the same item (School of Hard Knocks: 1d12, Endanger or Taunt).
    for ( const rule of [declared].flat() ) {
      let left;
      let level = null;
      // §87: the boon is paid with a use of ANOTHER item (the maneuvers: the Superiority Dice).
      const payer = rule.pays ? (actor.items.find(i => identifierOf(i).id === rule.pays) ?? null) : null;
      if ( rule.pays && !payer ) continue;
      // §298: the damage activity is missing on this item (the Soul Knife's "psionic-power" carries the same identifier as the
      // Psi Warrior's, without Psionic Strike): nothing to offer.
      if ( rule.damage && !item.system.activities?.get(rule.damage) ) continue;
      if ( payer ) {
        const uses = payer.system.uses ?? {};
        left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
      } else if ( rule.slot === "pact" ) {
        const pact = actor.system?.spells?.pact ?? {};
        left = Number(pact.value) || 0;
        level = Number(pact.level) || 0;
      } else if ( !(item.system.uses?.max ?? "") ) left = Infinity;   // §78: without a maximum, not counted (Stung)
      else {
        const uses = item.system.uses ?? {};
        left = Number.isFinite(Number(uses.value)) ? Number(uses.value) : (Number(uses.max) || 0) - (Number(uses.spent) || 0);
      }
      // Quivering Palm: a boon that costs several uses of the item that pays for it (`cost`: 4 credo points).
      if ( !riderAffordable(left, rule.cost) ) continue;
      // §95: only while an effect of the item is on the bearer (Terrifying Avatar: under the Form of Dread).
      if ( rule.whileActive && !carriesEffectFrom(actor, identifierOf(item).id) ) continue;
      if ( rule.weapon && !(meleeWeaponHit(activity, attackMode) && wieldsBound(activity, actor, rule.weapon)) ) continue;
      // §78: only with the weapon of this identifier (Stung: the shortsword).
      if ( rule.item && (identifierOf(activity?.item ?? {}).id !== rule.item) ) continue;
      // §129: only an unarmed attack (Tavern Brawler: the Unarmed Strike, or the feat's improved attack).
      if ( rule.unarmed && !unarmedAttack(activity) ) continue;
      // §132: a melee hit (weapon or unarmed), a shield on the arm, damage of this type (Crusher, Slasher, Charger,
      // Shield Master).
      if ( rule.melee && !meleeWeaponHit(activity, attackMode) ) continue;
      if ( rule.shield && !wearsShield(actor) ) continue;
      if ( rule.damageType && !attackDamageTypes(activity).includes(rule.damageType) ) continue;
      // §372: only an attack of these kinds of weapon ("unarmed", dnd5e's weapon types).
      if ( rule.weapons && !rule.weapons.includes(weaponKind(activity)) ) continue;
      const key = identifierOf(item).id ?? item.id;
      if ( rule.oncePerTurn && turn && (usedThisTurn(actor, key, turn) >= perTurnLimit(actor, rule)) ) continue;
      const size = target?.actor?.system?.traits?.size;
      // §132: `sizeAbove` — the target is not more than N sizes larger than the author (Crusher: "no more than one size larger").
      const own = actor.system?.traits?.size;
      const fits = (!rule.sizeAtMost || !size || (sizes.indexOf(size) <= sizes.indexOf(rule.sizeAtMost)))
        && (!rule.sizeAbove || !size || !own || (sizes.indexOf(size) <= sizes.indexOf(own) + rule.sizeAbove));
      if ( !fits && !rule.damage && !rule.effect ) continue;
      const unlimited = left === Infinity;
      // §372: the name of a list option, that of its activity ("School of Hard Knocks: Endanger").
      const name = rule.name ? (item.system.activities?.get(rule.name)?.name || item.name) : null;
      const label = (rule.slot === "pact") ? t("FaveurPacte", { item: item.name, level, n: left })
        : (name ?? (unlimited ? item.name : t("Faveur", { item: item.name, n: left })));
      out.push({ item, rule, rider: true, free: false, unlimited, level, fits, payer, once: rule.oncePerTurn ? key : null, label, name });
    }
  }
  return out;
}

/** §132: an equipped shield. */
function wearsShield(actor) {
  return (actor?.items ?? []).some(i => (i.type === "equipment") && (i.system.type?.value === "shield") && i.system.equipped);
}

/** §132: the damage types of an attack — those of its parts, and those of the weapon if the activity takes them over. */
export function attackDamageTypes(activity) {
  const out = new Set();
  for ( const p of activity?.damage?.parts ?? [] ) for ( const t of p.types ?? [] ) out.add(t);
  if ( (activity?.damage?.includeBase !== false) && activity?.item?.system?.damage?.base ) {
    for ( const t of activity.item.system.damage.base.types ?? [] ) out.add(t);
  }
  return Array.from(out);
}

/** §129: an unarmed attack — classed "unarmed" by dnd5e, or the Unarmed Strike itself. */
function unarmedAttack(activity) {
  return (activity?.type === "attack") && ((activity.attack?.type?.classification === "unarmed")
    || (identifierOf(activity.item ?? {}).id === "unarmed-strike"));
}

/** The dice that the Smite adds, at the level cast, against this target: `{ formula, type }`, or null. */
export function smiteDamage(option, target) {
  const { item, rule, level } = option;
  if ( option.rider ) {
    // §372: dice specific to the option (School of Hard Knocks: 1d12), read with the actor's data.
    if ( rule.formula ) return { formula: Roll.replaceFormulaData(rule.formula, item.actor?.getRollData() ?? {}, { missing: "0" }), type: null };
    // A boon without damage (Hill's Tumble): nothing to roll, but it counts.
    const part = rule.damage ? item.system.activities?.get(rule.damage)?.damage?.parts?.[0] : null;
    const type = Array.from(part?.types ?? [])[0] ?? null;
    // A free formula (Eldritch Smite: "(1 + @spells.pact.level)d8"), read with the actor's data: "4d8" at level 3.
    if ( part?.custom?.enabled && part.custom.formula ) {
      const formula = Roll.replaceFormulaData(part.custom.formula, item.actor?.getRollData() ?? {});
      const sum = formula.match(/^\(\s*(\d+)\s*\+\s*(\d+)\s*\)d(\d+)$/);
      return { formula: sum ? `${Number(sum[1]) + Number(sum[2])}d${sum[3]}` : formula, type };
    }
    if ( !part?.number || !part.denomination ) return { formula: null, type: null };
    return { formula: `${part.number}d${part.denomination}`, type };
  }
  if ( !rule.damage ) return { formula: null, type: null };   // §164: Hail of Thorns
  const undead = ["fiend", "undead"].includes(creatureTypeOf(target?.actor));
  const activity = item.system.activities?.get((undead && rule.fiends) ? rule.fiends : rule.damage);
  const part = activity?.damage?.parts?.[0];
  if ( !part?.number || !part.denomination ) return null;
  const extra = Math.max(0, level - (Number(item.system.level) || 1)) * (Number(part.scaling?.number) || 0);
  const type = Array.from(part.types ?? [])[0] ?? null;
  return { formula: `${part.number + extra}d${part.denomination}`, type };
}

/** Spends what the chosen Smite costs: the free use, or the slot. */
export async function spendSmite(actor, option) {
  if ( option.once ) {
    const turn = turnKey(actor);
    const used = usedThisTurn(actor, option.once, turn);
    if ( turn ) await actor.setFlag(MODULE_ID, `oncePerTurn.${option.once}`, used ? `${turn}#${used + 1}` : turn);
  }
  if ( option.rider && (option.rule.slot === "pact") ) {
    const value = Number(actor.system.spells?.pact?.value) || 0;
    await actor.update({ "system.spells.pact.value": Math.max(0, value - 1) });
    return;
  }
  if ( option.unlimited ) return;
  if ( option.payer ) {   // §87
    await spendItemUses(option.payer, Math.max(1, Number(option.rule?.cost) || 1));
    return;
  }
  if ( option.free || option.rider ) {
    await spendItemUses(option.item);
    return;
  }
  const value = Number(actor.system.spells[option.slot]?.value) || 0;
  await actor.update({ [`system.spells.${option.slot}.value`]: Math.max(0, value - 1) });
}

/**
 * The question, on the author's client: the spell, then its level (§290), and "no Smite". Without an answer: none.
 * @returns {Promise<object|null>}  The chosen option.
 */
export async function askSmite(actor, target, options) {
  if ( !options.length ) return null;
  const riders = options.every(o => o.rider);
  // §290: in two steps — the spell (one tile per spell: icon, name), then its level (one button per available level; only
  // one: taken straight away); "Another spell" goes back to the first step. One button per spell and per level made ten
  // buttons for a paladin (table feedback). The footer buttons stay, hidden: DialogV2 looks for its actions there.
  const groups = [];
  options.forEach((o, i) => {
    let group = groups.find(g => g.item === o.item);
    if ( !group ) groups.push(group = { item: o.item, picks: [] });
    group.picks.push({ i, o });
  });
  const esc = foundry.utils.escapeHTML;
  const title = t(riders ? "TitreFaveur" : "Titre", { name: actor.name });
  const none = { action: "none", label: t(riders ? "AucuneFaveur" : "Aucun") };
  for ( ;; ) {
    const tiles = groups.map((g, n) => `<div class="tile">
      <button type="button" class="icon" data-action="group${n}" data-tooltip="${esc(g.item.name)}"><img src="${esc(g.item.img ?? "")}" alt=""></button>
      <span class="name">${esc(g.item.name)}</span></div>`).join("");
    const first = await timedWait({
      window: { title }, classes: ["dnd5e-combat-smite"],
      position: { width: Math.min(640, 140 + (Math.min(groups.length, 5) * 104)) },
      content: `<p>${t(riders ? "QuestionFaveur" : "Question", { name: target?.name ?? "" })}</p><div class="tiles">${tiles}</div>`,
      // The hidden buttons of each option (spell and level) first: a choice made in one go (scenarios, `answer-dialog`) skips
      // the second step.
      buttons: [...options.map((o, i) => ({ action: `smite${i}`, label: o.label })),
        ...groups.map((g, n) => ({ action: `group${n}`, label: g.item.name, default: n === 0 })), none]
    }, { fallback: "none", awaiting: { actor, kind: "choice" } });
    if ( String(first ?? "").startsWith("smite") ) return options[Number(first.replace("smite", ""))] ?? null;
    const group = String(first ?? "").startsWith("group") ? groups[Number(first.replace("group", ""))] : null;
    if ( !group ) return null;
    if ( group.picks.length === 1 ) return group.picks[0].o;
    // §372: the options of a list are shown by their name.
    const named = group.picks.every(({ o }) => o.name);
    const levels = group.picks.map(({ i, o }) => `<button type="button" class="level${o.free ? " free" : ""}${o.name ? " named" : ""}" data-action="smite${i}"
      data-tooltip="${esc(o.label)}">${esc(o.name ?? (o.level ? String(o.level) : t("PastilleUtiliser")))}</button>`).join("");
    const second = await timedWait({
      window: { title }, classes: ["dnd5e-combat-smite", "step-level"], position: { width: 360 },
      content: `<div class="chosen"><img src="${esc(group.item.img ?? "")}" alt=""><span class="name">${esc(group.item.name)}</span></div>
        <p>${t(named ? "QuestionOption" : "QuestionNiveau")}</p><div class="levels">${levels}</div>`,
      buttons: [...group.picks.map(({ i, o }) => ({ action: `smite${i}`, label: o.label })),
        { action: "back", label: t(named ? "AutreFaveur" : "AutreSort"), icon: "fa-solid fa-arrow-left" }, none]
    }, { fallback: "none", awaiting: { actor, kind: "choice" } });
    if ( second === "back" ) continue;
    const i = Number(String(second ?? "").replace("smite", ""));
    return String(second ?? "").startsWith("smite") ? (options[i] ?? null) : null;
  }
}

/**
 * At the damage roll of a hit (`rollDamageForAttack`, author's client): the question, then what the roll must carry —
 * `{ item, level, formula, type, save, target }` —, the slot or use already spent. null without a Smite.
 */
/** §87: the hit's damage type — the one the attack roll carries, otherwise the weapon's first. */
function weaponDamageType(activity, attackMessage) {
  const chosen = attackMessage?.getFlag?.(MODULE_ID, "damageType");
  if ( chosen ) return chosen;
  const base = activity?.damage?.includeBase !== false ? activity?.item?.system?.damage?.base?.types : null;
  const parts = activity?.damage?.parts ?? [];
  return Array.from(base ?? [])[0] ?? Array.from(parts[0]?.types ?? [])[0] ?? null;
}

export async function chooseSmite(activity, attackMessage) {
  const actor = activity?.actor;
  const targets = attackMessage?.system?.targets ?? [];
  if ( !actor || (targets.length !== 1) || (activity?.type !== "attack") ) return null;
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  if ( !target ) return null;
  // The Smites: a melee hit with a weapon or unarmed; the species boons: any attack roll.
  const mode = attackMessage.system?.mode;
  const options = [...(meleeWeaponHit(activity, mode) ? smiteOptions(actor) : []),
    ...(rangedWeaponHit(activity, mode) ? smiteOptions(actor, { ranged: true }) : []), ...riderOptions(actor, target, activity, mode)];
  if ( !options.length ) return null;
  const option = await askSmite(actor, target, options);
  const dice = option ? smiteDamage(option, target) : null;
  if ( !dice ) return null;
  await spendSmite(actor, option);
  if ( option.rider ) {
    // §87: the dice at the weapon's damage type (maneuvers); the save of a size-limited boon, only against a target
    // small enough (Pushing Attack, Trip Attack: "Large or smaller").
    const weaponType = option.rule.weaponDamage ? weaponDamageType(activity, attackMessage) : null;
    return { kind: "rider", item: option.item.uuid, name: option.item.name, ...dice, ...(weaponType ? { type: weaponType } : {}),
      effect: option.rule.effect ?? null, status: option.fits ? (option.rule.status ?? null) : null,
      save: option.fits ? (option.rule.save ?? null) : null, push: option.fits ? (option.rule.push ?? null) : null, target: target.uuid };
  }
  return { item: option.item.uuid, name: option.item.name, level: option.level, free: option.free, ...dice,
    save: option.rule.save ?? null, effect: option.rule.effect ?? null,
    scaling: Math.max(0, option.level - (Number(option.item.system.level) || 1)), target: target.uuid,
    // §288: Lightning Arrow — its dice instead of the weapon's; the burst around the target, once the attack is resolved.
    ...(option.rule.replaces ? { replaces: true } : {}), ...(option.rule.blast ? { blast: true } : {}) };
}
