/**
 * Basic action items (content/actions.mjs) on the Foundry side: building them, recognizing them,
 * knowing what an actor lacks. A "feat" item with a "utility" activity that costs an
 * action: dnd5e casts it like any other, the engine draws the effect on the budget from it
 * (runtime/turn.mjs, the core's `basicAction`).
 */

import { MODULE_ID } from "../constants.mjs";
import { BASIC_ACTIONS } from "../content/actions.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { basicKindsFor, hasPaidForm } from "../core/basic-kinds.mjs";
import { familiarBasicKinds } from "../core/familiar.mjs";

/** The basic action key of an item ("dash"…), or null. */
export function basicActionOf(item) {
  const kind = item?.getFlag?.(MODULE_ID, "basicAction") ?? null;
  return kind && BASIC_ACTIONS[kind] ? kind : null;
}

/** Does the activity spend a resource (uses, creed point…) according to its data? */
const spendsResource = activity => (activity?.consumption?.targets ?? []).length > 0;

/**
 * What the content declares for this activity (`basicActions`), the paid or free form chosen from what it spends
 * (core/basic-kinds.mjs); null if nothing.
 */
export function declaredBasicsOf(activity) {
  if ( !activity?.item ) return null;
  return basicKindsFor(contentOf(activity.item).entry?.basicActions?.[activity.id] ?? null, spendsResource(activity));
}

/** Is this use the free form of an activity that has two (Step of the Wind without a point: no doubled jump)? */
export function isFreeForm(activity) {
  if ( !activity?.item ) return false;
  return hasPaidForm(contentOf(activity.item).entry?.basicActions?.[activity.id]) && !spendsResource(activity);
}

/**
 * The basic action an activity takes: that of its basic action item, otherwise the one the content declares for it
 * (`basicActions`: Rogue's Cunning Action, "Hide" as a Bonus Action — §20).
 */
export function basicActionOfActivity(activity, chosen=null) {
  if ( !activity?.item ) return null;
  const declared = declaredBasicsOf(activity);
  // §65: an action of choice (Nimble Escape) — the one the author chose at use, otherwise none.
  if ( declared?.choose ) return declared.choose.includes(chosen) ? chosen : null;
  return basicActionOf(activity.item) ?? declared;
}

/** §65: the basic actions among which the author chooses when using this activity, or null. */
export function basicChoiceOf(activity) {
  const declared = declaredBasicsOf(activity);
  return Array.isArray(declared?.choose) ? declared.choose : null;
}

/** 2024 Unarmed Strike: a "natural" weapon, an attack and the "Grapple / Shove" save. */
function unarmedStrikeData(def, text) {
  const effectText = key => game.i18n.localize(`DND5ECOMBAT.Action.unarmed.Effet.${key}`);
  const target = { affects: { type: "creature", count: "1" }, prompt: false };
  const effects = Object.entries(def.effects).map(([key, e]) => ({
    _id: e.id, name: effectText(key), img: e.img, transfer: false, disabled: false, showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    statuses: e.status ? [e.status] : [], changes: [],
    flags: e.push ? { [MODULE_ID]: { push: e.push } } : {}
  }));
  return {
    name: text("Nom"),
    type: "weapon",
    img: def.img,
    system: {
      identifier: def.identifier,
      description: { value: `<p>${text("Texte")}</p>` },
      type: { value: "natural", baseItem: "" },
      proficient: 1,
      equipped: false,
      range: { reach: 5, units: "ft" },
      damage: { base: { number: null, denomination: 0, types: ["bludgeoning"], custom: { enabled: true, formula: "1 + @abilities.str.mod" } } },
      activities: {
        [def.activityId]: {
          _id: def.activityId, type: "attack", activation: { type: "action", value: 1 }, target,
          attack: { ability: "str", type: { value: "melee", classification: "unarmed" } },
          damage: { includeBase: true, parts: [] }
        },
        [def.saveActivityId]: {
          _id: def.saveActivityId, type: "save", name: text("Lutte"), activation: { type: "action", value: 1 }, target,
          range: { override: true, units: "touch" },
          effects: effects.map(e => ({ _id: e._id, onSave: false })),
          damage: { parts: [], onSave: "none" },
          save: { ability: ["str", "dex"], dc: { calculation: "str", formula: "" } }
        }
      }
    },
    effects,
    flags: { [MODULE_ID]: { basicAction: "unarmed" } }
  };
}

/** The item data of a basic action, in this client's language. */
export function basicActionData(kind) {
  const def = BASIC_ACTIONS[kind];
  const text = key => game.i18n.localize(`DND5ECOMBAT.Action.${kind}.${key}`);
  if ( kind === "unarmed" ) return unarmedStrikeData(def, text);
  return {
    name: text("Nom"),
    type: "feat",
    img: def.img,
    system: {
      identifier: `dnd5e-combat-${kind}`,
      description: { value: `<p>${text("Texte")}</p>` },
      activities: {
        [def.activityId]: { _id: def.activityId, type: "utility", activation: { type: "action", value: 1 }, ...(def.activity ?? {}) }
      }
    },
    flags: { [MODULE_ID]: { basicAction: kind } }
  };
}

/**
 * The basic actions an actor does not have yet. A class unarmed strike (Monk, Barbarian) stands in for ours.
 * §107: a familiar (`familiar`) has only those that do not attack.
 */
export function missingBasicActions(actor, { familiar=false }={}) {
  const owned = new Set(actor.items.map(basicActionOf).filter(Boolean));
  const identifiers = new Set(actor.items.map(i => identifierOf(i).id).filter(Boolean));
  const allowed = new Set(familiar ? familiarBasicKinds(BASIC_ACTIONS) : Object.keys(BASIC_ACTIONS));
  return Object.entries(BASIC_ACTIONS)
    .filter(([kind, def]) => allowed.has(kind) && !owned.has(kind) && !(def.identifier && identifiers.has(def.identifier)))
    .map(([kind]) => kind);
}

/** An actor's Unarmed Strike item (ours or a class's), or undefined. */
const unarmedStrikeOf = actor => actor?.items.find(i => (i.type === "weapon") && (identifierOf(i).id === "unarmed-strike"));

/** The "Grapple / Shove" save of an actor's Unarmed Strike (ours or a class's), or null. */
export function grappleShoveOf(actor) {
  return unarmedStrikeOf(actor)?.system.activities?.find(a => a.type === "save") ?? null;
}

/** An actor's Unarmed Strike, or null. */
export function unarmedAttackOf(actor) {
  return unarmedStrikeOf(actor)?.system.activities?.find(a => a.type === "attack") ?? null;
}

/** An actor's Help activity (basic action), or null. */
export function helpActivityOf(actor) {
  const item = actor?.items.find(i => basicActionOf(i) === "help");
  return item?.system.activities?.contents?.[0] ?? null;
}

/** A push carried by an activity effect ("pushed" from the Shove), or null. */
export function pushOf(effect) {
  return effect?.getFlag?.(MODULE_ID, "push") ?? effect?.flags?.[MODULE_ID]?.push ?? null;
}
