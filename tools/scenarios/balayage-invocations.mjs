/**
 * §389 (issue #38): sweep of summons through the REAL casting paths — the spell and feature sweeps
 * (`tools/lib/balayage.mjs`) skip "summon" activities and cast everything with `confirmed`: neither the action bar, nor the sheet,
 * nor "Cast anyway" went through there, and Summon Celestial (imposed form), Create Undead (0 ghouls) had
 * nothing to catch them. Here, every Player's Handbook spell that summons is lent to the Caster of the "Spell Arena" and cast:
 *   barre        like the DAS · Combat UI bar: slot of its level, without dnd5e's window (`castFromBar`);
 *   fiche        like a click in the sheet: dnd5e's or the engine's window, consumption (`castFromBar({ sheet })`);
 *   sans-empl.   the sheet, slots emptied: the GM goes through "Out of charges → Cast anyway" (§77, §384).
 * The windows are answered by choosing the LAST form (a form imposed outright — the first one — would show) and, if there is a
 * number to choose, 2. Invariants, independent of the dice:
 *   1. several forms → a choice window opens (the engine's or dnd5e's);
 *   2. the chosen form is the one dnd5e summons;
 *   3. at least one creature placed, as many as the chosen number (or as dnd5e counts);
 *   4. the spell goes off at least at its level;
 *   5. no SRD 2014 creature when the Monster Manual 2024 or the SRD 2024 has it (§386);
 *   6. no error in the GM's console.
 * A prepared ritual, slots remaining (Floating Disk, Unseen Servant, Phantom Steed): the engine asks "as a ritual
 * or with a slot" (§139); the bar and the sheet answer "with a slot" (the spell goes off at its level), without a slot
 * it goes off as a ritual automatically.
 * Skipped (said in the report): "by CR" summons (dnd5e opens the compendium browser: Find Familiar), Light and
 * Continual Flame (their own window, §16.35), summons that target an object or a creature (Animate Objects, Finger of Death).
 * Only played when named: `node tools/scenario.mjs balayage-invocations`. Variables:
 * `SORTS=summon-celestial,create-undead` (identifiers), `CHEMINS=barre,fiche` (the three by default).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";
import { CONTENT } from "../../module/scripts/content/index.mjs";
import { readFileSync } from "node:fs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const only = (process.env.SORTS ?? "").split(",").filter(Boolean);
// §392: `OBJETS=1` sweeps magic items (DMG, SRD 2024) instead of spells — for an item, the bar and the sheet go through the
// same path (dnd5e's window): "fiche" alone.
const ITEMS = !!process.env.OBJETS;
const PACKS = ITEMS ? ["dnd-dungeon-masters-guide.equipment", "dnd5e.equipment24"] : ["dnd-players-handbook.spells"];
const PATHS = (process.env.CHEMINS ?? (process.env.OBJETS ? "fiche" : "barre,fiche,sans-empl.")).split(",").filter(Boolean);
const FULL = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));
const EMPTY = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 0, override: 0 }]));
const OWN_WINDOW = new Set(["light", "continual-flame"]);
// §139: the ritual question is recognized by its button "with a slot", in the client's language.
const WITH_SLOT = new Set(["en", "fr", "it", "pt-BR"].map(l => JSON.parse(readFileSync(new URL(`../../module/lang/${l}.json`, import.meta.url), "utf-8"))["DND5ECOMBAT.Rituel.AvecEmplacement"]).filter(Boolean));

export default {
  name: process.env.OBJETS ? "balayage des invocations des objets magiques (DMG, SRD 2024)" : "balayage des invocations par les vrais chemins (barre, fiche, sans emplacement)",
  scene: ARENE_SORTS.name,
  audit: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Lanceur") ) { ctx.log("Lanceur absent : lancer tools/arene-sorts.mjs"); return; }
    const caster = await ctx.token("Lanceur");
    const at = await ctx.position(caster);
    const grid = ARENE_SORTS.grid;
    const sceneId = (await ctx.scene()).sceneId;
    const mm = (await ctx.call("list-compendiums", {})).some(p => (p.id === "dnd-monster-manual.actors") || (p.id === "dnd5e.actors24"));
    const actorsBefore = new Set((await ctx.call("list-actors", {})).map(a => a.id));
    const effectsBefore = new Set(((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).map(e => e._id ?? e.id));
    const placed = new Set();
    const made = new Set();
    const slots = async table => ctx.call("update-actor", { actorId: caster.actorId, actorData: { system: { spells: { ...table, pact: { value: 0, override: 0 } } } } });

    const tidy = async () => {
      const live = (await ctx.call("list-scene-objects", { sceneId, type: "Token" })).objects.Token.map(t => t.id);
      for ( const id of placed ) if ( live.includes(id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: id }).catch(() => {});
      placed.clear();
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: false })).windows ?? [] ) {
        if ( /Usage|Dialog/.test(d.className ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
      for ( const e of ((await ctx.call("get-actor", { actorId: caster.actorId })).effects ?? []).filter(x => !effectsBefore.has(x._id ?? x.id)) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      await tidy();
      await slots(FULL);
      for ( const id of made ) if ( !actorsBefore.has(id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: id }).catch(() => {});
    });

    // The Handbook's spells that summon ("summon" activity).
    const spells = [];
    for ( const packId of PACKS ) for ( const e of (await ctx.call("list-compendium-entries", { packId }).catch(() => [])) ?? [] ) {
      const { data } = await ctx.call("get-compendium-entry", { uuid: e.uuid });
      const id = data.system?.identifier;
      if ( only.length && !only.includes(id) ) continue;
      const summon = Object.values(data.system?.activities ?? {}).find(a => a.type === "summon");
      if ( summon ) spells.push({ uuid: e.uuid, data, summon });
    }
    spells.sort((a, b) => (a.data.system.level - b.data.system.level) || a.data.name.localeCompare(b.data.name));
    ctx.log(`${spells.length} sort(s) qui invoquent, chemins : ${PATHS.join(", ")}`);
    const report = [];

    for ( const { uuid, data, summon } of spells ) {
      const id = data.system.identifier;
      const level = Number(data.system.level) || 0;
      if ( summon.summon?.mode === "cr" ) { report.push(`${id} : sauté (invocation par FP, navigateur de compendium)`); continue; }
      if ( OWN_WINDOW.has(id) ) { report.push(`${id} : sauté (sa propre fenêtre, §16.35)`); continue; }
      // §394: only the summons that the content makes target (`targetedSummon`: Finger of Death raises a corpse) wait for a
      // click — scenario `invocations-ciblees`, in the Summons Arena.
      const affects = (summon.target?.override ? summon.target?.affects?.type : data.system.target?.affects?.type) ?? "";
      if ( CONTENT[id]?.targetedSummon ) {
        report.push(`${id} : sauté (vise ${affects} : attend un clic)`);
        ctx.log(`${id} : sauté (vise ${affects} : attend un clic)`);
        continue;
      }
      // §393: an item is lent by its uuid (DMG and SRD 2024 share identifiers), equipped and attuned.
      const itemId = await ctx.ensureItem(caster, uuid, ITEMS ? { byUuid: true, ready: true } : {});
      const forms = (summon.profiles ?? []).filter(p => ((p.level?.min ?? 0) <= level) && ((p.level?.max ?? 99) >= level)).length;
      for ( const path of PATHS ) {
        if ( (path === "sans-empl.") && (level < 1) ) continue;
        if ( (path === "barre") && (level < 1) ) continue;
        await slots(path === "sans-empl." ? EMPTY : FULL);
        await ctx.refill(caster, itemId);   // §393: the charges from the previous pass
        await ctx.call("get-client-errors", { clear: true }).catch(() => {});
        const label = `${id} [${path}]`;
        const started = await ctx.engine("castFromBar", { tokenId: caster.id, itemId, sheet: path !== "barre",
          slot: (path === "barre") ? `spell${level}` : null, x: at.x + grid, y: at.y + (2 * grid) });
        const profiles = started.profiles ?? [];
        // The windows, until dnd5e summons (or gives up): we pick the last form, and 2 creatures if there is a number.
        let chose = null;
        let wanted = null;
        let sawChoice = false;
        let captured = null;
        let ritualAsked = false;
        for ( let i = 0; i < 24; i++ ) {
          captured = await ctx.engine("summonCaptured", {});
          if ( captured?.tokens ) break;
          const { windows = [] } = await ctx.call("list-dialogs", { details: true, waitMs: 500 });
          for ( const w of windows ) {
            const fields = w.fields ?? [];
            const radio = fields.filter(f => f.name === "profile");
            const select = fields.find(f => f.name === "summons.profile");
            const count = fields.find(f => f.name === "count");
            if ( radio.length || count ) {
              sawChoice = sawChoice || (radio.length > 1) || !!count;
              chose = radio.length ? radio[radio.length - 1].value : (chose ?? null);
              // In two steps, like a player: the form first (it redraws the list of numbers), then the number.
              let state = w;
              if ( radio.length ) state = (await ctx.call("answer-dialog", { id: w.id, fields: { profile: chose }, waitMs: 300 }).catch(() => null))?.window ?? w;
              const counts = (state.fields ?? []).find(f => f.name === "count");
              wanted = (counts && (counts.options ?? []).some(o => o.value === "2")) ? 2 : null;
              await ctx.call("answer-dialog", { id: w.id, fields: wanted ? { count: "2" } : {}, button: "summon" }).catch(() => {});
            } else if ( select ) {
              sawChoice = sawChoice || ((select.options ?? []).length > 1);
              chose = (select.options ?? []).at(-1)?.value ?? null;
              await ctx.call("answer-dialog", { id: w.id, fields: { "summons.profile": chose }, button: "use" }).catch(() => {});
            } else if ( (w.buttons ?? []).some(b => WITH_SLOT.has(b.label)) ) {
              ritualAsked = true;
              await ctx.call("answer-dialog", { id: w.id, button: w.buttons.find(b => WITH_SLOT.has(b.label)).action }).catch(() => {});
            } else if ( (w.buttons ?? []).some(b => ["yes", "go"].includes(b.action)) ) {
              await ctx.call("answer-dialog", { id: w.id, button: (w.buttons ?? []).some(b => b.action === "go") ? "go" : "yes" }).catch(() => {});
            } else if ( /UsageDialog/.test(w.className ?? "") ) {
              await ctx.call("answer-dialog", { id: w.id, button: "use" }).catch(() => {});
            }
          }
          await pause(300);
        }
        const tokensOut = captured?.tokens ?? [];
        for ( const t of tokensOut ) { placed.add(t.id); if ( t.actorId ) made.add(t.actorId); }
        const problems = [];
        if ( (forms > 1) && !sawChoice ) problems.push(`${forms} formes, aucune fenêtre de choix`);
        if ( chose && captured?.summoned?.profile && (captured.summoned.profile !== chose) ) problems.push(`forme invoquée ${captured.summoned.name || captured.summoned.profile}, pas celle choisie`);
        if ( !tokensOut.length ) problems.push("aucune créature posée");
        // §392: the creature actually summoned exists (DMG link repaired) — dnd5e placed it under this name.
        if ( ritualAsked ) ctx.log(`${label} : rituel préparé — « avec un emplacement » choisi`);
        if ( tokensOut.length ) ctx.log(`${label} : ${tokensOut.map(t => t.name).join(", ")} (${String(captured?.summoned?.uuid ?? "").split(".").slice(1, 3).join(".")})`);
        const expected = Number(captured?.summoned?.count) || null;
        if ( wanted && expected && (expected !== wanted) ) problems.push(`${wanted} créature(s) choisie(s), dnd5e en compte ${expected}`);
        if ( tokensOut.length && expected && (tokensOut.length !== expected) ) problems.push(`${tokensOut.length} posée(s) pour ${expected} attendue(s)`);
        if ( captured?.summoned?.level && (captured.summoned.level < level) ) problems.push(`lancé au niveau ${captured.summoned.level} (sort de niveau ${level})`);
        if ( mm && String(captured?.summoned?.uuid ?? "").startsWith("Compendium.dnd5e.monsters.") ) problems.push("créature du SRD 2014");
        await pause(1500);
        const errors = (await ctx.call("get-client-errors", { levels: ["error", "uncaught", "unhandledrejection"] }).catch(() => ({ entries: [] }))).entries ?? [];
        // A BLFX animation error (third-party module) is noted separately, not counted against the engine.
        const blfx = e => /boss-loot-assets-premium/.test(String(e.text ?? e.message ?? ""));
        const ours = errors.filter(e => !blfx(e));
        if ( ours.length ) problems.push(`erreur console : ${String(ours[0].text).slice(0, 120)}`);
        if ( errors.length > ours.length ) ctx.log(`${label} : erreur d'animation de BLFX (tiers), non comptée`);
        ctx.expect(!problems.length, `${label} : ${problems.length ? problems.join(" ; ") : `${tokensOut.length} posée(s), niveau ${captured?.summoned?.level ?? "?"}`}`);
        report.push(`${label} : ${problems.length ? problems.join(" ; ") : "ok"}`);
        // The appearance animation (BLFX, darsh-animations) still runs for a few seconds: removing the creature before it finishes
        // crashes BLFX ("reading 'rotation'"), counted at the next cast.
        await pause(4000);
        await tidy();
      }
    }
    ctx.log(`rapport : ${report.filter(r => !r.endsWith(": ok")).length} ligne(s) en défaut sur ${report.length}`);
  }
};
