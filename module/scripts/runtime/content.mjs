/**
 * Content at runtime: the world overlay setting, the refusal of a wrong flag on
 * write (SPEC §7: "an unknown key raises an error on write, not silence in
 * play"), the inspection API, and the registration of other modules' content.
 *
 * Content from another module (2026-10-03) — public API, two equivalent paths:
 *
 *   Hooks.once("dnd5e-combat.registerContent", register => register("mon-module", TABLE));
 *   game.modules.get("dnd5e-combat")?.api?.content.register("mon-module", TABLE);
 *
 * `TABLE`: `{ identifiant dnd5e: entrée }`, in the schema of core/content.mjs (the same as the shipped content). The hook is
 * called once, at `setup` (after all the `init`s): register from your own `init`. The direct call works as soon as the API
 * exists (engine `init` passed); `api.content.registered()` says what is registered. Each entry is validated like the
 * shipped content: a wrong entry is discarded and reported in the console, the others are taken. The table is merged
 * on top of the shipped content, entry by entry (`mergeEntries`); registering the same source again replaces it.
 * The engine knows none of these modules: without them, it runs with its own content alone.
 *
 * §277: `register(source, table, { sources })` — `sources`: `{ id de document: identifiant }`, for items that have no
 * usable identifier (a premium item without identifier, an imported item whose identifier dnd5e derived from the name),
 * recognised by the id of their compendium source or their own id, like content/sources.mjs. A wrong pair is discarded and
 * reported; the sources follow the table: re-registering the source replaces them, `unregister` removes them.
 */

import { MODULE_ID } from "../constants.mjs";
import { validateEntry, validateTable, validateSources, CONTENT_VERSION, ENTRY_KEYS } from "../core/content.mjs";
import { RECIPES, RECIPES_VERSION, FACTS, FACT_ARG_OPTIONS, FIELD_KINDS, PUBLIC_KEYS, buildEntry, buildCondition } from "../core/recipes.mjs";
import { CONTENT, SHIPPED, registerTable, unregisterTable, registeredTables, registerSources, registeredSources } from "../content/index.mjs";
import { OVERRIDES_SETTING, KNOWN_FACTS, worldOverrides, forgetWorldOverrides, setWorldOverride, contentOf, inspect,
  identifierOf } from "../adapter/content.mjs";
import { buildSpellIndex, stampScroll } from "../adapter/scrolls.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

/** The hook through which the engine asks other modules for their content (at `setup`). */
export const REGISTER_HOOK = `${MODULE_ID}.registerContent`;

/** Before an item is created or modified: its module flags must be valid, otherwise the write is refused. */
function checkItemFlags(item, data) {
  const flags = data?.flags?.[MODULE_ID];
  if ( !flags ) return true;
  const layer = {};
  for ( const key of ENTRY_KEYS ) if ( (key in flags) && (flags[key] !== null) ) layer[key] = flags[key];
  const errors = validateEntry(layer, { facts: KNOWN_FACTS });
  if ( !errors.length ) return true;
  ui.notifications.error(loc("ContenuRefuse", { item: item.name ?? data.name ?? "", errors: errors.join(" ; ") }));
  console.error(`${MODULE_ID} | flags rejected on ${item.name ?? data.name}`, errors);
  return false;
}

/**
 * Registers another module's content table (see the header). Validated entry by entry like the shipped content.
 * @param {string} source                    The id of the module that provides it.
 * @param {Record<string, object>} table     `{ identifiant dnd5e: entrée }`.
 * @param {{sources?: Record<string, string>}} [options]  §277: `{ id de document: identifiant }`.
 * @returns {{source: string, accepted: string[], rejected: Record<string, string[]>, sources: string[], rejectedSources: string[]}}
 */
export function registerExternal(source, table, { sources={} }={}) {
  if ( (typeof source !== "string") || !source ) throw new Error(`${MODULE_ID} | content.register: the source module id is required`);
  if ( !table || (typeof table !== "object") || Array.isArray(table) ) {
    throw new Error(`${MODULE_ID} | content.register(${source}): the table is an object { identifier: entry }`);
  }
  const accepted = {};
  const rejected = {};
  for ( const [id, entry] of Object.entries(table) ) {
    const errors = validateEntry(entry, { facts: KNOWN_FACTS, at: `${id}.` });
    if ( errors.length ) rejected[id] = errors;
    else accepted[id] = entry;
  }
  const goodSources = {};
  const rejectedSources = validateSources(sources ?? {});
  if ( sources && (typeof sources === "object") && !Array.isArray(sources) ) {
    for ( const [docId, identifier] of Object.entries(sources) ) if ( !validateSources({ [docId]: identifier }).length ) goodSources[docId] = identifier;
  }
  registerSources(source, goodSources);
  registerTable(source, accepted);
  if ( Object.keys(rejected).length ) console.error(`${MODULE_ID} | content from ${source}: entries rejected`, rejected);
  if ( rejectedSources.length ) console.error(`${MODULE_ID} | content from ${source}: sources rejected`, rejectedSources);
  log(`content: ${Object.keys(accepted).length} entry(ies)${Object.keys(goodSources).length ? `, ${Object.keys(goodSources).length} source(s)` : ""} registered by ${source}`);
  return { source, accepted: Object.keys(accepted), rejected, sources: Object.keys(goodSources), rejectedSources };
}

/** At `setup`: other modules give their content through the hook, if they have not already done so through the API. */
function collectExternal() {
  Hooks.callAll(REGISTER_HOOK, (source, table, options) => registerExternal(source, table, options));
}

/** At `ready`: the content in force (shipped and registered) and the world overlay are re-read; what is wrong is reported once. */
function audit() {
  const shipped = validateTable(CONTENT, { facts: KNOWN_FACTS });
  if ( shipped.length ) console.error(`${MODULE_ID} | invalid shipped content`, shipped);
  const stored = game.settings.get(MODULE_ID, OVERRIDES_SETTING);
  if ( stored && (typeof stored === "object") && Object.keys(stored).length && (stored.v !== CONTENT_VERSION) ) {
    console.warn(`${MODULE_ID} | world overlay ignored: schema ${stored.v} ≠ ${CONTENT_VERSION}`);
  }
  const world = validateTable(worldOverrides(), { facts: KNOWN_FACTS });
  if ( world.length ) console.warn(`${MODULE_ID} | world overlay: invalid entries`, world);
  const external = Object.entries(registeredTables()).map(([source, ids]) => `${source} (${ids.length})`);
  log(`content: ${Object.keys(SHIPPED).length} shipped entry(ies)${external.length ? `, registered: ${external.join(", ")}` : ""}, `
    + `${Object.keys(worldOverrides()).length} from the world`);
}

/** Exposed on `game.modules.get("dnd5e-combat").api.content`. */
export const contentApi = Object.freeze({
  version: CONTENT_VERSION,
  /** The content in force: shipped + registered by other modules. */
  shipped: CONTENT,
  /** §277: the content shipped with the engine, alone (without the registered tables) — to say that a table overlaps a rule. */
  builtin: SHIPPED,
  facts: Object.keys(KNOWN_FACTS),
  world: worldOverrides,
  set: setWorldOverride,
  of: contentOf,
  identifierOf,
  inspect,
  /** The errors of a content entry (`string[]`, empty = valid), against the schema `core/content/entry.mjs`. Changes nothing. */
  validate: entry => validateEntry(entry, { facts: KNOWN_FACTS }),
  /** §277: the errors of a sources table `{ id de document: identifiant }` (empty = valid). */
  validateSources,
  /** `register(source, table, { sources? })`: another module's content (see the header of runtime/content.mjs). */
  register: registerExternal,
  /** `unregister(source)`: removes a module's table, and its sources. */
  unregister: unregisterTable,
  /** `{ source: [identifiants] }`: what other modules have registered. */
  registered: registeredTables,
  /** §277: `{ source: { id de document: identifiant } }`: the sources other modules have registered. */
  sources: registeredSources,
  /**
   * §114: the recipes — the schema's bricks told for a no-code tool (core/recipes.mjs). `build(recettes, { identifier,
   * base })` returns `{ entry, errors }`; the entry is then validated by `validate`, like any content.
   */
  recipes: Object.freeze({
    version: RECIPES_VERSION,
    list: RECIPES,
    facts: FACTS,
    factOptions: FACT_ARG_OPTIONS,
    fieldKinds: FIELD_KINDS,
    publicKeys: PUBLIC_KEYS,
    build: buildEntry,
    condition: buildCondition
  })
});

export function registerContent() {
  // `onChange`: on each client, when the GM writes the overlay — what was read from it is forgotten (adapter/content.mjs).
  game.settings.register(MODULE_ID, OVERRIDES_SETTING, { scope: "world", config: false, type: Object, default: {},
    onChange: () => forgetWorldOverrides() });
  route("preCreateItem", (item, data) => checkItemFlags(item, data), { cancellable: true, label: "content: flags on creation" });
  route("preUpdateItem", (item, changes) => checkItemFlags(item, changes), { cancellable: true, label: "content: flags on update" });
  route("setup", collectExternal, { label: "content: other modules' tables" });
  route("ready", audit, { label: "content: audit" });
  // §48: a scroll is recognised by the spell it contains — noted at its creation (dnd5e does not keep it), found by its name
  // for the scrolls already made (index of the compendium and world spells).
  route("dnd5e.createScrollFromSpell", stampScroll, { label: "scroll: contained spell" });
  route("ready", () => buildSpellIndex().then(n => log(`spell index (scrolls): ${n} keys`)), { label: "scroll: spell index" });
}
