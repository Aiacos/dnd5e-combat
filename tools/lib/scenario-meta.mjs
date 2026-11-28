/**
 * What is known about a scenario without loading it, read from its text: its title (`name`), its scene (`scene`), its header
 * comment and the § of the journal that they cite. Used by the reference (`docs/reference/SCENARIOS.md`) and by the runner's
 * filters (`node tools/scenario.mjs --list --grep zone`).
 */

/** `{ title, summary, doc, scene, refs }` from the text of a scenario file. */
export function scenarioMeta(text) {
  const header = text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  const doc = header ? header[1].split("\n").map(line => line.replace(/^\s*\*?\s?/, "")).join(" ").replace(/\s+/g, " ").trim() : "";
  const named = text.match(/\bname:\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/);
  const title = (named?.[1] ?? named?.[2] ?? "").replace(/\\"/g, "\"");
  const scene = text.match(/\bscene:\s*"([^"]+)"/)?.[1] ?? "";
  const refs = [...new Set(`${doc} ${title}`.match(/§\d+(?:\.\d+)*/g) ?? [])];
  const summary = title.includes("—") ? title.slice(title.indexOf("—") + 1).trim() : (title || doc);
  return { title, summary, doc, scene, refs };
}

/** Lowercase without accents, to search "zone" in "Zône" as in "zones". */
export const plain = text => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Does a scenario pass the filters? `words`: one word found in its file name, its title or its header is enough;
 * `sections`: it cites one of these § ("239" stands for §239 and §239.x); `scenes`: its scene is one of them ("arene": no
 * scene declared). Each family of filters given must be satisfied.
 */
export function matches(id, meta, { words=[], sections=[], scenes=[] }={}) {
  const haystack = plain(`${id} ${meta.title} ${meta.doc}`);
  if ( words.length && !words.some(word => haystack.includes(plain(word))) ) return false;
  if ( sections.length && !sections.some(section => meta.refs.some(ref => (ref === `§${section}`) || ref.startsWith(`§${section}.`))) ) return false;
  if ( scenes.length && !scenes.some(scene => (plain(scene) === "arene") ? !meta.scene : plain(meta.scene).includes(plain(scene))) ) return false;
  return true;
}
