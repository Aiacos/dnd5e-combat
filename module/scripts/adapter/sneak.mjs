/**
 * Sneak Attack and Cunning Strikes (SPEC §20) read in dnd5e 6.0: which item gives the Sneak Attack, how many dice,
 * whether this attack roll qualifies, and which Cunning Strikes the author can pay for. The rules are in core/sneak.mjs.
 *
 * Verified in dnd5e 6.0.3:
 *  - the retained Advantage mode of an attack roll is in `roll.options.advantageMode` (dice/d20-roll.mjs, `hasAdvantage`);
 *  - a damage roll made from an attack carries `system.origin` = the use message, like the attack roll
 *    (activity/attack.mjs:303-311): so we find the attack it follows;
 *  - the Player's Handbook Sneak Attack rolls `@scale.rogue.sneak-attack` (its first damage part), a dice
 *    scale value that `Roll.replaceFormulaData` writes as "3d6".
 */

import { MODULE_ID } from "../constants.mjs";
import { sneakAttackIssue, parseDice, sneakDiceAtLevel, affordableStrikes } from "../core/sneak.mjs";
import { SIZES } from "../core/content.mjs";
import { turnKeyOf } from "../core/area.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { factsFor } from "./facts.mjs";
import { timedWait } from "./dialogs.mjs";
import { speakerTokenOf } from "./turn.mjs";

/** dnd5e's ranged weapon types (`CONFIG.DND5E.weaponTypes`): a thrown melee weapon is not one. */
const RANGED_WEAPON_TYPES = Object.freeze(["simpleR", "martialR"]);

/** The current combat turn, combat included (two combats each have their round 1, turn 0), or null outside combat. */
const currentTurnKey = () => (game.combat?.started ? `${game.combat.id}:${turnKeyOf(game.combat.round, game.combat.turn)}` : null);

/** The item that gives this actor the Sneak Attack, or null. */
export function sneakItemOf(actor) {
  return Array.from(actor?.items ?? []).find(i => !!contentOf(i).entry?.sneakAttack) ?? null;
}

/** The item's Sneak Attack dice: its first damage part, otherwise those of a rogue of that level. */
export function sneakDiceOf(item) {
  // §72: the dice that the content fixes (NPC: "17 (5d6)").
  const fixed = contentOf(item).entry?.sneakAttack?.dice;
  if ( fixed ) return parseDice(fixed);
  const activity = Array.from(item?.system?.activities ?? []).find(a => a.damage?.parts?.length);
  const part = activity?.damage.parts[0];
  const formula = part?.custom?.enabled ? part.custom.formula
    : ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}` : null);
  if ( formula ) {
    try {
      const dice = parseDice(Roll.replaceFormulaData(formula, item.getRollData(), { missing: "0" }));
      if ( dice?.number > 0 ) return dice;
    } catch { /* formule illisible : le niveau */ }
  }
  return sneakDiceAtLevel(item?.actor?.classes?.rogue?.system?.levels ?? 0);
}

/** Has the Sneak Attack already been used this combat turn? Outside combat, never. */
export function sneakSpent(actor) {
  const key = currentTurnKey();
  return !!key && (actor?.getFlag(MODULE_ID, "sneakAttack") === key);
}

/** Marks the Sneak Attack as used this turn (on the author's client, which owns the actor). */
export async function markSneakSpent(actor) {
  const key = currentTurnKey();
  if ( key && actor?.isOwner ) await actor.setFlag(MODULE_ID, "sneakAttack", key);
}

/** The last attack roll of this activity attached to this use message, or null. */
export function attackMessageFor(originId, activity) {
  if ( !originId ) return null;
  return game.messages.contents.findLast(m => (m.type === "attack") && (m._source.system?.origin === originId)
    && (!activity || (m.system?.activity?.uuid === activity.uuid) || (fromUuidSync(m.system?.activity?.uuid ?? "", { strict: false })?.item === activity.item))) ?? null;
}

/**
 * The Sneak Attack of this damage roll: the item, its dice, the target and, if it does not apply, why.
 * null if the author does not have the Sneak Attack or if the roll does not follow an attack on a single target.
 * @param {Activity} activity           The attack (not its damage variant).
 * @param {ChatMessage} attackMessage   Its attack roll.
 * @returns {{item: Item5e, dice: {number: number, faces: number}, issue: string|null, source: TokenDocument,
 *   target: TokenDocument}|null}
 */
export function sneakAttackFor(activity, attackMessage) {
  const actor = activity?.actor;
  const item = sneakItemOf(actor);
  if ( !item || !attackMessage ) return null;
  const targets = attackMessage.system?.targets ?? [];
  if ( targets.length !== 1 ) return null;   // "a creature that you hit"
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  const source = speakerTokenOf(attackMessage);
  if ( !target?.actor || !source ) return null;
  const weapon = activity.item;
  const dice = sneakDiceOf(item);
  if ( !dice ) return null;
  const properties = weapon?.system?.properties;
  const facts = factsFor({ source: actor, target: target.actor, activity, sourceToken: source, targetToken: target });
  const rule = contentOf(item).entry?.sneakAttack;
  const issue = sneakAttackIssue({
    weapon: (activity.type === "attack") && (weapon?.type === "weapon"),
    finesse: properties?.has?.("fin") === true,
    rangedWeapon: RANGED_WEAPON_TYPES.includes(weapon?.system?.type?.value),
    advantageMode: attackMessage.rolls?.[0]?.options?.advantageMode ?? 0,
    allyNear: facts["source.allyNearTarget"]({ distance: 5, units: "ft" }),
    spent: sneakSpent(actor),
    anyWeapon: rule?.anyWeapon === true,
    freeTarget: (rule?.alwaysVs ?? []).includes(facts["target.creatureType"])
  });
  return { item, dice, issue, source, target };
}

/** Les parts de plus de l'Attaque sournoise (Assassinat au premier round) : `{ name, formula }`. */
export function sneakBonusesOf(actor) {
  const firstRound = !!game.combat?.started && (game.combat.round === 1);
  return Array.from(actor?.items ?? []).flatMap(i => {
    const b = contentOf(i).entry?.sneakBonus;
    return (b && (!b.firstRound || firstRound)) ? [{ name: i.name, formula: b.formula, data: i.getRollData() }] : [];
  });
}

/** L'acteur a-t-il un item de cet identifiant (la trousse d'empoisonneur : `poisoners-kit`) ? */
function owns(actor, requires) {
  return Array.from(actor?.items ?? []).some(i => (identifierOf(i).id === requires) || (i.system?.identifier === requires));
}

/** Rang de taille de dnd5e. */
const sizeRank = size => SIZES.indexOf(size);

/**
 * The Cunning Strikes the author knows, with what makes them possible against this target.
 * @returns {Array<{key: string, cost: number, available: boolean, item: Item5e, activity: Activity|null, withdraw: boolean,
 *   label: string}>}
 */
export function strikeOptionsOf(actor, target) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    for ( const [key, rule] of Object.entries(contentOf(item).entry?.cunningStrikes ?? {}) ) {
      if ( out.some(o => o.key === key) ) continue;
      const activity = rule.activity ? item.system.activities?.get(rule.activity) ?? null : null;
      if ( rule.activity && !activity ) continue;
      const size = target?.actor?.system?.traits?.size;
      const available = (!rule.requires || owns(actor, rule.requires))
        && (!rule.sizeAtMost || !size || (sizeRank(size) <= sizeRank(rule.sizeAtMost)));
      out.push({ key, cost: rule.cost, available, item, activity, withdraw: rule.withdraw === true, keepsHidden: rule.keepsHidden === true,
        label: game.i18n.localize(`DND5ECOMBAT.Sournoise.Frappe.${key}`) });
    }
  }
  return out;
}

/** How many Cunning Strikes per Sneak Attack (Improved Cunning Strike: 2). */
export function strikeMaxOf(actor) {
  return Math.max(1, ...Array.from(actor?.items ?? []).map(i => Number(contentOf(i).entry?.cunningStrikeMax) || 1));
}

/* -------------------------------------------- */
/*  §223 : automatique ou au choix              */
/* -------------------------------------------- */

/** World setting: the Sneak Attack applies by itself to the first eligible hit of the turn ("auto") or the author chooses ("ask"). */
export const SNEAK_MODE_SETTING = "sneakAttackMode";
export const SNEAK_MODES = Object.freeze(["auto", "ask"]);

/** The world's mode ("auto" if the setting is not readable). */
export function sneakMode() {
  try {
    const mode = game.settings.get(MODULE_ID, SNEAK_MODE_SETTING);
    return SNEAK_MODES.includes(mode) ? mode : "auto";
  } catch { return "auto"; }
}

/** The key that arms the Sneak Attack for the next eligible hit: the current turn, or "free" outside combat. */
const armKey = () => currentTurnKey() ?? "free";

/** Has the author reserved their Sneak Attack (the item's activity, in "ask" mode) for this turn's next eligible hit? */
export function sneakArmed(actor) {
  return actor?.getFlag(MODULE_ID, "sneakArmed") === armKey();
}

/** Reserves (or releases) the Sneak Attack for this turn's next eligible hit. */
export async function armSneak(actor, armed=true) {
  if ( !actor?.isOwner ) return;
  if ( armed ) await actor.setFlag(MODULE_ID, "sneakArmed", armKey());
  else if ( actor.getFlag(MODULE_ID, "sneakArmed") !== undefined ) await actor.unsetFlag(MODULE_ID, "sneakArmed");
}

/**
 * §223: on the author's client, before their damage, a single window for what is decided "on hit":
 *  - the Sneak Attack itself, in "ask" mode (box checked in advance), unless the author reserved it through the item's activity;
 *  - the Cunning Strikes they can pay for (they remove dice from the Sneak Attack; without it, ignored);
 *  - the optional bonus damage (`ask`: Dreadful Strike), unchecked in advance;
 *  - §516: "Martial Savagery" (`savage`, adapter/savage.mjs), checked in advance.
 * Without an answer within the timeout: what the window offers by default (the Sneak Attack and "Martial Savagery", nothing else).
 * With nothing to ask, no window.
 * @param {Actor} actor
 * @param {TokenDocument} target
 * @param {{dice: {number: number, faces: number}, issue: string|null}|null} sneak   sneakAttackFor (null: no Sneak Attack).
 * @param {Array<{key: string, name: string, formula: string, damageType: string|null, left: number}>} bonuses   optionalBonusesFor.
 * @param {{savage?: boolean}} [options]   `savage`: ask for "Martial Savagery" for this hit.
 * @returns {Promise<{sneak: boolean|null, strikes: string[], bonuses: string[], savage: boolean|null}>}  `sneak`: null without
 *   a possible Sneak Attack; `savage`: null without a "Martial Savagery" question.
 */
export async function askHitOptions(actor, target, sneak, bonuses=[], { savage=false }={}) {
  const eligible = !!sneak && !sneak.issue;
  const ask = eligible && (sneakMode() === "ask") && !sneakArmed(actor);
  const options = eligible ? affordableStrikes(strikeOptionsOf(actor, target), sneak.dice.number) : [];
  const fallback = { sneak: eligible ? true : null, strikes: [], bonuses: [], savage: savage ? true : null };
  if ( !ask && !options.length && !bonuses.length && !savage ) return fallback;
  const t = (key, data={}) => game.i18n.format(`DND5ECOMBAT.Sournoise.${key}`, data);
  // One line per box: the box, the label, then the dice on the right (without `.form-group`, which stacked the label word by word).
  const box = (name, label, hint, checked=false) => `<label class="das-hit-option"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
    <span class="das-hit-option__label">${label}</span>${hint ? `<span class="das-hit-option__hint">${hint}</span>` : ""}</label>`;
  const list = rows => `<div class="das-hit-options">${rows.join("")}</div>`;
  const parts = [];
  if ( savage ) parts.push(list([box("savage", game.i18n.localize("DND5ECOMBAT.Sauvagerie.Utiliser"),
    game.i18n.localize("DND5ECOMBAT.Sauvagerie.Aide"), true)]));
  if ( ask ) parts.push(list([box("sneak", t("Utiliser", { name: target.name }), `+${sneak.dice.number}d${sneak.dice.faces}`, true)]));
  if ( options.length ) {
    const max = strikeMaxOf(actor);
    parts.push(`<p>${ask ? t("QuestionFrappes", { max }) : t("Question", { n: sneak.dice.number, faces: sneak.dice.faces, name: target.name, max })}</p>`,
      list(options.map(o => box(o.key, o.label, `−${o.cost}d${sneak.dice.faces}`))));
  }
  if ( bonuses.length ) {
    const type = d => (d ? game.i18n.localize(CONFIG.DND5E.damageTypes[d]?.label ?? d) : "");
    parts.push(`<p>${t("QuestionBonus", { name: target.name })}</p>`, list(bonuses.map(b => box(`bonus-${b.key}`, b.name,
      [`+${b.formula} ${type(b.damageType)}`.trim(), Number.isFinite(b.left) ? t("Restantes", { n: b.left }) : ""].filter(Boolean).join(", ")))));
  }
  const checked = (dialog, button, name) => !!(dialog.element ?? button.form)?.querySelector(`input[name="${name}"]`)?.checked;
  const picked = await timedWait({
    window: { title: t(options.length && !ask && !bonuses.length && !savage ? "Titre" : "TitreCoup", { name: actor.name }) },
    position: { width: 400 },
    content: parts.join(""),
    buttons: [
      { action: "strike", label: t("Frapper"), icon: "fa-solid fa-bolt", default: true,
        callback: (event, button, dialog) => {
          const sneakOn = eligible && (!ask || checked(dialog, button, "sneak"));
          return {
            sneak: eligible ? sneakOn : null,
            strikes: sneakOn ? options.filter(o => checked(dialog, button, o.key)).map(o => o.key) : [],
            bonuses: bonuses.filter(b => checked(dialog, button, `bonus-${b.key}`)).map(b => b.key),
            savage: savage ? checked(dialog, button, "savage") : null
          };
        } },
      // "Nothing": neither Strike nor optional damage; the Sneak Attack stays if it is automatic, and is kept if it was asked for.
      // §516: "Martial Savagery" is also kept for another hit.
      { action: "none", label: t((ask || bonuses.length || savage) ? "Rien" : "Aucune"),
        callback: () => ({ sneak: eligible ? !ask : null, strikes: [], bonuses: [], savage: savage ? false : null }) }
    ]
  }, { fallback, awaiting: { actor, kind: "choice" } });
  return (picked && (typeof picked === "object")) ? picked : fallback;
}
