/**
 * A spell's class. dnd5e 6.0 writes it in `system.sourceItem` ("class:druid", or a subclass's item) and reads it through
 * `classIdentifier` (data/item/spell.mjs:169-177, the `sourceClass` migration: spell.mjs:424-431); the engine still read
 * `sourceClass`, which no longer exists — gap survey, 2026-10-22: it always fell back on "does the actor have the class?", wrong
 * for a multiclass character. `classIdentifier` asks for the class on the sheet; without it, the written identifier
 * ("class:…") counts. "": none.
 * @param {Item} item
 * @returns {string}
 */
export function spellClassOf(item) {
  const s = item?.system ?? {};
  const written = String(s.sourceItem ?? "");
  return s.classIdentifier || (written.startsWith("class:") ? written.slice(6) : "") || s.sourceClass || "";
}
