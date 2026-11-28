/**
 * #33: the text of the cover preview (adapter/cover-preview.mjs), pure — the translation is passed as an argument.
 * A main line ("Clear", "Half cover +2 AC", "Total cover — blocked", "Half cover ignored (Sharpshooter)")
 * and a source line ("by: obstacle, creature"), with no detail the player would not know: categories, and the
 * name of a zone spell visible on the scene.
 */

/** L'ordre d'affichage des sources. */
const ORDER = ["manual", "wall", "surface", "creature", "grapple", "zone"];

/**
 * @param {import("../adapter/cover-preview.mjs").CoverPreview} preview
 * @param {(key: string, data?: object) => string} t   Translation of an `Apercu.*` key (without the namespace).
 * @returns {{css: string, main: string, sub: string|null}|null}
 */
export function coverPreviewText(preview, t) {
  if ( !preview ) return null;
  if ( preview.ignored ) {
    return { css: "ignored", main: t("Apercu.Ignore", { cover: t(`Apercu.Nom.${preview.ignored.degree}`), by: preview.ignored.by }), sub: null };
  }
  if ( preview.degree === "none" ) return { css: "clear", main: t("Apercu.Degage"), sub: null };
  const main = (preview.bonus === null) ? t("Apercu.Total") : t("Apercu.Bonus", { cover: t(`Apercu.Nom.${preview.degree}`), bonus: preview.bonus });
  const sources = [...new Set(preview.sources ?? [])]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .map(s => ((s === "zone") && preview.zone) ? preview.zone : t(`Apercu.Source.${s}`));
  return { css: preview.degree, main, sub: sources.length ? t("Apercu.Par", { sources: sources.join(", ") }) : null };
}
