#!/usr/bin/env node
/**
 * Sets up (or restores) the "Spells Arena" of a test world, through the connector: a flat, empty scene, and test actors made
 * for the sweep of spells and abilities (`tools/scenarios/balayage-sorts.mjs`, `balayage-aptitudes.mjs`).
 * Why not the "Test Arena" (§83): fifteen tokens surround the Zombie, an area touches half a dozen of them, and these are the
 * PC sheets, which lending 391 spells would dirty. Here, an NPC **Caster** with no item at all (level 20 caster, 9 slots at
 * each level, spellcasting ability at 20: the lent spells are the only ones it carries), targets at 999 HP that do not die,
 * and nothing else within reach of an area.
 *
 *   node tools/arene-sorts.mjs          creates what is missing, resets actors and tokens to their reference state
 *
 * Idempotent: an actor or the scene is found by its name; nothing outside its folder is touched. Positions in cells:
 * `ARENE_SORTS` (tools/lib/stages.mjs), which the scenario runner restores before each scenario of this scene.
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_SORTS } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène des sorts";
const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));

/**
 * The test actors: Bestiary base, items removed (nothing but what a scenario lends), then touch-ups. The Hero, a
 * character (the Handbook's pregenerated Barbarian, `keepItems`): what an NPC lacks — class and scales (Rage damage), Rage,
 * weapons, a PC's turn budget (Fanatical Focus, Remarkable Athlete, Combat Inspiration, scenario `passifs-releve`).
 */
const ACTORS = {
  "Lanceur": { base: "mmArchmage000000", disposition: 1, system: {
    abilities: { int: { value: 20 }, wis: { value: 20 }, cha: { value: 20 }, con: { value: 14 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "int", spell: { level: 20 } },
    spells: SLOTS, details: { cr: 12 } } },
  "Héros": { pack: PHB, base: "phbprgBarbarian0", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Allié": { base: "mmCommoner000000", disposition: 1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Ennemi au contact": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible voisine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible lointaine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Mort-vivant": { base: "mmZombie00000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Grande cible": { base: "mmOgre0000000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Créature artificielle": { base: "mmAnimatedArmor0", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } }
};

await buildArena({ stage: ARENE_SORTS, folder: FOLDER, flag: "sorts", actors: ACTORS });
