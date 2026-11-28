/**
 * Text of an item description (dnd5e HTML) reduced to plain text, for the rules that read the sentence of a stat
 * block: entities, inline rolls (`[[…]]` → "…"), cross-references `&Reference[x]{…}` → "x", tags, non-breaking spaces,
 * typographic apostrophe. Pure function, no Foundry.
 */
export const plainStatText = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…")
  .replace(/&Reference\[([^\]]+)\](?:\{[^}]*\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/’/g, "'").replace(/\s+/g, " ");
