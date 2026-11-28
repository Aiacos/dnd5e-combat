/**
 * Scene distributions: where the tokens that a scenario assumes in place stand. A scenario that places its targets relative
 * to other tokens ("the Bandit three cells above the Wizard") only holds if these are where it was
 * written; `ctx.stage(…)` (tools/scenario.mjs) sets the distribution at the start of the scenario and puts each token back
 * where it was at the end — the user can leave their world's tokens wherever they want between two passes (SPEC §40.6).
 *
 * `scene`: identifier of the scene (elsewhere, nothing is placed); `level`: level of the scene where the distribution is played;
 * `tokens`: name → [x, y], top-left corner of the token, in pixels, elevation 0. A token absent from the scene is ignored.
 */

/**
 * Restored Keep (`dnd-6`), ground floor: the "reference positions" surveyed in SPEC §11, those with which the
 * scenarios were written. The Zombies and the Wraith are not among them: no scenario places its targets relative to them.
 */
export const RESTORED_KEEP = Object.freeze({
  scene: "rklRestoredKeepC",
  level: "rcWKCTvbgKJhN2DV",
  tokens: Object.freeze({
    Magicien: [3080, 4760], Paladin: [3220, 5460], Guerrier: [2800, 5180], Roublard: [3080, 5600], Mage: [3360, 4480],
    Occultiste: [3500, 4760], Bandit: [2940, 4620], Clerc: [3640, 4900], Ensorceleur: [3500, 5600], Moine: [2940, 5740],
    Druide: [3080, 5740], "Rôdeur": [3220, 5740], Barde: [3360, 5740]
  })
});

/**
 * §83: the test arena of `dnd-6` — a flat scene, a single level, no walls, with the dimensions and grid of Restored Keep (140 px,
 * 5 ft): the reference coordinates above hold there as they are. A single Zombie. The runner (tools/scenario.mjs) plays there
 * every scenario that does not ask for `scene: "keep"` (floors, stairs, staircases), and puts each token back in place before
 * each one.
 * Found by its name; absent (another world), the runner plays on the active scene, as before.
 */
export const ARENA = Object.freeze({
  name: "Arène de test",
  tokens: Object.freeze({ ...RESTORED_KEEP.tokens, "Âme-en-peine": [3640, 5460], Zombi: [2800, 4900] })
});

/**
 * The "Spell Arena" (2026-10-22, `tools/arene-sorts.mjs`): flat scene of 40 × 20 cells of 140 px (5 ft), for the sweeps
 * of spells and features. Positions in canvas cells (top-left corner, scene margin included). The Caster and the Ally side by side;
 * the Target 4 cells away (20 ft, within any range except touch), its neighbor right next to it, the typed targets (Undead, Large,
 * artificial) at least 15 ft from the Target so that a 10 ft area centered on it does not catch them, the far Target at 150 ft;
 * the Enemy in contact, above the Caster, for the Emanations (Radiant Word, Spirit Guardians); the Hero (a character) apart,
 * out of the areas.
 */
export const ARENE_SORTS = Object.freeze({
  name: "Arène des sorts",
  cols: 40, rows: 20, grid: 140,
  tokens: Object.freeze({
    "Lanceur": [5, 10], "Allié": [5, 11], "Héros": [2, 14], "Ennemi au contact": [5, 9], "Cible": [9, 10], "Cible voisine": [10, 10],
    "Mort-vivant": [9, 15], "Grande cible": [14, 4], "Créature artificielle": [9, 4], "Cible lointaine": [35, 10]
  })
});

/**
 * Issue #32: the "Success at a Price Arena" (`tools/arene-prix.mjs`) — flat scene of 12 × 8 cells of 140 px (5 ft). The Hero (the
 * Player's Handbook pre-made Fighter: a player character, the only one the aid applies to by default) in contact with the
 * Dummy (999 HP, AC 15); the Caster (NPC without items, Sacred Flame lent by the scenario) 4 cells from the Hero, for the
 * save. Positions in cells.
 */
export const ARENE_PRIX = Object.freeze({
  name: "Arène du succès à un prix",
  cols: 12, rows: 8, grid: 140,
  tokens: Object.freeze({ "Héros du prix": [4, 4], "Mannequin": [5, 4], "Lanceur du prix": [4, 8] })
});

/**
 * §393: the "Summoning Arena" (`tools/arene-invocations.mjs`) — flat scene of 20 × 12 cells of 140 px (5 ft), for what the
 * summoning sweep cannot test in the Spell Arena: what targets a creature or an object. The Caster (NPC without items,
 * slots 9 everywhere); 2 cells away the Corpse (dead commoner: a Medium Humanoid that darsh-loot can raise — Finger of Death,
 * Animate Dead on a body) and the Dead Beast (dead wolf: not a Humanoid, refused); the Hero (pre-made Barbarian, weapon bearer:
 * Elemental Weapon, enchantments) in contact with the Caster; the Victim (1 HP) 4 cells away. The cells on the right stay free
 * for the summoned creatures. Positions in cells.
 */
export const ARENE_INVOCATIONS = Object.freeze({
  name: "Arène des invocations",
  cols: 20, rows: 12, grid: 140,
  tokens: Object.freeze({ "Lanceur": [4, 6], "Héros": [4, 7], "Cadavre": [6, 6], "Bête morte": [6, 8], "Victime": [8, 5] }),
  // Dead by construction: the scenario runner does not raise them (`standUpDowned`).
  corpses: Object.freeze(["Cadavre", "Bête morte"])
});

/**
 * Issue #42: the "Vision Arena" (`tools/arene-vision.mjs`) — flat scene of 40 × 12 cells of 140 px (5 ft), in full light,
 * to judge who sees whom (rules) and what a player's screen shows. The observers (owned by `claude player`) on the left:
 * the Human (pre-made Druid, no Darkvision), the Devil's Sight Warlock (pre-made Warlock, gnome, + Devil's Sight and
 * Darkness), the Elf Ranger (Darkvision 60 ft), the Truesight (120 ft); the Blindsight (30 ft) 25 ft from the Target
 * in the darkness, at the center of the Darkness cast by the scenario (15 ft Sphere); the Target behind the darkness, lit, on
 * the other side; the observers added afterwards (Vibrations 60 ft, Sense All and See Invisible at 120 ft, core modes set on
 * the token); the Target in the dark (ordinary darkness set by the scenario), the invisible Target (Invisible condition, in
 * full light); the Target far away, lit, top left, that no line of sight passes through the Darkness (control). Positions in
 * canvas cells:
 * the scene margin (10%: 4 columns, 2 rows) is excluded from vision by the core (`visibility.mjs`, `inBuffer`) —
 * an observer placed in it sees nothing of the scene.
 */
export const ARENE_VISION = Object.freeze({
  name: "Arène de la vision",
  cols: 40, rows: 12, grid: 140,
  tokens: Object.freeze({
    "Humain": [6, 6], "Occultiste du diable": [6, 8], "Rôdeur elfe": [6, 10], "Vision véritable": [6, 12], "Vision aveugle": [12, 8],
    "Vibrations": [12, 12], "Sens tout": [6, 4], "Voir l'invisible": [6, 2],
    "Cible dans les ténèbres": [17, 8], "Cible derrière les ténèbres": [23, 8], "Cible au loin": [10, 2],
    "Cible dans le noir": [14, 3], "Cible invisible": [10, 4]
  }),
  // The target at the center of the Darkness cast by the `vision-tenebres` scenario.
  darknessOn: "Cible dans les ténèbres",
  // The ordinary darkness ("Adjust Darkness" region, no spell) that the scenario sets around the Target in the dark: cells
  // [x, y, width, height], far from the observers and the Darkness.
  dark: Object.freeze([13, 2, 4, 3])
});

/**
 * Issue #44 (§408): the "Refusal Arena" (`tools/arene-refus.mjs`) — flat scene of 36 × 10 cells of 140 px (5 ft), for the
 * refusals of the legality check and their override. The level 1 pre-mades of the Player's Handbook, player characters
 * (`claude player` owns them): the Mage (staff equipped, Ray of Frost 60 ft, Detect Magic as a ritual), the Cleric (mace and
 * shield equipped, holy symbol amulet: both hands taken), the Fighter (two-handed sword). The Dummy (999 HP) in contact with
 * the Mage; the far Target at 31 cells (155 ft), out of any cantrip range. Positions in canvas cells, margin included
 * (4 cells on the left, 1 on top).
 */
export const ARENE_REFUS = Object.freeze({
  name: "Arène des refus",
  cols: 36, rows: 10, grid: 140,
  tokens: Object.freeze({ "Mage des refus": [6, 5], "Clerc des refus": [6, 7], "Guerrier des refus": [6, 3], "Mannequin des refus": [7, 5],
    "Cible lointaine des refus": [37, 5] })
});

/**
 * §414: the "Abjuration Arena" (`tools/arene-abjuration.mjs`) — flat scene of 20 × 10 cells of 140 px (5 ft), for Arcane
 * Ward in game conditions: the Abjurer (pre-made Wizard raised to level 6, Abjurer subclass, Int 18, 40 HP),
 * the Protégé (pre-made Fighter, 60 HP) 10 ft from them, the Ogre (club 2d8 + 4; Large, 2 × 2 cells: 7-8 × 6-7) who hits
 * the Abjurer (diagonally) and the Protégé (above) without moving. Positions in canvas cells, margin included.
 */
export const ARENE_ABJURATION = Object.freeze({
  name: "Arène de l'abjuration",
  cols: 20, rows: 10, grid: 140,
  tokens: Object.freeze({ "Abjurateur": [6, 5], "Protégé": [8, 5], "Ogre": [7, 6] })
});
