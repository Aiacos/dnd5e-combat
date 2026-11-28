#!/usr/bin/env node
/**
 * Issue #42: sets up (or resets) the "Vision Arena" of a test world, through the connector — a flat scene in full
 * light for judging vision: observers with different senses, owned by `claude player` (to see the scene through their eyes
 * in the built-in browser), and targets in, behind and far from the Darkness cast by the `vision-tenebres` scenario.
 *
 *   node tools/arene-vision.mjs     creates what is missing, resets actors, items and tokens to their reference state
 *
 * Observers: Human (pre-made Druid from the Player's Handbook, Human species: no Darkvision), Devil's Sight Warlock (pre-made
 * Warlock, gnome: Darkvision 60 ft; + the Devil's Sight invocation from the Handbook and the Darkness spell, at will, to cast it
 * from the sheet), Elf Ranger (pre-made Ranger, wood elf: Darkvision 60 ft), Truesight (commoner, 120 ft),
 * Blindsight (commoner, 30 ft), Vibrations (commoner, 60 ft), Sense All and See Invisible (commoners, core modes "Sense All" and
 * "See Invisibility" at 120 ft set on the token). Targets: hostile commoners with 999 HP, one of them Invisible.
 * Positions: `ARENE_VISION` (tools/lib/stages.mjs).
 *
 * What is read afterwards: `api.mcp.visionMatrix` (rules + screen through each observer's eyes, on the GM's side)
 * and `api.mcp.screenHere` (what the current client shows, on a player's side).
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_VISION } from "./lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.actors.";
const DEVILS_SIGHT = "Compendium.dnd-players-handbook.classes.phbinvDevilsSigh";
const DARKNESS = { uuid: "Compendium.dnd-players-handbook.spells.phbsplDarkness00", system: { method: "atwill", prepared: 1 } };
const OWNERS = ["claude player"];
// The view enabled on each observer: without it, a token gives no vision source (the GM who controls it would see everything, a
// player would see nothing through it); dnd5e projects the sheet's senses onto it (`senseVisionSync`).
const SIGHT = { sight: { enabled: true } };
const sturdy = { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } };
const senses = ranges => ({ ...sturdy, attributes: { ...sturdy.attributes, senses: { ranges } } });

const ACTORS = {
  "Humain": { pack: PHB, base: "phbprgDruid00000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, system: { attributes: { hp: { value: 300, max: 300 } } } },
  "Occultiste du diable": { pack: PHB, base: "phbprgWarlock000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, items: [DEVILS_SIGHT, DARKNESS],
    // The pact slot given back at each reset: Hex ("a creature you can see") is used to judge the target refusal.
    system: { attributes: { hp: { value: 300, max: 300 } }, spells: { pact: { value: 1 } } } },
  "Rôdeur elfe": { pack: PHB, base: "phbprgRanger0000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, system: { attributes: { hp: { value: 300, max: 300 } } } },
  "Vision véritable": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, token: SIGHT, system: senses({ truesight: 120 }) },
  "Vision aveugle": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, token: SIGHT, system: senses({ blindsight: 30 }) },
  "Vibrations": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, token: SIGHT, system: senses({ tremorsense: 60 }) },
  // Two generic core modes, which no dnd5e sheet provides: set on the token (client/config.mjs:1307-1337).
  "Sens tout": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, system: sturdy,
    token: { sight: { enabled: true }, detectionModes: { senseAll: { enabled: true, range: 120 } } } },
  "Voir l'invisible": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, system: sturdy,
    token: { sight: { enabled: true }, detectionModes: { seeInvisibility: { enabled: true, range: 120 } } } },
  "Cible dans les ténèbres": { base: "mmCommoner000000", disposition: -1, system: sturdy },
  "Cible dans le noir": { base: "mmCommoner000000", disposition: -1, system: sturdy },
  "Cible invisible": { base: "mmCommoner000000", disposition: -1, system: sturdy, statuses: ["invisible"] },
  "Cible derrière les ténèbres": { base: "mmCommoner000000", disposition: -1, system: sturdy },
  "Cible au loin": { base: "mmCommoner000000", disposition: -1, system: sturdy }
};

// Global light only illuminates up to a darkness of 0.5 (`environment.globalLight.darkness.max`,
// common/documents/scene.mjs:119-130): the scenario's "Adjust Darkness" region (darkness 1) then makes a real ordinary dark.
const SCENE = { environment: { globalLight: { darkness: { min: 0, max: 0.5 } } } };

await buildArena({ stage: ARENE_VISION, folder: "DAS · Arène de la vision", flag: "vision", actors: ACTORS, scene: SCENE });
