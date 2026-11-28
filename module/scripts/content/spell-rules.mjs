/**
 * 2024 Player's Handbook spells with multiple rules (SPEC §37), one complete entry per dnd5e identifier, merged over
 * the per-building-block tables like the classes. `phbspl…` items from the `spells` pack of the premium module
 * `dnd-players-handbook` 2.2.0.
 */

/**
 * Bestow Curse (level 3, Cleric, Bard, Wizard…), `phbsplBestowCurs`. Four Wisdom saving throw activities, one per curse
 * (the caster picks it by picking the activity); the duration and concentration are those of the effects and the spell (dnd5e).
 *  - "Curse Ability" links NONE of the six "Cursed <ability>" effects (Disadvantage on checks and saving throws, through
 *    `system.abilities.<x>.check|save.roll.mode`): the `choice.pool` reserve offers them, the caster picks one. Data
 *    defect: "Cursed Wisdom" carries Disadvantage on saving throws twice and not the one on checks.
 *  - "Cursed Attacks" (`u7Yc7mxHYPDvipS1`, without changes): "Disadvantage on attack rolls against you".
 *  - "Cursed Actions" (`T3x6XvQbSkg6kW6u`): "in combat, a Wisdom saving throw at the start of each of its turns, or
 *    the Dodge action" — the save of the activity that applied it; on a success, the curse remains.
 *  - "Cursed Resilience" (`DRsQi8p3Zvhte2G0`): "if you deal damage to it with an attack roll or a spell, an extra 1d8
 *    necrotic damage" — on the caster's item, like Hex.
 */
const BESTOW_CURSE = {
  // §403: "with a level 4 slot, Concentration up to 10 minutes; at level 5 or higher, the spell does not require
  // Concentration and lasts 8 hours (level 5–6) or 24 hours (level 7–8); at level 9, until dispelled".
  durationByLevel: [{ from: 4, seconds: 600 }, { from: 5, seconds: 28800, concentration: false },
    { from: 7, seconds: 86400, concentration: false }, { from: 9, concentration: false }],
  // §295: "Curse Resilience" carries 1d8 necrotic on its save in the data; those dice only fall on the following hits.
  noDamage: ["fkQUKM8bxHgAUcg5"],
  choice: {
    effects: "one",
    pool: { PYFPZ4aLWjKJ1tLZ: ["m5aRx9iXnJi2WWPU", "pG5HdDpW8VELR1O3", "BXWN6AGeNbxrRBUZ", "eA7PgIuucNGqZ1AS", "qLBTtRHOpGfv4IAb", "2Xjz5PKhyDferpZ7"] }
  },
  triggers: [
    { on: "preAttackRoll", via: "effect", fromEffect: "u7Yc7mxHYPDvipS1",
      if: { "source.hasEffectFromTarget": { item: "bestow-curse", effect: "u7Yc7mxHYPDvipS1" } }, do: [{ type: "disadvantage" }] },
    { on: "startOfTurn", via: "effect", fromEffect: "T3x6XvQbSkg6kW6u", do: [{ type: "resave", keep: true, onFail: "dodge" }] },
    { on: "preDamageRoll",
      if: { any: [{ "activity.isAttack": true }, { "activity.isSpell": true }], "target.hasEffectFrom": { item: "bestow-curse", effect: "DRsQi8p3Zvhte2G0" } },
      do: [{ type: "damage", formula: "1d8", damageType: "necrotic" }] }
  ]
};

/** §284: dancing in place — all Speeds at 0 while the effect lasts (Otto's Irresistible Dance). */
const DANCE_IN_PLACE = Object.freeze(["walk", "fly", "swim", "climb", "burrow"].map(m => ({ key: `system.attributes.movement.${m}`, type: "override", value: 0 })));

export const SPELL_RULES = Object.freeze({
  // §43.1: Petrification — the effect of a successful save (Speed 0) ends at the start of the caster's next turn.
  // §402: Enthralling speech — "the creatures you or your companions are fighting automatically succeed".
  "enthrall": { saveAutoSuccess: { fighting: true } },
  // Blight (SRD 5.2): "a Plant automatically fails the saving throw".
  "blight": { saveAutoFail: { types: ["plant"] } },
  // §402: "a Construct automatically succeeds" (the effect on a success, Unable to Move, remains applied).
  "flesh-to-stone": { saveAutoSuccess: { types: ["construct"] }, effectEnds: { sFyjp6wt9bjyIl9W: "casterTurnStart" } },
  // §43.2 — an action ends the effect.
  // Otto's Irresistible Dance: "on each of its turns, the target can take an action to shake itself and repeat the
  // saving throw"; the dance of a successful save ends at the end of the target's next turn.
  // §284: both effects are empty in the data — "must spend all its movement dancing in place" (Speeds at 0); under
  // Charmed, "Disadvantage on Dexterity saving throws" (attack rolls: content/triggers.mjs).
  "ottos-irresistible-dance": { actionEnds: { MpToumiJ2o3S16K7: { by: "bearer", roll: "save" } }, effectEnds: { UhFtBDEZEDpVgz9G: "bearerTurnEnd" },
    effectChanges: {
      MpToumiJ2o3S16K7: [...DANCE_IN_PLACE, { key: "system.abilities.dex.save.roll.mode", type: "add", value: "-1" }],
      UhFtBDEZEDpVgz9G: DANCE_IN_PLACE
    } },
  // Gaseous Form: "or if it takes a Magic action to end the spell on itself".
  // §295: "the spell ends if the target drops to 0 HP"; "its only means of movement is a Fly Speed of 3 m".
  "gaseous-form": { actionEnds: { QeYsfnjEj2T9A3C8: { by: "bearer" } }, endsWhen: { zeroHp: true },
    effectChanges: { QeYsfnjEj2T9A3C8: ["walk", "swim", "climb", "burrow"].map(m => ({ key: `system.attributes.movement.${m}`, type: "override", value: "0" })) } },
  // Earthquake, "Buried in Rubble": "a DC 20 Strength (Athletics) check as an action to extricate itself".
  // §91: "when cast and at the end of each of your turns, each creature in contact with the ground in the area makes a
  // Dexterity save; on a failure, Prone and its Concentration broken" — the casting save repeated at the end of the caster's
  // turns, on the creatures on the ground; Difficult Terrain. Fissures and structures: left to the GM
  // (the data's activities).
  "earthquake": {
    actionEnds: { "6UanNy7OTib1zFSq": { by: "bearer", roll: "check" } },
    casterPulse: { at: "turnEnd", ground: true, by: [{ from: 1, to: 10, activity: "Z1voDdIYLdJfGwMH" }] },
    difficultTerrain: {},
    triggers: [{ on: "failedSave", if: { "activity.id": "Z1voDdIYLdJfGwMH" }, do: [{ type: "status", status: "prone" }, { type: "breakConcentration" }] }]
  },
  // §91: Delayed Blast Fireball — "the damage increases by 1d6 each time your turn ends while the spell persists":
  // at the end of the caster's turns, "Increase end-of-turn damage" is USED (it adds a use to the spell, which
  // the explosion reads: 12d6 + (@item.uses.value)d6); "when the spell ends, the bead explodes": the area drops, the explosion
  // (6 m Sphere) starts from its center. The touched or thrown bead: left to the GM ("Bead touched").
  "delayed-blast-fireball": {
    casterPulse: { at: "turnEnd", by: [{ from: 1, to: 10, activity: "9i14Jmun9em69EnX", use: true }] },
    zoneEnd: { activity: "M15GlfjeWy7Cdiqn" }
  },
  // §91: Tsunami — "at the start of each of your subsequent turns, the wall moves 15 m away from you; creatures in the space it
  // moves into make a Strength save or take 5d10 bludgeoning": the area moves away, "Start-of-turn effect" pays a use (the
  // round counter, which its dice read: (@item.uses.value)d10) and replays on what is inside; no use left, the spell
  // ends. Creatures swept away, swimming, size Gargantuan at most: left to the GM.
  "tsunami": {
    casterPulse: { at: "turnStart", away: { distance: 50, units: "ft" }, untilSpent: true, by: [{ from: 1, to: 6, activity: "o7MOuS6uL1ZV3dhe", pay: true }] }
  },
  // §91: Forbiddance — the barrier has no area in the data: a 60 m square (3,600 m²) supplied, placed with the mouse; "a
  // designated creature that enters the area for the first time on a turn or ends its turn there takes 5d10 necrotic or
  // radiant damage" — replay of "Forbidden creature damage"; designated: the six types the spell allows (the choice of a
  // subset, the damage type — asked at the roll —, the password, planar travel and teleportation: left to
  // the GM).
  // Forbiddance: the spell can be cast as a ritual according to its text — the data does not have the property.
  "forbiddance": {
    dataFixes: [{ path: "system.properties", from: ["vocal", "somatic", "material"],
      value: ["vocal", "somatic", "material", "ritual"] }],
    selfZone: { T2XK004SAb09LvvP: { type: "cube", size: 200, units: "ft" } },
    targets: { types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] },
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "9IBiOeIf2PC1wcLp" }] }]
  },
  // §91: Storm of Vengeance — the placement (Constitution, 2d6 thunder, Deafened); then at the start of the caster's following
  // turns, on what is under the cloud: turn 2 acid rain (4d6), turn 3 six lightning bolts (Dexterity, 10d6; enemies first),
  // turn 4 hail (2d6), turns 5 to 10 gusts (1d6 cold). The text files under those turns 5 to 10 the Difficult Terrain,
  // the null visibility and, §367, "ranged attacks with a weapon are impossible there": all three from the fourth replay,
  // not from the placement.
  "storm-of-vengeance": {
    casterPulse: { at: "turnStart", by: [
      { from: 1, activity: "WOo8u0FLAzNMpMJN" }, { from: 2, activity: "Fd8ZGgmDyNmJJuj3", max: 6 },
      { from: 3, activity: "H4uCtCkANBkttnov" }, { from: 4, to: 9, activity: "yt2oWWelZl1zV4CB" }] },
    difficultTerrain: { fromPulse: 4 },
    obscures: { fromPulse: 4 },
    noRangedWeapons: { fromPulse: 4 }
  },
  // Shaking a sleeper: "someone takes an action to shake it" — Sleep (within 1.50 m), Hypnotic Pattern, Evil Eye
  // ("Asleep"), Symbol ("Sleeping").
  // §296: "each creature of your choice in the Sphere" — allies spared.
  "sleep": { actionEnds: { "04Wa4xUzjA31kPno": { by: "other", verb: "wake" } }, zoneAffects: "enemy" },
  "hypnotic-pattern": { actionEnds: { mjAs8ssQlgp0AQOp: { by: "other", verb: "wake" } } },
  "eyebite": { actionEnds: { "5btX5iwwleMMzkvj": { by: "other", verb: "wake" } }, targets: { unaffectedIf: { "target.hasMark": "eyebite-saved" } } },
  // §91: Symbol, Discord — "its ability checks are made with Disadvantage" (the data's effect is empty).
  // §403: "… the glyph's magic acts for 10 minutes: a creature that enters the Sphere, or ends its turn in it, is subjected to it
  // (once per turn)" — the triggered activity's Sphere lasts 10 minutes (`zoneLasts`) and replays (content/triggers.mjs).
  "symbol": {
    zoneLasts: { seconds: 600 },
    actionEnds: { A1VA7t5gB7ODNsr6: { by: "other", verb: "wake" } },
    effectChanges: { YAwLt85sPQpUCIBI: ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" })) }
  },
  // Ensnaring Strike: the target, or any creature that reaches it, can spend an action on a Strength (Athletics) check against the
  // caster's DC — the target goes through the escape from a restraint (§16.54); this opens the check to another creature.
  // §81: the casting save (dnd5eactivity000) carries 1d6 piercing in the data (premium PHB and dnd5e SRD), which the
  // 2024 text does not give: the damage only falls at the start of the restrained target's turns ("Start of Turn Damage", §80).
  // §208: Jump — "once on each of its turns, until the spell ends, the creature can jump up to 9 m for 3 m of
  // movement": carried by the spell's effect ("Jump", Esyd01OZ3NCv8gtp) on the creature touched.
  "jump": { jump: { fixed: { distance: 30, cost: 10, from: "effect" } } },
  // §206: like the smites — offered after a weapon hit, melee as well as ranged ("immediately after hitting
  // a creature with a weapon"); the target makes its Strength roll, with Advantage if it is Large or larger.
  "ensnaring-strike": { actionEnds: { tFGMG3cjQTEeAhv2: { by: "other", roll: "check" } }, noDamage: ["dnd5eactivity000"],
    smite: { save: "dnd5eactivity000", any: true }, saveAdvantageSize: "lg" },
  // Haste (level 3), `phbsplHaste00000`: "when the spell ends, the target is Incapacitated and its Speed is 0 until the end
  // of its next turn" — the "Lethargy" effect (S5XcFawnnNHO8bUr) applied when "Hasted" (NEFWcyysYgsE6de3) ends, however
  // the end comes (duration, broken concentration, dispelling); §42.2, runtime/endings.mjs.
  // §157: "an additional action on each of its turns, which can only be used to Attack (one attack only), Dash,
  // Disengage, Hide, or Utilize" — `limitedAction` on the "Hasted" effect.
  "haste": { limitedAction: "NEFWcyysYgsE6de3", effectThen: { NEFWcyysYgsE6de3: "S5XcFawnnNHO8bUr" }, effectEnds: { S5XcFawnnNHO8bUr: "bearerTurnEnd" } },
  "bestow-curse": BESTOW_CURSE,
  // Dispel Magic (level 3, Cleric, Druid…), `phbsplDispelMagi`: a utility activity without an effect; the engine ends
  // the spells in progress on the designated targets (§37.2, runtime/dispel.mjs).
  "dispel-magic": { dispel: true },
  // §403: Gust of Wind — "each meter traveled toward you costs 2 m of movement" in the Line (runtime/move-gate.mjs).
  "gust-of-wind": { windward: true },
  // §403: Moonbeam — "while it is in the light, it cannot take another form": a transformation cast from
  // the cylinder is refused (the creature that targets another one inside: left to the GM).
  "moonbeam": { formLock: true },
  // §403: Freedom of Movement — "the target's Speed cannot be reduced by magic" (Immunity to Paralyzed and
  // Restrained, Difficult Terrain ignored: the data's "Unrestricted Movement" effect). A reduction already applied before the spell
  // remains; "1.50 m of movement to escape a grapple": left to the GM.
  "freedom-of-movement": { keepsSpeed: true },
  // Silence (level 2, Cleric, Bard, Ranger), `phbsplSilence000`: "a creature entirely within the Sphere is immune to
  // thunder damage and Deafened; no spell with a verbal component can be cast within it" — the item's "Silenced" effect (Deafened,
  // `silenced` which legality already reads, §17; thunder immunity), carried in the area (§37.4).
  "silence": { zoneEffects: true, silences: true },
  // §69: Difficult Terrain of the area, lost from the premium Player's Handbook data (`behaviors` empty; the dnd5e SRD
  // has it). Entangle ("the ground in the area becomes Difficult Terrain", plants), Spike Growth (plants), Web
  // (webs), Grease, Sleet Storm ("Difficult Terrain"), Evard's Black Tentacles. Plant Growth and Wall
  // of Thorns (4 m of movement per meter) are not ordinary Difficult Terrain: not included.
  // §70: Call Lightning — the cloud (18 m cylinder) remains; each casting targets a 1.50 m bolt below it; "outdoors, in
  // stormy weather": +1d10 (question at casting). The recast without a slot (`recast`) and the bolt (`bolt`): content/bursts.mjs.
  // §469: Handbook 3.0.0 — "Cast Spell" (utility) only places the cloud; the bolt is "Lightning Strike" (3d10), and
  // "Lightning Strike (Storm)" (4d10) is its variant when the storm was already there.
  "call-lightning": { storm: { bonus: "1d10", strike: "dnd5eactivity000", stormStrike: "8DvTC5lYcdKn1Q3r" } },
  // §120: Vampiric Touch (level 3) — "you regain HP equal to half the necrotic damage dealt" (runtime/lifesteal.mjs);
  // "while the spell lasts, you can make the attack again on each of your turns as a Magic action": the recast without
  // a slot (content/bursts.mjs).
  "vampiric-touch": { lifesteal: { damageType: "necrotic", fraction: 0.5 } },
  // §73: Death Ward (level 4) — "the first time the target would drop to 0 HP, it drops to 1 HP instead, and the spell
  // ends" (adapter/ward.mjs). The effect that would kill outright without damage: left to the GM.
  "death-ward": { wardsAtZero: true },
  // §303: Aid — the maximum HP raised before the healing of the current HP.
  "aid": { effectsFirst: true },
  // Heroes' Feast (SRD 5.2): "its maximum HP increases by 2d10, and it gains the same number of HP" — "Consume Feast" heals
  // 2d10 and applies the benefits, but the maximum did not change.
  "heroes-feast": { effectsFirst: true, healRaisesMax: true },
  // §75: Cordon of Arrows — four projectiles, then the spell ends (content/triggers.mjs).
  // §303: "four pieces of ammunition", "two more for each slot level above 2nd" — 2 × the casting level.
  // §366: "you can designate creatures, which the spell ignores" — the caster's allies.
  "cordon-of-arrows": { zoneCharges: "2 * @item.level", zoneAffects: "enemy" },
  // §71: Umbral Dagger (Vampire Familiar, Monster Manual 2024, `mmUmbralDagger00`) — "if the target drops to 0 Hit Points as
  // a result of this attack, it is Stabilized but takes the Poisoned condition for 1 hour; while it is Poisoned,
  // it is Paralyzed": the item's "Poisoned and Paralyzed" effect only applies if the target is at 0 HP after the damage, and
  // it is stabilized (neither death saving throw nor death, even an NPC).
  "umbral-dagger": { stableAtZero: true, effectsIf: { "target.atZero": true } },
  "entangle": { difficultTerrain: { types: ["plants"] } },
  "spike-growth": { difficultTerrain: { types: ["plants"] } },
  // §158 (spell survey, batch 2: lasting areas). Web: "… that enters it for the first time on a turn or starts its
  // turn there makes a Dexterity save; on a failure, Restrained while it is in the web or until it breaks free"; "an
  // action for a Strength (Athletics) check against your DC". The data's 2d4 fire damage is that of a burning web: not
  // rolled at the replay (the burning is left to the GM). Lightly obscured area: not included.
  "web": {
    difficultTerrain: { types: ["webs"] },
    noDamage: ["dnd5eactivity000"],
    triggers: [{ on: ["enter", "turnStart"], do: [{ type: "replay" }] }, { on: "failedSave", do: [{ type: "status", status: "restrained" }] }],
    actionEnds: { "status:restrained": { by: "bearer", roll: "check" } },
    // §188: "Flammable. Any portion of the web exposed to fire burns away in 1 round, dealing 2d4 fire damage to any creature
    // that starts its turn in the fire." The whole web burns at once (simplification); Restrained falls with it.
    flammable: { damage: "2d4", type: "fire", rounds: 1, seconds: 6, on: ["turnStart"], frees: "restrained" }
  },
  // Grease: "… that enters it or ends its turn there makes a Dexterity save or has the Prone condition". §195: a slippery
  // surface (Slippers of Spider Climbing do not hold on it).
  "grease": {
    difficultTerrain: {},
    slippery: true,
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }, { on: "failedSave", do: [{ type: "status", status: "prone" }] }]
  },
  // §300: "enters the Cylinder for the first time on a turn or starts its turn there" — nothing at casting.
  "sleet-storm": { difficultTerrain: {}, quietPose: true },
  // Sacred Flame (SRD 5.2): "the target gains no benefit from Half Cover or Three-Quarters Cover for this save".
  "sacred-flame": { saveIgnoresCover: true },
  // Antipathy/Sympathy (SRD 5.2): "when you cast the spell, choose whether it creates antipathy or sympathy" — the data's
  // "Cast" activity applies both marks at once.
  "antipathy-sympathy": { choice: { effects: "one" } },
  // Glyph of Warding, explosive rune (SRD 5.2): "the glyph releases magical energy in a 6 m radius Sphere
  // centered on it; each creature in the area makes a Dexterity saving throw" — the data's "Explosive Rune" activity
  // has no area (it inherits the spell's target, an object): it hit nobody.
  "glyph-of-warding": { dataFixes: [
    { path: "system.activities.dnd5eactivity100.target.override", from: false, value: true },
    { path: "system.activities.dnd5eactivity100.target.template.type", from: null, value: "sphere" },
    { path: "system.activities.dnd5eactivity100.target.template.size", from: null, value: "20" },
    { path: "system.activities.dnd5eactivity100.target.affects.type", from: null, value: "creature" }] },
  // Magic Circle (SRD 5.2): the data only has a Charisma save (that of an inward teleportation). The area
  // places a mark on whoever stands in it, with no save or anything at placement: that is what the attackers' Disadvantage
  // (content/triggers.mjs) and the Charmed and Frightened immunity (content/endings.mjs) read.
  "magic-circle": { quietPose: true, zoneEffects: true,
    dataFixes: [{ effect: "dasMagicCircle00", create: { name: "Inside the Magic Circle", type: "base", transfer: false,
      disabled: false, statuses: [], system: { changes: [] } } },
    { path: "system.activities.dnd5eactivity000.effects", from: [], value: [{ _id: "dasMagicCircle00" }] }] },
  // Time Stop ("time-stop": { extraTurns: { formula: "1d4 + 1" } }) is held back until issue #274: the extra turns must not start
  // and end the next combatant's turn. The key and its runtime stay; the spell is played by hand until then.
  // Zone of Truth, Control Water's whirlpool (SRD 5.2): nothing when placed — the save comes on entering and on each
  // creature's turn (content/triggers.mjs).
  "zone-of-truth": { quietPose: true },
  "control-water": { quietPose: true },
  // §300: "Growth" — the area becomes terrain where each meter costs 4 meters of movement; it remains (instantaneous duration).
  // Overgrowth: "casting time: action" — the data leaves the activation "special" (nothing was spent).
  "plant-growth": { difficultTerrain: { cost: 4 }, usageLimits: { dnd5eactivity000: { cost: "action" } } },
  // §261: Ice Storm — "the area becomes Difficult Terrain until the end of your next turn".
  "ice-storm": { difficultTerrain: { lingers: "casterNextTurnEnd" } },
  // Evard's Black Tentacles: "… that enters it for the first time on a turn or ends its turn there" repeats the save; "an action
  // for a Strength (Athletics) check against your DC" ends Restrained. "On a failure, it takes 3d6 damage": nothing on a
  // success, but the data's activity carries `onSave: "half"` (gap survey, 2026-10-22: 4 HP on a success, seen in play).
  "evards-black-tentacles": {
    difficultTerrain: {},
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }],
    actionEnds: { NDytclFrNmC418CS: { by: "bearer", roll: "check" } },
    saveDamage: { dnd5eactivity000: "none" }
  },
  // Cloudkill, Incendiary Cloud: the Sphere repeats its save on entry and at the end of the turn, and "moves 3 m away from
  // you at the start of each of your turns" (heavily obscured: content/bursts.mjs).
  "cloudkill": { triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }], casterPulse: { at: "turnStart", by: [], away: { distance: 10, units: "ft" } } },
  "incendiary-cloud": { triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }], casterPulse: { at: "turnStart", by: [], away: { distance: 10, units: "ft" } } },
  // Insect Plague: replay on entry and at the end of the turn, Difficult Terrain (lightly obscured: not included).
  "insect-plague": { difficultTerrain: {}, triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Blade Barrier: wall or ring, replay on entry and at the end of the turn, Difficult Terrain. (Three-Quarters Cover through the
  // wall: not included.)
  // §172: placed on a row of cells; "the wall provides Three-Quarters Cover".
  "blade-barrier": { difficultTerrain: {}, cellWall: true, coverThrough: "threeQuarters", triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Jallarzi's Storm of Radiance: "while in the Cylinder, a creature is Blinded and Deafened and cannot cast a
  // spell with a verbal component" — carried by the area, not by the save; damage on entry and at the end of the turn.
  "jallarzis-storm-of-radiance": { zoneEffects: true, triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }] },
  // Hunger of Hadar: Difficult Terrain (Darkness: content/lights.mjs).
  "hunger-of-hadar": { difficultTerrain: {} },
  // Stinking Cloud: "Poisoned until the end of the current turn; while Poisoned this way, it cannot take an action or a Bonus
  // Action" (the "Stinking Poison" effect).
  // §300: only a creature that STARTS its turn in the cloud saves — nothing at casting.
  "stinking-cloud": { noActions: "gFid0DG5HydORpr3", quietPose: true },
  // §300: "a creature's Speed is halved in the Emanation" — the effect ends when it leaves.
  // §531 (issue #142): SRD 5.2 — "whenever the Emanation enters a creature's space and whenever a creature enters the Emanation or
  // ends its turn there". Unlike Moonbeam ("When the Cylinder appears, each creature in it…"), nothing happens when it appears:
  // creatures already inside at the cast save at the end of their turn, or when the moving Emanation reaches them (`quietPose`,
  // on both the 3.0.0 form and the older form whose save activity places the zone; replaces §438's `enterOnPose`).
  "spirit-guardians": { zoneBound: true, quietPose: true },
  // §302: Contagion — "Disadvantage on saving throws of the chosen ability" (the data's effects only apply Poisoned).
  "contagion": { effectChanges: {
    S8jxTZQbT8KKSg5V: [{ key: "system.abilities.str.save.roll.mode", type: "add", value: "-1" }],
    pqGQCk5wZx196HuY: [{ key: "system.abilities.dex.save.roll.mode", type: "add", value: "-1" }],
    "5aPQT5DlL6Igaxh4": [{ key: "system.abilities.con.save.roll.mode", type: "add", value: "-1" }],
    EruTLG8AjsLULgHj: [{ key: "system.abilities.int.save.roll.mode", type: "add", value: "-1" }],
    J77AMHW5tROddZQg: [{ key: "system.abilities.wis.save.roll.mode", type: "add", value: "-1" }],
    xewLYmHBxPTEKPlU: [{ key: "system.abilities.cha.save.roll.mode", type: "add", value: "-1" }]
  } },
  // §301: Fountain of Moonlight — "when you take damage from a creature visible within 18 m, your Reaction: its Constitution save
  // or Blinded"; only under the spell (the "Wreathed in Light" effect).
  "fount-of-moonlight": { triggers: [{ on: "isDamaged", if: { "target.hasEffect": "fount-of-moonlight", "target.seesSource": true, "target.within": { distance: 60, units: "ft" } },
    do: [{ type: "use", activity: "dnd5eactivity000", target: "source" }] }] },
  // §301: Feather Fall — "Reaction when you or a creature within 18 m falls: up to five creatures descend slowly, taking no
  // fall damage" — before application, the fall canceled (one creature per fall card).
  "feather-fall": { triggers: [{ on: ["falls", "allyFalls"], if: { "target.nearSelf": { distance: 60, units: "ft" } },
    do: [{ type: "use", activity: "dnd5eactivity000", target: "target" }, { type: "cancel" }] }] },
  // §86: Yolande's Regal Presence — "Surround Self" (OJHRKWz8JvLzyl9R) has no Emanation in the data: 10 ft on self,
  // placed automatically; "a creature you can see… you can force it": allies spared. Whoever enters it (or whom the
  // Emanation covers) or ends their turn in it: "Emanation Save" (dzeoGwKOPG7PHbyE, Wisdom, 4d6 psychic), once per turn;
  // on a failure, Prone, and pushed 3 m (§366).
  // §263: "each creature of your choice" in the area — the data does not say so (`affects.choice` absent): the caster's
  // allies are spared, as for Spirit Guardians (§16.23). CAT / CPR audit: Destructive Wave also hit allies.
  "destructive-wave": { zoneAffects: "enemy" },
  // §286: Chain Lightning — "toward up to three other targets, which you choose, within 9 m or less of the first"
  // (the number, "@item.level - 2", is in the data).
  "chain-lightning": { chain: { radius: 30, units: "ft" } },
  "word-of-radiance": { zoneAffects: "enemy" },
  "conjure-barrage": { zoneAffects: "enemy" },
  "conjure-volley": { zoneAffects: "enemy" },
  "yolandes-regal-presence": {
    selfZone: { OJHRKWz8JvLzyl9R: { type: "radius", size: 10, units: "ft" } },
    zoneAffects: "enemy",
    triggers: [
      { on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "dzeoGwKOPG7PHbyE" }] },
      // §366: "and you can push it up to 3 m"; §401: the distance asked of the caster.
      { on: "failedSave", do: [{ type: "status", status: "prone" }, { type: "move", mode: "push", distance: 10, units: "ft", upTo: true }] }
    ]
  },
  // §86: Conjure Woodland Beings — "Cast" (dnd5eactivity000, the placement save) without an Emanation in the data:
  // 10 ft on self; allies spared; entry and end of turn: "Emanation Save" (UkXLSgFbCBI9CHMf, Wisdom, 5d8 force), once
  // per turn. ("Disengage as a Bonus Action": the item's "Disengage" activity.)
  // §157 (spell survey, batch 1). Blur: the "Blurred" effect (PsuBObX6WLcNEvUw, without changes) is linked to no activity —
  // applied to the caster; "a creature with Blindsight or Truesight is not affected".
  "blur": {
    choice: { pool: { dnd5eactivity000: ["PsuBObX6WLcNEvUw"] } },
    triggers: [{ on: "preAttackRoll", via: "effect",
      if: { "target.hasEffect": "blur", not: { "source.hasSense": ["blindsight", "truesight"] } }, do: [{ type: "disadvantage" }] }]
  },
  // Feign Death: the "Cataleptic" effect (LEOWoE0nlVC8VRka: Blinded, Incapacitated, Speed 0, resistances) is linked to no
  // activity.
  "feign-death": { choice: { pool: { dnd5eactivity000: ["LEOWoE0nlVC8VRka"] } } },
  // Compelled Duel: "Disadvantage on attack rolls against any creature other than you" — the "Compelled" effect is empty. (The 9 m
  // leash and the ends of the spell: left to the GM.)
  // §402: "it cannot willingly move to a space more than 9 m from you" (`leash`, runtime/move-gate.mjs).
  "compelled-duel": { leash: { distance: 30, units: "ft" },
    triggers: [{ on: "preAttackRoll", via: "effect",
      if: { "source.hasEffect": "compelled-duel", not: { "source.hasEffectFromTarget": "compelled-duel" } }, do: [{ type: "disadvantage" }] }]
  },
  // Branding Smite: "attack rolls against it have Advantage" (effect applied by `smite.effect`, content/paladin.mjs).
  "shining-smite": {
    triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffect": "shining-smite" }, do: [{ type: "advantage" }] }]
  },
  // Thunderous Smite: "pushed 3 m and Prone" on a failed save — Prone through the data's effect.
  "thunderous-smite": { triggers: [{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Staggering Smite: "Stunned until the end of your next turn" — the data's save applies nothing.
  "staggering-smite": {
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "stunned" }] }],
    effectEnds: { "status:stunned": "casterTurnEnd" }
  },
  // Heat Metal: whoever keeps the object has "Disadvantage on attack rolls and ability checks until the start of your
  // next turn" — the "Heated Metal" effect (VVQbCUE5W44bF4QU) is empty. C12-b: the data applies it on a failure; the rule makes
  // the creature DROP the object on a failure (its held weapon) and leaves the Disadvantage on whoever keeps it — on a
  // success (`savedEffects`), or on a failure when nothing is dropped (worn armor: `elseEffect`).
  "heat-metal": {
    savedEffects: ["VVQbCUE5W44bF4QU"],
    effectChanges: { VVQbCUE5W44bF4QU: ["str", "dex", "con", "int", "wis", "cha"].map(a => ({ key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" })) },
    effectEnds: { VVQbCUE5W44bF4QU: "casterTurnStart" },
    triggers: [
      { on: "failedSave", do: [{ type: "disarm", elseEffect: "VVQbCUE5W44bF4QU" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "VVQbCUE5W44bF4QU", if: { "source.hasEffect": "heat-metal" }, do: [{ type: "disadvantage" }] }
    ]
  },
  // Expeditious Retreat: "you take the Dash action, and until the spell ends you can take it again as a Bonus Action" —
  // the use takes Dash; recasting it during concentration does not spend a slot.
  "expeditious-retreat": { basicActions: { dnd5eactivity000: "dash" }, recast: true },
  // Melf's Acid Arrow: "on a failure, the arrow splashes the target with acid for only half the initial damage".
  "melfs-acid-arrow": { halfOnMiss: true },
  // Heroism: "at the start of each of its turns, it gains Temporary Hit Points equal to your spellcasting ability
  // modifier" — the healing activity (Temporary Hit Points) replayed on the bearer of "Bravery" (zCpsdUyNz8bL3LF5).
  "heroism": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "zCpsdUyNz8bL3LF5", do: [{ type: "damage", to: "bearer", activity: "dnd5eactivity000" }] }] },
  // Shatter: "a Construct has Disadvantage on the saving throw".
  "shatter": { saveDisadvantageFor: ["construct"] },
  // §159: Aura of Life — "an ally at 0 HP that starts its turn in the aura regains 1 HP"; Aura of Purity — "Advantage on saves
  // to avoid or end Blinded, Charmed, Deafened, Frightened, Paralyzed, Poisoned, or Stunned"; Circle of Power — "Advantage on
  // saves against spells and other magical effects" ("no damage on a success instead of half": not included). Carried by the effect
  // of the aura (content/auras.mjs).
  "aura-of-life": { triggers: [{ on: "startOfTurn", via: "effect", if: { "target.atZero": true }, do: [{ type: "damage", to: "bearer", formula: "1", damageType: "healing" }] }] },
  "aura-of-purity": { saveAdvantage: ["blinded", "charmed", "deafened", "frightened", "paralyzed", "poisoned", "stunned"] },
  // §402: "… takes none" on a success against magic, half damage (`magicEvasion`, read on the aura's effect).
  "circle-of-power": { saveAdvantage: ["magic"], magicEvasion: true },
  // §160 (spell survey, batch 4: healing, conditions, HP thresholds). Heal: "ends Blinded, Deafened, and Poisoned"; Mass Heal:
  // same, on each target (the pool of 700 HP to distribute: left to the GM — each target regains up to 700); Power Word
  // Heal: "Charmed, Frightened, Paralyzed, Poisoned, Stunned end" (standing up as a Reaction: left to the player).
  "heal": { curesAll: ["blinded", "deafened", "poisoned"] },
  // §296: "up to 700 HP distributed among as many creatures as you like within range (18 m)" — the list, then the shared pool.
  "mass-heal": { curesAll: ["blinded", "deafened", "poisoned"], healPool: { activities: ["eCa5jzMXR0Pgp3ZV"], choose: true },
    pickTargets: { activities: ["eCa5jzMXR0Pgp3ZV"], radius: 60, units: "ft", self: true, check: "allies" } },
  "power-word-heal": { standsWithReaction: true, curesAll: ["charmed", "frightened", "paralyzed", "poisoned", "stunned"] },
  // Remove Curse: "all curses affecting a creature end" — those of spells.
  // C12-e: Eldritch Hex (Great Old One Warlock 10) — "the target also has Disadvantage on saving throws of the
  // chosen ability", on the Hex effect chosen when the caster has the feature.
  "hex": {
    effectChanges: Object.fromEntries([["ljMTBKPVmEnLPX1b", "str"], ["Mmss2SPIy7wtt2PV", "dex"], ["XVQwGWbC0A1svBNm", "con"], ["FfVB2Yyb7wfgpsQB", "int"],
      ["k2569xtIeXKRReLU", "wis"], ["sC2IXWDs07oTt5JN", "cha"]].map(([id, a]) => [id, [{ key: `system.abilities.${a}.save.roll.mode`, type: "add", value: "-1", ifCaster: "eldritch-hex" }]]))
  },
  "remove-curse": { endsCurses: ["bestow-curse", "hex"] },
  // §366: Greater Restoration — "… ends a curse" (the same ones as Remove Curse).
  "greater-restoration": { endsCurses: ["bestow-curse", "hex"] },
  // Regenerate: "the target regains 1 HP at the start of each of its turns" (the "Regenerating" effect is empty).
  "regenerate": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "O73gdwM6cCbr9LXn", do: [{ type: "damage", to: "bearer", formula: "1", damageType: "healing" }] }] },
  // Power Word Fortify: 120 Temporary Hit Points split equally among the targets (up to six).
  "power-word-fortify": { tempHpPool: 120 },
  // Resurrection, True Resurrection: "returns to life with all its HP" (the Dead condition ends: content/spells.mjs, `cures`).
  // §402: "the penalty decreases by 1 with each Long Rest" — the data's four −1 effects fall one by one (day 4 first).
  // Revivify: the spell's text gives a touch range; the data says "self".
  "raise-dead": {
    dataFixes: [{ path: "system.range.units", from: "self", value: "touch" }],
    fadesOnLongRest: ["vyf4vVVoGkZPyAqa", "0EAyGy8YaKbvgvkm", "QUWVMgg2HidYsUxy", "etY0sDrXe6DcFEzc"]
  },
  "resurrection": { revivesFull: true, fadesOnLongRest: ["xHPAupRPOI8N2VkA", "PO5KOrBEorm2xGGz", "NvAysJa5PCR83GRb", "yC37XvN0jzIDyHTr"] },
  "true-resurrection": { revivesFull: true },
  // Power Word Kill: "100 HP or fewer: it dies; otherwise, 12d12 psychic damage".
  "power-word-kill": { hpTiers: [{ atMost: 100, damage: false, statuses: ["dead"] }, {}] },
  // Power Word Stun: "150 HP or fewer: Stunned; otherwise, Speed 0 until the start of your next turn". C12-e:
  // "at the end of each of its turns, it repeats a Constitution save" — the data has no save activity: declared here.
  // C12-j: Protection from Evil and Good — the Heroes of the Borderlands copy gives the activity a "self" range for a
  // touch spell: targeting another creature, in contact.
  // §402: "… already Charmed or Frightened by a creature of those types, it has Advantage on any new save against that effect".
  "protection-from-evil-and-good": { ranges: { zFTMr0vFdY214UIY: { value: 5, units: "ft" } },
    saveAdvantageFrom: { types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"], statuses: ["charmed", "frightened"] } },
  // C12-a: Phantasmal Force — "the target can take the Study action: an Intelligence (Investigation) check against your DC;
  // on a success, the spell ends" (the "Study" activity, offered to the target).
  "phantasmal-force": { actionEnds: { QyPQcXhcl8sTDQ3d: { by: "bearer", roll: "check", spell: true } } },
  // C12-g: Mislead — "you become Invisible at the moment an illusory double of you appears": the "Invisible" effect of
  // the summoning activity goes to the caster (dnd5e applied it to the double); it ends when the caster attacks, deals
  // damage, or casts a spell (`breaksOn`, content/spells.mjs).
  "mislead": { summonEffectsOnCaster: true },
  // C12-d: Dragon's Breath — "touch a willing creature": the creature touched receives "Exhale", which it uses with its own
  // Magic action, at the caster's DC and level, until concentration ends (`grants`, runtime/grants.mjs). "Cast" is given on
  // contact ("self" range in the data).
  "dragons-breath": { ranges: { dnd5eactivity000: { value: 5, units: "ft" } }, grants: { from: "dnd5eactivity000", activity: "61nfYLT1M7MOTibf" } },
  // C12-f: Disintegrate — "a creature reduced to 0 HP by this spell is disintegrated": dead, without death saving throws.
  "disintegrate": { killsAtZero: true },
  // C12-f: Modify Memory — "the spell ends if the target takes damage".
  "modify-memory": { triggers: [{ on: "isDamaged", via: "effect", fromEffect: "ayfixWGhTtaIUusk", do: [{ type: "remove" }] }] },
  "power-word-stun": {
    hpTiers: [{ atMost: 150, effects: ["o7XJceFSBTiIIPFo"] }, { effects: ["B5dLPDfw1fDtfRW1"] }], effectEnds: { B5dLPDfw1fDtfRW1: "casterTurnStart" },
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "o7XJceFSBTiIIPFo", do: [{ type: "resave", ability: "con" }] }]
  },
  // Divine Word, on a failed save: 20 HP or fewer, dead; 30, Blinded, Deafened, Stunned; 40, Blinded and Deafened;
  // 50, Deafened; beyond that, nothing. Two effects of the data lack their conditions. §402: "regardless of its HP", a Celestial,
  // Elemental, Fey, or Fiend that fails is sent back to its home plane (`banish`: removed from the scene and the combat; its
  // return after 24 hours: left to the GM). Durations specific to each tier: left to the GM.
  "divine-word": {
    triggers: [{ on: "failedSave", if: { any: ["celestial", "elemental", "fey", "fiend"].map(t => ({ "target.creatureType": t })) },
      do: [{ type: "banish" }] }],
    hpTiers: [{ atMost: 20, effects: [], statuses: ["dead"] }, { atMost: 30, effects: ["grWj3oo8iH8egvi1"] },
      { atMost: 40, effects: ["8O8KymREuOZFi45g"] }, { atMost: 50, effects: ["qZvAfjU2H6Fg6y6M"] }],
    effectStatuses: { "8O8KymREuOZFi45g": ["blinded", "deafened"], qZvAfjU2H6Fg6y6M: ["deafened"] }
  },
  // §161 (spell survey, batch 5a). See Invisibility: "you see Invisible creatures and objects as if they were
  // visible" (the Ethereal Plane: not included).
  "see-invisibility": { seesInvisible: true },
  // Declared senses (`sense`, core/senses.mjs) — the caster's Divination spells, as long as their effect lasts; stopped by
  // walls (a thickness of stone, earth, wood, metal or lead: the engine only reads "a wall").
  // Detect Evil and Good: the location of creatures of six types, within 9 m.
  "detect-evil-and-good": { sense: { kind: "locate", range: 30, units: "ft", via: "effect", magic: "div",
    detects: { "target.creatureType": ["aberration", "celestial", "elemental", "fey", "fiend", "undead"] } } },
  // Detect Poison and Disease: the location of poisonous creatures, within 9 m (poisons and contagions: objects and
  // effects that the engine does not track).
  "detect-poison-and-disease": { sense: { kind: "locate", range: 30, units: "ft", via: "effect", magic: "div",
    detects: { "target.poisonous": true } } },
  // Detect Magic: an aura around any creature visible within 9 m that carries magic (`reveals: "aura"` — nothing more is
  // located or seen). The spell requires a Magic action to see the aura: it is shown as long as the effect lasts. The school
  // of the magic perceived is left to the GM.
  "detect-magic": { sense: { kind: "locate", range: 30, units: "ft", via: "effect", magic: "div", reveals: "aura",
    detects: { "target.carriesMagic": true } } },
  // What protects against detection (`wardsDetection`). Nondetection: the target cannot be targeted by a Divination spell.
  // Mind Blank: nothing magically detects its location. "Concealment": neither Divination nor magical detection.
  "nondetection": { wardsDetection: ["div"] },
  "mind-blank": { wardsDetection: ["magic"] },
  "sequester": { wardsDetection: ["div", "magic"] },
  // §225, batch 4: Monster Manual 2024 traits — "teleports from the Material Plane to the Ethereal Plane or vice versa"
  // (phase spider); Etherealness also takes the designated creatures along.
  "ethereal-jaunt": { etherealShift: true },
  "ethereal-stride": { etherealShift: { others: true } },
  // Compulsion: §403 — "you can use a Bonus Action to designate a direction… each target must use as much of its movement as
  // possible to move in that direction on its next turn… after moving this way, it repeats the Wisdom save": the direction
  // requested at the start of the caster's turn, the walk on the target's turn (runtime/compulsion.mjs), the save at its end
  // of turn only after that walk (`ifCompelled`).
  "compulsion": { compels: true, triggers: [{ on: "endOfTurn", via: "effect", do: [{ type: "resave", ifCompelled: true }] }] },
  // Telekinesis: on a failed Strength save, "… Restrained until the end of your next turn"; retried with a Magic action during
  // Concentration, without a spell slot (the 9 m move in the chosen direction: up to the GM).
  "telekinesis": {
    recast: true,
    triggers: [{ on: "failedSave", do: [{ type: "status", status: "restrained" }] }],
    effectEnds: { "status:restrained": "casterTurnEnd" }
  },
  // Otiluke's Resilient Sphere: "nothing — physical objects, energy, or other spell effects — can pass through it": the enclosed
  // target is immune to all damage (the "Enclosed in Sphere" effect is empty). §232: "a creature inside the sphere can't damage
  // anything outside" and cannot be reached from outside (`encloses`); "an unwilling creature must succeed" on the save — a
  // willing one is enclosed without a roll (`willingFails`).
  // §283: Otiluke's Freezing Sphere, `phbsplOtilukesFr` — "10d6 Cold damage"; the data ("Cast and Fire", "Throw Held Globe")
  // leaves its damage untyped.
  "otilukes-freezing-sphere": { untypedDamage: "cold" },
  // The SRD data ("Resilient Sphere") does not have the Concentration property that the spell text requires ("Concentration,
  // up to 1 minute"); the Player's Handbook one has it, and is not touched (`from` does not match it).
  "otilukes-resilient-sphere": { dataFixes: [{ path: "system.properties", from: ["vocal", "somatic", "material"],
    value: ["vocal", "somatic", "material", "concentration"] }],
    encloses: true, willingFails: true, effectChanges: { U5UciD171a5jcc7s: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"].map(t => ({ key: "system.traits.di.value", type: "add", value: t })) } },
  // Globe of Invulnerability: "a spell of level 5 or lower cast from outside can't affect anything within the 3 m Emanation"
  // (the globe's slot upcasting: not taken over).
  "globe-of-invulnerability": { globe: { radius: 10, units: "ft", maxLevel: 5 } },
  // Leomund's Tiny Hut (SRD 5.2): "spells of level 3 or lower can't be cast through it, and the effects of such spells can't
  // extend into it" — the same `globe`, at level 3. The spell has neither Concentration nor an effect in the data: a created
  // mark, linked to the activity and placed on the caster (`ranges`: self) holds the globe, for the duration of the spell.
  "tiny-hut": { globe: { radius: 10, units: "ft", maxLevel: 3 }, ranges: { dnd5eactivity000: { units: "self" } },
    dataFixes: [{ effect: "dasTinyHut000000", create: { name: "Tiny Hut", type: "base", transfer: false, disabled: false,
      statuses: [], duration: { value: 8, units: "hours" }, system: { changes: [] } } },
    { path: "system.activities.dnd5eactivity000.effects", from: [], value: [{ _id: "dasTinyHut000000" }] }] },
  // Blink: 1d6 at end of turn, 4–6 → Ethereal until the start of the next turn (runtime/blink.mjs).
  "blink": { blink: "La5ofK0TnPSTL3iq" },
  // Conjure Minor Elementals: "while the spell lasts, your attacks deal 2d8 extra damage (acid, cold, fire or lightning, your
  // choice) to a creature within the 4.50 m Emanation". §403: "the Emanation is Difficult Terrain for your enemies" — the "Cast"
  // activity places the Emanation on the caster (`selfZone`, attached to its token), Difficult Terrain except for its disposition.
  "conjure-minor-elementals": { selfZone: { VSwMJFQoi3KU3Ais: { type: "radius", size: 15, units: "ft" } }, difficultTerrain: { enemiesOnly: true },
    triggers: [{ on: "preDamageRoll",
    if: { "activity.isAttack": true, "source.hasEffect": "conjure-minor-elementals", "target.within": { distance: 15, units: "ft" } },
    do: [{ type: "damage", formula: "2d8", damageType: ["acid", "cold", "fire", "lightning"] }] }] },
  // §162: walls are placed by points (ui/pointer.mjs, `aimWall`) and raise the core walls that they are. Wall of Force, Wall of
  // Ice, Forcecage: nothing passes through them (sight does: Wall of Force is invisible, ice and the cage let you see through);
  // Wall of Stone: neither movement nor sight; Prismatic Wall, Wall of Thorns: sight is blocked, they can be crossed (and their
  // effects suffered). (The AC and HP sections of the ice and stone walls, the creatures caught in the wall: up to the GM.)
  // §169: "opaque" — core walls that block sight, not movement; burning face at 3 m.
  "wall-of-fire": { walls: { move: false, sight: true }, wallSide: { distance: 10, units: "ft" } },
  // §173: thin walls — placed without diagonals, the creatures touching the wall when it appears, a thin ring globe.
  "wall-of-force": { walls: { ethereal: true }, thinWall: true },   // §225: "extends into the Ethereal Plane as well"
  "wall-of-ice": { walls: { activities: ["c4ttlpiIpyf3dFdf", "zjpb29Tww0iuv1P3"] }, thinWall: true },
  "forcecage": { walls: { ethereal: true } },   // §225: "blocks ethereal travel"
  "wall-of-stone": { walls: { sight: true }, thinWall: true },
  // §173: the crossing — all seven layers at once (one save: simplification), blinding at 6 m, nothing passes through;
  // "you and the creatures you designate": the caster and allies spared.
  "prismatic-wall": { walls: { move: false, sight: true, activities: ["5f0JerdDSOQQXiTe", "fOYr1bgsB1VXROcm"] }, thinWall: true, zoneAffects: "enemy",
    coverThrough: "total", prismatic: { indigo: "CbAuJQPoOViKebWs", violet: "EIaFpuWAfQKSkFyp", all: true, activities: ["fxEIn0sNwZReZJhV"] },
    wallAura: { distance: 20, units: "ft", activity: "Pm0Re9Gt8pJNaF1C", on: ["enter", "turnStart"] },
    triggers: [{ on: ["enter"], do: [{ type: "replay", activity: "fxEIn0sNwZReZJhV" }] },
      // C12-b: the indigo layer (Restrained) — same rule as Prismatic Spray: Constitution at end of turn,
      // three successes or three failures.
      { on: "endOfTurn", via: "effect", fromEffect: "CbAuJQPoOViKebWs", do: [{ type: "resave", ability: "con", tally: { successes: 3, failures: 3, status: "petrified" } }] }] },
  // §173: "arrows, bolts and other ordinary projectiles launched at targets behind the wall […] automatically miss".
  "wind-wall": { thinWall: true, coverThrough: { degree: "total", against: "rangedWeapon" } },
  // §172: placed on a row of cells; "for every 30 cm travelled in the wall, 1.20 m must be spent": ×4.
  "wall-of-thorns": { walls: { move: false, sight: true }, cellWall: true, difficultTerrain: { cost: 4 } },
  // §163: Antimagic Field — "spells have no effect on anything in the Emanation, and none can be cast in it" (the suspension of
  // magical effects and objects already there, teleportation: up to the GM); Antilife Shell — "prevents creatures other than
  // Constructs and Undead from entering it or reaching through" (the spell ending when the caster forces a creature through
  // it: up to the GM).
  // §164 (spell survey, batch 5c). Spirits of Summon Elemental (items of the summoned spirit): "a Restrained creature repeats the
  // save at the start of each of its turns; on a failure, 4d8; on a success, it frees itself". Fire: its Restrained effect is
  // linked to nothing.
  "air-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "NGnrAr3HdReYoTjS", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "OeBjTLqhK4uDBBuD" }] }] },
  "earth-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "i5T6yzxlsSnXxGGa", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "BpPMuUAvi25WtIqp" }] }] },
  "fire-element": { choice: { pool: { kKPSUm9WDEDhhQtt: ["BWZxm9qxlXDSF6Dy"] } }, triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "BWZxm9qxlXDSF6Dy", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "5PCXGij7otAlYyL2" }] }] },
  "water-element": { triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "fwIobATMREr7g26x", do: [{ type: "resave" }, { type: "damage", to: "bearer", activity: "K1lCqatPi2PsSDio" }] }] },
  // Summon Celestial: the Cylinder replays, once per turn, when a creature enters it or ends its turn in it — Healing Light
  // for an ally, Searing Light for an enemy (movable: content/movables.mjs). C12-b: also on those it covers when it
  // appears (`enterOnPose`).
  "conjure-celestial": { enterOnPose: true,
    // "Healing Light": the text adds the spellcasting modifier to the 4d12 — the data has only the dice.
    dataFixes: [{ path: "system.activities.ke8eykrnAdAq5nfZ.healing.bonus", from: "", value: "@mod" }],
    triggers: [
    { on: ["enter", "turnEnd"], if: { "target.allied": true }, do: [{ type: "replay", activity: "ke8eykrnAdAq5nfZ" }] },
    { on: ["enter", "turnEnd"], if: { "target.allied": false }, do: [{ type: "replay", activity: "naMU3mLP7jLZu1IG" }] }
  ] },
  // Follow-ups of an already cast spell, which the data (PHB 3.0.0) makes cost a second slot — `consumption.spellSlot` left true,
  // whereas the follow-ups of the other spells (Storm of Vengeance, Prismatic Spray, Weird) have it false.
  // Detect Thoughts: "as a Magic action on a later turn, you can try to probe deeper" ("Probe Deeper"). Summon Fey: "as a Bonus
  // Action on your later turns, you can teleport the spirit" ("Teleport and Attack"). Guardian of Faith, Flaming Sphere: the save
  // of the enemy that approaches the guardian, that the sphere rams or that ends its turn near it — the engine plays it through
  // the summon (content/summons.mjs); clicked on the sheet, it took a slot.
  // Detect Thoughts, perception option: the presence — not the location — of creatures that know a language or
  // are telepathic, within 9 m, as long as Concentration lasts.
  "detect-thoughts": { dataFixes: [{ path: "system.activities.dnd5eactivity000.consumption.spellSlot", from: true, value: false }],
    sense: { kind: "locate", range: 30, units: "ft", via: "effect", magic: "div", reveals: "presence",
      detects: { "target.speaksLanguage": true } } },
  "conjure-fey": { dataFixes: [{ path: "system.activities.sKmRcy0IDp9aOuAt.consumption.spellSlot", from: true, value: false }] },
  "guardian-of-faith": { dataFixes: [{ path: "system.activities.dnd5eactivity100.consumption.spellSlot", from: true, value: false }] },
  "flaming-sphere": { dataFixes: [{ path: "system.activities.dnd5eactivity100.consumption.spellSlot", from: true, value: false }] },
  // Swift Quiver: "when you cast the spell, and as a Bonus Action on each of your later turns, two attacks with a weapon that
  // has Ammunition" — two free open attacks (like Flurry of Blows), the retry on the Bonus Action. (Only a weapon with
  // Ammunition: up to the player.)
  "swift-quiver": { flurry: { activity: "DE7WqJFIWGteZ8xU", strikes: 2, weapons: true }, recast: true, recastCost: "bonus" },
  // Levitate: the target rises 6 m; "when the spell ends, it floats gently to the ground if it is still aloft"
  // (moving with a Magic action: up to the GM). §195: while it levitates, it does not fall — the effect carries Immunity to
  // "Falling" from dnd5e, which would otherwise make it fall as soon as it rises; once the effect is over, it lands on the
  // ground that dnd5e finds under it, without damage.
  // §295: only an unwilling creature saves.
  "levitate": {
    willingFails: true,
    levitate: { effect: "axhLHcJQHprSpHRD", height: 20, units: "ft" },
    effectChanges: { axhLHcJQHprSpHRD: [{ key: "system.traits.ci.value", type: "add", value: "falling" }] }
  },
  // Spider Climb: "a Climb Speed equal to your Speed" — the data effect writes the formula `@attributes.movement.walk`
  // in `upgrade`, which gives 1 ft (§194): replaced by the bearer's Speed, read at placement (§195).
  "spider-climb": {
    effectChanges: { q2ug9SpVRCGuudoG: [{ key: "system.attributes.movement.climb", type: "upgrade", value: "@walk", replace: true }] }
  },
  // Reverse Gravity: on a failure, the creature falls upward, to the top of the Cylinder (30 m); once the spell is over, it falls
  // (§195: the dnd5e fall, 1d6 per 3 m, Prone if it takes damage).
  "reverse-gravity": { triggers: [{ on: "failedSave", do: [{ type: "lift", height: 100, units: "ft" }] }] },
  // Prismatic Spray: a d8 per target for the color (the replayed save of indigo, the teleportation of violet: up to the GM).
  "prismatic-spray": { prismatic: { indigo: "cCQh7iXKnT8PKmc1", violet: "jFAGct9YCYvLJodW" } },
  // Hail of Thorns: "immediately after hitting a creature with a ranged weapon"; the target and each creature within 1.50 m
  // of it make the save.
  "hail-of-thorns": { smite: { save: "dnd5eactivity000", ranged: true, burst: { radius: 5, units: "ft" } } },
  // §288: Lightning Arrow — "when your attack hits or misses the target […] instead of taking the damage and other effects of
  // the attack, the target takes 4d8 lightning damage if the attack hits, half as much if it misses. Each creature within 3 m of
  // the target then makes a Dexterity saving throw" (2d8, half). The data: a save without an ability (the 4d8) and
  // a damage activity without a save (the 2d8).
  "lightning-arrow": { smite: { damage: "dnd5eactivity000", ranged: true, replaces: true, onMiss: "half",
    blast: { activity: "dnd5eactivity200", radius: 10, units: "ft", ability: "dex" } } },
  // §288: Dispel Evil and Good — the "Cast" effect (RMeb9TUrFdhXMTzz) is missing from the data: a trace on the caster carries the
  // Disadvantage (content/triggers.mjs); Dismissal and Break Enchantment end the spell; Break Enchantment ends Charmed or
  // Frightened.
  // §459: "Cast" still cites this missing effect (Handbook 3.0.0; SRD 6.1 has it, empty) — the link is removed, the engine's
  // trace is enough.
  "dispel-evil-and-good": { trace: { activity: "0vS3We98acymzUXC" }, endsOnUse: ["dnd5eactivity000", "eBbyE0du7mEJWDbZ"],
    cures: ["charmed", "frightened"], curesOn: "eBbyE0du7mEJWDbZ",
    dataFixes: [{ path: "system.activities.0vS3We98acymzUXC.effects", from: [{ _id: "RMeb9TUrFdhXMTzz" }], value: [] }] },
  // §288: Maze — the "Banished" effect (empty) carries the target away (§265); "it can take the Study action to try to
  // escape: Intelligence (Investigation) check DC 20; on a success, it escapes and the spell ends" — offered at the start of
  // its turn.
  "maze": { checkPoses: true, banishes: ["y7cYsJ0DCzXt4Tvy"], actionEnds: { y7cYsJ0DCzXt4Tvy: { by: "bearer", roll: "check", spell: true, turnStart: true } } },
  "antimagic-field": { globe: { radius: 10, units: "ft", maxLevel: 9, everywhere: true } },
  // §459: Handbook 3.0.0 lost the "Antilife Shell" effect that its activity places (SRD 6.1 has it: a one-hour mark on the
  // caster) — recreated; the barrier also holds through Concentration (adapter/barriers.mjs, any effect coming from the spell).
  "antilife-shell": { barrier: { radius: 10, units: "ft", exceptTypes: ["construct", "undead"] },
    dataFixes: [{ effect: "IrE5td3goSQtcc0U", create: { name: "Antilife Shell", type: "base", transfer: false, disabled: false, statuses: [],
      img: "icons/magic/control/silhouette-hold-beam-blue.webp", duration: { value: 3600, units: "seconds", expiry: "turnStart" },
      system: { magical: true, changes: [] } } }] },
  "arcane-gate": { pointWall: false },
  "gate": { pointWall: false },
  "demiplane": { pointWall: false },
  "mordenkainens-magnificent-mansion": { pointWall: false },
  "conjure-woodland-beings": {
    // C12-c: "Disengage" — the activity's Bonus Action gives the Disengage action.
    basicActions: { GAQKUmYcWR3SjxiV: "disengage" },
    selfZone: { dnd5eactivity000: { type: "radius", size: 10, units: "ft" } },
    zoneAffects: "enemy",
    triggers: [{ on: ["enter", "turnEnd"], do: [{ type: "replay", activity: "UkXLSgFbCBI9CHMf" }] }]
  },
  // §295 (term-by-term pass, batch C1) —
  // Shield: "until the start of your next turn"; cast as a Reaction on an enemy's turn, the data's "1 round" duration was
  // counted from that combatant.
  "shield": { effectEnds: { Bv3EoHGfYCprLdG1: "casterTurnStart" } },
  // §296 (batch C2) — Slow: "up to six creatures of your choice in a 12 m Cube"; Beacon of Hope: "as many creatures as
  // you like within range (9 m)", yourself included. (Group healing, healing an area: deferred, the dnd5e roll goes off
  // before the area.)
  "slow": { zoneAffects: "enemy", zoneMax: 6 },
  // §300: "up to six creatures" — chosen from the list, within range (60 ft). Simplification: the 9 m sphere around a point
  // is not checked.
  // §300: "Create Aura" — the casting's healing goes to ONE creature of the aura (30 ft), of your choice.
  "aura-of-vitality": { pickTargets: { activities: ["dnd5eactivity000"], radius: 30, units: "ft", self: true, check: "allies", max: 1 } },
  "mass-cure-wounds": { pickTargets: { activities: ["dnd5eactivity000"], radius: 60, units: "ft", self: true, check: "allies", max: 6 } },
  "beacon-of-hope": { pickTargets: { activities: ["dnd5eactivity000"], radius: 30, units: "ft", self: true, check: "allies" } },
  // Enlarge/Reduce (and Levitate, above): only an UNWILLING creature saves — an ally fails automatically.
  "enlarge-reduce": { willingFails: true },
  // Holy Aura: the Fiend or Undead attacker is Blinded "until the end of its next turn".
  "holy-aura": { effectEnds: { wqBjgsd2xRnmSm8Z: "bearerTurnEnd" } },
  // Contact Other Plane: 6d6 psychic "on a failure" only (the data: half on a success).
  "contact-other-plane": { saveDamage: { dnd5eactivity000: "none" } },
  // Geas: the 5d10 only fall if the target disobeys (up to the GM, damage of the effect) — not at casting.
  "geas": { noDamage: ["dnd5eactivity000"] },
  // Conjure Animals, Dream: the damage only falls on a failed save, but the data's activity carries
  // `onSave: "half"`. For the pack, the "Pack Damage" item of the summoned creature (which the engine plays: content/summons.mjs)
  // already says "none"; the spell's activity, clicked on the sheet, dealt half on a success.
  "conjure-animals": { dataFixes: [{ path: "system.activities.dnd5eactivity100.damage.onSave", from: "half", value: "none" }] },
  "dream": { dataFixes: [{ path: "system.activities.dnd5eactivity000.damage.onSave", from: "half", value: "none" }] }
});
