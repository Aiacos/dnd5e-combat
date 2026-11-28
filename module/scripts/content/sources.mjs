/**
 * Identifiers of premium-module items that carry none (empty `system.identifier`): dnd5e then falls back on the
 * name (documents/mixins/document.mjs:33, `formatIdentifier(this.name)`), which Babele translates — "morsure-vampirique" in
 * French, "vampiric-bite" in English. The engine recognizes them by their compendium source (`_stats.compendiumSource`,
 * which dnd5e's advancement keeps: documents/advancement/item-grant.mjs:182) or by their id, if they were imported as
 * they are. Key: the document's id in the compendium (16 characters); value: the English identifier, in kebab-case.
 *
 * Checked in the premium module `dnd-ravenloft-horrors-within` 1.0.1 (`options` pack, extracted into
 * `Foundry dnd5 module trad Ravenloft/work/rhw-en/options`).
 */

export const SOURCE_IDENTIFIERS = Object.freeze({
  // O1 (§335): the four rings of elemental command in the Guide share the identifier "ring-of-elemental-command"; their data
  // defaults differ (content/item-fixes.mjs). Harkon's Bite (Ravenloft) has no identifier.
  dmgAirRingOfElem: "ring-of-elemental-command-air",
  dmgEarthRingOfEl: "ring-of-elemental-command-earth",
  dmgFireRingOfEle: "ring-of-elemental-command-fire",
  dmgWaterRingOfEl: "ring-of-elemental-command-water",
  rhwHarkonsBite2Q: "harkons-bite",
  // K6 (§327): Monster Manual and Ravenloft abilities whose identifier is that of a PHB rule — the Pirate Captain's Riposte
  // is not the Battle Master maneuver, the Shield Guardian's Protection is not the fighting style, the Oracle Cyclops's Foretelling
  // is not the Diviner's, the Vampire's Misty Escape is not the Warlock invocation, the Giant Spider's Web is not the
  // spell, the Pirate Admiral's Rally is not the Eldritch Knight feature. A proper identifier: only the text layer applies to it.
  mmRiposte0000000: "mm-riposte",
  // Red Dragons' Commanding Presence (SRD 5.2): the legendary action casts Command; it has nothing of the Fighter's
  // "commanding-presence" (a bonus to Charisma checks), whose entry it carried by namesake.
  "mmAdultRedDragon.mmCommandingPres": "mm-commanding-presence",
  "mmAncientRedDrag.mmCommandingPres": "mm-commanding-presence",
  mmProtection0000: "mm-protection",
  mmPortent0000000: "mm-portent",
  mmMistyEscape000: "mm-misty-escape",
  E2ZOsODrA6ydRBro: "mm-misty-escape",
  mmWeb00000000000: "mm-web",
  // §435: the Water Elemental's Whelm is not the Guide's legendary hammer "Whelm" (content/item-fixes.mjs, O3) —
  // the weapon's entry replaced the creature's text layer, and its damage at the start of its turn (`originTurnStart`) was lost.
  mmWhelm000000000: "mm-whelm",
  Z40sOvc1VYKqWqA6: "mm-rally",
  // §334: data defaults specific to one creature — "actor.item" key of the compendium source (the item id is shared).
  "mmHomunculus0000.mmBite0000000000": "mm-homunculus-bite",
  "mmPseudodragon00.mmSting000000000": "mm-pseudodragon-sting",
  "mmWereboar000000.mmGore0000000000": "mm-wereboar-gore",
  // Fire Aura "each creature" (SRD 5.2), under the shared identifier "fire-aura" ("of its choice": Azers, Salamanders).
  "mmFireElemental0.mmFireAura000000": "mm-fire-aura-each",
  "mmBalor000000000.mmFireAura000000": "mm-balor-fire-aura",
  // Bite of the other lycanthropes (SRD 5.2): same clause as the Wereboar's Tusk, under the shared identifier "bite".
  "mmWerebear000000.mmBite0000000000": "mm-werebear-bite",
  "mmWererat0000000.mmBite0000000000": "mm-wererat-bite",
  "mmWeretiger00000.mmBite0000000000": "mm-weretiger-bite",
  "mmWerewolf000000.mmBite0000000000": "mm-werewolf-bite",
  "mmWight000000000.mmLifeDrain00000": "mm-wight-life-drain",
  "mmBeholder000000.mmEyeRays0000000": "mm-beholder-eye-rays",
  "mmDeathTyrant000.mmEyeRays0000000": "mm-beholder-eye-rays",
  // Dhampir species (Ravenloft: The Horrors Within).
  rhwVampiricBitnE: "vampiric-bite",
  rhwSpiderClimb7F: "spider-climb",
  // Domaine de la Tombe (clerc).
  rhwCSCircleofMOG: "circle-of-mortality",
  rhwCSPathtotheCb: "path-to-the-grave",
  rhwCSSentinelaOa: "sentinel-at-deaths-door",
  rhwCSDivineRea8I: "divine-reaper",
  // §93 : Dons sombres.
  rhwAberrantAnato: "aberrant-anatomy",
  rhwEchoingSoulGK: "echoing-soul",
  rhwLivingShadow2: "living-shadow",
  rhwSymbioticBein: "symbiotic-being",
  rhwWatchersGH8OL: "watchers",
  rhwGatheredWhisp: "gathered-whispers",
  rhwSecondSkinkc1: "second-skin",
  // §94: feats and species traits.
  rhwSurvivor2zrM3: "survivor-ravenloft",
  rhwMistWalkerlge: "mist-walker",
  rhwSharpEyev8PBf: "sharp-eye-ravenloft",
  rhwKnowledgefraL: "knowledge-from-a-past-life",
  rhwHowlA3f2I58L3: "lupin-howl",
  rhwFeralPounce7E: "feral-pounce",
  // §95: subclasses — Undead Patron, Ghost, Shadow Sorcery, Hollow Warden.
  rhwUPFormofDreOJ: "form-of-dread",
  rhwUPNecroticHYI: "necrotic-husk",
  rhwPRWailsfromLz: "wails-from-the-grave",
  rhwPRGhostWalkKY: "ghost-walk",
  rhwSSPowerofShNG: "power-of-shadow",
  rhwSSShadowWalqT: "shadow-walk",
  rhwSSUmbralForQw: "umbral-form",   // §447
  rhwUPGraveToucq1: "grave-touched",   // §447
  rhwRERefinedRebY: "refined-reanimation",   // §447
  rhwEverlasting7o: "everlasting",   // §447
  rhwPRDeathsFriHo: "deaths-friend",   // §447
  rhwHWWrathofth3C: "wrath-of-the-wild",
  rhwHWAncientMibA: "ancient-might",
  // §96: College of Spirits.
  rhwCSAvengerSpv2: "avenger-spirit",
  rhwCSBruteSpir1q: "brute-spirit",
  rhwCSCowardSpi34: "coward-spirit",
  rhwCSFortuneTeZz: "fortune-teller-spirit",
  rhwCSPriestSpi36: "priest-spirit",
  rhwCSShadeSpirvt: "shade-spirit",
  rhwCSEmpoweredtO: "empowered-channeling",
  // §88: the Battle Master's Parry (Player's Handbook) carries the identifier "parry" of the Monster Manual's Parry (§74), whose
  // rule differs (AC + proficiency versus damage reduction): recognized by its source.
  phbmnvParry00000: "parry-maneuver",
  // §295 (second pass): the Great Old One patron's Hex (class pack, identifier "great-old-one-hex") is the Hex spell —
  // same activities, same six effects (with Disadvantage on Hex's saving throws): recognized as "hex" (1d6, choice of an
  // effect, Remove Curse). The Heroes of the Borderlands copy of Assassinate carries the identifier "assasinate" under the
  // same id as the Handbook's.
  n2qsI3p9HBVQIjeK: "hex",
  phbrgeAssasinate: "assassinate",
  // §298: the College of Valor's Extra Attack carries the common identifier "extra-attack"; it also allows a cantrip
  // in place of an attack. Recognized separately (adapter/turn.mjs keeps its two attacks).
  phbbrdExtraAttac: "valor-extra-attack",
  // §305: Ravenloft's Reanimated Companion (no identifier of its own).
  rhwRECompanionqV: "reanimated-companion"
});

/**
 * O5b (SPEC §340): the enchantment effects of the 2024 Dungeon Master's Guide magic weapons and armor, by id → the
 * identifier of the item that applies them. An enchanted weapon keeps its own identifier ("longsword"); the applied
 * enchantment keeps the id of its original effect (dnd5e, activity/enchant.mjs: `effect.clone(…).toObject()` created with
 * `keepId`), even when the item that applied it is no longer on the sheet. Surveyed in the Guide's `equipment` pack (2.0.0);
 * the "Enspelled" enchantments (shared ids) are not there.
 */
export const ENCHANTMENT_SOURCES = Object.freeze({
  rkijTbDVcBViZ8hs: "demon-armor",
  GTBlnwp18lMmlhNY: "dragon-scale-mail", oAMZPSz9ScJ9kzJS: "dragon-scale-mail", YnovzwTfQAEO8okl: "dragon-scale-mail", SXYzllaQnbyxFGJu: "dragon-scale-mail", "7R5dtsUNiWZhXhS3": "dragon-scale-mail", kwIXULk6aDknIZnv: "dragon-scale-mail", "4MsmIVyXTFt4AKuD": "dragon-scale-mail", WnwsmlBDChjhXgAj: "dragon-scale-mail", wVh8ceMKvVud2qyr: "dragon-scale-mail", QzV7iJWMlEePDrjN: "dragon-scale-mail",
  ZveR6kPKafjcwQdY: "dragon-slayer",
  F6NbXlYCpjhBGFRp: "executioners-axe",
  LdDrwdlNhF9ZxLJB: "moon-touched-sword", oZBFpi117yOXca3k: "helm-of-brilliance",
  VtBOwsAVipxkP2f5: "flame-tongue", MHnAqxEXBhUbnjPq: "flame-tongue",
  KDZFGFsxEOF5WvbJ: "frost-brand",
  ZwpawARncDIheC65: "giant-slayer",
  I7Iwl7awPq2wftoF: "holy-avenger",
  "3hRQ0o8Q1nmj5WwB": "luck-blade",
  L4ylYIFxr0vdht6M: "oathbow", J4bEaPvFwAGKSrPm: "berserker-axe", RSpASIW4HbToM7yC: "hammer-of-thunderbolts", qiwTWGRINh3WFPaA: "nine-lives-stealer", fSXff5Y6ILs6gJT7: "sword-of-life-stealing", vRcdxeUa3i4BjM3i: "sword-of-vengeance",
  nxid1s2CZrB06HH8: "sword-of-sharpness",
  // O9h (§363): Scroll of Protection, one profile per creature type.
  BFfhMUlqxRCc8RVd: "scroll-of-protection-aberration", S6ExnY9BBE2pR0fr: "scroll-of-protection-beast", bbPsBexnD43dITRz: "scroll-of-protection-celestial", digyUmkB2vUGt81C: "scroll-of-protection-construct", TaWMk1UKev6qtNMW: "scroll-of-protection-dragon",
  Byvwe1NjGChfIS8X: "scroll-of-protection-elemental", xu5cGmok325TaOt5: "scroll-of-protection-humanoid", NzbOdx6nFdfqGIin: "scroll-of-protection-fey", "1MhKOwy5blXJtP9r": "scroll-of-protection-fiend", zECAU6TNjC2wJpGq: "scroll-of-protection-giant",
  IRF1OVqBXs7xNqcq: "scroll-of-protection-monstrosity", "4Xom4fAANNPxjb0k": "scroll-of-protection-ooze", jyIGfsCnReo9WEpN: "scroll-of-protection-plant", JvE43pQh6FVZ42qp: "scroll-of-protection-undead",
  tuFnPbghL64ioL04: "sword-of-wounding",
  CzJMRNHYWlVNvnJN: "vicious-weapon",
  mxrAgEyDsV2h5jla: "vorpal-sword",
  "5rHVxAXfNzLO5zxx": "weapon-of-warning",
  UaQkN55ZMKSt9LGT: "1-wand-of-the-war-mage", jqNFw2MJ4B1HG257: "1-wand-of-the-war-mage",
  kejXxpJFzlSWcpm1: "1-wand-of-the-war-mage",
  "8E4SvTACyo0LzFBk": "dwarven-plate",
});
