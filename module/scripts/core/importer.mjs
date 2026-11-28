/**
 * The item importers the world diagnostic knows. An imported item can carry its activities and effects under
 * other ids than the official item: content rules that cite the official ids do not find them (§245). The engine names
 * only DDB Importer; another module declares its own (`api.diagnostic.registerImporter`), recognized by a flag its items
 * carry.
 * Pure functions.
 */

/** The importer the engine knows by itself. */
export const DDB_IMPORTER = Object.freeze({ id: "ddb", flag: "ddbimporter" });

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What is missing from an importer's declaration: `[]` if it is good.
 * @param {{id: string, flag: string, name: string, hint?: string, icon?: string}} def
 *   `id` — lowercase and hyphens; `flag` — the `item.flags` key its items carry; `name`, `hint` — the name and help of its
 *   check in the diagnostic, already translated; `icon` — Font Awesome classes.
 * @param {Array<{id: string, flag: string}>} [known]  The importers already declared by other modules.
 * @returns {string[]}
 */
export function importerErrors(def, known=[]) {
  const errors = [];
  if ( !def || (typeof def !== "object") ) return ["an object { id, flag, name } is required"];
  if ( (typeof def.id !== "string") || !SLUG.test(def.id) ) errors.push("id: lowercase letters, digits and hyphens");
  if ( (typeof def.flag !== "string") || !def.flag ) errors.push("flag: the key of item.flags its items carry");
  if ( (typeof def.name !== "string") || !def.name.trim() ) errors.push("name: the name of its check, already localized");
  for ( const key of ["hint", "icon"] ) {
    if ( (def[key] !== undefined) && (typeof def[key] !== "string") ) errors.push(`${key}: a string`);
  }
  for ( const other of [DDB_IMPORTER, ...known] ) {
    if ( other.id === def.id ) errors.push(`id: "${def.id}" is already taken`);
    if ( other.flag === def.flag ) errors.push(`flag: "${def.flag}" already belongs to "${other.id}"`);
  }
  return errors;
}

/**
 * Which importer created this item, from its flags: DDB Importer first, then those declared, in order. An item that went through
 * two importers is therefore counted only once — by DDB Importer if it is one (its synchronization recreates it, its repair
 * knows how to lock it).
 * @param {object|null|undefined} flags  the item's flags
 * @param {Array<{id: string, flag: string}>} [importers]  the importers declared by other modules
 * @returns {string|null}  the importer's id
 */
export function importerOf(flags, importers=[]) {
  if ( !flags ) return null;
  for ( const { id, flag } of [DDB_IMPORTER, ...importers] ) if ( flags[flag] ) return id;
  return null;
}
