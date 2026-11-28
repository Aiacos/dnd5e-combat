/**
 * Survey of the premium data's choice activities (issue #38, SPEC §389): summons, transformations, enchantments — wherever
 * dnd5e only lets you choose in ITS use window, and the action bar, "Cast anyway" or an engine relaunch skip it. For each,
 * what its data carries and the risky cases:
 *   formes        several profiles, sizes or creature types (the choice is lost without a window; §383 covers it for "summon")
 *   par-niveau    profiles reserved for certain levels (`level.min/max`)
 *   nombre        a number of creatures that depends on the level (`count` as a formula), or hidden only in the spell's target
 *                 (Animate Dead: `target.affects.count`), without the engine's `summon.chooseCount`
 *   srd-2014      a creature from dnd5e's SRD 2014 (`dnd5e.monsters`); "→ MM" / "→ SRD 2024" if the equivalent exists (§386)
 *   introuvable   a profile whose creature is in no surveyed compendium
 *   ne-pose-rien  `summon.prompt` false and not in `PLACES_SUMMONS` (nothing appears, except a neighbor that takes over the summon)
 *   vise          the summon is aimed with a click: only if the content says so (`targetedSummon`, §394: Finger of Death)
 * And what the engine declares for the identifier (`CONTENT[identifier].summon`, `placesSummons`).
 *
 * Reads a COPY of the LevelDB databases (Foundry locks them), writes nothing to the public repository: the detail (premium
 * names) goes in the requested JSON, outside the repository, and a Markdown summary in `prive/RELEVE_INVOCATIONS.md` if
 * `--md` is given.
 *   node tools/releve-invocations.mjs "F:/Foundry V14/Data" <output.json> [--md prive/RELEVE_INVOCATIONS.md]
 */
import { cpSync, mkdirSync, readdirSync, mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClassicLevel } from "classic-level";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { mmActorId, srdMonsterId } from "../module/scripts/core/summon.mjs";

const args = process.argv.slice(2);
const mdAt = args.indexOf("--md");
const md = (mdAt >= 0) ? args.splice(mdAt, 2)[1] : null;
const [data, out] = args;
if ( !data || !out ) {
  console.error("usage : node tools/releve-invocations.mjs <dossier Data de Foundry> <sortie.json> [--md <fichier.md>]");
  process.exit(1);
}

/** The surveyed packages: premium modules (if installed) and the system. */
const PACKAGES = [
  { id: "dnd-players-handbook", kind: "modules" }, { id: "dnd-monster-manual", kind: "modules" },
  { id: "dnd-dungeon-masters-guide", kind: "modules" }, { id: "dnd-ravenloft-horrors-within", kind: "modules" },
  { id: "dnd-heroes-borderlands", kind: "modules" }, { id: "dnd5e", kind: "systems" }
];
const MM = "dnd-monster-manual.actors";
const SRD24 = "dnd5e.actors24";

const tmp = mkdtempSync(join(tmpdir(), "releve-invocations-"));

async function read(dir, fn) {
  const copy = join(tmp, dir.replace(/[^A-Za-z0-9]+/g, "_"));
  mkdirSync(copy, { recursive: true });
  for ( const f of readdirSync(dir) ) if ( f !== "LOCK" ) cpSync(join(dir, f), join(copy, f));
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  try { for await ( const [key, value] of db.iterator() ) fn(key, value); }
  finally { await db.close(); }
}

/** The known actors (uuid → name) and the items with activities, from all compendiums. */
const actors = new Map();
const items = [];
for ( const { id: pkg, kind } of PACKAGES ) {
  const root = join(data, kind, pkg, "packs");
  if ( !existsSync(root) ) { console.warn(`absent : ${pkg}`); continue; }
  for ( const pack of readdirSync(root) ) {
    // dnd5e's 2014 compendiums (SRD 5.1) are no longer used: only the 2024 ones (`*24`) — but their actors remain known, to
    // say that a profile points to one (`srd-2014`).
    const legacy = (pkg === "dnd5e") && !pack.endsWith("24");
    const dir = join(root, pack);
    if ( !statSync(dir).isDirectory() || !existsSync(join(dir, "CURRENT")) ) continue;
    const actorNames = new Map();
    await read(dir, (key, value) => {
      if ( key.startsWith("!actors!") ) {
        actors.set(`Compendium.${pkg}.${pack}.Actor.${value._id}`, value.name);
        actorNames.set(value._id, value.name);
      } else if ( legacy ) {
        return;
      } else if ( key.startsWith("!items!") ) {
        items.push({ pack: `${pkg}.${pack}`, owner: null, item: value });
      } else if ( key.startsWith("!actors.items!") ) {
        items.push({ pack: `${pkg}.${pack}`, owner: key.split("!")[2].split(".")[0], item: value });
      }
    });
    for ( const row of items ) if ( (row.pack === `${pkg}.${pack}`) && row.owner && actorNames.has(row.owner) ) row.ownerName = actorNames.get(row.owner);
  }
}

/** The uuid as Foundry resolves it (including the short form `Compendium.p.k.id`). */
function knownActor(uuid) {
  if ( actors.has(uuid) ) return actors.get(uuid);
  const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:Actor\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? (actors.get(`Compendium.${m[1]}.${m[2]}.Actor.${m[3]}`) ?? null) : null;
}

/** §386: the 2024 equivalent of an SRD 2014 creature, as the engine looks it up. */
function preferred(uuid) {
  if ( !srdMonsterId(uuid) ) return null;
  const id = mmActorId(knownActor(uuid));
  if ( !id ) return null;
  for ( const pack of [MM, SRD24] ) {
    const [pkg, name] = pack.split(".");
    if ( actors.has(`Compendium.${pkg}.${name}.Actor.${id}`) ) return pack === MM ? "MM 2024" : "SRD 2024";
  }
  return null;
}

const PLACES = new Set(Object.entries(CONTENT).filter(([, e]) => e?.placesSummons).map(([id]) => id));
const variable = f => /@|d\d/i.test(String(f ?? ""));
// §394: aiming a summon no longer depends on its target in the data (the content's `targetedSummon`).

const rows = [];
for ( const { pack, ownerName, item } of items ) {
  const s = item.system ?? {};
  const identifier = s.identifier || null;
  const content = identifier ? CONTENT[identifier] : null;
  for ( const a of Object.values(s.activities ?? {}) ) {
    if ( !["summon", "transform", "enchant"].includes(a.type) ) continue;
    const profiles = a.type === "enchant" ? (a.effects ?? []) : (a.profiles ?? []);
    const flags = [];
    const sizes = (a.creatureSizes ?? []).length;
    const types = (a.creatureTypes ?? []).length;
    // A summon with several forms has the engine's "Choose the form" window (§383): flagged separately, covered.
    // Enchantments and transformations: the same engine window (§391); Wild Shape has its own (§16.39).
    if ( (profiles.length > 1) || (sizes > 1) || (types > 1) ) flags.push(a.type === "summon" ? "formes (couvert §383)"
      : (["wild-shape", "circle-forms"].includes(identifier) ? "formes (couvert §16.39)" : `formes (couvert §391) ${a.type}`));
    if ( profiles.some(p => (p.level?.min ?? null) !== null || (p.level?.max ?? null) !== null) ) flags.push("par-niveau");
    const targetCount = (a.target?.override ? a.target?.affects?.count : s.target?.affects?.count) ?? "";
    if ( a.type === "summon" ) {
      const countVaries = profiles.some(p => variable(p.count));
      const hiddenCount = !countVaries && variable(targetCount);
      if ( (countVaries || hiddenCount) && !content?.summon?.chooseCount ) flags.push(hiddenCount ? "nombre (dans la cible)" : "nombre");
      for ( const p of profiles ) {
        if ( a.summon?.mode === "cr" ) continue;
        // §392: a broken link to an SRD 2014 id (DMG) — the engine repairs it like an SRD 2014 profile.
        const lostId = (p.uuid && !knownActor(p.uuid)) ? String(p.uuid).split(".").pop() : null;
        if ( lostId ) {
          const order = ["dnd-monster-manual.actors", "dnd5e.actors24", "dnd-players-handbook.actors", "dnd-dungeon-masters-guide.actors"];
          const hits = [...actors.keys()].filter(k => k.endsWith(`.Actor.${lostId}`));
          const rank = k => { const pk = k.split(".").slice(1, 3).join("."); const i = order.indexOf(pk); return (i >= 0) ? i : (pk === "dnd5e.monsters" ? 99 : 50); };
          const hit = hits.sort((a, b) => rank(a) - rank(b))[0];
          if ( hit ) {
            const to = srdMonsterId(hit) ? preferred(hit) : null;
            flags.push(`lien cassé couvert §392 ${actors.get(hit)} → ${to ?? hit.split(".").slice(1, 3).join(".")} (redirigé en jeu par le module, ou réparé par le moteur)`);
            continue;
          }
        }
        if ( p.uuid && srdMonsterId(p.uuid) ) {
          const to = preferred(p.uuid);
          // The engine takes the 2024 equivalent when it exists (§386): covered; without an equivalent, the 2014 creature stays.
          flags.push(to ? `srd-2014 couvert §386 ${knownActor(p.uuid) ?? "?"} → ${to}` : `srd-2014 ${knownActor(p.uuid) ?? "?"} (sans équivalent)`);
        }
        if ( p.uuid && !knownActor(p.uuid) ) {
          // The same id in another compendium (a link to the wrong pack)?
          const id = String(p.uuid).split(".").pop();
          const elsewhere = [...actors.keys()].find(k => k.endsWith(`.Actor.${id}`));
          flags.push(`introuvable ${p.uuid}${elsewhere ? ` (même id : ${elsewhere} « ${actors.get(elsewhere)} »)` : ""}${p.name ? ` « ${p.name} »` : ""}`);
        }
      }
      // Light, Continual Flame: the engine places the object itself (§16.35, `light` content "on: summon").
      if ( (a.summon?.prompt === false) && !PLACES.has(identifier) && (content?.light?.on !== "summon") ) flags.push("ne-pose-rien");
    }
    const affects = (a.target?.override ? a.target?.affects?.type : s.target?.affects?.type) ?? "";
    if ( (a.type === "summon") && content?.targetedSummon ) flags.push(`vise (${affects || "contenu"})`);
    rows.push({
      pack, owner: ownerName ?? null, item: item.name, identifier, activity: a._id, type: a.type, name: a.name || "",
      level: s.level ?? null, profiles: profiles.map(p => p.name || knownActor(p.uuid) || p._id), sizes, types,
      count: profiles.map(p => p.count || "1"), targetCount, prompt: a.summon?.prompt ?? null, mode: a.summon?.mode ?? null,
      engine: content ? Object.keys(content).filter(k => ["summon", "placesSummons", "enchantTarget", "pact"].includes(k)) : [],
      flags: [...new Set(flags)]
    });
  }
}

// "At risk": at least one flag that is not covered by the engine.
const covered = f => f.startsWith("formes (couvert") || f.startsWith("srd-2014 couvert") || f.startsWith("lien cassé couvert");
const risky = rows.filter(r => r.flags.some(f => !covered(f)));
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
const by = key => rows.filter(r => r.flags.some(f => (key === "srd-2014 (") ? (f.startsWith("srd-2014 ") && f.includes("sans équivalent")) : f.startsWith(key))).length;
console.log(`${rows.length} activités (summon / transform / enchant), ${risky.length} à risque`);
for ( const key of ["formes (couvert", "par-niveau", "nombre", "srd-2014 couvert", "srd-2014 (", "lien cassé couvert", "introuvable", "ne-pose-rien", "vise"] ) console.log(`  ${key} : ${by(key)}`);

if ( md ) {
  const line = r => `| ${r.item}${r.owner ? ` (${r.owner})` : ""} | \`${r.identifier ?? "—"}\` | ${r.type} | ${r.profiles.length} | ${r.flags.join(" ; ")} | ${r.engine.join(", ") || "—"} |`;
  const groups = new Map();
  for ( const r of risky ) {
    const k = r.pack;
    if ( !groups.has(k) ) groups.set(k, []);
    groups.get(k).push(r);
  }
  const body = [...groups].map(([pack, list]) => `### ${pack}\n\n| Objet | Identifiant | Activité | Formes | Risques | Moteur |\n|---|---|---|---|---|---|\n${
    list.sort((a, b) => String(a.item).localeCompare(String(b.item))).map(line).join("\n")}`).join("\n\n");
  writeFileSync(md, `# Relevé des activités à choix (invocation, transformation, enchantement)

Généré par \`tools/releve-invocations.mjs\` le ${new Date().toISOString().slice(0, 10)} (SPEC §389). ${rows.length} activités, ${risky.length} à risque.
Risques : voir l'en-tête de l'outil. « Moteur » : ce que le contenu du moteur déclare pour l'identifiant.

${body}
`);
  console.log(`résumé : ${md}`);
}
