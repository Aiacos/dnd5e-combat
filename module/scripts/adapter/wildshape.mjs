/**
 * Wild Shape (SPEC §16.39), read and written in Foundry. dnd5e 6 provides the transformation ("transform" activity, "cr" mode,
 * `wildshape` preset: HP, class, feats, mental ability scores kept; Temporary Hit Points; Circle of the Moon minimum AC; circle
 * spells — config.mjs:3545) and the return (`Actor5e#revertOriginalForm`). What was missing, here:
 *  - the druid's **known forms** (flag `dnd5e-combat.forms` of the original actor: actor uuids);
 *  - the transformation **on casting**, into the chosen form, by the active GM (dnd5e only transforms at the card's button,
 *    on the selected tokens, and `transformInto` creates an actor — which a player does not always have the right to do);
 *  - the **end**: Bonus Action "Revert Form" (an item placed on the transformed sheet), duration (half the druid
 *    level, in hours), Incapacitated or 0 HP.
 */

import { MODULE_ID } from "../constants.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { formRefusal, formMustEnd, knownFormsMax, moonLevelsFormula, moonSpellLists } from "../core/wildshape.mjs";
import { expiryTime } from "../core/area.mjs";
import { readTimeFactors } from "./areas.mjs";
import { evalRuleFormula } from "./projectiles.mjs";

/** A Wild Shape (or Circle Forms) activity: "cr" transformation with the `wildshape` preset. */
export function isWildShape(activity) {
  return (activity?.type === "transform") && (activity.transform?.mode === "cr") && (activity.transform?.preset === "wildshape");
}

/** The original actor of a transformed actor (itself otherwise). */
export function originalOf(actor) {
  if ( !actor?.isPolymorphed ) return actor;
  return game.actors.get(actor.getFlag("dnd5e", "originalActor")) ?? actor;
}

/** Le niveau de druide de l'acteur (d'origine). */
function druidLevel(actor) {
  return Number(originalOf(actor)?.classes?.druid?.system?.levels) || 0;
}

/** The known forms (uuids) and their maximum number. */
export function knownForms(actor) {
  const original = originalOf(actor);
  return { forms: [...(original?.getFlag(MODULE_ID, "forms") ?? [])], max: knownFormsMax(druidLevel(actor)) };
}

/** Rewrites the list of known forms, on the original actor (its player owns it). */
export async function setKnownForms(actor, forms) {
  await originalOf(actor)?.setFlag(MODULE_ID, "forms", Array.from(new Set(forms)));
}

/** What must be known about a form to show it and judge it. */
export async function formInfo(uuid) {
  const actor = await fromUuid(uuid).catch(() => null);
  if ( !actor ) return null;
  const cr = Number(actor.system?.details?.cr);
  return { uuid, name: actor.name, img: actor.img, cr: Number.isFinite(cr) ? cr : null,
    type: actor.system?.details?.type?.value ?? null, fly: Number(actor.system?.attributes?.movement?.fly) || 0 };
}

/** The limits of the profile the activity applies at this level (dnd5e: the first available profile). */
export function profileLimits(activity) {
  const profile = activity.availableProfiles?.[0] ?? activity.profiles?.[0];
  if ( !profile ) return { maxCr: null, types: [], noMovement: [] };
  const maxCr = (profile.cr === "") || (profile.cr === null) || (profile.cr === undefined) ? null : evalRuleFormula(String(profile.cr), activity, null);
  // `evalRuleFormula` rounds down to the integer: a CR ¼ or ½ reads as is.
  const exact = Number(profile.cr);
  return { maxCr: Number.isFinite(exact) ? exact : maxCr, types: Array.from(profile.types ?? []), noMovement: Array.from(profile.movement ?? []) };
}

/** Is the form allowed by the activity? The reason for the refusal, or null. */
export function formRefusedBy(activity, form) {
  return formRefusal(form, profileLimits(activity));
}

/** The world time at which the form ends ("a number of hours equal to half your druid level"), or null. */
export function formExpiry(activity, now=game.time.worldTime) {
  const d = activity.duration ?? {};
  let value = Number(d.value);
  if ( !Number.isFinite(value) ) value = evalRuleFormula(String(d.value ?? ""), activity, NaN);
  return expiryTime(now, { value, units: d.units }, readTimeFactors());
}

/* -------------------------------------------- */
/*  Transformer, revenir (MJ actif)             */
/* -------------------------------------------- */

const REVERT_ACTIVITY = "dnd5eCombatRevrt";

/** The "Revert Form" action placed on a transformed sheet, or null. */
export function revertActivityOf(actor) {
  const item = actor?.items?.find(i => i.getFlag(MODULE_ID, "revertForm"));
  return item?.system.activities?.get(REVERT_ACTIVITY) ?? item?.system.activities?.contents?.[0] ?? null;
}

/** The item of the "Revert Form" Bonus Action (HUD, sheet, right-click menu). */
function revertItemData() {
  return {
    name: game.i18n.localize("DND5ECOMBAT.Forme.Reprendre"), type: "feat", img: "icons/magic/nature/wolf-paw-glow-large-green.webp",
    system: {
      description: { value: `<p>${game.i18n.localize("DND5ECOMBAT.Forme.ReprendreAide")}</p>` },
      activities: { [REVERT_ACTIVITY]: { _id: REVERT_ACTIVITY, type: "utility", activation: { type: "bonus", value: 1 },
        range: { units: "self" }, target: { affects: { type: "self" } } } }
    },
    flags: { [MODULE_ID]: { revertForm: true } }
  };
}

/**
 * Transforms the actor into the form `sourceUuid`, per the activity's settings — first reverting to the original form
 * if it already bears one ("use Wild Shape again" changes form). Active GM.
 * @returns {Promise<Actor|null>}  The transformed actor.
 */
export async function transformActor(actor, source, activity) {
  let original = actor;
  if ( actor.isPolymorphed ) original = (await actor.revertOriginalForm({ renderSheet: false })) ?? originalOf(actor);
  await original.transformInto(await withConcreteImage(source), moonSettings(activity.settings), { renderSheet: false });
  const shaped = game.actors.filter(a => a.isPolymorphed && (a.getFlag("dnd5e", "originalActor") === original.id))
    .sort((a, b) => (b._stats?.createdTime ?? 0) - (a._stats?.createdTime ?? 0))[0] ?? null;
  if ( !shaped ) return null;
  await shaped.setFlag(MODULE_ID, "wildShape", { item: activity.item?.name ?? null, expiresAt: formExpiry(activity) });
  if ( !revertActivityOf(shaped) ) await shaped.createEmbeddedDocuments("Item", [revertItemData()]);
  return shaped;
}

/**
 * §432: the transformation settings, with Circle of the Moon read under its two identifiers (`moon` of the Player's
 * Handbook, `circle-moon` of dnd5e 6.1's preset) — minimum AC, Temporary Hit Points, circle spells. A copy: neither the
 * activity nor dnd5e's preset (`CONFIG.DND5E.transformation.presets.wildshape`) is modified. Nothing to change: the
 * settings as they are.
 */
export function moonSettings(settings) {
  if ( !settings ) return settings;
  const lists = Array.from(settings.spellLists ?? []);
  const changes = {};
  for ( const key of ["minimumAC", "tempFormula"] ) {
    const formula = moonLevelsFormula(settings[key]);
    if ( formula !== settings[key] ) changes[key] = formula;
  }
  const widened = moonSpellLists(lists);
  if ( widened.length !== lists.length ) changes.spellLists = widened;
  if ( !Object.keys(changes).length ) return settings;
  return (typeof settings.clone === "function") ? settings.clone(changes) : { ...settings, ...changes };
}

/**
 * A creature whose token takes a random image (`randomImg`, pattern `wolf-*.webp` of the Monster Manual): dnd5e
 * copies the pattern as is into the transformed token, which the core cannot load (seen in play: "Invalid Asset
 * …/wolf-*.webp"). We transform into an in-memory copy (never written) whose image is drawn from those of the pattern.
 */
async function withConcreteImage(source) {
  const proto = source.prototypeToken;
  const subject = String(proto?.ring?.subject?.texture ?? "");
  if ( !proto?.randomImg && !String(proto?.texture?.src ?? "").includes("*") && !subject.includes("*") ) return source;
  // `getTokenImages` may return the pattern itself, unresolved (seen in play): it is then resolved like the core does, through
  // the file browser.
  let images = [...(await source.getTokenImages().catch(() => []))].filter(i => i && !String(i).includes("*")).sort();
  if ( !images.length && String(proto?.texture?.src ?? "").includes("*") ) images = await wildcardFiles(proto.texture.src);
  const pick = images.length ? Math.floor(Math.random() * images.length) : 0;
  const changes = { "prototypeToken.randomImg": false, "prototypeToken.texture.src": images[pick] ?? source.img };
  // dnd5e's dynamic ring has its own subject image, also a pattern (`subjects/wolf-*.webp`): the same variant.
  if ( subject.includes("*") ) {
    const subjects = await wildcardFiles(subject);
    changes["prototypeToken.ring.subject.texture"] = subjects.length ? subjects[pick % subjects.length] : null;
  }
  // `clone` does not expand dotted keys. Outside the compendium (`pack: null`): built with its pack's context, the copy
  // of a Monster Manual actor took the compendium image (`tokens/wolf-*.webp`, `randomImg`) and ignored these
  // changes (seen in play on 2026-10-12, §155); dnd5e only reads `toObject()` from it, the pack serves no purpose here.
  return source.clone(foundry.utils.expandObject(changes), { keepId: true, pack: null });
}

/** The files of a pattern (`…/wolf-*.webp`), sorted, as the core lists them for token images. */
async function wildcardFiles(path) {
  try {
    const result = await CONFIG.ux.FilePicker.browse("data", path, { wildcard: true });
    return [...(result?.files ?? [])].sort();
  } catch { return []; }
}

/** Reverts to the original form. Active GM. */
export async function revertForm(actor) {
  if ( !actor?.isPolymorphed ) return null;
  return actor.revertOriginalForm({ renderSheet: false });
}

/** An actor in Wild Shape (placed by the engine). */
export function isWildShaped(actor) {
  return !!actor?.isPolymorphed && !!actor.getFlag(MODULE_ID, "wildShape");
}

/** Must this actor's form end (Incapacitated, 0 HP)? */
export function formShouldEnd(actor) {
  if ( !isWildShaped(actor) ) return false;
  return formMustEnd({ hp: actor.system?.attributes?.hp?.value, statuses: Array.from(actor.statuses ?? []) }, INCAPACITATING);
}

/** Les acteurs dont la forme a fait son temps. */
export function expiredForms(now=game.time.worldTime) {
  return game.actors.filter(a => {
    const at = isWildShaped(a) ? a.getFlag(MODULE_ID, "wildShape")?.expiresAt : null;
    return Number.isFinite(at) && (at <= now);
  });
}
