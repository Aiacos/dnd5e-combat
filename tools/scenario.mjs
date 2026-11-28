#!/usr/bin/env node
/**
 * Integration scenarios replayable without a human hand (SPEC §13, S5): the engine runs in
 * the GM's client, driven by the MCP connector (tools/lib/connector.mjs), and each scenario
 * checks the CONSISTENCY of what happened — not dice values: hit ⇔ roll ≥ AC, HP
 * removed = damage applied, successful save ⇔ roll ≥ DC, area removed…
 *
 *   node tools/scenario.mjs                 all the scenarios of tools/scenarios/
 *   node tools/scenario.mjs attaque zone    only those (file name without extension)
 *   node tools/scenario.mjs <folder|file.mjs>   scenarios kept elsewhere (another module's repository), mixable with names
 *   node tools/scenario.mjs --grep zone      those whose name, title or header contains this word
 *                                            (without accents; repeatable: one OR the other)
 *   node tools/scenario.mjs --section 239    those that cite this § of the journal (§239 and §239.x; repeatable)
 *   node tools/scenario.mjs --scene escalade those of this scene ("arene": the test Arena, no scene declared)
 *   node tools/scenario.mjs --list [filters] the selection, without playing anything or touching the connector
 * Filters combine (word AND § AND scene) and pick from the full pass: an interactive or diagnostic scenario
 * stays skipped, as without a filter. Full list: docs/reference/SCENARIOS.md.
 *
 * A scenario marked `interactive: true` (it waits for a GM click) or `audit: true` (a diagnostic that surveys without checking)
 * is only played when named. `scene`: "keep" (Restored Keep), a scene name ("metres", "Redbrand Hideout [30x20]": the scene
 * with this name, the scenario skipped if it is missing), or nothing (the test arena).
 *
 * A scenario marked `players: true` needs a real player client: the test bench (`Dev Foundry/banc-de-test`) opens one
 * ("claude player", separate Chrome) for that scenario alone, lends it as `ctx.asPlayer(code, args)` — `code` is the body
 * of an async function run in the player's page, which returns a JSON result — then closes it. The launcher finds it through the
 * variable BANC_JOUEUR (the bench driver, `lib/joueur.mjs`); without it (the user's Foundry), the scenario is not
 * applicable. Never for the whole pass: the other scenarios assume that no player is connected.
 *
 * Prerequisites: connector server running, test world open on the GM's side ("Test tools"
 * setting enabled), scene displayed with the tokens the scenario names, and **F5 of the GM's client
 * after any engine change** (it is what runs it). A scenario restores what it
 * touched (HP, areas, combat), even if it fails. Exit code 1 if a check is missing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connect } from "./lib/connector.mjs";
import { matches, scenarioMeta } from "./lib/scenario-meta.mjs";
import { ARENA, ARENE_ABJURATION, ARENE_INVOCATIONS, ARENE_PRIX, ARENE_REFUS, ARENE_SORTS, ARENE_VISION, RESTORED_KEEP } from "./lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const TERMINAL = new Set(["done", "missed", "undone"]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A short engine test function (answer within 8 s). */
async function callEngine(mcp, fn, args={}) {
  const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 8000 });
  if ( !r.settled ) throw new Error(`${fn} : pas de réponse en 8 s`);
  return r.result;
}

/** A creature sheet: Monster Manual 2024 (premium) and dnd5e's SRD 2024 carry the same identifiers (`mmWolf0000000000`). */
const MM = id => `Compendium.dnd-monster-manual.actors.Actor.${id}`;
const SRD = id => `Compendium.dnd5e.actors24.Actor.${id}`;

/**
 * `ctx.cast` (run on the GM's side by `run-script`, "Test tools" setting): the first sheet found, imported under the wanted name,
 * its unlinked token placed on the first free cell in rings around `near` (or the center of the tokens), at the level of `near`.
 */
const CAST_SCRIPT = `
const { uuids, name, near, disposition } = args;
let src = null, from = null;
for ( const u of uuids ) { const d = await fromUuid(u).catch(() => null); if ( d ) { src = d; from = u; break; } }
if ( !src ) return { error: "fiche absente" };
const data = game.actors.fromCompendium(src);
data.name = name;
data.prototypeToken = { ...(data.prototypeToken ?? {}), name, actorLink: false, ...((disposition === null) || (disposition === undefined) ? {} : { disposition }) };
const actor = await Actor.implementation.create(data);
const scene = canvas.scene;
const g = scene.grid.size;
const w = Math.max(1, Math.round(actor.prototypeToken.width ?? 1)), h = Math.max(1, Math.round(actor.prototypeToken.height ?? 1));
const toks = scene.tokens.contents;
const busy = (x, y) => toks.some(t => (x < t.x + t.width * g) && (x + w * g > t.x) && (y < t.y + t.height * g) && (y + h * g > t.y));
const rect = scene.dimensions.sceneRect;
const inside = (x, y) => (x >= rect.x) && (y >= rect.y) && (x + w * g <= rect.x + rect.width) && (y + h * g <= rect.y + rect.height);
const anchor = near ?? (toks.length ? { x: toks.reduce((s, t) => s + t.x, 0) / toks.length, y: toks.reduce((s, t) => s + t.y, 0) / toks.length } : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const ax = rect.x + Math.round((anchor.x - rect.x) / g) * g, ay = rect.y + Math.round((anchor.y - rect.y) / g) * g;
let at = null;
for ( let r = 1; (r < 40) && !at; r++ ) {
  for ( let dx = -r; (dx <= r) && !at; dx++ ) for ( let dy = -r; (dy <= r) && !at; dy++ ) {
    if ( Math.max(Math.abs(dx), Math.abs(dy)) !== r ) continue;
    const x = ax + dx * g, y = ay + dy * g;
    if ( inside(x, y) && !busy(x, y) ) at = { x, y };
  }
}
if ( !at ) { await actor.delete(); return { error: "aucune case libre" }; }
const nearTok = near ? toks.find(t => (t.x === near.x) && (t.y === near.y)) : null;
const td = await actor.getTokenDocument({ ...at, name, actorLink: false, ...(nearTok?.level ? { level: nearTok.level } : {}) });
const [tok] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
return { tokenId: tok.id, actorId: actor.id, createdActor: true, from };
`;
/** Restoration for `ctx.cast` / `ctx.ensureActor`: the token (or all those of the actor), then the imported actor. */
const UNCAST_SCRIPT = `
const { tokenId, actorId, createdActor, allTokens } = args;
for ( const s of game.scenes ) {
  const ids = s.tokens.filter(t => (t.id === tokenId) || (allTokens && (t.actorId === actorId))).map(t => t.id);
  if ( ids.length ) await s.deleteEmbeddedDocuments("Token", ids);
}
if ( createdActor ) await game.actors.get(actorId)?.delete();
return true;
`;
/** `ctx.ensureActor`: the world actor under its sheet's id, imported (keepId) if missing. */
const ACTOR_SCRIPT = `
if ( game.actors.get(args.id) ) return { actorId: args.id, created: false };
for ( const u of args.uuids ) {
  const d = await fromUuid(u).catch(() => null);
  if ( !d ) continue;
  const a = await Actor.implementation.create(game.actors.fromCompendium(d, { keepId: true }), { keepId: true });
  return { actorId: a.id, created: true, from: u };
}
return {};
`;

/** What a scenario receives. */
function makeContext(mcp) {
  const failures = [];
  let checks = 0;
  const restorations = [];
  let scene = null;
  const healed = new Set();   // tokens already restored to their max HP in this scenario (ctx.token)
  /** Time of the bounds returned by `lastMessageId`, in case the bound message disappears. */
  const stamps = new Map();

  const ctx = {
    call: (tool, args) => mcp.call(tool, args),
    log: (...args) => console.log("   ", ...args),
    /** Code in the player client's page (`players: true` only; replaced by the launcher). */
    asPlayer: async () => { throw new Error("ctx.asPlayer : le scénario ne déclare pas players: true"); },

    /**
     * An engine test function (`api.mcp`, runtime/testing.mjs) through `call-module-api` (connector ≥ 0.28.0). A long
     * function (animated movement) hands control back after 8 s; it is picked up by its `callId` until the result.
     * Past `timeoutMs`, the dialogs opened in the meantime are closed (a core "Change Level" pauses the movement)
     * and an error is thrown.
     */
    async engine(fn, args={}, { timeoutMs=60000 }={}) {
      const before = new Set((await callEngine(mcp, "windows")).map(w => w.id));
      const until = Date.now() + timeoutMs;
      // A level change of the GM's view (stairs taken, the view follows the token) redraws the whole canvas
      // (documents/scene.mjs:273-281): while it draws, the test functions answer "no scene displayed" or
      // "not drawn". We wait for the canvas to come back (15 s at most) rather than interrupt the scenario (seen in `escaliers`).
      let r;
      for ( const redrawn = Date.now() + 15000; !r; ) {
        try { r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 8000 }); }
        catch(err) {
          if ( !/aucune scène affichée|non dessiné|no scene displayed|not drawn/.test(err.message) || (Date.now() > redrawn) ) throw err;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      while ( !r.settled ) {
        if ( Date.now() > until ) {
          const stuck = (await callEngine(mcp, "windows")).filter(w => !before.has(w.id));
          for ( const w of stuck ) await callEngine(mcp, "closeWindow", { id: w.id }).catch(() => {});
          // With the dialog closed, the movement resumes and finishes: we clear the pending call.
          await mcp.call("call-module-api", { callId: r.callId, waitMs: 8000 }).catch(() => {});
          throw new Error(`${fn} : pas de réponse après ${timeoutMs} ms${stuck.length ? ` — fenêtre(s) fermée(s) : ${stuck.map(w => w.title ?? w.id).join(", ")}` : ""}`);
        }
        r = await mcp.call("call-module-api", { callId: r.callId, waitMs: 8000 });
      }
      return r.result;
    },

    /** A check: logged, never blocking — the whole scenario is read. */
    expect(condition, label) {
      console.log(`    ${condition ? "✓" : "✗"} ${label}`);
      checks++;
      if ( !condition ) failures.push(label);
      return !!condition;
    },
    get failures() { return failures; },
    /** The number of checks played (`expect`): 0 at the end of the scenario, it checked nothing ("not applicable"). */
    get checks() { return checks; },

    /**
     * 2026-11-14: a compendium creature on the scene, for the duration of the scenario. `roles`: expected token name → sheet
     * identifier (16 characters: looked up in the Monster Manual 2024 if installed, otherwise in dnd5e's SRD 2024, `actors24`,
     * with the same identifiers) or full uuid, or list of uuids (the first found). A token of that name already on the scene is
     * kept as is; otherwise the actor is imported into the world under that name, its token (unlinked) placed on a free cell near
     * `near`
     * (name of a scene token, or {x, y}) or the center of the tokens, and both are removed at restoration. Returns name → token
     * ({ id, actorId, name }) or null if no sheet is found: the scenario then honestly says "not applicable".
     * Several scenarios written in the `ravenloft` world (Wolf, Brown Bear…) no longer played in `dnd-6` without this.
     */
    async cast(roles, { near=null, disposition=null }={}) {
      const out = {};
      const present = new Set((await ctx.liveTokens()).map(t => t.name));
      for ( const [name, source] of Object.entries(roles) ) {
        if ( present.has(name) ) { out[name] = (await ctx.liveTokens()).find(t => t.name === name) ?? null; continue; }
        const uuids = [source].flat().flatMap(s => /^[A-Za-z0-9]{16}$/.test(s) ? [MM(s), SRD(s)] : [s]);
        const anchor = (typeof near === "string") ? (await ctx.liveTokens()).find(t => t.name === near) ?? null : near;
        const r = await mcp.call("run-script", { code: CAST_SCRIPT, args: { uuids, name, near: anchor ? { x: anchor.x, y: anchor.y } : null, disposition }, waitMs: 20000 });
        const res = r?.result;
        if ( !res?.tokenId ) { out[name] = null; console.log(`    · ${name} : aucune fiche parmi ${uuids.join(", ")}${res?.error ? ` (${res.error})` : ""}`); continue; }
        ctx.restore(() => mcp.call("run-script", { code: UNCAST_SCRIPT, args: res, waitMs: 10000 }).catch(() => {}));
        console.log(`    + ${name} posé pour le scénario (${res.from})`);
        out[name] = { id: res.tokenId, actorId: res.actorId, name };
        present.add(name);
      }
      scene = null;   // the list of `ctx.scene()` is re-read with them
      await sleep(800);   // the GM's canvas draws the new tokens
      return out;
    },

    /**
     * A world actor under its sheet's identifier (`keepId`), for a scenario that looks it up by its id (the Dretch, the Vampire
     * Familiar): imported from the Monster Manual or SRD 2024 if missing, removed (with its tokens) at restoration.
     * Returns the id or null.
     */
    async ensureActor(id) {
      const r = await mcp.call("run-script", { code: ACTOR_SCRIPT, args: { id, uuids: [MM(id), SRD(id)] }, waitMs: 20000 });
      const res = r?.result;
      if ( !res?.actorId ) return null;
      if ( res.created ) {
        ctx.restore(() => mcp.call("run-script", { code: UNCAST_SCRIPT, args: { actorId: res.actorId, createdActor: true, allTokens: true }, waitMs: 10000 }).catch(() => {}));
        console.log(`    + acteur ${id} importé pour le scénario (${res.from})`);
      }
      return res.actorId;
    },

    /** To undo at the end of the scenario, whatever happens (last to first). */
    restore(fn) { restorations.push(fn); },
    async undoAll() {
      for ( const fn of restorations.reverse() ) {
        try { await fn(); }
        catch(err) { console.log(`    ! remise en état : ${err.message}`); }
      }
    },

    /* ---- the scene and its tokens ---- */

    async scene() {
      if ( !scene ) {
        const { sceneId, objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
        scene = { sceneId, tokens: objects.Token ?? [] };
      }
      return scene;
    },

    /**
     * The scene's tokens NOW — `scene()` keeps the list from the start of the scenario (seen on 2026-09-29: summons created
     * during a scenario were neither seen nor removed by its restoration, and a "the spirit is removed" passed wrongly).
     */
    async liveTokens() {
      const { objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
      return objects.Token ?? [];
    },

    /** The first visible token of that name on the displayed scene. */
    async token(name) {
      const { tokens } = await ctx.scene();
      // Several tokens of the same name (in `dnd-6`, a second Zombie on the upper floor of Restored Keep, elevation 20:
      // picked first, it made `attaque`, `empoignade`, `injonction`… fail through Total Cover): the one at the level where
      // most tokens are, on the ground.
      const levels = new Map();
      for ( const t of tokens ) levels.set(t.level ?? null, (levels.get(t.level ?? null) ?? 0) + 1);
      const main = [...levels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const rank = t => (t.hidden ? 4 : 0) + (((t.level ?? null) === main) ? 0 : 2) + ((t.elevation ?? 0) ? 1 : 0);
      const found = tokens.filter(t => t.name === name).sort((a, b) => rank(a) - rank(b))[0];
      if ( !found ) throw new Error(`token « ${name} » absent de la scène (présents : ${[...new Set(tokens.map(t => t.name))].join(", ")})`);
      // Hidden by the GM (the engine keeps it out of play for everyone, adapter/vision.mjs): shown for the scenario that names
      // it, then hidden again — seen on 2026-10-26, the Arena decluttered by hand made thirty scenarios fail ("attacker not seen").
      if ( found.hidden ) {
        await mcp.call("update-scene-object", { type: "Token", objectId: found.id, data: { hidden: false } });
        found.hidden = false;
        console.log(`    👁 ${found.name} montré le temps du scénario (caché par le MJ)`);
        restorations.unshift(async () => {
          await mcp.call("update-scene-object", { type: "Token", objectId: found.id, data: { hidden: true } });
          found.hidden = true;
        });
        await sleep(300);
      }
      // Wounded (HP below the maximum computed by dnd5e): restored to the maximum for the scenario that names it — the safety
      // net restores its previous HP afterwards. Seen on 2026-10-26: the Fighter at 8/13 and the Cleric at 6 HP made fail the
      // scenarios that read the world's HP as those of an unharmed character (Revivify, Drain, Hellish Rebuke). Never lowered:
      // scenarios count on a Zombie or a Bandit sturdier than its sheet.
      if ( !healed.has(found.id) ) {
        healed.add(found.id);
        const max = (await ctx.engine("stats", { tokenId: found.id }).catch(() => null))?.hp?.max;
        const now = Number.isFinite(max) ? await ctx.hp(found).catch(() => null) : null;
        if ( Number.isFinite(now) && (now > 0) && (now < max) ) {
          await ctx.setHp(found, max);
          console.log(`    ❤ ${found.name} remis à ${max} PV (${now} dans le monde) le temps du scénario`);
        }
      }
      return found;
    },

    /**
     * Sets a scenario's staging (tools/lib/stages.mjs, SPEC §40.6): each named token goes to its place, through
     * `move-token` (a "displace" movement, without walls or budget), and returns to where it was at the end — this restoration
     * is registered from here: call `stage` BEFORE any other restoration of the scenario, so that it runs last (restorations
     * run in reverse). Returns false, moving nothing, on a scene other than the staging's.
     * @param {{scene?: string, level?: string, tokens: Record<string, [number, number]>}} layout
     */
    async stage(layout) {
      const { sceneId } = await ctx.scene();
      if ( layout.scene && (sceneId !== layout.scene) ) return false;
      const moved = [];
      for ( const [name, [x, y]] of Object.entries(layout.tokens) ) {
        const t = await ctx.token(name).catch(() => null);
        if ( !t ) continue;
        const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
        const before = { x: data.x, y: data.y, elevation: data.elevation ?? 0, level: data.level ?? null };
        const changesLevel = !!layout.level && (before.level !== layout.level);
        if ( (before.x === x) && (before.y === y) && (before.elevation === 0) && !changesLevel ) continue;
        await mcp.call("move-token", { tokenId: t.id, x, y, elevation: 0, ...(changesLevel ? { levelId: layout.level } : {}) });
        await sleep(500);
        moved.push({ id: t.id, name, before, changesLevel });
      }
      if ( moved.length ) {
        console.log(`    ⇄ distribution posée : ${moved.map(m => m.name).join(", ")}`);
        restorations.push(async () => {
          for ( const m of moved ) {
            await mcp.call("move-token", { tokenId: m.id, x: m.before.x, y: m.before.y, elevation: m.before.elevation,
              ...((m.changesLevel && m.before.level) ? { levelId: m.before.level } : {}) }).catch(err => console.log(`    ! ${m.name} non remis : ${err.message}`));
            await sleep(400);
          }
        });
      }
      scene = null;   // the kept list carried the old positions
      return true;
    },

    /** A token's HP, read from the document (token delta, or linked actor) — not from the engine. */
    async hp(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const own = data.actorLink ? null : (data.delta?.system?.attributes?.hp?.value ?? null);
      if ( own !== null ) return own;
      // Linked actor, or unlinked token whose delta carries no HP: those of the sheet. Returning `null` here made the token
      // rewrite `null` at restoration — 0 HP, a "Dead" Zombie for the following scenarios (§82).
      const actor = await mcp.call("get-actor", { actorId: data.actorId ?? token.actorId });
      return actor.system?.attributes?.hp?.value ?? actor.actor?.system?.attributes?.hp?.value ?? null;
    },

    async setHp(token, value) {
      if ( (value === null) || (value === undefined) ) throw new Error(`setHp(${token.name ?? token.id}) : PV inconnus, rien n'est écrit`);
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      if ( data.actorLink ) await mcp.call("update-actor", { actorId: token.actorId, actorData: { "system.attributes.hp.value": value } });
      else await mcp.call("update-scene-object", { type: "Token", objectId: token.id, data: { "delta.system.attributes.hp.value": value } });
    },

    /** Pixel rectangle of a token, to place an area on it. */
    async box(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const grid = data.parent?.grid?.size ?? null;
      const size = grid ?? (await ctx.gridSize());
      return { x: data.x, y: data.y, width: data.width * size, height: data.height * size };
    },

    /**
     * Removes from a token the effects that carry this condition (effect applied by an activity: Grappled from Grapple…).
     * `set-status … active: false` only removes the condition applied by the toggle, not those effects.
     */
    async removeStatusEffects(token, status) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const scene = (await ctx.scene()).sceneId;
      const linked = !!data.actorLink;
      const effects = linked ? ((await mcp.call("get-actor", { actorId: data.actorId })).effects ?? []) : (data.delta?.effects ?? []);
      const target = linked ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of effects.filter(e => (e.statuses ?? []).includes(status)) ) {
        await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});   // already expired: skip
      }
    },

    /** Removes from a token the effects whose name matches (effect applied by a spell, Concentration). */
    async removeEffectsNamed(token, pattern) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const scene = (await ctx.scene()).sceneId;
      const linked = !!data.actorLink;
      const effects = linked ? ((await mcp.call("get-actor", { actorId: data.actorId })).effects ?? []) : (data.delta?.effects ?? []);
      const target = linked ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of effects.filter(e => pattern.test(e.name ?? "")) ) {
        await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});
      }
    },

    /** Removes from a token the effects applied by the items of given identifiers (`effectsFrom`), whatever the language. */
    async removeEffectsFrom(token, ...identifiers) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const scene = (await ctx.scene()).sceneId;
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of await ctx.effectsFrom(token, ...identifiers) ) {
        await mcp.call("remove-embedded-effect", { ...target, effectId: e.id }).catch(() => {});
      }
    },

    async gridSize() {
      const s = await mcp.call("get-scene", {});
      return s.grid?.size ?? s.scene?.grid?.size ?? 100;
    },

    /* ---- actions and resolutions ---- */

    /**
     * Uses an activity, confirmed automatically for the engine (no legality dialog).
     * The item is designated by `identifier` (dnd5e identifier, `system.identifier`) or by `itemId` — never
     * by its name: names are translated on the fly by Babele ("Moonbeam" / "Rayon de lune").
     */
    async use({ identifier, ...params }) {
      if ( identifier ) params.itemId = await ctx.itemId(params.tokenId, identifier);
      // The engine flag is merged (confirmed automatically); without other instruction, no reaction window
      // opens (`autoReact: "none"`): a hostile Mage who sees the whole room would counter every spell of the scenarios.
      // `areaPlaced`: the area is placed by the connector (`area`) — the engine does not open its own placement (§188).
      const ours = { confirmed: true, autoReact: "none", ...(params.area ? { areaPlaced: true } : {}), ...(params.usageConfig?.[MODULE_ID] ?? {}) };
      return mcp.call("use-activity", {
        configure: false,
        ...params,
        usageConfig: { ...(params.usageConfig ?? {}), [MODULE_ID]: ours }
      });
    },

    /**
     * Makes sure a token carries a compendium item (by its uuid), for a scenario that needs a spell
     * the sheet does not have; added for the scenario, removed at the end. Returns the item's id on the sheet.
     */
    async ensureItem(token, uuid, { system={}, byUuid=false, ready=false }={}) {
      const { data } = await mcp.call("get-compendium-entry", { uuid });
      Object.assign(data.system ??= {}, system);   // retouches (ex. { method: "atwill" } : un sort sans emplacement)
      // §410: a lent spell is ready to cast — prepared (the engine now refuses an unprepared spell, "Use anyway" window).
      if ( (data.type === "spell") && !("prepared" in system) ) data.system.prepared = 1;
      const identifier = data.system?.identifier;
      // §393: `byUuid` recognizes the lent object by its original uuid, not by its identifier — the DMG's Axe of the Dwarvish Lords
      // and the SRD 2024's have the same identifier, and the second reused the first (charge already spent).
      const match = byUuid ? { path: "flags.dnd5e-combat.lentFrom", value: uuid } : { path: "system.identifier", value: identifier };
      if ( byUuid ) foundry_set(data, "flags.dnd5e-combat.lentFrom", uuid);
      // §393: `ready` lends a magic item ready for use — equipped, attuned if it requires it (dnd5e otherwise refuses
      // its activities).
      if ( ready && PHYSICAL.has(data.type) ) {
        data.system.equipped = true;
        if ( data.system.attunement ) data.system.attuned = true;
      }
      const { data: tok } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const items = (await mcp.call("get-actor", { actorId: tok.actorId })).items ?? [];
      const existing = items.find(i => foundry_get(i, match.path) === match.value);
      if ( existing ) {
        // §410: a spell already on the sheet but unprepared is prepared for the scenario's duration (the engine refuses an
        // unprepared spell).
        if ( (existing.type === "spell") && !existing.system?.prepared && !("prepared" in system) ) {
          await mcp.call("upsert-actor-item", { actorId: tok.actorId, itemData: { "system.prepared": 1 }, match: { path: "_id", value: existing._id } });
          ctx.restore(() => mcp.call("upsert-actor-item", { actorId: tok.actorId, itemData: { "system.prepared": existing.system?.prepared ?? 0 },
            match: { path: "_id", value: existing._id } }).catch(() => {}));
        }
        return existing._id;
      }
      const { _id, folder, ownership, _stats, ...itemData } = data;
      const r = await mcp.call("upsert-actor-item", { actorId: tok.actorId, itemData, match });
      const id = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => mcp.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: id }).catch(() => {}));
      return id;
    },

    /**
     * §393: resets the charges of a token's item — the item's and each of its activities' —, so that a
     * sweep that relaunches it by several paths (bar, sheet…) does not hit "no more charge" the second time.
     */
    async refill(token, itemId) {
      const { data: tok } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const item = ((await mcp.call("get-actor", { actorId: tok.actorId })).items ?? []).find(i => i._id === itemId);
      if ( !item ) return false;
      const itemData = { "system.uses.spent": 0 };
      for ( const id of Object.keys(item.system?.activities ?? {}) ) itemData[`system.activities.${id}.uses.spent`] = 0;
      await mcp.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "_id", value: itemId } });
      return true;
    },

    /** Position (top-left corner, pixels) and elevation of a token, read from the document. */
    async position(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      return { x: data.x, y: data.y, elevation: data.elevation ?? 0 };
    },

    /** A token's Active Effects (linked actor or delta). */
    async effects(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      if ( data.actorLink ) return (await mcp.call("get-actor", { actorId: data.actorId })).effects ?? [];
      return data.delta?.effects ?? [];
    },

    /**
     * A token's effects applied by an item of a given dnd5e identifier (the spell, the feature, the original object), whatever
     * the language of the GM's client: an effect's name follows the translation ("Warded" / "Protégé"), its origin does not.
     * Returns `[{ id, effect, identifier, statuses, disabled }]`; several identifiers possible.
     */
    async effectsFrom(token, ...identifiers) {
      const all = await this.engine("effectOrigins", { tokenId: token.id ?? token });
      return (all ?? []).filter(e => identifiers.includes(e.identifier));
    },

    /** A token's item id by its dnd5e identifier, stable whatever the language. */
    async itemId(tokenId, identifier) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: tokenId });
      const items = (await mcp.call("get-actor", { actorId: data.actorId })).items ?? [];
      const found = items.find(i => i.system?.identifier === identifier);
      if ( !found ) throw new Error(`item « ${identifier} » absent de ${data.name} (identifiants : ${items.map(i => i.system?.identifier).filter(Boolean).join(", ")})`);
      return found._id;
    },

    /** The resolution carried by a message, as the engine wrote it. */
    async resolution(messageId) {
      const { messages } = await mcp.call("list-chat-messages", { limit: 60, flagScope: MODULE_ID });
      const m = (messages ?? []).find(x => x.id === messageId);
      return m ? (m.flags?.[MODULE_ID]?.resolution ?? m.flags?.resolution ?? null) : null;
    },

    /** Waits for a resolution to be settled (done / missed / undone). */
    async settle(messageId, { timeoutMs=30000 }={}) {
      const until = Date.now() + timeoutMs;
      let last = null;
      while ( Date.now() < until ) {
        last = await ctx.resolution(messageId);
        if ( last && TERMINAL.has(last.step) ) return last;
        await sleep(500);
      }
      throw new Error(`résolution ${messageId} non tranchée après ${timeoutMs} ms (étape : ${last?.step ?? "aucune"})`);
    },

    /** The messages created since a given message, engine flags included. */
    async messagesSince(messageId) {
      // Empty log at the time of the bound (`lastMessageId` → null): everything that exists is later.
      try {
        const { messages } = await mcp.call("list-chat-messages", { limit: 100, ...(messageId ? { sinceId: messageId } : {}), flagScope: MODULE_ID });
        return messages ?? [];
      } catch(err) {
        // The bound was deleted in the meantime (card removed by the engine, log cleared): we fall back on its time.
        const since = stamps.get(messageId);
        if ( !/introuvable|not found/i.test(err.message) || (since === undefined) ) throw err;
        const { messages } = await mcp.call("list-chat-messages", { limit: 100, flagScope: MODULE_ID });
        return (messages ?? []).filter(m => (m.timestamp ?? 0) > since);
      }
    },

    /** The chat's last message (to bound "since"). */
    async lastMessageId() {
      const { messages } = await mcp.call("list-chat-messages", { limit: 1 });
      const last = messages?.at(-1) ?? null;
      if ( last ) stamps.set(last.id, last.timestamp ?? 0);
      return last?.id ?? null;
    },

    /** GM console errors since the last call (buffer emptied). The engine's log is followed (`watch`). */
    async clientErrors() {
      const r = await mcp.call("get-client-errors", { levels: ["error", "uncaught", "unhandledrejection"], watch: [MODULE_ID, ...(process.env.SCENARIO_WATCH ?? "").split(",").filter(Boolean)], clear: true, limit: 50 });
      // "id … does not exist in the EmbeddedCollection": BLFX writes on an effect after its animation (Fire Shield:
      // `effect.setFlag(…, "blfxCustom")`, macros/spell/customSpells4.js:709 → utils/light.js:158), sometimes after the
      // scenario or the engine removed it — the race already seen with its regions (SPEC §14.2). Not the engine (2026-09-25).
      // "auraeffects.aura" is not a valid type: `ravenloft` world, PC items made for the Aura Effects module, absent
      // (Alara's Pass without Trace, Kaalisti's "Spiritual Veil"); surveyed at each preparation of the sheet. Not the engine.
      // "Cannot set properties of null (setting 'hidden')" at #postNotification: core chat notification (collapsed chat
      // panel), whose message is deleted during its entry animation (foundry.mjs, ChatLog, `#postNotification` re-reads
      // the element by its id). Seen on 2026-09-26 in `defenses`, chat collapsed. Not the engine.
      // BG3 HUD 0.6.0 with no token selected (`this.actor` null): `getSelectedPassives` (DnD5ePassivesContainer.js:63) and the
      // "End turn" button (DnD5eActionButtonsContainer.js:40) refresh on a combat or level change.
      // Seen on 2026-09-27 in `escaliers` (the core level change deselects the token). Not the engine.
      // Same cause, confirmed on 2026-09-27 by the stack: "Cannot read properties of null (reading 'system')" at
      // `DnD5eInfoContainer.renderAbilitiesHeader` (DnD5eInfoContainer.js:100), by `PortraitContainer.swapTokenContext` ←
      // `BG3Hotbar._softTokenSwapRefresh` ← `UpdateCoordinator._onUpdateToken` (bg3-hud-core 0.6.0), on level change.
      // §435 (user's decision, 2026-11-13): "Invalid Asset blfx02.…" from Sequencer — an image from an absent BLFX pack
      // (Contact Other Plane needs pack 02), like an absent BLFX sound below: not the engine.
      // A third-party module sound that fails to load (BLFX: "Failed to load audio element "modules/blfx-assets-pack01/…""),
      // seen on 2026-09-28 on the replay of `druide` (teleportation of the "Selenic Stride"). Not the engine. Likewise core sounds
      // ("sounds/dice.wav", by the dozens in `malediction` on the full pass of 2026-09-29): client audio, not the engine.
      // A core token animation (foundry.mjs, `#animate` ← `#animateFrame`) interrupted by a level change:
      // "Cannot read properties of undefined (reading 'chain')", seen on 2026-09-28 in `escaliers`. Not the engine.
      // Sequencer and Boss Loot (BLFX) animations launched on a token or effect that the scenario moves, removes or whose
      // effect it removes right away: "Cannot read/set properties of null (reading 'position' | 'rotation', setting 'volume')", the
      // stack IN sequencer.js (`CanvasEffect._createFile`, `PersistentCanvasEffect._createSprite`) or boss-loot-assets-premium
      // (`summonActorAnimation`, customSpells3.js). Seen on 2026-09-29 in `repliques`, `riposte`, `sorts-clerc-druide`,
      // `sorts-codes`, their own checks passing. Decided by the user: ignored here, the modules stay active. Only a
      // "property of null" error whose stack is in these modules: any other error is still counted.
      // "Codec reclaimed due to inactivity": Chromium reclaims the video decoders (WebCodecs) of .webm animations when the
      // Foundry window stays in the background — by the dozens on the full pass of 2026-10-01 (`sorts-lot-1`, `sorts-lot-2`,
      // `tours-de-magie`, `ravenloft-options`), the user working in another window. The browser, not the engine.
      // "Cannot read properties of null (reading 'off')" at PreciseText.destroy (pixi): a canvas text destroyed twice when
      // the GM's view changes level (the canvas is redrawn) while ANOTHER token is moving — the follower, in
      // `suivre` (2026-10-01, §41.3); never with a single token (`escaliers`, `escalier-direct`). The stack stops at pixi: origin
      // not established (rule or label of an animated token), the follower arrives anyway. Not an engine error.
      // "triggerItems is not iterable": `_updateCombat` of boss-loot-assets-premium (hooks.js:779), on the turn change of a
      // combat in which a combatant has just died — seen in `crapaud` (ravenloft, 2026-10-01). Third-party module.
      // "Cannot read properties of null (reading 'querySelector')" at ChatLog5e.updateMessage (dnd5e): the GM's chat log
      // never displayed since the F5 (sidebar collapsed), dnd5e refreshes there the origin card of a roll (`ui.chat.element` null).
      // Seen at every launch of the spell sweep, on 2026-10-22. The system, not the engine.
      // Same cause in Dice So Nice (`ThrowPipeline._revealMessage`, "reading 'querySelector'"): the GM's chat log
      // not displayed, the module looks there for the roll card to reveal. Seen in `audit-pj`, on 2026-10-29. Third-party module.
      // "setCombatVisibility" at the `createCombat` hook ("reading 'querySelector'"): the Simple Timekeeping clock displayed on
      // the GM's side looks for an absent interface element. Environment, on the user's decision (2026-10-28).
      // "reading 'position'" at `set y` then `CanvasAnimation#animateFrame`: a core floating text (`createScrollingText`) animated
      // on an object destroyed by the canvas redraw on level change — `suivre`, 2/2 and already on 0.259.0 (night pass of
      // 2026-10-28). The V14 core, not the engine; ignored on the user's decision (2026-10-29).
      // "reading 'position'" at `set position` ← `Token._refreshPosition`, with no module in the stack: Sequencer 4.3.0,
      // `copySprite` of a dynamic-ring token (`CanvasEffect._createFile`) — it clones the token, draws it, takes a texture from it
      // then destroys the clone, whose pending render flags refresh a destroyed mesh on the next tick. Established by a probe
      // on the bench on 2026-11-15 (BLFX's Mirror Image, `repliques`, on the first cast after a client load only; the
      // canvas token is not touched). Third-party module, same family as above. Only this exact stack is ignored.
      // §389: the same BLFX error reported by the core in the form "[Detected 1 package: boss-loot-assets-premium(…)]".
      const thirdPartyAnimation = /Cannot (read|set) properties of null[\s\S]*(modules\/sequencer\/dist\/sequencer\.js|modules\/boss-loot-assets-premium\/|Detected 1 package: boss-loot-assets-premium)/;
      // 2026-11-25: two Foundry core canvas races, each seen once in a full pass and gone on the replay (`releve-sorts-3`,
      // `sorts-clerc-druide`, 2026-11-24): an animated sprite drawn after its texture was destroyed, and a token mesh refreshed while
      // its texture is not there (token removed by the scenario's clean-up). Only these exact core frames are ignored.
      const coreCanvasRace = /reading 'uvsFloat32'\)[\s\S]*AnimatedSpriteMesh\.calculateVertices|property 'width' of 'this\._texture' as it is null[\s\S]*Token\w*\._refreshMeshSizeAndScale/;
      return (r.entries ?? r.errors ?? r ?? []).filter?.(e => !thirdPartyAnimation.test(e.message ?? e.text ?? ""))
        .filter?.(e => !coreCanvasRace.test(e.message ?? e.text ?? "")).filter?.(e => !/reading 'chain'\)[\s\S]*#animate|Failed to load audio element "(modules\/blfx-|sounds\/)|Codec reclaimed due to inactivity|Invalid Asset blfx\d+\.|triggerItems is not iterable|reading 'off'\)[\s\S]*PreciseText\.destroy|screen resolution|usable window dimensions|ResizeObserver loop|search for 'turn' in undefined|does not exist in the EmbeddedCollection|"auraeffects.aura" is not a valid type|Cannot set properties of null \(setting 'hidden'\)|bg3-hud-dnd5e\/scripts\/components\/containers\/DnD5e(Passives|ActionButtons|Info)Container|ChatLog5e\.updateMessage|reading 'querySelector'\)[\s\S]*ThrowPipeline\._revealMessage|setCombatVisibility[\s\S]*reading 'querySelector'|reading 'position'\)[\s\S]*set y[\s\S]*#animateFrame|reading 'position'\)[\s\S]*at set position[\s\S]*Token\w*\._refreshPosition|DAS debug probe/i.test(e.message ?? e.text ?? "")) ?? [];
    },

    /** The engine's log (`dnd5e-combat |` lines) since the last flush: printed when a scenario fails. */
    async engineLog() {
      const r = await mcp.call("get-client-errors", { levels: ["log", "warn"], limit: 200 });
      return (r.entries ?? r.errors ?? []).map(e => String(e.message ?? e.text ?? "")).filter(m => /dnd5e-combat/.test(m) && !/budget|cibles relâchées|visée|dés 3D|targets released|targeting|3D dice/.test(m));
    },

    /* ---- combat ---- */

    async startCombat(tokens) {
      // At the start of combat, the engine places its basic actions on the players' characters (§15.2):
      // at the end we remove those it placed during the scenario.
      const engineItems = async actorId => ((await mcp.call("get-actor", { actorId })).items ?? [])
        .filter(i => i.flags?.[MODULE_ID]?.basicAction).map(i => i._id);
      const actorIds = [...new Set(tokens.map(t => t.actorId).filter(Boolean))];
      const before = new Map();
      for ( const id of actorIds ) before.set(id, new Set(await engineItems(id)));
      ctx.restore(async () => {
        for ( const id of actorIds ) {
          for ( const itemId of await engineItems(id) ) {
            if ( !before.get(id).has(itemId) ) await mcp.call("remove-embedded-item", { documentType: "Actor", id, itemId });
          }
        }
      });
      const r = await mcp.call("start-combat", { tokenIds: tokens.map(t => t.id), rollInitiative: false });
      // Always THAT combat, by its id: without an id, the connector acts on the ACTIVE combat — that of a game
      // in progress if the GM is playing at the same time (seen on 2026-09-23: a user's combat deleted).
      ctx.ownCombat = r?.id ?? null;
      ctx.restore(() => (ctx.ownCombat ? mcp.call("end-combat", { combatId: ctx.ownCombat }) : null)?.catch?.(() => {}));
      return r;
    },
    ownCombat: null,
    nextTurn: () => mcp.call("next-turn", ctx.ownCombat ? { combatId: ctx.ownCombat } : {}),
    combat: () => mcp.call("get-combat", ctx.ownCombat ? { combatId: ctx.ownCombat } : {})
  };
  return ctx;
}

/* -------------------------------------------- */

const dir = join(import.meta.dirname, "scenarios");
// An argument that is a path (.mjs file or folder) designates scenarios from elsewhere — those another module keeps in its
// own repository (`node tools/scenario.mjs ../autre-module/tools/scenarios`, or a file). The others are names in tools/scenarios/.
const argv = process.argv.slice(2);
// Options: `--list`, and the filters `--grep <mot>`, `--section <§>`, `--scene <nom>` (repeatable); the rest, names or paths.
const filters = { words: [], sections: [], scenes: [] };
const OPTIONS = { "--grep": "words", "-g": "words", "--section": "sections", "--scene": "scenes" };
const listOnly = argv.includes("--list");
const args = [];
for ( let i = 0; i < argv.length; i++ ) {
  if ( argv[i] === "--list" ) continue;
  if ( OPTIONS[argv[i]] ) {
    if ( argv[i + 1] === undefined ) { console.error(`${argv[i]} attend une valeur`); process.exit(2); }
    filters[OPTIONS[argv[i]]].push(argv[++i].replace(/^§/, ""));
  }
  else if ( argv[i].startsWith("--") ) { console.error(`option inconnue : ${argv[i]} (--list, --grep, --section, --scene)`); process.exit(2); }
  else args.push(argv[i]);
}
const filtered = filters.words.length || filters.sections.length || filters.scenes.length;
const external = args.filter(a => existsSync(a) && (statSync(a).isDirectory() || a.endsWith(".mjs"))).map(a => resolve(a));
const wanted = args.filter(a => !external.includes(resolve(a)));
const listed = d => readdirSync(d).filter(f => f.endsWith(".mjs")).sort().map(f => join(d, f));
const files = [
  ...(external.length && !wanted.length ? [] : listed(dir).filter(f => !wanted.length || wanted.includes(basename(f, ".mjs")))),
  ...external.flatMap(p => statSync(p).isDirectory() ? listed(p) : [p])
];
if ( filtered || listOnly ) {
  const kept = files.map(file => ({ file, id: basename(file, ".mjs"), meta: scenarioMeta(readFileSync(file, "utf8")) }))
    .filter(entry => !filtered || matches(entry.id, entry.meta, filters));
  files.length = 0;
  files.push(...kept.map(entry => entry.file));
  if ( listOnly ) {
    for ( const { id, meta } of kept ) console.log(`${id.padEnd(34)} ${(meta.scene || "·").padEnd(24)} ${meta.refs.slice(0, 3).join(" ").padEnd(14)} ${meta.summary.slice(0, 110)}`);
    console.log(`
${kept.length} scénario(s)${filtered ? " retenu(s) par les filtres" : ""}`);
    process.exit(0);
  }
  if ( filtered ) console.log(`Filtres : ${kept.length} scénario(s) — ${kept.map(entry => entry.id).join(", ")}`);
}
if ( !files.length ) {
  console.error(`aucun scénario ${argv.join(" ")} dans ${dir}`);
  process.exit(2);
}

let mcp;
try { mcp = await connect(); }
catch(err) { console.error(err.message); process.exit(2); }

// The bench's player client driver (`players: true`): `ouvrir()`, `evaluer(code, args)`, `fermer()`. Absent outside the bench.
const playerDriver = process.env.BANC_JOUEUR
  ? await import(pathToFileURL(process.env.BANC_JOUEUR).href).catch(err => { console.log(`⚠ client joueur du banc indisponible : ${err.message}`); return null; })
  : null;

/** After the player client closes: the GM no longer sees any connected player (10 s at most), as the following scenarios assume. */
async function playerGone() {
  for ( let i = 0; i < 20; i++ ) {
    const players = await callEngine(mcp, "status").then(r => r?.players).catch(() => null);
    if ( players === 0 ) return true;
    await sleep(500);
  }
  console.log("    ⚠ un joueur paraît encore connecté après la fermeture du client joueur");
  return false;
}

/** Message and start of the stack of a client error, to locate the culprit (engine, system, other module). */
const describeError = e => (e.message ?? e.text ?? "")
  + (e.stack ? "\n        " + String(e.stack).split("\n").filter(l => /\bat\b/.test(l)).slice(0, 12).join("\n        ") : "");

// A combat already there: a game in progress. Scenarios create their own and act only on it (by its id).
{
  const existing = await mcp.call("get-combat", {}).catch(() => null);
  const combats = existing?.combats ?? (existing?.id ? [existing] : []);
  if ( combats.length ) console.log(`⚠ ${combats.length} combat(s) déjà dans le monde : les scénarios n'y touchent pas, ils créent et terminent le leur.`);
}

/**
 * Safety net between two scenarios (added on 2026-09-23, after a Wizard left in contact with the Zombie,
 * at 0 HP, by a suite of scenarios): each token of the scene is surveyed — position, HP, effects — before
 * the scenario, and after its own restoration what moved is put back; effects that appeared are removed.
 * Items too (2026-09-26): an item lent to an UNLINKED token goes on the base actor, but as soon as the engine or dnd5e
 * modifies it through the token (uses, flags), V14 copies a version into the token's delta — removing the item from the
 * base actor leaves it in place. 43 lent items had accumulated this way on the `ravenloft` Wolf.
 * **Vanished** items too (2026-10-01): a neighboring module that makes a thrown weapon leave the hand (Darsh Loot: stuck
 * in the target or fallen in a pile) removed the weapons of `dnd-6` characters — the Fighter's Javelin, a Wizard's Dagger on
 * that day's full pass. An actor item that vanished is returned under its identifier
 * (`api.mcp.restoreItem`), a changed quantity is put back, and a region or tile born during the scenario and left there
 * (a pile on the ground) is removed.
 */
async function snapshotScene(mcp) {
  const { sceneId, objects } = await mcp.call("list-scene-objects", { types: ["Token", "Region", "Tile"] });
  const tokens = [];
  for ( const t of objects.Token ?? [] ) {
    if ( !t.actorId ) continue;
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
    const actor = await mcp.call("get-actor", { actorId: data.actorId });
    tokens.push({
      id: t.id, name: t.name, linked: !!data.actorLink, actorId: data.actorId,
      pos: { x: data.x, y: data.y, elevation: data.elevation ?? 0, level: data.level ?? null },
      hp: data.actorLink ? (actor?.system?.attributes?.hp?.value ?? null) : (data.delta?.system?.attributes?.hp?.value ?? null),
      // The maximum carried by an unlinked token's delta (null: the sheet's) — scenarios that "harden" the Bandit
      // write it (300); not restored, it stayed at 200 and skewed "unharmed" in the following ones (seen on 2026-10-26).
      hpMax: data.actorLink ? null : (data.delta?.system?.attributes?.hp?.max ?? null),
      effects: new Set((data.actorLink ? (actor?.effects ?? []) : (data.delta?.effects ?? [])).map(e => e._id)),
      // §84: the remaining spell slots of a linked actor (scenarios that consume emptied the Cleric's).
      spells: data.actorLink ? Object.fromEntries(Object.entries(actor?.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? null])) : null,
      items: new Set((actor?.items ?? []).map(i => i._id)),
      // The actor's item data, to return the one that vanishes and put a quantity back.
      itemData: new Map((actor?.items ?? []).map(i => [i._id, i])),
      deltaItems: new Set((data.delta?.items ?? []).map(i => i._id))
    });
  }
  return { sceneId, tokens, regions: new Set((objects.Region ?? []).map(r => r.id)), tiles: new Set((objects.Tile ?? []).map(t => t.id)) };
}

/**
 * §319: a token left at 0 HP in the world (Dead, Unconscious) — the safety net restores the HP surveyed before each scenario, 0
 * included, so a token that fell outside the net stayed dead from one scenario to the next (the `dnd-6` Bandit, from 2026-10-30 to
 * 2026-11-01: Sleep and "Howl" held it as "unaffected", two defects opened wrongly; the Wizard at 0 HP: `empoignade`).
 * Reported with the preceding scenario, then restored to its maximum, without Dead or Unconscious, BEFORE the net's survey:
 * it is the world that is repaired, not only the scenario.
 */
async function standUpDowned(mcp, ctx, previousName) {
  const { objects } = await mcp.call("list-scene-objects", { types: ["Token"] }).catch(() => ({ objects: {} }));
  for ( const t of objects.Token ?? [] ) {
    if ( !t.actorId ) continue;
    if ( ARENE_INVOCATIONS.corpses.includes(t.name) ) continue;   // §393: the arena's corpses are dead on purpose
    const stats = await ctx.engine("stats", { tokenId: t.id }).catch(() => null);
    const max = stats?.hp?.max;
    if ( !Number.isFinite(max) || (max <= 0) || !(Number(stats.hp.value) <= 0) ) continue;
    await ctx.setHp(t, max).catch(() => {});
    for ( const status of ["dead", "unconscious"] ) await ctx.removeStatusEffects(t, status).catch(() => {});
    console.log(`    ⚠ ${t.name} était à 0 PV dans le monde${previousName ? ` (après « ${previousName} »)` : ""} : relevé à ${max} PV`);
  }
}

async function restoreScene(mcp, snap) {
  const fixed = [];
  const seenActors = new Set();
  for ( const t of snap.tokens ) {
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id }).catch(() => ({}));
    if ( !data ) continue;
    const away = d => (d.x !== t.pos.x) || (d.y !== t.pos.y) || ((d.elevation ?? 0) !== t.pos.elevation) || ((d.level ?? null) !== t.pos.level);
    if ( away(data) ) {
      // Re-read afterwards, a new attempt: tokens stayed elsewhere without it being seen (the Rogue and the Wizard,
      // surveyed outside their cell on 2026-09-28). A failure is reported, so we know which scenario and which token.
      let now = data;
      for ( let attempt = 0; (attempt < 2) && away(now); attempt++ ) {
        await mcp.call("move-token", { tokenId: t.id, x: t.pos.x, y: t.pos.y, elevation: t.pos.elevation, ...(t.pos.level ? { levelId: t.pos.level } : {}) }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 600));
        now = (await mcp.call("get-scene-object", { type: "Token", objectId: t.id }).catch(() => ({}))).data ?? now;
      }
      fixed.push(away(now) ? `${t.name} NON replacé (${now.x} × ${now.y} au lieu de ${t.pos.x} × ${t.pos.y})` : `${t.name} replacé`);
    }
    if ( t.linked && seenActors.has(t.actorId) ) continue;
    seenActors.add(t.actorId);
    const actor = t.linked ? await mcp.call("get-actor", { actorId: t.actorId }) : null;
    const hp = t.linked ? actor?.system?.attributes?.hp?.value : data.delta?.system?.attributes?.hp?.value;
    if ( (t.hp !== null) && (hp !== t.hp) ) {
      if ( t.linked ) await mcp.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.hp.value": t.hp } });
      else await mcp.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.value": t.hp } });
      fixed.push(`${t.name} PV ${hp} → ${t.hp}`);
    } else if ( (t.hp === null) && !t.linked && (hp !== null) && (hp !== undefined) ) {
      // §82: unlinked token that inherited its sheet's HP; the scenario wrote some in its delta — we remove them.
      await mcp.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.-=value": null } });
      fixed.push(`${t.name} PV ${hp} → ceux de la fiche`);
    }
    const hpMax = t.linked ? null : (data.delta?.system?.attributes?.hp?.max ?? null);
    if ( !t.linked && (hpMax !== t.hpMax) ) {
      const change = (t.hpMax === null) ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": t.hpMax };
      await mcp.call("update-scene-object", { type: "Token", objectId: t.id, data: change });
      fixed.push(`${t.name} PV max ${hpMax} → ${t.hpMax ?? "ceux de la fiche"}`);
    }
    if ( t.spells && actor ) {
      const changed = Object.entries(t.spells).filter(([k, v]) => (v !== null) && ((actor.system?.spells?.[k]?.value ?? null) !== v));
      if ( changed.length ) {
        await mcp.call("update-actor", { actorId: t.actorId, actorData: Object.fromEntries(changed.map(([k, v]) => [`system.spells.${k}.value`, v])) });
        fixed.push(`${t.name} : emplacements ${changed.map(([k, v]) => `${k} → ${v}`).join(", ")}`);
      }
    }
    const effects = t.linked ? (actor?.effects ?? []) : (data.delta?.effects ?? []);
    const target = t.linked ? { documentType: "Actor", id: t.actorId } : { uuid: `Scene.${snap.sceneId}.Token.${t.id}.Actor.${t.actorId}` };
    // Aura copies come and go with positions (the engine recreates them): not in the net.
    for ( const e of effects.filter(e => !t.effects.has(e._id) && !e.flags?.[MODULE_ID]?.aura) ) {
      await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});
      fixed.push(`${t.name} : effet « ${e.name} » retiré`);
    }
    // Items that appeared: on the actor (linked, or base actor of an unlinked token), then in an unlinked token's delta.
    const base = actor ?? await mcp.call("get-actor", { actorId: t.actorId }).catch(() => null);
    for ( const i of (base?.items ?? []).filter(i => !t.items.has(i._id)) ) {
      await mcp.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: i._id }).catch(() => {});
      fixed.push(`${t.name} : item « ${i.name} » retiré`);
    }
    // Items vanished from the actor, changed quantities (thrown weapon that a neighboring module makes leave the hand).
    const present = new Map((base?.items ?? []).map(i => [i._id, i]));
    for ( const [id, before] of t.itemData ?? [] ) {
      const now = present.get(id);
      if ( !now ) {
        const { folder, ownership, _stats, ...itemData } = before;
        const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn: "restoreItem", args: { actorId: t.actorId, itemData }, waitMs: 8000 }).catch(err => ({ error: err.message }));
        fixed.push(r?.result?.restored ? `${t.name} : item « ${before.name} » rendu` : `${t.name} : item « ${before.name} » NON rendu (${r?.error ?? "sans réponse"})`);
      } else if ( (before.system?.quantity !== undefined) && (now.system?.quantity !== before.system.quantity) ) {
        await mcp.call("upsert-actor-item", { actorId: t.actorId, itemData: { "system.quantity": before.system.quantity }, match: { path: "_id", value: id } }).catch(() => {});
        fixed.push(`${t.name} : « ${before.name} » quantité ${now.system?.quantity} → ${before.system.quantity}`);
      }
    }
    if ( !t.linked ) {
      const baseIds = new Set((base?.items ?? []).map(i => i._id));
      for ( const i of (data.delta?.items ?? []).filter(i => !t.deltaItems.has(i._id) && !baseIds.has(i._id)) ) {
        await mcp.call("remove-embedded-item", { ...target, itemId: i._id }).catch(() => {});
        fixed.push(`${t.name} : item « ${i.name} » retiré du token`);
      }
    }
  }
  // Regions and tiles born during the scenario and left there (a neighboring module's pile): the region first, its chest goes
  // with it.
  if ( snap.regions && snap.tiles ) {
    for ( const [kind, known] of [["Region", snap.regions], ["Tile", snap.tiles]] ) {
      const { objects } = await mcp.call("list-scene-objects", { types: [kind] }).catch(() => ({ objects: {} }));
      for ( const o of (objects?.[kind] ?? []).filter(o => !known.has(o.id)) ) {
        await mcp.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
        fixed.push(`${kind === "Region" ? "région" : "tuile"} « ${o.name ?? o.id} » retirée`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if ( fixed.length ) console.log(`    ↺ filet de sécurité : ${fixed.join(" ; ")}`);
}

// §83: each scenario's scene. In a world that has the test arena (`dnd-6`), a scenario plays there, except `scene: "keep"`
// (floors, stairs: Restored Keep); the starting active scene is restored at the end. Without an arena, the active scene, as before.
const scenes = await mcp.call("list-scenes", {}).catch(() => []);
const sceneList = Array.isArray(scenes) ? scenes : (scenes.scenes ?? []);
// `ARENE=0`: without the arena (the active scene), for comparison.
const arenaScene = (process.env.ARENE === "0") ? null : (sceneList.find(s => s.name === ARENA.name) ?? null);
const keepScene = sceneList.find(s => s.id === RESTORED_KEEP.scene) ?? null;
/** A scenario's named scene (`scene`: a name or an id, other than "keep"), or null. */
const namedScene = name => sceneList.find(s => (s.name === name) || (s.id === name)) ?? null;
const activeAtStart = sceneList.find(s => s.active)?.id ?? null;
let activeNow = activeAtStart;

/** Activates a scene and waits for the GM's client to display it. */
async function useScene(id) {
  if ( !id ) return;
  // The scene DISPLAYED on the GM's side, not just the active one: the GM may be looking at a scene other than the active one (seen
  // on 2026-10-22: sweep played against the displayed test Arena, while the Spell Arena was active).
  const viewed = (await mcp.call("list-scene-objects", { types: ["Token"] }).catch(() => ({}))).sceneId;
  if ( (activeNow === id) && (viewed === id) ) return;
  await mcp.call("activate-scene", { sceneId: id });
  if ( activeNow === id ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "viewScene", args: { sceneId: id }, waitMs: 8000 }).catch(() => null);
  for ( let i = 0; i < 30; i++ ) {
    await sleep(500);
    const { sceneId } = await mcp.call("list-scene-objects", { types: ["Token"] }).catch(() => ({}));
    if ( sceneId === id ) break;
  }
  await sleep(2500);   // the GM's canvas draws (vision, regions) before the engine reads anything from it
  activeNow = id;
  console.log(`    ⇄ scène : ${sceneList.find(s => s.id === id)?.name ?? id}`);
}

/** In the arena, each token of the staging at its place, on the ground. The Spell Arena gives its positions in cells. */
async function arrangeArena(layout=ARENA) {
  const { objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
  for ( const t of objects.Token ?? [] ) {
    const cell = layout.tokens[t.name];
    const at = cell && layout.grid ? cell.map(c => c * layout.grid) : cell;
    if ( !at ) continue;
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
    if ( (data.x === at[0]) && (data.y === at[1]) && !(data.elevation ?? 0) ) continue;
    await mcp.call("move-token", { tokenId: t.id, x: at[0], y: at[1], elevation: 0 }).catch(err => console.log(`    ! ${t.name} non replacé : ${err.message}`));
    await sleep(300);
  }
}

let failed = 0;
// 2026-11-14: scenarios held with NO check of their own (`ctx.expect`, apart from "no error in the console") — usually a
// "not applicable": a token, a scene, a module is missing. They stay "✓ scenario held" so that the bench and the comparison of
// passes read them as before, but the line says so ("nothing checked … not applicable", which the bench lists separately)
// and the total counts them.
const empty = [];
let skipped = 0;
// The state left by the previous scenario, once put back in place: a token that moved BETWEEN two scenarios (a delayed engine
// movement, after the safety net) is reported naming that scenario, and put back. The Wizard and the Rogue ended up
// outside their cell without the net seeing it (2026-09-28).
let previous = null;
// §182: the scenarios assume 360° vision out of combat; vision cones are turned off for the duration of the pass (the scenario
// `cones` turns them back on itself), then restored.
const cones = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "visionCones", value: false }, waitMs: 8000 })
  .then(r => r?.result?.before).catch(() => undefined);
// §274: the ammunition choice window would wait for an answer on the GM's side — turned off for the pass (the scenario `munitions`
// turns it back on itself).
const ammoPrompt = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "ammoPrompt", value: false }, waitMs: 8000 })
  .then(r => r?.result?.before).catch(() => undefined);
// §185: likewise, the 2024 rules' Stealth (the scenario `furtivite-bg3` switches to BG3 itself).
const stealthRules = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "stealthRules", value: "2024" }, waitMs: 8000 })
  .then(r => r?.result?.before).catch(() => undefined);
// §224: the climbing, jumping, falling and flying scenarios assume the climbing-and-falling system is on; the GM may have
// turned it off at their table (token bar button) — seen on 2026-10-23: 16 scenarios failing. Turned on for the pass, then
// restored.
const climbSystem = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "climbSystem", value: true }, waitMs: 8000 })
  .then(r => r?.result?.before).catch(() => undefined);
// 2026-10-26: two table choices that the scenarios do not assume — Sneak Attack "ask" (`roublard` waits for the Cunning Strike
// question, not the choice one; `roublard-choix` switches to "ask" itself) and combat windows shorter than
// the default 10 s (a reaction closed before the scenario's answer). Set to their default for the pass, then restored.
// §251: the engine's real-time clock, like Simple Timekeeping further down, stopped for the pass.
// §369: flanking (house rule) would give an Advantage that the other scenarios do not assume: turned off for the pass.
// §389 (issue #38): the engine state that all scenarios assume — Theater of the Mind off (when on, the engine stays silent:
// an engine choice window did not open and the defect was believed to be in the engine), use without a window by default.
// Set for the duration of the pass, restored afterwards; what was otherwise is stated at the head of the pass. The automation
// level, however, reloads the world when it changes (`requiresReload`): it is only reported if it is not "Full".
/** §393: physical item types (equippable, attunable) — a spell or a feature is not equipped. */
const PHYSICAL = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
/** Read / write by dotted path on plain data (no `foundry.utils` outside Foundry). */
const foundry_get = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
function foundry_set(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

const PINNED = { sneakAttackMode: "auto", combatWindowSeconds: 10, realTimeClock: false, flanking: "off",
  theaterOfMind: false, autoUsage: true, zoneChoice: "never", refusalMode: "level", reactionPrompts: "level", damageFlow: "level" };
const pinned = {};
for ( const [key, value] of Object.entries(PINNED) ) {
  pinned[key] = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key, value }, waitMs: 8000 })
    .then(r => r?.result?.before).catch(() => undefined);
}
{
  const unusual = Object.entries(pinned).filter(([key, before]) => (before !== undefined) && (JSON.stringify(before) !== JSON.stringify(PINNED[key])))
    .map(([key, before]) => `${key} ${JSON.stringify(before)} → ${JSON.stringify(PINNED[key])}`);
  const client = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "status", args: {}, waitMs: 8000 }).then(r => r?.result).catch(() => null);
  console.log(`Préconditions : client du MJ ${client?.lang ?? "?"}, ${client?.players ?? "?"} joueur(s) connecté(s)`
    + (unusual.length ? ` ; remis pour la passe : ${unusual.join(", ")}` : " ; réglages du moteur à leur valeur de passe"));
  if ( client?.players ) console.log("  ⚠ des joueurs sont connectés : un clic de leur part peut fermer une fenêtre attendue par un scénario");
  const level = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "automationLevel" }, waitMs: 8000 })
    .then(r => r?.result?.now).catch(() => null);
  if ( level && (level !== "full") ) console.log(`  ⚠ niveau d'automatisation « ${level} » : les scénarios supposent « full » (Complet) ; beaucoup échoueront`);
}
// Gap survey (2026-10-22): a clock that advances world time out of combat (Simple Timekeeping of `dnd-6`: 600 s per
// interval) makes a concentration or a one-minute effect expire in a few seconds, which dnd5e removes out of combat — 61 false
// "not concentrating" on the first spell sweep. It is stopped for the pass (its `paused` setting), then restored.
const clock = await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "foreignSetting", args: { namespace: "simple-timekeeping", key: "paused", value: true }, waitMs: 8000 })
  .then(r => (r?.result?.absent ? undefined : r?.result?.before)).catch(() => undefined);
for ( const file of files ) {
  const { default: scenario } = await import(pathToFileURL(file).href);
  const named = wanted.length || external.includes(file);
  // A scenario that waits for a GM click (`interactive`), or a diagnostic that surveys without checking (`audit`),
  // is only played when named.
  if ( (scenario.interactive || scenario.audit) && !named ) {
    console.log(`\n· ${scenario.name ?? basename(file)} : ${scenario.audit ? "diagnostic" : "interactif"}, sauté (le nommer pour le jouer)`);
    skipped++;
    continue;
  }
  console.log(`\n▶ ${scenario.name ?? basename(file)}`);
  // `scene: "<nom>"` (other than "keep"): the scene of that name, wherever it is ("metres", "Redbrand Hideout [30x20]"); absent,
  // the scenario is not applicable.
  const own = (scenario.scene && (scenario.scene !== "keep")) ? namedScene(scenario.scene) : null;
  if ( scenario.scene && (scenario.scene !== "keep") && !own ) { console.log(`    scène « ${scenario.scene} » absente : non applicable`); skipped++; continue; }
  if ( scenario.players && !playerDriver ) { console.log("    client joueur absent (seul le banc de test en ouvre un) : non applicable"); skipped++; continue; }
  if ( own ) {
    if ( own.id !== activeNow ) previous = null;
    await useScene(own.id);
    // The arenas whose positions are in cells: each token put back at its place before the scenario.
    const layout = [ARENE_SORTS, ARENE_PRIX, ARENE_INVOCATIONS, ARENE_VISION, ARENE_REFUS, ARENE_ABJURATION].find(l => l.name === own.name);
    if ( layout ) await arrangeArena(layout);
  }
  else if ( arenaScene ) {
    const target = (scenario.scene === "keep") ? keepScene : arenaScene;
    if ( target ) {
      if ( target.id !== activeNow ) previous = null;   // the state left in the other scene is not compared
      await useScene(target.id);
      if ( target === arenaScene ) await arrangeArena();
    }
  }
  const ctx = makeContext(mcp);
  if ( scenario.players ) ctx.asPlayer = (code, args=null) => playerDriver.evaluer(code, args);
  let ownChecks = 0;
  if ( previous ) {
    const now = await snapshotScene(mcp).catch(() => null);
    const moved = (now?.tokens ?? []).filter(t => {
      const before = previous.snap.tokens.find(b => b.id === t.id);
      return before && ((before.pos.x !== t.pos.x) || (before.pos.y !== t.pos.y) || (before.pos.elevation !== t.pos.elevation) || (before.pos.level !== t.pos.level));
    });
    if ( moved.length ) {
      console.log(`    ⚠ entre « ${previous.name} » et ce scénario, des tokens ont bougé : ${moved.map(t => {
        const b = previous.snap.tokens.find(x => x.id === t.id).pos;
        return `${t.name} (${b.x} × ${b.y} → ${t.pos.x} × ${t.pos.y})`;
      }).join(", ")} — remis`);
      await restoreScene(mcp, previous.snap).catch(err => console.log(`    ! filet de sécurité : ${err.message}`));
    }
  }
  await standUpDowned(mcp, ctx, previous?.name ?? null);
  const snap = await snapshotScene(mcp);
  // Sequencer effects and sounds from before the scenario: those born during it (BLFX animations, looping sounds) are ended
  // after restoration.
  const seq0 = await ctx.engine("sequencer").catch(() => null);
  try {
    await ctx.clientErrors();   // vide le tampon
    if ( scenario.players ) {
      const t0 = Date.now();
      await playerDriver.ouvrir();
      console.log(`    client joueur ouvert (${Math.round((Date.now() - t0) / 1000)} s)`);
    }
    await scenario.run(ctx);
    ownChecks = ctx.checks;
    if ( ctx.failures.length ) for ( const line of await ctx.engineLog() ) console.log(`      · ${line.slice(0, 200)}`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(describeError).join(" | ").slice(0, 1500)}` : ""}`);
  } catch(err) {
    console.log(`    ✗ interrompu : ${err.message}`);
    ctx.failures.push(err.message);
  } finally {
    if ( scenario.players ) {
      await playerDriver.fermer().catch(err => console.log(`    ! client joueur : ${err.message}`));
      if ( await playerGone() ) console.log("    client joueur fermé");
    }
    await ctx.undoAll();
    await sleep(1500);   // the restoration's removals (auras, conditions) propagate
    await restoreScene(mcp, snap).catch(err => console.log(`    ! filet de sécurité : ${err.message}`));
    if ( seq0?.available ) {
      const now = await ctx.engine("sequencer").catch(() => null);
      const effects = (now?.effects ?? []).filter(e => !seq0.effects.some(x => x.id === e.id)).map(e => e.id);
      const sounds = (now?.sounds ?? []).filter(s => !seq0.sounds.some(x => x.id === s.id)).map(s => s.id);
      if ( effects.length || sounds.length ) {
        await ctx.engine("sequencer", { end: { effects, sounds } }).catch(err => console.log(`    ! Sequencer : ${err.message}`));
        console.log(`    ↺ Sequencer : ${effects.length} effet(s), ${sounds.length} son(s) laissés par le scénario, terminés`);
      }
    }
    previous = { name: scenario.name ?? basename(file), snap };
  }
  if ( ctx.failures.length ) failed++;
  if ( !ctx.failures.length && !ownChecks ) empty.push(basename(file, ".mjs"));
  console.log(ctx.failures.length ? `  ✗ ${ctx.failures.length} vérification(s) en défaut`
    : ownChecks ? `  ✓ scénario tenu (${ownChecks} vérification${ownChecks > 1 ? "s" : ""})`
    : "  ✓ scénario tenu — rien vérifié (0 vérification jouée : non applicable)");
}
if ( activeAtStart && (activeNow !== activeAtStart) ) await useScene(activeAtStart);
if ( stealthRules !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "stealthRules", value: stealthRules }, waitMs: 8000 }).catch(() => null);
if ( cones !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "visionCones", value: cones }, waitMs: 8000 }).catch(() => null);
if ( ammoPrompt !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "ammoPrompt", value: ammoPrompt }, waitMs: 8000 }).catch(() => null);
for ( const [key, value] of Object.entries(pinned) ) {
  if ( value !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key, value }, waitMs: 8000 }).catch(() => null);
}
if ( climbSystem !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setting", args: { key: "climbSystem", value: climbSystem }, waitMs: 8000 }).catch(() => null);
if ( clock !== undefined ) await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "foreignSetting", args: { namespace: "simple-timekeeping", key: "paused", value: clock }, waitMs: 8000 }).catch(() => null);
console.log(`\n${files.length - skipped - failed}/${files.length - skipped} scénario(s) tenus${skipped ? ` (${skipped} interactif(s) ou diagnostic(s) sauté(s))` : ""}`
  + (empty.length ? ` ; dont ${empty.length} sans rien vérifié : ${empty.join(", ")}` : ""));
process.exitCode = failed ? 1 : 0;
await mcp.close();
