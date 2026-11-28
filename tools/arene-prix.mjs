#!/usr/bin/env node
/**
 * Issue #32: sets up (or restores) the "Success at a Cost Arena" of a test world, through the connector — the scene of the scenario
 * `succes-a-un-prix` and hand trials: a player character (the Handbook's pregenerated Fighter, weapons kept), a Dummy
 * that does not die (999 HP, AC 15), an NPC Caster without items (Sacred Flame lent by the scenario, Wisdom 20).
 *
 *   node tools/arene-prix.mjs          creates what is missing, resets actors and tokens to their reference state
 *
 * Idempotent: an actor or the scene is found by its name; nothing outside its folder is touched.
 */
import { connect } from "./lib/connector.mjs";
import { ARENE_PRIX } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène du succès à un prix";

const ACTORS = {
  "Héros du prix": { pack: PHB, base: "phbprgFighter000", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 300, max: 300 } } } },
  "Mannequin": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" } } } },
  "Lanceur du prix": { base: "mmArchmage000000", disposition: -1, system: {
    abilities: { wis: { value: 20 }, int: { value: 20 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "wis", spell: { level: 20 } }, details: { cr: 12 } } }
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
  const folder = await mcp.call("create-folder", { name: FOLDER, type: "Actor" });
  const folderId = folder.id ?? folder.folderId ?? folder.folder?.id;
  const listed = await mcp.call("list-actors", {});
  const existing = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) ?? [];
  const ids = {};
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    const { data } = await mcp.call("get-compendium-entry", { uuid: (spec.pack ?? MM) + spec.base });
    const { _id, folder: f, ownership, _stats, items, effects, ...rest } = data;
    const actorData = merge(rest, { name, system: spec.system, prototypeToken: { name, actorLink: true, disposition: spec.disposition,
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
      const system = race ? merge(structuredClone(spec.system), { details: { race: race._id ?? race.id } }) : spec.system;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, prototypeToken: actorData.prototypeToken } });
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === ARENE_PRIX.name);
  const { cols, rows, grid } = ARENE_PRIX;
  const sceneData = {
    backgroundColor: "#4a4438", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: "prix" } }
  };
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: ARENE_PRIX.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${ARENE_PRIX.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // A single level, without a ceiling (the level created by default caps at 20 ft: §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(ARENE_PRIX.tokens) ) {
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
  console.log(`arène prête : ${ARENE_PRIX.name} (${scene.id})`);
}
finally { await mcp.close?.(); }
