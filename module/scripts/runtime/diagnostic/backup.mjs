/**
 * Les sauvegardes du diagnostic (SPEC §177) : un compendium de monde « DAS · Sauvegardes » (type Aventure), une entrée par
 * réparation. Une Aventure porte des acteurs et des objets complets (common/documents/adventure.mjs, `actors`, `items`) : les
 * racines Actor et Item y sont copiées telles quelles, inspectables dans le compendium ; un token non lié est sauvegardé par son
 * **delta** (ce qui le distingue de son acteur de base), dans les flags de l'entrée, et restauré en remplaçant tout ce delta — comme le
 * cœur le fait lui-même (client/documents/token.mjs:3835, `updateSource({ delta }, { diff: false, recursive: false })`). Restaurer la
 * vue de l'acteur du token recopierait dans le delta des objets qui viennent de l'acteur de base.
 *
 * Règle de sûreté : une sauvegarde est relue et comparée à ce qui a été copié (`verifyBackup`) AVANT toute modification ; si elle
 * n'est pas complète, l'appelant ne touche à rien.
 */
import { MODULE_ID } from "../../constants.mjs";
import { EMBEDDED, backupName, restorePlan, rootFields, rootKey, verifyBackup } from "../../core/backup.mjs";
import { failurePlace, sameData, withoutBrokenLinks } from "../../core/source-links.mjs";
import { log, loc } from "../shared.mjs";

export const PACK_NAME = "das-backups";
export const LOGO = `modules/${MODULE_ID}/assets/das-logo.png`;

/** Le compendium des sauvegardes, s'il existe. */
export const backupPack = () => game.packs.get(`world.${PACK_NAME}`) ?? null;

/** Le compendium des sauvegardes, créé au besoin (MJ). */
export async function ensureBackupPack() {
  const existing = backupPack();
  if ( existing ) return existing;
  const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({
    type: "Adventure", name: PACK_NAME, label: loc("Diagnostic.Pack")
  });
  if ( !pack ) throw new Error("backup compendium could not be created");
  log(`backup compendium ${pack.collection} created`);
  return pack;
}

/** Le document d'une racine, s'il existe encore. Pour un token, son acteur propre. */
export function rootDocument(root) {
  const doc = fromUuidSync(root.uuid, { strict: false });
  if ( !doc ) return null;
  return (root.type === "Token") ? (doc.actor ?? null) : doc;
}

/** La racine d'un document : un acteur ou un objet du monde, ou le token non lié dont l'acteur propre le porte. */
export function rootOf(doc) {
  let d = doc;
  while ( d?.parent && !(d.parent instanceof foundry.documents.Scene) ) {
    if ( (d.documentName === "Actor") && d.isToken ) break;
    d = d.parent;
  }
  if ( (d?.documentName === "Actor") && d.isToken ) {
    const token = d.token;
    return { type: "Token", uuid: token.uuid, name: `${token.name} (${token.parent?.name ?? "?"})` };
  }
  if ( d?.documentName === "Actor" ) return { type: "Actor", uuid: d.uuid, name: d.name };
  if ( d?.documentName === "Item" ) return { type: "Item", uuid: d.uuid, name: d.name };
  return null;
}

/** Les données à copier d'une racine : le document entier, ou le delta d'un token. */
function snapshot(root) {
  if ( root.type === "Token" ) {
    const token = fromUuidSync(root.uuid, { strict: false });
    if ( !token ) throw new Error(`${rootKey(root)} not found`);
    return { ...root, data: foundry.utils.deepClone(token.toObject().delta ?? {}) };
  }
  const doc = rootDocument(root);
  if ( !doc ) throw new Error(`${rootKey(root)} not found`);
  return { ...root, data: doc.toObject() };
}

/**
 * Une copie que l'Aventure peut porter : un acteur ou un objet dont tous les types (le sien, ceux de ses objets et de ses effets) sont
 * connus de ce monde. Un effet laissé par un module désactivé (« auraeffects.aura », retour Discord 2026-10-29) ferait refuser
 * toute l'entrée par la validation de l'Aventure : une telle copie va telle quelle dans les flags, comme le delta d'un token.
 */
function storable({ type, data }) {
  const known = (doc, t) => !t || (game.documentTypes?.[doc] ?? [t]).includes(t);
  const effectsKnown = d => (d?.effects ?? []).every(e => known("ActiveEffect", e?.type));
  const itemKnown = d => known("Item", d?.type) && effectsKnown(d);
  if ( type === "Actor" ) return known("Actor", data?.type) && effectsKnown(data) && (data?.items ?? []).every(itemKnown);
  if ( type === "Item" ) return itemKnown(data);
  return false;
}

/** §553: does Foundry accept this value as a source UUID? (common/data/fields.mjs:3545, `DocumentUUIDField#_validateType`) */
export function validSourceUuid(value) {
  if ( (value === null) || (value === undefined) ) return true;
  const field = foundry.documents.BaseItem.schema.getField("_stats.compendiumSource");
  try { return !field.validate(value, { strict: false }); } catch { return false; }
}

/** The failures of a validation error, as `{ path, message }` (DataModelValidationError#getAllFailures). */
function failuresOf(err) {
  const all = (typeof err?.getAllFailures === "function") ? err.getAllFailures() : {};
  return Object.entries(all ?? {}).map(([path, f]) => ({ path, message: f?.message ?? String(f) }));
}

/**
 * §553: would the Adventure's validation accept this copy? A trial Adventure in memory holding this copy alone runs the same
 * validation as `Adventure.create` (one source UUID Foundry refuses made the whole entry refused). Returns the refusals (empty: fine).
 */
function adventureRefusals({ type, data }) {
  const key = (type === "Actor") ? "actors" : "items";
  try {
    new Adventure.implementation({ name: "check", [key]: [foundry.utils.deepClone(data)] }, { strict: true });
    return [];
  } catch(err) {
    const failures = failuresOf(err);
    return failures.length ? failures : [{ path: "", message: err?.message ?? String(err) }];
  }
}

/** "Actor — item: field: reason" for each refusal, names taken from the refused data. */
function placesOf(failures, data) {
  return failures.map(({ path, message }) => {
    const p = failurePlace(path, data);
    return loc("Diagnostic.SauvegardeRefus", {
      root: p.root ?? "?", embedded: p.embedded ? ` — ${p.embedded}` : "", field: p.field || "?", error: message
    });
  });
}

/** Ce que rend une entrée relue : les racines et leurs données. */
function readEntry(entry) {
  const meta = entry.getFlag(MODULE_ID, "backup") ?? {};
  const actors = new Map(entry.actors.map(a => [a._id, a.toObject?.() ?? a]));
  const items = new Map(entry.items.map(i => [i._id, i.toObject?.() ?? i]));
  // Des flags lus d'un document ne sont pas des objets simples : une copie, avant de les rendre à une mise à jour.
  const tokens = new Map((meta.tokens ?? []).map(t => [t.uuid, foundry.utils.deepClone(t.data)]));
  const raw = new Map((meta.raw ?? []).map(r => [r.uuid, foundry.utils.deepClone(r.data)]));
  return (meta.roots ?? []).map(root => {
    const id = root.uuid.split(".").at(-1);
    const data = raw.get(root.uuid)
      ?? ((root.type === "Actor") ? actors.get(id) : (root.type === "Item") ? items.get(id) : tokens.get(root.uuid));
    return { ...root, data };
  });
}

/**
 * Copie ces racines dans une nouvelle entrée, la relit et la vérifie. Lève une Error si elle n'est pas complète : l'appelant ne doit
 * alors rien modifier. Rend `{ uuid, name }` de l'entrée.
 * @param {{ type: string, uuid: string, name: string }[]} roots
 * @param {{ label: string, checks?: string[] }} context
 */
export async function createBackup(roots, { label, checks=[] }) {
  if ( !game.user.isGM ) throw new Error("only a GM can back up");
  if ( !roots.length ) throw new Error("nothing to back up");
  const pack = await ensureBackupPack();
  const copies = roots.map(snapshot);
  // §553: a copy the Adventure's validation would refuse (a broken source link…) goes as is into the flags, like a token's delta:
  // the entry stays exact, and one damaged sheet no longer makes the whole backup fail.
  const raw = new Set();
  for ( const c of copies ) {
    if ( (c.type === "Token") || !storable(c) ) continue;
    const refusals = adventureRefusals(c);
    if ( !refusals.length ) continue;
    raw.add(c);
    log(`backup: ${c.name} kept as raw data (${placesOf(refusals, { [c.type === "Actor" ? "actors" : "items"]: [c.data] }).join("; ")})`);
  }
  const inAdventure = c => (c.type !== "Token") && storable(c) && !raw.has(c);
  const name = backupName(label, Date.now(), copies.length);
  const list = copies.map(c => `<li>${foundry.utils.escapeHTML(loc(`Diagnostic.Racine.${c.type}`))} — ${foundry.utils.escapeHTML(c.name)}</li>`).join("");
  const data = {
    name, img: LOGO,
    description: `<p>${foundry.utils.escapeHTML(loc("Diagnostic.SauvegardeAide"))}</p><ul>${list}</ul>`,
    actors: copies.filter(c => (c.type === "Actor") && inAdventure(c)).map(c => c.data),
    items: copies.filter(c => (c.type === "Item") && inAdventure(c)).map(c => c.data),
    flags: { [MODULE_ID]: { backup: {
      version: 1, label, date: Date.now(), checks, user: game.user.name,
      roots: copies.map(({ type, uuid, name }) => ({ type, uuid, name })),
      tokens: copies.filter(c => c.type === "Token").map(c => ({ uuid: c.uuid, data: c.data })),
      raw: copies.filter(c => (c.type !== "Token") && !inAdventure(c)).map(c => ({ uuid: c.uuid, data: c.data }))
    } } }
  };
  let created;
  try {
    created = await Adventure.implementation.create(data, { pack: pack.collection });
  } catch(err) {
    // §553: tell the GM which sheet and which item are refused, not only "entry not created".
    const places = placesOf(failuresOf(err), data);
    throw new Error(places.length ? `${loc("Diagnostic.SauvegardeRefusee")} ${places.join(" ; ")}` : (err?.message ?? String(err)), { cause: err });
  }
  if ( !created ) throw new Error("backup entry not created");
  // Relire depuis la base, pas depuis l'objet en mémoire.
  const entry = await pack.getDocument(created.id);
  const problems = entry ? verifyBackup(copies, readEntry(entry)) : ["entry unreadable"];
  if ( problems.length ) throw new Error(`backup incomplete: ${problems.join("; ")}`);
  log(`backup ${name}: ${copies.length} document(s), verified`);
  return { uuid: entry.uuid, name };
}

/** Les sauvegardes, la plus récente d'abord : `{ id, uuid, name, date, roots, checks }`. */
export async function listBackups() {
  const pack = backupPack();
  if ( !pack ) return [];
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.backup.date`, `flags.${MODULE_ID}.backup.roots`, `flags.${MODULE_ID}.backup.checks`] });
  return [...index].map(e => {
    const meta = e.flags?.[MODULE_ID]?.backup ?? {};
    return { id: e._id, uuid: e.uuid, name: e.name, date: meta.date ?? 0, roots: meta.roots ?? [], checks: meta.checks ?? [] };
  }).sort((a, b) => b.date - a.date);
}

/**
 * §553: data Foundry will agree to write. A source link Foundry refuses cannot be written back (the whole update would be refused):
 * it is set to null and noted for the report. The backup itself keeps it exactly.
 */
function acceptable(data, notes) {
  const { data: clean, removed } = withoutBrokenLinks(data, validSourceUuid);
  for ( const link of removed ) notes.push(loc("Diagnostic.LienNonRestaure", {
    name: foundry.utils.escapeHTML(link.name || data?.name || "?"), value: foundry.utils.escapeHTML(link.value)
  }));
  return clean;
}

/** Remet un document dans l'état de sa copie : collections incluses (supprimer, recréer, remettre), puis ses champs. */
async function restoreDocument(doc, type, saved, notes=[]) {
  for ( const field of EMBEDDED[type] ?? [] ) {
    const name = (field === "items") ? "Item" : "ActiveEffect";
    // §553: the source, not the collection: an embedded document Foundry could not load (invalid) is missing from `doc.items` but
    // is in the database, and recreating it would fail.
    const current = foundry.utils.deepClone(doc._source?.[field] ?? doc[field].map(d => d.toObject()));
    const plan = restorePlan(current, saved[field] ?? []);
    const now = new Map(current.map(d => [d._id, d]));
    // What has not changed since the backup is not rewritten (a damaged item the repair did not touch is left as it is).
    const update = plan.update.filter(d => !sameData(now.get(d._id), d)).map(d => acceptable(d, notes));
    const create = plan.create.map(d => acceptable(d, notes));
    if ( plan.remove.length ) await doc.deleteEmbeddedDocuments(name, plan.remove);
    if ( create.length ) await doc.createEmbeddedDocuments(name, create, { keepId: true });
    if ( update.length ) await doc.updateEmbeddedDocuments(name, update, { diff: false, recursive: false });
  }
  const fields = rootFields(type, saved);
  delete fields.type;
  if ( type === "Token" ) delete fields.prototypeToken;
  await doc.update(fields, { diff: false, recursive: false });
}

/**
 * Restaure une sauvegarde. Sauvegarde d'abord l'état actuel des mêmes racines (« avant restauration ») : une restauration se
 * défait comme une réparation. Rend `{ lines, before }`.
 */
export async function restoreBackup(uuid) {
  if ( !game.user.isGM ) throw new Error("only a GM can restore");
  const entry = await fromUuid(uuid);
  if ( !entry ) throw new Error(`backup not found: ${uuid}`);
  const roots = readEntry(entry);
  const present = roots.filter(r => rootDocument(r));
  const before = present.length ? await createBackup(present, { label: loc("Diagnostic.AvantRestauration"), checks: ["restore"] }) : null;
  const lines = [];
  for ( const root of roots ) {
    try {
      if ( !root.data ) throw new Error("no saved data");
      let doc = rootDocument(root);
      if ( !doc ) {
        // Un acteur ou un objet du monde supprimé depuis : recréé avec son id (les tokens liés le retrouvent).
        if ( root.type === "Token" ) throw new Error(loc("Diagnostic.TokenDisparu"));
        const cls = CONFIG[root.type].documentClass;
        const notes = [];
        await cls.create(acceptable(root.data, notes), { keepId: true });
        lines.push(loc("Diagnostic.Recree", { name: foundry.utils.escapeHTML(root.name) }), ...notes);
        continue;
      }
      const notes = [];
      if ( root.type === "Token" ) {
        await fromUuidSync(root.uuid).update({ delta: acceptable(root.data, notes) }, { diff: false, recursive: false });
      } else await restoreDocument(doc, root.type, root.data, notes);
      lines.push(loc("Diagnostic.Restaure", { name: foundry.utils.escapeHTML(root.name) }), ...notes);
    } catch(err) {
      console.error(`${MODULE_ID} | restore`, root, err);
      lines.push(loc("Diagnostic.RestaurationEchec", { name: foundry.utils.escapeHTML(root.name), error: foundry.utils.escapeHTML(err.message) }));
    }
  }
  return { lines, before };
}
