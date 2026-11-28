#!/usr/bin/env node
/**
 * Issue #44 (§408): sets up (or restores) the "Refusals Arena" of a test world, through the connector — the scene of the scenario
 * `regle-forcee` and hand trials of the legality check's refusals (window, "Use anyway", GM alert). The level 1
 * Player's Handbook pregenerated characters, their items kept, as player characters owned by `claude player` (the
 * player side is checked in the built-in browser): Mage (Wizard), Cleric (mace and shield in hand), Fighter (two-handed sword).
 * A hostile Dummy that does not die (999 HP, AC 15) in melee with the Mage; a Distant Target at 155 ft.
 *
 *   node tools/arene-refus.mjs         creates what is missing, resets actors and tokens to their reference state
 *
 * Idempotent: an actor or the scene is found by its name; nothing outside its folder is touched.
 */
import { connect } from "./lib/connector.mjs";
import { ARENE_REFUS } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène des refus";
/** The test player of `dnd-6`: owner of the characters, to check the window on their side. */
const PLAYER = "claude player";

const HP = { attributes: { hp: { value: 300, max: 300 } } };
const ACTORS = {
  "Mage des refus": { pack: PHB, base: "phbprgWizard0000", keepItems: true, disposition: 1, player: true, system: HP },
  "Clerc des refus": { pack: PHB, base: "phbprgCleric0000", keepItems: true, disposition: 1, player: true, system: HP },
  "Guerrier des refus": { pack: PHB, base: "phbprgFighter000", keepItems: true, disposition: 1, player: true, system: HP },
  "Mannequin des refus": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" } } } },
  "Cible lointaine des refus": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" } } } }
};

const merge = (a, b) => {
  for ( const [k, v] of Object.entries(b) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) ) a[k] = merge(a[k] && (typeof a[k] === "object") ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};

const mcp = await connect();
try {
  const players = await mcp.call("list-players", {});
  const playerId = (Array.isArray(players) ? players : []).find(u => u.name === PLAYER)?.id ?? null;
  if ( !playerId ) console.log(`joueur « ${PLAYER} » absent : personnages au MJ seulement`);
  const folder = await mcp.call("create-folder", { name: FOLDER, type: "Actor" });
  const folderId = folder.id ?? folder.folderId ?? folder.folder?.id;
  const listed = await mcp.call("list-actors", {});
  const existing = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) ?? [];
  const ids = {};
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    const { data } = await mcp.call("get-compendium-entry", { uuid: (spec.pack ?? MM) + spec.base });
    const { _id, folder: f, ownership: _owners, _stats, items, effects, ...rest } = data;
    const ownership = (spec.player && playerId) ? { default: 0, [playerId]: 3 } : { default: 0 };
    const actorData = merge(rest, { name, ownership, system: spec.system, prototypeToken: { name, actorLink: true, disposition: spec.disposition,
      displayName: 30, appendNumber: false, prependAdjective: false } });
    const baseItems = items ?? [];
    actorData.items = spec.keepItems ? baseItems : [];
    actorData.effects = [];
    const found = existing.find(a => (a.name === name) && (a.folderId === folderId));
    if ( found ) {
      // Reset to the reference state: HP, no item or effect left by an interrupted scenario.
      const actor = await mcp.call("get-actor", { actorId: found.id });
      const own = new Set(baseItems.map(i => `${i.type}|${i.name}`));
      for ( const i of actor.items ?? [] ) {
        if ( spec.keepItems && own.has(`${i.type}|${i.name}`) ) continue;
        await mcp.call("remove-embedded-item", { documentType: "Actor", id: found.id, itemId: i._id ?? i.id });
      }
      for ( const e of actor.effects ?? [] ) await mcp.call("remove-embedded-effect", { documentType: "Actor", id: found.id, effectId: e._id ?? e.id });
      // A character's species, designated by id (`details.race`): realigned on the sheet's species item.
      const race = spec.keepItems ? (actor.items ?? []).find(i => i.type === "race") : null;
      const system = race ? merge(structuredClone(spec.system), { details: { race: race._id ?? race.id } }) : structuredClone(spec.system);
      // The pregenerated character's spell slots reset (a scenario may have emptied them).
      if ( rest.system?.spells ) system.spells = rest.system.spells;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, ownership, prototypeToken: actorData.prototypeToken } });
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  // The connector's `create-actor` / `update-actor` do not set `ownership`: the test player becomes owner through a script.
  if ( playerId ) {
    const names = Object.entries(ACTORS).filter(([, spec]) => spec.player).map(([name]) => name);
    await mcp.call("run-script", { code: `for ( const id of ${JSON.stringify(names.map(n => ids[n]))} ) await game.actors.get(id)?.update({ ownership: { ${JSON.stringify(playerId)}: 3 } }); return true;` })
      .catch(err => console.log(`propriété du joueur : ${err.message} (réglage « Outils de test » requis)`));
  }

  // Full spell slots: the pregenerated character stores `value` at 0, dnd5e computes the maximum (a scenario may have
  // emptied them too).
  await mcp.call("run-script", { code: `for ( const id of ${JSON.stringify(Object.values(ids))} ) { const a = game.actors.get(id); if ( !a?.system?.spells ) continue;
    const u = {}; for ( const [k, s] of Object.entries(a.system.spells) ) if ( s?.max ) u[\`system.spells.\${k}.value\`] = s.max; if ( Object.keys(u).length ) await a.update(u); } return true;` })
    .catch(err => console.log(`emplacements : ${err.message} (réglage « Outils de test » requis)`));

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === ARENE_REFUS.name);
  const { cols, rows, grid } = ARENE_REFUS;
  const sceneData = {
    backgroundColor: "#3c4a44", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: "refus" } }
  };
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: ARENE_REFUS.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${ARENE_REFUS.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // A single level, without a ceiling (the level created by default caps at 20 ft: §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(ARENE_REFUS.tokens) ) {
    const x = cx * grid, y = cy * grid;
    const found = tokens.find(t => t.name === name);
    if ( found ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: found.id, data: { x, y, elevation: 0, ...(level?.id ? { level: level.id } : {}) } });
    else {
      const r = await mcp.call("place-token", { sceneId: scene.id, actorId: ids[name], x, y });
      const tokenId = r.id ?? r.tokenId ?? r.token?.id;
      if ( level?.id && tokenId ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: tokenId, data: { x, y, level: level.id } });
      console.log(`token « ${name} » posé`);
    }
  }
  console.log(`arène prête : ${ARENE_REFUS.name} (${scene.id})`);
}
finally { await mcp.close?.(); }
