/**
 * The diagnostic's checks (SPEC §177): those of the "GM Tools" macros (tools/macros/, SPEC §56), whose logic they reproduce
 * identically, split into tasks. A check modifies nothing: `scan()` returns tasks
 *   { check, root, where, text, apply?, preselect }
 * `root`: the document to back up before repairing (backup.mjs, `rootOf`); `apply()` repairs and returns the report's sentence;
 * a task without `apply` is only flagged. The texts are the macros' (keys DND5ECOMBAT.Macro.*).
 */
import { MODULE_ID } from "../../constants.mjs";
import { loc, esc } from "../shared.mjs";
import { rootOf, validSourceUuid } from "./backup.mjs";
import { fresh } from "./fresh.mjs";
import { basicActionData } from "../../adapter/basics.mjs";
import { scrollSpellOf } from "../../adapter/scrolls.mjs";
import { localizeEffectNames } from "../../core/localize.mjs";
import { DDB_IMPORTER, importerErrors, importerOf } from "../../core/importer.mjs";
import { referenceReader, retranslationOf, applyRetranslation } from "../../adapter/retranslate.mjs";
import { contentOf } from "../../adapter/content.mjs";
import { dataFixPlanOf, applyDataFixes } from "../../adapter/data-fixes.mjs";
import { sourceKind } from "../../core/item-sources.mjs";
import { withDataFixes } from "../../core/data-fixes.mjs";
import { unmarkedItemEffects, unmarkedAppliedEffects, markEffects } from "../../adapter/antimagic.mjs";
import { phbDifferences, phbShape, renamedSourceItem, citesSubclass, withoutGrantedForwards } from "../../core/phb-update.mjs";
import { spellDuplicates } from "../../core/spell-duplicates.mjs";
import { missingModifications, modifyOrigin } from "../../core/modify-item.mjs";
import { summonGaps } from "../../core/summon-permissions.mjs";
import { summonFacts } from "../../adapter/summon-permissions.mjs";
import { brokenSourceLinks } from "../../core/source-links.mjs";
import { invalidEffectIds, hasInvalidEffects } from "../../core/invalid-effects.mjs";

/**
 * §202: the effects of a compendium reference, ready to copy — an effect with the item's original (English) name
 * takes the reference's translated name, for a translation that does not translate effect names (core/localize.mjs).
 */
const effectsOf = (reference, effects=reference.effects) =>
  localizeEffectNames(effects.map(e => (e.toObject ? e.toObject() : e)), reference.flags?.babele?.originalName ?? null, reference.name);

const tr = prefix => (key, data) => loc(`Macro.${prefix}.${key}`, data);

/** §456: an item deleted to be recreated right away (replacement) — `leavesEffects` must not apply (runtime/leaves.mjs). */
const replacing = () => ({ [MODULE_ID]: { replacing: true } });

/**
 * §456: the compendium reference as the engine returns it (its `dataFixes` applied). Compared raw, an item corrected on the sheet
 * ("Lady Nature's Sanctuary", Brutal Strike) seemed "different from the Player's Handbook": `phb3-items` replaced it,
 * the correction redid it.
 */
const fixedReference = doc => withDataFixes(doc.toObject(), contentOf(doc).entry?.dataFixes).data;

/**
 * The items belonging to an unlinked token: those of its delta's SOURCE. Client side, `token.delta.items` enumerates the merged
 * inventory (base + delta): the old macros thus also processed, through each token, the base actor's items (seen in
 * play on 2026-10-13: repairing the actor then its token failed on a base item already removed).
 */
const ownItemIds = token => (token._source?.delta?.items ?? []).map(i => i._id);

/** All the world's items: world items, sheets' items, items belonging to unlinked tokens (their delta only). */
function allItems() {
  const found = [];
  for ( const item of game.items ) found.push(item);
  for ( const actor of game.actors ) for ( const item of actor.items ) found.push(item);
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor ) continue;
    for ( const id of ownItemIds(token) ) {
      const item = token.actor.items.get(id);
      if ( item ) found.push(item);
    }
  }
  return found;
}

/** "Sheet — item", or "World — item". */
function whereOf(item) {
  const root = rootOf(item);
  return `<b>${esc(root?.type === "Item" ? loc("Diagnostic.Monde") : root?.name ?? "?")}</b> — ${esc(item.name)}`;
}

/* -------------------------------------------- */
/*  1. Midi-QOL, DAE, CPR (nettoyage-midi.js)     */
/* -------------------------------------------- */

const MIDI = (() => {
  const BAD = ["midi-qol", "midiProperties", "dae", "chris-premades", "gambits-premades", "itemacro", "autoanimations", "ActiveAuras",
    "times-up", "automated-conditions-5e", "darsh-automation", "cat", "link-item-resource-5e", "custom-character-sheet-sections", "boss-loot-assets-premium"];
  const OFFICIAL = /^Compendium\.(dnd-players-handbook|dnd-monster-manual|dnd5e)\./;
  const PHYSICAL = new Set(["weapon", "equipment", "consumable", "loot", "tool", "container"]);
  const STRIP_ONLY = new Set(["spirit-shroud", "anneau-de-chaleur-maudit", "staff"]);
  const RENAMED = { "blfx-scorching-ray": "scorching-ray", "bullseye-lantern-11438": "bullseye-lantern", "arcane-ward-resource-usage-10010": "arcane-ward" };
  const PACK_ORDER = ["dnd-players-handbook.equipment", "dnd-players-handbook.spells", "dnd-players-handbook.feats", "dnd-players-handbook.origins",
    "dnd-players-handbook.classes", "dnd5e.equipment24", "dnd5e.spells24", "dnd5e.feats24", "dnd5e.origins24", "dnd5e.classes24"];
  const THIRD_PARTY = /^Compendium.(chris-premades|midi-item-showcase|forge-vtt-shared|boss-loot)|^Compendium.world.ddb/;
  const PACT_TYPES = ["necrotic", "psychic", "radiant"];
  const MACRO_KEY = /midi-qol|chris-premades|DamageBonusMacro|ItemMacro/;
  return { BAD, OFFICIAL, PHYSICAL, STRIP_ONLY, RENAMED, PACK_ORDER, THIRD_PARTY, PACT_TYPES, MACRO_KEY };
})();

const hasBad = flags => Object.keys(flags ?? {}).some(k => MIDI.BAD.includes(k));
const cleanFlags = flags => Object.fromEntries(Object.entries(foundry.utils.deepClone(flags ?? {})).filter(([k]) => !MIDI.BAD.includes(k)));
const deletion = flags => {
  const del = foundry.data.operators.ForcedDeletion;
  return Object.fromEntries(Object.keys(flags ?? {}).filter(k => MIDI.BAD.includes(k)).map(k => [`flags.${k}`, new del()]));
};
const badEffect = e => hasBad(e.flags) || (e.type !== "base" && e.type !== "enchantment")
  || (e.system?.changes ?? e.changes ?? []).some(c => MIDI.MACRO_KEY.test(c.key ?? ""));
// §276: an item from another official module (Ravenloft…) is not "to be taken over" for its source alone.
const needsWork = item => hasBad(item.flags) || item.effects.some(badEffect) || (item.effects.invalidDocumentIds?.size > 0)
  || (sourceKind(item._stats?.compendiumSource) === "other");
const touchedByMidi = actor => hasBad(actor.flags) || actor.effects.some(e => hasBad(e.flags))
  || actor.items.some(i => hasBad(i.flags) || i.effects.some(e => hasBad(e.flags)) || MIDI.THIRD_PARTY.test(i._stats?.compendiumSource ?? ""));

async function officialFor(item) {
  const src = item._stats?.compendiumSource ?? "";
  const kind = sourceKind(src);
  if ( (kind === "reference") || (kind === "premium") ) { const doc = await fromUuid(src).catch(() => null); if ( doc ) return doc; }
  // §276: never a namesake by identifier for an item from another official module — seen on 2026-10-28, the feat
  // "Survivor" from Ravenloft (identifier `survivor`) replaced by the Champion's "Survivor" feature.
  if ( kind === "premium" ) return null;
  const identifier = MIDI.RENAMED[item.system.identifier] ?? item.system.identifier;
  for ( const pack of MIDI.PACK_ORDER.map(id => game.packs.get(id)).filter(p => p?.documentName === "Item") ) {
    const index = await pack.getIndex({ fields: ["system.identifier"] });
    const hit = index.find(e => (e.system?.identifier === identifier) && (e.type === item.type));
    if ( hit ) return pack.getDocument(hit._id);
  }
  return null;
}

function midiReplacement(item, doc) {
  const data = doc.toObject();
  const old = item.toObject();
  data._id = item.id;
  const kept = cleanFlags(old.flags);
  data.flags = foundry.utils.mergeObject(foundry.utils.deepClone(data.flags ?? {}), { ...kept, babele: data.flags?.babele ?? kept.babele }, { inplace: false });
  if ( !data.flags.babele ) delete data.flags.babele;
  data._stats = { ...(data._stats ?? {}), compendiumSource: doc.uuid };
  data.sort = old.sort;
  const s = old.system ?? {};
  const keep = paths => { for ( const p of paths ) { const v = foundry.utils.getProperty(s, p); if ( v !== undefined ) foundry.utils.setProperty(data.system, p, v); } };
  keep(["uses.spent", "container"]);
  if ( item.type === "spell" ) keep(["method", "prepared", "sourceItem", "sourceClass", "ability"]);
  if ( MIDI.PHYSICAL.has(item.type) ) {
    if ( !(item.system.identifier in MIDI.RENAMED) ) { data.name = old.name; data.img = old.img; }
    keep(["quantity", "equipped", "attuned", "attunement", "identified"]);
  }
  for ( const [id, activity] of Object.entries(s.activities ?? {}) ) {
    if ( data.system.activities?.[id] && (activity.uses?.spent !== undefined) ) foundry.utils.setProperty(data.system.activities[id], "uses.spent", activity.uses.spent);
  }
  return data;
}

/**
 * Issue #112: the effects of this document that failed to initialize are deleted (the task's root is backed up first, and the
 * backup keeps them: they are still in the source data). One report line per document; `dry` writes nothing.
 * @param {Actor|Item} doc
 * @param {boolean} dry
 * @param {(key: string, data?: object) => string} t  The check's translator.
 * @returns {Promise<string[]>}
 */
async function deleteInvalidEffects(doc, dry, t) {
  const invalid = invalidEffectIds(doc);
  if ( !invalid.length ) return [];
  if ( !dry ) await doc.deleteEmbeddedDocuments("ActiveEffect", invalid);
  return [`🧹 ${esc(doc.name)} : ${t("AuraEffectsDeleted", { count: invalid.length })}`];
}

/**
 * Cleans one sheet, as the macro does: `dry` writes nothing. Returns the report lines.
 * Issue #112: `onlyInvalid` — a sheet Midi never touched, listed only because one of its effects fails to initialize: nothing
 * but those effects is removed (no item is replaced, no flag stripped).
 */
export async function cleanActor(actor, dry, { onlyInvalid=false }={}) {
  const t = tr("CleanMidi");
  const lines = [];
  if ( onlyInvalid ) {
    for ( const doc of [actor, ...actor.items] ) lines.push(...await deleteInvalidEffects(doc, dry, t));
    return lines;
  }
  const ids = identifier => actor.items.filter(i => i.system.identifier === identifier);
  for ( const item of [...actor.items] ) {
    // A spell given by an item replaced earlier in the loop: dnd5e removed it with it and recreated it under another id (#111).
    if ( !actor.items.has(item.id) ) continue;
    const id = item.system.identifier;
    const src = item._stats?.compendiumSource ?? "";
    const duplicate = (id === "dark-ones-blessing" && src.startsWith("Compendium.chris-premades") && ids(id).length > 1)
      || (id === "blade-ward" && !MIDI.OFFICIAL.test(src) && ids(id).length > 1)
      || (id === "arcane-ward-resource-usage-10010" && ids("arcane-ward").length > 0);
    if ( (id === "generic-actions") || duplicate ) {
      lines.push(`🗑 ${esc(item.name)}`);
      if ( !dry ) await item.delete();
      continue;
    }
    if ( !needsWork(item) ) continue;
    const doc = MIDI.STRIP_ONLY.has(id) || /^spell-scroll/.test(id) ? null : await officialFor(item);
    const custom = MIDI.PHYSICAL.has(item.type) && !!doc && (doc.name !== item.name) && !MIDI.THIRD_PARTY.test(src) && !(id in MIDI.RENAMED);
    if ( doc && !custom ) {
      lines.push(`♻ ${esc(item.name)} ← ${esc(doc.name)} (${esc(doc.uuid.replace("Compendium.", ""))})`);
      if ( !dry ) {
        const data = midiReplacement(item, doc);
        await actor.deleteEmbeddedDocuments("Item", [item.id], replacing());
        await actor.createEmbeddedDocuments("Item", [data], { keepId: true });
      }
      continue;
    }
    if ( !hasBad(item.flags) && !item.effects.some(badEffect) && !(item.effects.invalidDocumentIds?.size > 0) ) continue;
    const invalid = [...(item.effects.invalidDocumentIds ?? [])];
    const effects = item.effects.filter(badEffect);
    lines.push(`🧹 ${t("Cleaned", { name: esc(item.name), campaign: doc ? ` ${t("CampaignItem")}` : "",
      flags: Object.keys(deletion(item.flags)).map(k => k.slice(6)).join(", ") || "—" })}`
      + `${invalid.length ? ` ; ${t("AuraEffectsDeleted", { count: invalid.length })}` : ""}${effects.length ? ` ; ${t("EffectsCleaned", { names: esc(effects.map(e => e.name).join(", ")) })}` : ""}`);
    if ( dry ) continue;
    if ( invalid.length ) await item.deleteEmbeddedDocuments("ActiveEffect", invalid);
    const update = deletion(item.flags);
    if ( Object.keys(update).length ) await item.update(update);
    for ( const e of effects ) {
      const changes = (e.system?.changes ?? e.changes ?? []).filter(c => !MIDI.MACRO_KEY.test(c.key ?? ""));
      await e.update({ ...deletion(e.flags), "system.changes": changes });
    }
  }
  if ( ids("pact-of-the-blade").length ) {
    for ( const weapon of actor.items.filter(i => (i.type === "weapon") && (i.system.type?.value !== "natural")) ) {
      const base = weapon._source.system.damage?.base ?? {};
      const types = [...(base.types ?? [])];
      if ( !MIDI.PACT_TYPES.every(x => types.includes(x)) ) continue;
      const kept = types.filter(x => !MIDI.PACT_TYPES.includes(x));
      const bonus = /^\s*[+-]?\d+\s*$/.test(String(base.bonus ?? "")) ? "" : base.bonus;
      lines.push(`🗡 ${t("PactWeapon", { name: esc(weapon.name), types: types.join(", "), kept: kept.join(", ") || "—" })}`
        + `${bonus !== base.bonus ? `, ${t("FixedBonusRemoved", { bonus: esc(base.bonus) })}` : ""}`);
      if ( !dry ) await weapon.update({ "system.damage.base.types": kept, "system.damage.base.bonus": bonus ?? "" });
    }
  }
  const actorDeletion = deletion(actor.flags);
  if ( Object.keys(actorDeletion).length ) {
    lines.push(`🧹 ${t("SheetFlags", { flags: Object.keys(actorDeletion).map(k => k.slice(6)).join(", ") })}`);
    if ( !dry ) await actor.update(actorDeletion);
  }
  for ( const e of actor.effects ) {
    if ( !hasBad(e.flags) ) continue;
    lines.push(`🧹 ${esc(e.name)}`);
    if ( !dry ) await e.update(deletion(e.flags));
  }
  // Issue #112: an invalid effect on the actor itself (the loop above already deletes those of its items).
  lines.push(...await deleteInvalidEffects(actor, dry, t));
  return lines;
}

const cleanMidi = {
  id: "clean-midi", icon: "fa-solid fa-flask",
  async scan() {
    const tasks = [];
    // Issue #112: a sheet is also listed when one of its effects fails to initialize, Midi traces or not — the core logs an
    // error for it at every preparation. Without Midi traces the repair is limited to those effects (`onlyInvalid`).
    for ( const actor of game.actors.filter(a => touchedByMidi(a) || hasInvalidEffects(a)) ) {
      const options = { onlyInvalid: !touchedByMidi(actor) };
      const lines = await cleanActor(actor, true, options);
      if ( !lines.length ) continue;
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text: lines.join("<br>"), preselect: actor.hasPlayerOwner,
        apply: async () => (await cleanActor(fresh(actor), false, options)).join("<br>") });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  2. Player's Handbook effects                 */
/* -------------------------------------------- */

const phbEffects = {
  id: "phb-effects", icon: "fa-solid fa-ankh",
  async scan() {
    const SOURCES = /^Compendium\.dnd-players-handbook\.(origins|classes|feats)\.Item\./;
    const tasks = [];
    for ( const actor of game.actors ) for ( const item of actor.items ) {
      const source = item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId;
      if ( !source || !SOURCES.test(source) ) continue;
      const reference = await fromUuid(source).catch(() => null);
      if ( !reference?.effects?.size ) continue;
      // §438: an item from an older version whose identifier or activities changed (Handbook 3.0.0) is replaced (`phb3-items`);
      // copying the new effects onto it would mix the two forms.
      if ( phbDifferences(phbShape(item.toObject()), phbShape(fixedReference(reference))).some(r => ["identifier", "activities"].includes(r)) ) continue;
      const missing = reference.effects.filter(e => !item.effects.has(e.id));
      if ( !missing.length ) continue;
      const copies = effectsOf(reference, missing);
      const names = esc(copies.map(e => e.name).join(", "));
      tasks.push({ root: rootOf(item), where: whereOf(item), text: names, preselect: true,
        apply: async () => {
          await fresh(item).createEmbeddedDocuments("ActiveEffect", copies, { keepId: true });
          return names;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  3. Objets aux effets perdus                  */
/* -------------------------------------------- */

const lostEffects = {
  id: "item-effects", icon: "fa-solid fa-hammer",
  async scan() {
    const t = tr("RepairItems");
    const TYPES = new Set(["equipment", "weapon", "consumable", "tool", "loot", "container"]);
    const refs = new Map();
    for ( const id of ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment"] ) {
      const pack = game.packs.get(id);
      if ( !pack ) continue;
      const index = await pack.getIndex({ fields: ["system.identifier"] });
      for ( const e of index ) if ( e.system?.identifier && !refs.has(e.system.identifier) ) refs.set(e.system.identifier, { pack, id: e._id });
    }
    const cache = new Map();
    const reference = async identifier => {
      if ( !cache.has(identifier) ) { const r = refs.get(identifier); cache.set(identifier, r ? await r.pack.getDocument(r.id) : null); }
      return cache.get(identifier);
    };
    const tasks = [];
    for ( const scanned of allItems() ) {
      if ( !TYPES.has(scanned.type) ) continue;
      const item = scanned;
      const identifier = item.system?.identifier;
      if ( !identifier || !refs.has(identifier) ) continue;
      const ref = await reference(identifier);
      if ( !ref?.effects?.size ) continue;
      const where = whereOf(item);
      const copies = effectsOf(ref);
      const names = esc(copies.map(e => e.name).join(", "));
      if ( item.effects.size ) {
        if ( ref.effects.some(e => !item.effects.has(e.id)) ) tasks.push({ root: rootOf(item), where, text: t("LineDifferent", { where, names }) });
        continue;
      }
      tasks.push({ root: rootOf(item), where, text: t("LineToCopy", { where, names }), preselect: true,
        apply: async () => {
          const item = fresh(scanned);
          if ( ref.effects.some(e => e.type === "enchantment") ) {
            // Enchantment effects are not added to an existing item (dnd5e refuses them, data/active-effect/enchantment.mjs,
            // `_preCreate`): the item is replaced by a fresh copy from the compendium, which keeps name, quantity, container,
            // price, order and flags of other modules.
            const data = game.items.fromCompendium(ref);
            data.name = item.name;
            data.effects = effectsOf(ref, data.effects ?? []);
            data.sort = item.sort;
            Object.assign(data.system, { quantity: item.system.quantity, container: item.system.container ?? null, price: item.system.price ?? data.system.price });
            for ( const [scope, value] of Object.entries(item.flags ?? {}) ) if ( !["dnd5e", "core"].includes(scope) ) data.flags[scope] = foundry.utils.deepClone(value);
            if ( item.parent ) await item.parent.createEmbeddedDocuments("Item", [data]);
            else await Item.implementation.create({ ...data, folder: item.folder?.id ?? null });
            await item.delete();
            return t("LineReplaced", { where, names });
          }
          await item.createEmbeddedDocuments("ActiveEffect", copies, { keepId: true });
          const refused = ref.effects.filter(e => !item.effects.has(e.id)).map(e => e.name);
          if ( refused.length ) throw new Error(t("EffectsRefused", { names: esc(refused.join(", ")) }));
          return t("LineCopied", { where, names });
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  4. Parchemins de sort                        */
/* -------------------------------------------- */

const scrolls = {
  id: "scrolls", icon: "fa-solid fa-scroll",
  async scan() {
    const t = tr("Scrolls");
    const isScroll = item => (item.type === "consumable") && (item.system?.type?.value === "scroll");
    const legacyOf = item => {
      const source = item._stats?.compendiumSource ?? "";
      if ( source.startsWith("Compendium.dnd5e.items.") ) return t("LegacyOldCompendium");
      if ( item.flags?.ddbimporter ) return t("LegacyDdb");
      if ( item.flags?.["chris-premades"] || item.flags?.["midi-qol"] || item.flags?.midiProperties ) return t("LegacyMidi");
      return null;
    };
    let sources = null;
    const sourceOf = async identifier => {
      if ( !sources ) {
        sources = new Map();
        const FIRST = ["dnd-players-handbook.spells", "dnd5e.spells24"];
        const rank = pack => (FIRST.includes(pack.collection) ? FIRST.indexOf(pack.collection) : FIRST.length);
        for ( const pack of [...game.packs].filter(p => p.documentName === "Item").sort((a, b) => rank(a) - rank(b)) ) {
          const index = await pack.getIndex({ fields: ["system.identifier"] });
          for ( const e of index ) if ( (e.type === "spell") && e.system?.identifier && !sources.has(e.system.identifier) ) sources.set(e.system.identifier, e.uuid);
        }
      }
      return sources.get(identifier);
    };
    const tasks = [];
    for ( const scanned of allItems().filter(isScroll) ) {
      const item = scanned;
      if ( item.system.activities?.some?.(a => a.type === "cast") ) continue;   // current format: nothing to do
      const where = whereOf(item);
      const spell = scrollSpellOf(item);
      if ( !spell ) { tasks.push({ root: rootOf(item), where, text: t("LineNotFound", { where }) }); continue; }
      const label = t("SpellLabel", { identifier: spell.identifier, level: spell.level ?? "?" });
      const legacy = legacyOf(item);
      const noted = item.flags?.[MODULE_ID]?.scroll?.identifier ?? null;
      const note = { identifier: spell.identifier, level: spell.level, school: spell.school };
      if ( legacy ) {
        tasks.push({ root: rootOf(item), where, text: `${label} — ${t("LegacyFormat", { legacy })}`, preselect: true,
          apply: async () => {
            const item = fresh(scanned);
            const uuid = await sourceOf(spell.identifier);
            if ( !uuid ) throw new Error(t("SpellNotInCompendiums"));
            const source = await fromUuid(uuid);
            const scroll = await CONFIG.Item.documentClass.createScrollFromSpell(source, {}, { dialog: false, level: spell.level ?? source.system.level });
            if ( !scroll ) throw new Error(t("ScrollNotCreated"));
            const data = scroll.toObject();
            const { ForcedReplacement, ForcedDeletion } = foundry.data.operators;
            await item.update({
              name: data.name,
              "system.activities": ForcedReplacement.create(data.system.activities),
              "system.description": data.system.description,
              "system.properties": data.system.properties,
              "system.source": data.system.source,
              "system.identifier": data.system.identifier,
              "system.uses.max": data.system.uses?.max ?? item.system.uses?.max,
              "flags.dnd5e.spellLevel": data.flags?.dnd5e?.spellLevel ?? item.flags?.dnd5e?.spellLevel,
              "flags.dnd5e.scaling": data.flags?.dnd5e?.scaling ?? 0,
              [`flags.${MODULE_ID}.scroll`]: note,
              "flags.ddbimporter": new ForcedDeletion(),
              "flags.midi-qol": new ForcedDeletion(),
              "flags.midiProperties": new ForcedDeletion(),
              "flags.chris-premades": new ForcedDeletion()
            });
            if ( item.effects.size ) await item.deleteEmbeddedDocuments("ActiveEffect", item.effects.map(e => e.id));
            if ( data.effects?.length ) await item.createEmbeddedDocuments("ActiveEffect", data.effects, { keepId: true });
            return t("LineRebuilt", { where, label, legacy, name: esc(data.name) });
          } });
      } else if ( noted !== spell.identifier ) {
        tasks.push({ root: rootOf(item), where, text: `${label} — ${t("ToNote")}`, preselect: true,
          apply: async () => {
            await fresh(scanned).update({ [`flags.${MODULE_ID}.scroll`]: note });
            return t("LineNoted", { where, label, legacy: "" });
          } });
      }
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  4 bis. Items imported from D&D Beyond         */
/* -------------------------------------------- */

/**
 * §245 (issue #21): an item imported by DDB Importer (`flags.ddbimporter`) carries its activities and effects under other ids
 * than the official item (Handbook, SRD). A content rule that cites one of these ids finds nothing: the item's automation may do
 * nothing (Armor of Agathys gave its Temporary Hit Points, not its retaliation). The engine does not adapt to it, by decision: the
 * diagnostic flags them, without repairing anything. Only items whose rule cites an activity or effect id of the official item
 * absent from the imported item are retained; with no official item in the world, the cited ids that look like a Foundry id (16
 * characters, at least one digit).
 * @returns {Promise<Array<{item: Item, official: Item|null, viaMidi: boolean}>>}
 */
export const ddbItemsAtRisk = () => importedItemsAtRisk(DDB_IMPORTER.id);

/**
 * The importers declared by other modules (`registerImporter`), in order: each has its check, after "ddb".
 * @type {Map<string, {id: string, flag: string, name: string, hint: string, icon: string}>}
 */
const IMPORTERS = new Map();

/**
 * Another module declares its item importer: the diagnostic lists those of its items whose rule cites an id the item does not
 * have, and replaces them with the official item as for DDB Importer (same id, sheet state and importer flags kept;
 * no lock). A second declaration of the same `id` by the same caller replaces the first.
 * @param {{id: string, flag: string, name: string, hint?: string, icon?: string}} def  see core/importer.mjs, `importerErrors`
 * @returns {string}  the id of its check
 */
export function registerImporter(def) {
  const errors = importerErrors(def, [...IMPORTERS.values()].filter(other => other.id !== def?.id));
  if ( errors.length ) throw new Error(`${MODULE_ID} | diagnostic.registerImporter: ${errors.join(" ; ")}`);
  IMPORTERS.set(def.id, Object.freeze({ id: def.id, flag: def.flag, name: def.name, hint: def.hint ?? "",
    icon: def.icon ?? "fa-solid fa-file-import" }));
  return importedCheckId(def.id);
}

/** The importer is no longer declared. @returns {boolean} whether it was */
export function unregisterImporter(id) {
  return IMPORTERS.delete(id);
}

const importedCheckId = id => `imported-${id}`;

/** @param {string} importer  the id of the examined importer (`importerOf`) */
async function importedItemsAtRisk(importer) {
  const out = [];
  const declared = [...IMPORTERS.values()];
  for ( const item of allItems() ) {
    if ( importerOf(item.flags, declared) !== importer ) continue;
    const { entry } = contentOf(item);
    if ( !entry ) continue;
    const cited = new Set(JSON.stringify(entry).match(/[A-Za-z0-9]{16}/g) ?? []);
    if ( !cited.size ) continue;
    const official = await officialFor(item).catch(() => null);
    const idsOf = doc => new Set([...Object.keys(doc?._source?.system?.activities ?? {}), ...(doc?.effects?.map(e => e.id) ?? [])]);
    const own = idsOf(item);
    const reference = official ? idsOf(official) : null;
    const relevant = [...cited].filter(id => reference ? reference.has(id) : /\d/.test(id));
    if ( !relevant.some(id => !own.has(id)) ) continue;
    // The "Midi-QOL" check already replaces this item with the official one (sheet touched by Midi, item to take over).
    const actor = item.parent?.documentName === "Actor" ? item.parent : null;
    // Issue #112: `touchedByMidi` on purpose, not "listed by clean-midi" — a sheet listed only for an invalid effect has
    // nothing replaced by that check, so its items stay with this one.
    const viaMidi = !!official && !!actor && touchedByMidi(actor) && needsWork(item);
    out.push({ item, official, viaMidi });
  }
  return out;
}

/**
 * The items the repair does not replace: classes, subclasses and origins, and any official item with advancements — the choices
 * made on the sheet (skills, feats, scale values…) live in its advancements and do not carry over from one version to the other.
 */
const DDB_BY_HAND = new Set(["class", "subclass", "background", "race"]);
const ddbRepairable = official => !DDB_BY_HAND.has(official.type)
  && !Object.keys(official._source?.system?.advancement ?? {}).length;

/**
 * The official item in place of the imported item, like the Midi-QOL check (`midiReplacement`: same id, sheet state
 * kept). `flags.ddbimporter` stays: DDB Importer matches its items by `flags.ddbimporter.id` and the name, or by `id` +
 * `definitionId` (spells, items; not features). Without a lock, the next sync recreates it as the DDB version, under the same id;
 * with the lock (`ignoreItemImport`, DDB Importer's "Ignore this item" option), it leaves it as is — and keeps it even removed
 * from D&D Beyond. Locked, an item without `definitionId` keeps its DDB name, otherwise the sync would no longer recognize it and
 * would add the DDB version next to it.
 */
function ddbReplacement(item, doc, { lock=false }={}) {
  const data = midiReplacement(item, doc);
  const ddbFlags = foundry.utils.deepClone(item._source.flags?.ddbimporter ?? {});
  if ( lock ) {
    ddbFlags.ignoreItemImport = true;
    if ( ddbFlags.definitionId === undefined ) data.name = item._source.name;
  }
  data.flags.ddbimporter = ddbFlags;
  if ( !item.parent ) data.folder = item._source.folder ?? null;
  return data;
}

const ddb = {
  id: "ddb", group: "ddb", icon: "fa-brands fa-d-and-d-beyond", options: [{ id: "lock", default: false }],
  async scan() {
    const t = tr("Ddb");
    return (await ddbItemsAtRisk()).map(({ item, official, viaMidi }) => {
      const name = esc(item.name);
      const where = whereOf(item);
      const root = rootOf(item);
      if ( viaMidi ) return { root, where, text: t("LineMidi", { name, official: esc(official.name) }) };
      if ( !official ) return { root, where, text: t("LineNone", { name }) };
      const target = { name, official: esc(official.name), pack: esc(official.pack ?? "") };
      if ( !ddbRepairable(official) ) return { root, where, text: t("LineByHand", target) };
      const text = t("LineRepair", target);
      return { root, where, text, preselect: true,
        apply: async ({ lock=false }={}) => {
          const current = fresh(item);
          const data = ddbReplacement(current, official, { lock });
          const parent = current.parent;
          if ( parent ) {
            await parent.deleteEmbeddedDocuments("Item", [current.id], replacing());
            await parent.createEmbeddedDocuments("Item", [data], { keepId: true });
          } else {
            await current.delete();
            await Item.implementation.create(data, { keepId: true });
          }
          return lock ? `${text} ${t("Locked")}` : text;
        } };
    });
  }
};

/* -------------------------------------------- */
/*  4 ter. Items from a declared importer         */
/* -------------------------------------------- */

/**
 * The check of an importer declared by another module: like "ddb", without a lock (the engine knows nothing about its
 * synchronization). The importer's flags stay (`midiReplacement` keeps the item's flags); a world item keeps its
 * folder. Its name and help come from the declaration (`name`, `hint`), not from the engine's translations.
 */
function importedCheck(def) {
  return {
    id: importedCheckId(def.id), icon: def.icon, name: def.name, hint: def.hint,
    async scan() {
      const t = tr("Ddb");
      return (await importedItemsAtRisk(def.id)).map(({ item, official, viaMidi }) => {
        const name = esc(item.name);
        const where = whereOf(item);
        const root = rootOf(item);
        if ( viaMidi ) return { root, where, text: t("LineMidi", { name, official: esc(official.name) }) };
        if ( !official ) return { root, where, text: t("LineNone", { name }) };
        const target = { name, official: esc(official.name), pack: esc(official.pack ?? "") };
        if ( !ddbRepairable(official) ) return { root, where, text: t("LineByHand", target) };
        const text = t("LineRepair", target);
        return { root, where, text, preselect: true,
          apply: async () => {
            const current = fresh(item);
            const data = midiReplacement(current, official);
            const parent = current.parent;
            if ( parent ) {
              await parent.deleteEmbeddedDocuments("Item", [current.id], replacing());
              await parent.createEmbeddedDocuments("Item", [data], { keepId: true });
            } else {
              data.folder = current._source.folder ?? null;
              await current.delete();
              await Item.implementation.create(data, { keepId: true });
            }
            return text;
          } };
      });
    }
  };
}

/* -------------------------------------------- */
/*  5. Actions de base sur les tas d'Item Piles   */
/* -------------------------------------------- */

const pileBasics = {
  id: "item-piles", icon: "fa-solid fa-sack-xmark",
  async scan() {
    const isPile = actor => actor?.flags?.["item-piles"]?.data?.enabled === true;
    const isBasic = item => !!item.flags?.[MODULE_ID]?.basicAction;
    const tasks = [];
    const add = (actor, basics) => {
      if ( !basics.length ) return;
      const root = rootOf(actor);
      tasks.push({ root, where: `<b>${esc(root.name)}</b>`, text: esc(basics.map(i => i.name).join(", ")), preselect: true,
        apply: async () => {
          await fresh(actor).deleteEmbeddedDocuments("Item", basics.map(i => i.id));
          return esc(basics.map(i => i.name).join(", "));
        } });
    };
    for ( const actor of game.actors ) if ( isPile(actor) ) add(actor, actor.items.filter(isBasic));
    for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor || !isPile(token.actor) ) continue;
      const own = new Set(ownItemIds(token));
      add(token.actor, token.actor.items.filter(i => isBasic(i) && own.has(i.id)));
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  6. Creature sheets                           */
/* -------------------------------------------- */

const creatures = {
  id: "creatures", icon: "fa-solid fa-paw",
  async scan() {
    const t = tr("RepairCreatures");
    const RENAMED = { "tactique-de-meute": "pack-tactics", "esquive-instinctive": "uncanny-dodge", "ascendance-feerique": "fey-ancestry",
      "forme-brumeuse": "misty-form" };
    const BASIC = { dash: "dash", course: "dash", foncer: "dash", disengage: "disengage", desengagement: "disengage",
      "se-desengager": "disengage", dodge: "dodge", esquive: "dodge", esquiver: "dodge", help: "help", aider: "help", hide: "hide",
      "se-cacher": "hide", ready: "ready", preparer: "ready", "se-preparer": "ready" };
    const kebab = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const idOf = item => item.system?.identifier || kebab(item.name);
    const tasks = [];
    for ( const actor of game.actors ) {
      if ( !["npc", "character"].includes(actor.type) ) continue;
      for ( const item of actor.items ) {
        const id = idOf(item);
        const where = whereOf(item);
        if ( RENAMED[id] && (item.system.identifier !== RENAMED[id]) ) {
          const what = t("WhatRename", { from: item.system.identifier || t("Empty"), to: RENAMED[id] });
          tasks.push({ root: rootOf(item), where, text: what, preselect: true,
            apply: async () => { await fresh(item).update({ "system.identifier": RENAMED[id] }); return what; } });
        } else if ( (actor.type === "npc") && (item.type === "feat") && BASIC[id] && !item.getFlag(MODULE_ID, "basicAction") ) {
          const what = t("WhatBasic", { to: BASIC[id] });
          tasks.push({ root: rootOf(item), where, text: what, preselect: true,
            apply: async () => {
              // A single base action of the engine per kind: a second CPR copy of the same action is only removed.
              const owner = fresh(actor);
              if ( !owner.items.some(i => i.getFlag(MODULE_ID, "basicAction") === BASIC[id]) ) {
                await owner.createEmbeddedDocuments("Item", [basicActionData(BASIC[id])]);
              }
              await fresh(item).delete();
              return what;
            } });
        }
      }
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  7. Texts left in the original language        */
/* -------------------------------------------- */

/**
 * §203: take over the current translation of the compendiums (that of this client's language, through Babele) for the world's
 * items and actors that come from them and whose texts were left in the original language — imported before a translation was
 * installed, or by a client in another language, or by a player without the right to browse files
 * (Babele translates nothing for them). Babele keeps its original values on each translated document
 * (`flags.babele.originalPayload`): a field is only taken over if it still equals the original exactly — a hand-edited text
 * does not move (core/localize.mjs); identifiers and the activity and effect ids never change (the automation follows),
 * an identifier drawn from the name is frozen. The names of tokens already placed do not change (they are not in the backup);
 * those placed afterwards take the prototype token's name.
 */
const retranslate = {
  id: "retranslate", icon: "fa-solid fa-language",
  async scan() {
    if ( !game.babele ) return [];
    const t = tr("Retranslate");
    const reference = referenceReader();
    const fieldsText = fields => [...new Set(fields.map(f => f.split(".")[0]))].map(f => t(`Field.${f}`)).join(", ");
    const tasks = [];
    const add = async (scanned, where) => {
      const plan = await retranslationOf(scanned, reference);
      if ( !plan.fields.length ) return;
      const text = t("Line", { name: esc(plan.update.name ?? scanned.name), fields: fieldsText(plan.fields) });
      tasks.push({ root: rootOf(scanned), where, text, preselect: true,
        apply: async () => { await applyRetranslation(fresh(scanned), plan); return text; } });
    };
    for ( const actor of game.actors ) await add(actor, `<b>${esc(actor.name)}</b>`);
    for ( const item of allItems() ) await add(item, whereOf(item));
    return tasks;
  }
};

/* -------------------------------------------- */
/*  8. Premium data to correct                    */
/* -------------------------------------------- */

/**
 * O1 (§335): the premium items whose data contradicts the rule and that the engine knows how to correct (`dataFixes`,
 * core/data-fixes.mjs) — what the active GM does at creation (runtime/data-fixes.mjs) for what already existed.
 * Only the plan's fields change; a value edited by hand (different from the declared origin) does not move.
 */
const dataFixes = {
  id: "data-fixes", icon: "fa-solid fa-screwdriver-wrench",
  async scan() {
    const t = tr("DataFixes");
    const tasks = [];
    for ( const scanned of allItems() ) {
      const plan = dataFixPlanOf(scanned);
      if ( !plan ) continue;
      const text = t("Line", { name: esc(scanned.name), count: plan.fields.length });
      tasks.push({ root: rootOf(scanned), where: whereOf(scanned), text, preselect: true,
        apply: async () => {
          const item = fresh(scanned);
          const now = dataFixPlanOf(item);
          if ( now ) await applyDataFixes(item, now);
          return text;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  9. Unmarked magical effects (antimagic)       */
/* -------------------------------------------- */

/**
 * §436: the `system.magical` mark that dnd5e 6.1's migration puts on the effects of a spell, scroll or `mgc` item, and
 * that the engine puts at creation (runtime/antimagic.mjs) — without it, the `antimagic` status does not suspend the effect.
 * Here, what was already on the sheets: the effects of magic items, and the effects placed on actors from them.
 * Nothing else changes.
 */
const magicalEffects = {
  id: "magical-effects", icon: "fa-solid fa-wand-sparkles",
  async scan() {
    const t = tr("MagicalEffects");
    const tasks = [];
    for ( const scanned of allItems() ) {
      const ids = unmarkedItemEffects(scanned);
      if ( !ids.length ) continue;
      const text = t("Line", { name: esc(scanned.name), count: ids.length });
      tasks.push({ root: rootOf(scanned), where: whereOf(scanned), text, preselect: true,
        apply: async () => { await markEffects(fresh(scanned), ids); return text; } });
    }
    const actors = [...game.actors];
    for ( const scene of game.scenes ) for ( const token of scene.tokens ) if ( !token.actorLink && token.actor ) actors.push(token.actor);
    for ( const scanned of actors ) {
      const ids = unmarkedAppliedEffects(scanned);
      if ( !ids.length ) continue;
      const text = t("Line", { name: esc(scanned.name), count: ids.length });
      tasks.push({ root: rootOf(scanned), where: `<b>${esc(scanned.name)}</b>`, text, preselect: true,
        apply: async () => { await markEffects(fresh(scanned), ids); return text; } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  10. Manuel des joueurs 3.0.0                  */
/* -------------------------------------------- */

/**
 * §438: the sheets made with Player's Handbook 2.2.0 keep their items as they were; dnd5e 6.1.0 only migrates one
 * subclass identifier (Circle of the Moon, `SubclassData.#migrateMoonIdentifier`) and the Handbook module has no
 * migration code. Two checks, at the user's request (2026-11-14):
 *  - `phb3-subclasses`: the identifier of a Handbook subclass put back to its reference's (`vengeance` → `oath-vengeance`), and
 *    the spells it gave (`system.sourceItem` "subclass:<id>", dnd5e.mjs:23417) followed. Ticked by default. The preview flags the
 *    items that still cite the old identifier in a formula (`@scale.fey.…` of the old Dreadful Strikes): to be replaced;
 *  - `phb3-items`: the Handbook features and spells whose reference changed (identifier, activities, effects, content, advancement)
 *    replaced by it — same id, sheet state kept (uses, preparation, advancement origin) as the Midi-QOL cleanup
 *    does. One task per sheet, the preview lists each item and what changes; nothing is ticked by default.
 */
const PHB_ITEM = /^Compendium\.dnd-players-handbook\.(classes|feats|origins|spells)\.Item\./;
const sourceOf = item => item._stats?.compendiumSource ?? item.flags?.dnd5e?.sourceId ?? "";

const phb3Subclasses = {
  id: "phb3-subclasses", icon: "fa-solid fa-signature",
  async scan() {
    const t = tr("Phb3Subclasses");
    const tasks = [];
    for ( const item of allItems() ) {
      if ( (item.type !== "subclass") || !PHB_ITEM.test(sourceOf(item)) ) continue;
      const reference = await fromUuid(sourceOf(item)).catch(() => null);
      const from = item._source.system?.identifier ?? item.system.identifier;
      const to = reference?.system?.identifier;
      if ( !to || (from === to) ) continue;
      const actor = item.actor;
      const spells = (actor?.items ?? []).filter(i => (i.type === "spell") && renamedSourceItem(i._source.system?.sourceItem, from, to));
      const citing = (actor?.items ?? []).filter(i => (i !== item) && citesSubclass(i._source.system, from));
      const text = [t("Line", { from: esc(from), to: esc(to) }),
        spells.length ? t("Spells", { count: spells.length }) : null,
        citing.length ? `⚠ ${t("Cites", { from: esc(from), names: esc(citing.map(i => i.name).join(", ")) })}` : null].filter(Boolean).join("<br>");
      tasks.push({ root: rootOf(item), where: whereOf(item), text, preselect: true,
        apply: async () => {
          const own = fresh(item);
          await own.update({ "system.identifier": to });
          for ( const spell of spells ) await fresh(spell).update({ "system.sourceItem": renamedSourceItem(spell._source.system.sourceItem, from, to) });
          return text;
        } });
    }
    return tasks;
  }
};

/** The Handbook item replaced by its reference: the reference's data, sheet state kept (midiReplacement), plus its class. */
function phb3Replacement(item, reference) {
  const data = midiReplacement(item, reference);
  const old = item.toObject().system ?? {};
  if ( old.classIdentifier && !data.system.classIdentifier ) data.system.classIdentifier = old.classIdentifier;
  const grant = spellGrantOf(item);
  if ( grant ) {
    // §469: a spell granted by an advancement (Paladin's Divine Smite, a feat's free spell…) receives the settings of that
    // advancement when granted — free uses, recovery, "cast for free" activity (dnd5e, spell-config.mjs:78-118, called by
    // item-grant.mjs:119). The compendium reference does not have them: we reapply them as dnd5e does, the spent use kept.
    grant.configuration.spell.applySpellChanges(data, { ability: grant.value?.ability });
    if ( old.uses?.spent !== undefined ) foundry.utils.setProperty(data, "system.uses.spent", old.uses.spent);
  }
  return data;
}

/**
 * §469: the advancement that granted this spell, if it gives it settings (`configuration.spell`) — found by the flag
 * `dnd5e.advancementOrigin` ("itemId.advancementId", advancement.mjs:385-391) on the spell's sheet. Null otherwise.
 */
function spellGrantOf(item) {
  if ( item.type !== "spell" ) return null;
  const [itemId, advancementId] = String(item.getFlag("dnd5e", "advancementOrigin") ?? "").split(".");
  const grant = item.parent?.items?.get(itemId)?.advancement?.byId?.[advancementId];
  return grant?.configuration?.spell?.applySpellChanges ? grant : null;
}

/** §469: has this spell lost the free uses its advancement gives it (replacement from before the fix)? */
function lostSpellGrant(item) {
  const uses = spellGrantOf(item)?.configuration.spell.uses;
  return !!(uses?.max && uses?.per && !item._source.system?.uses?.max);
}

/** The Handbook items of a sheet to review: `{ item, reference, reasons }` (reference null: it no longer exists). */
async function phb3Outdated(actor) {
  const out = [];
  for ( const item of actor.items ) {
    if ( !["feat", "spell"].includes(item.type) || !PHB_ITEM.test(sourceOf(item)) ) continue;
    const reference = await fromUuid(sourceOf(item)).catch(() => null);
    if ( !reference ) { out.push({ item, reference: null, reasons: [] }); continue; }
    const ref = phbShape(fixedReference(reference));
    // §547: a granted spell's free-cast activity (added at the grant and at our replacement) is not a difference from the Handbook.
    const own = spellGrantOf(item) ? withoutGrantedForwards(phbShape(item.toObject()), ref) : phbShape(item.toObject());
    const reasons = phbDifferences(own, ref);
    if ( lostSpellGrant(item) ) reasons.push("grant");
    if ( reasons.length ) out.push({ item, reference, reasons });
  }
  return out;
}

const phb3Items = {
  id: "phb3-items", icon: "fa-solid fa-book-open",
  async scan() {
    const t = tr("Phb3Items");
    const tasks = [];
    for ( const actor of game.actors ) {
      const outdated = await phb3Outdated(actor);
      if ( !outdated.length ) continue;
      const lines = outdated.map(({ item, reference, reasons }) => reference
        ? `♻ ${esc(item.name)} — ${reasons.map(r => t(`Reason.${r}`)).join(", ")}`
        : `⚠ ${t("Gone", { name: esc(item.name) })}`);
      const replaceable = outdated.filter(o => o.reference);
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text: lines.join("<br>"), preselect: false,
        ...(replaceable.length ? { apply: async () => {
          const sheet = fresh(actor);
          const done = [];
          for ( const { item, reference } of replaceable ) {
            const current = sheet.items.get(item.id);
            if ( !current ) continue;
            const data = phb3Replacement(current, reference);
            await sheet.deleteEmbeddedDocuments("Item", [current.id], replacing());
            await sheet.createEmbeddedDocuments("Item", [data], { keepId: true });
            done.push(`♻ ${esc(current.name)} ← ${esc(reference.name)}`);
          }
          return done.join("<br>");
        } } : {}) });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  Sorts en double (doublons-sorts.js)          */
/* -------------------------------------------- */

/**
 * A sheet's duplicate spells (core/spell-duplicates.mjs): a spell-preparation module that recognizes a spell by the uuid of
 * its origin compendium adds a second copy of a spell from another compendium (SRD against Handbook).
 * The spell kept: the one from the Player's Handbook (the Handbook's class spell lists cite its spells),
 * otherwise from the SRD 5.2. One task per sheet.
 */
const PREFERRED_SPELL_PACKS = Object.freeze(["Compendium.dnd-players-handbook.spells.", "Compendium.dnd5e.spells24."]);

/** The readable name of the compendium a spell comes from, or "created by hand". */
function spellSourceLabel(spell) {
  const source = sourceOf(spell);
  if ( !source.startsWith("Compendium.") ) return loc("Macro.SpellDuplicates.NoSource");
  const id = source.split(".").slice(1, 3).join(".");
  const pack = game.packs.get(id);
  if ( !pack ) return id;
  // Two compendiums can have the same title ("Spells" of the Handbook and of the SRD): the package that ships it tells them apart.
  const { packageType, packageName } = pack.metadata;
  const owner = (packageType === "system") ? game.system?.title : (packageType === "module") ? game.modules.get(packageName)?.title : null;
  return owner ? `${owner} · ${pack.title}` : pack.title;
}

/** A sheet's duplicate groups, with their documents. */
function spellDuplicatesOf(actor) {
  const spells = actor.itemTypes?.spell ?? [];
  const described = spells.map(s => ({
    id: s.id, name: s.name, identifier: s.system.identifier, method: s.system.method, prepared: Number(s.system.prepared) || 0,
    classIdentifier: s._source.system?.classIdentifier ?? "", sourceItem: s._source.system?.sourceItem ?? "", source: sourceOf(s),
    cachedFor: s.flags?.dnd5e?.cachedFor ?? null, flagScopes: Object.keys(s._source.flags ?? {}), sort: s.sort ?? 0
  }));
  const casterClasses = Object.keys(actor.spellcastingClasses ?? {});
  return spellDuplicates(described, { casterClasses, preferred: PREFERRED_SPELL_PACKS });
}

const spellDuplicatesCheck = {
  id: "spell-duplicates", icon: "fa-solid fa-clone",
  async scan() {
    const t = tr("SpellDuplicates");
    const state = p => t(`Prepared.${Number(p) || 0}`);
    const tasks = [];
    for ( const actor of game.actors ) {
      const groups = spellDuplicatesOf(actor);
      if ( !groups.length ) continue;
      const item = id => actor.items.get(id);
      const lines = groups.map(g => {
        const keep = item(g.keep.id);
        const raised = g.raisePrepared ? ` → ${state(g.prepared)}` : "";
        return `♊ ${t("Keep", { name: esc(keep.name), source: esc(spellSourceLabel(keep)), state: state(g.keep.prepared) + raised })}`
          + g.remove.map(r => ` ; ${t("Remove", { name: esc(item(r.id).name), source: esc(spellSourceLabel(item(r.id))), state: state(r.prepared) })}`).join("");
      });
      const text = lines.join("<br>");
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text, preselect: actor.hasPlayerOwner,
        apply: async () => {
          const sheet = fresh(actor);
          for ( const g of groups ) {
            const keep = sheet.items.get(g.keep.id);
            if ( !keep ) continue;
            const update = {};
            if ( g.raisePrepared ) update["system.prepared"] = g.prepared;
            for ( const { scope, from } of g.flagScopes ) {
              const value = sheet.items.get(from)?._source.flags?.[scope];
              if ( value !== undefined ) update[`flags.${scope}`] = foundry.utils.deepClone(value);
            }
            if ( Object.keys(update).length ) await keep.update(update);
            const ids = g.remove.map(r => r.id).filter(id => sheet.items.has(id));
            if ( ids.length ) await sheet.deleteEmbeddedDocuments("Item", ids);
          }
          return text;
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  "ModifyItem" enchantments (enchantements-aptitudes.js) */
/* -------------------------------------------- */

/**
 * §453: dnd5e 6.1's "ModifyItem" progression puts a feature's enchantment on another item of the sheet, only when
 * it applies and only on items already there (dnd5e.mjs `ModifyItemAdvancement#apply`). A spell learned afterwards, or a feature
 * replaced by its Handbook 3.0.0 version (`phb3-items`), stays without enchantment (core/modify-item.mjs). The repair puts it like
 * dnd5e: copy of the feature's effect, `transfer`, `advancementOrigin` / `sourceId` marks, origin = the feature (dnd5e then
 * creates its riders at the effect's creation, `_onCreateOperation` → `collectRiders`),
 * and records it in the progression's `value.modified`, riders included, so that a level drop removes it.
 */
async function modifyItemFeatures(actor) {
  const features = [];
  for ( const item of actor.items ) {
    const advancements = [];
    for ( const [id, adv] of Object.entries(item._source.system?.advancement ?? {}) ) {
      if ( adv?.type !== "ModifyItem" ) continue;
      const changes = [];
      for ( const c of adv.configuration?.changes ?? [] ) {
        const effect = c.uuid ? await fromUuid(c.uuid).catch(() => null) : item.effects.get(c._id);
        changes.push({ _id: c._id, uuid: c.uuid ?? null, identifiers: c.identifiers ?? [], effectName: effect?.name ?? "", exists: !!effect });
      }
      advancements.push({ id: adv._id ?? id, changes, modified: adv.value?.modified ?? [] });
    }
    if ( advancements.length ) features.push({ id: item.id, name: item.name, advancements });
  }
  return features;
}

async function missingEnchantmentsOf(actor) {
  const features = await modifyItemFeatures(actor);
  if ( !features.length ) return [];
  const targetsOf = key => [...(actor.identifiedItems?.get(key) ?? [])]
    .map(i => ({ id: i.id, name: i.name, dependent: !!i.flags?.dnd5e?.dependentOn }));
  const effectsOf = id => (actor.items.get(id)?.effects ?? []).map(e => ({ id: e.id, name: e.name, type: e.type,
    advancementOrigin: e.flags?.dnd5e?.advancementOrigin, sourceId: e.flags?.dnd5e?.sourceId }));
  return missingModifications(features, targetsOf, effectsOf);
}

/** Puts a change's enchantment on the targeted item, as dnd5e does, and records it in the progression. */
async function applyModification(actor, { feature, advancement, change, target }) {
  const own = actor.items.get(feature.id);
  const item = actor.items.get(target.id);
  const effect = change.uuid ? await fromUuid(change.uuid) : own?.effects.get(change._id);
  if ( !own || !item || !effect ) return false;
  const data = effect.toObject();
  data._id = foundry.utils.randomID();
  data._stats = { ...(data._stats ?? {}), [effect.inCompendium ? "compendiumSource" : "duplicateSource"]: effect.uuid,
    [effect.inCompendium ? "duplicateSource" : "compendiumSource"]: null };
  foundry.utils.setProperty(data, "flags.dnd5e.advancementOrigin", modifyOrigin(own.id, advancement.id));
  foundry.utils.setProperty(data, "flags.dnd5e.sourceId", effect.uuid);
  foundry.utils.setProperty(data, "system.origin.item", own.uuid);
  data.transfer = true;
  const [created] = await item.createEmbeddedDocuments("ActiveEffect", [data], { keepId: true });
  if ( !created ) return false;
  // The riders dnd5e has just created (the item's activities and effects, the sheet's items) depend on this effect.
  const updated = actor.items.get(item.id);
  const rel = doc => foundry.utils.buildRelativeUuid(doc, actor);
  const riders = [
    ...(updated?.system.activities ?? []).filter(a => a.flags?.dnd5e?.dependentOn === created.id).map(a => `${rel(updated)}.Activity.${a.id}`),
    ...(updated?.effects ?? []).filter(e => e.flags?.dnd5e?.dependentOn === created.id).map(rel),
    ...actor.items.filter(i => i.flags?.dnd5e?.dependentOn === created.uuid).map(rel)
  ];
  const modified = foundry.utils.deepClone(own._source.system.advancement?.[advancement.id]?.value?.modified ?? []);
  modified.push({ change: change._id, effect: created.id, item: item.id, riders });
  await own.update({ [`system.advancement.${advancement.id}.value.modified`]: modified });
  return true;
}

const modifyItemCheck = {
  id: "modify-item", icon: "fa-solid fa-gem",
  async scan() {
    const t = tr("ModifyItem");
    const tasks = [];
    for ( const actor of game.actors ) {
      const missing = await missingEnchantmentsOf(actor);
      if ( !missing.length ) continue;
      const text = missing.map(m => `✨ ${t("Line", { feature: esc(m.feature.name), target: esc(m.target.name),
        effect: esc(m.change.effectName || m.feature.name) })}`).join("<br>");
      tasks.push({ root: rootOf(actor), where: `<b>${esc(actor.name)}</b>`, text, preselect: actor.hasPlayerOwner,
        apply: async () => {
          const sheet = fresh(actor);
          const done = [];
          // Re-read at repair time: another task, or a level-up, may have placed it in the meantime.
          for ( const m of await missingEnchantmentsOf(sheet) ) {
            if ( await applyModification(sheet, m) ) done.push(`✨ ${t("Line", { feature: esc(m.feature.name), target: esc(m.target.name),
              effect: esc(m.change.effectName || m.feature.name) })}`);
          }
          return done.join("<br>");
        } });
    }
    return tasks;
  }
};

/* -------------------------------------------- */
/*  Summon permissions (§542, issue #43)          */
/* -------------------------------------------- */

/**
 * Read-only: what stops the players from summoning (core/summon-permissions.mjs). Settings and role permissions are not documents:
 * nothing to back up, so the tasks are only reported — the fix is the GM's (load window, ui/summon-permissions.mjs, or Foundry's
 * own configuration).
 */
const summonPermissions = {
  id: "summon-permissions", icon: "fa-solid fa-user-shield",
  async scan() {
    return summonGaps(summonFacts()).map(g => ({
      root: null,
      where: `<b>${esc(loc(`Invocation.Droits.Alerte.${g.key}.Nom`))}</b>`,
      text: esc(loc(`Invocation.Droits.Alerte.${g.key}.Texte`, { players: (g.players ?? []).join(", ") }))
    }));
  }
};

/* -------------------------------------------- */
/*  Broken source links (§553)                  */
/* -------------------------------------------- */

/**
 * `_stats.compendiumSource` / `duplicateSource` values Foundry refuses (core/source-links.mjs). Read from the SOURCE (`_source`): an
 * item Foundry could not load because of such a value is not in `actor.items` (common/abstract/embedded-collection.mjs:204,
 * `invalidDocumentIds`), yet it is in the database and in every copy. The repair sets the link to null; Foundry accepts the update
 * of an invalid embedded document (client/data/client-backend.mjs:228, `get(id, { invalid: true })`).
 */
const sourceLinks = {
  id: "source-links", icon: "fa-solid fa-link-slash",
  async scan() {
    const tasks = [];
    const add = (doc, data) => {
      const links = brokenSourceLinks(data, validSourceUuid);
      if ( !links.length ) return;
      const root = rootOf(doc);
      if ( !root ) return;
      const names = links.map(l => `${l.name || doc.name} (${l.value})`);
      tasks.push({ root, where: `<b>${esc(root.name)}</b>`, text: esc(names.join(", ")), preselect: true,
        apply: async () => {
          const now = fresh(doc);
          const byTarget = new Map();
          for ( const link of links ) {
            const key = link.path.join(".");
            if ( !byTarget.has(key) ) byTarget.set(key, { path: link.path, change: {} });
            byTarget.get(key).change[`_stats.${link.field}`] = null;
          }
          for ( const { path, change } of byTarget.values() ) {
            if ( !path.length ) { await now.update(change); continue; }
            if ( path.length === 2 ) {
              const name = (path[0] === "items") ? "Item" : "ActiveEffect";
              await now.updateEmbeddedDocuments(name, [{ _id: path[1], ...change }]);
              continue;
            }
            // An item's effect: through its item (a valid one; an item Foundry could not load is fixed by its own link first).
            const item = now.items.get(path[1]);
            if ( !item ) throw new Error(`item ${path[1]} not loaded: reload the world and run the diagnostic again`);
            await item.updateEmbeddedDocuments("ActiveEffect", [{ _id: path[3], ...change }]);
          }
          return esc(names.join(", "));
        } });
    };
    for ( const actor of game.actors ) add(actor, actor._source);
    for ( const item of game.items ) add(item, item._source);
    for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor ) continue;
      add(token.actor, { items: token._source?.delta?.items ?? [], effects: token._source?.delta?.effects ?? [] });
    }
    return tasks;
  }
};

/** The checks, in the order the macros offered them. */
export const CHECKS = Object.freeze([cleanMidi, phbEffects, lostEffects, scrolls, ddb, pileBasics, creatures,
  retranslate, dataFixes, magicalEffects, phb3Subclasses, phb3Items, spellDuplicatesCheck, modifyItemCheck, sourceLinks, summonPermissions]);

/** The current checks: the engine's, and, after "ddb", that of each importer declared by another module. */
export function allChecks() {
  const declared = [...IMPORTERS.values()].map(importedCheck);
  if ( !declared.length ) return CHECKS;
  const at = CHECKS.indexOf(ddb) + 1;
  return [...CHECKS.slice(0, at), ...declared, ...CHECKS.slice(at)];
}
