/**
 * O1 (SPEC §335): defects in the data of the premium items (2024 Dungeon Master's Guide, 2024 Player's Handbook, Ravenloft),
 * fixed by identifier — key `dataFixes` (core/data-fixes.mjs), written when the item is created and by the diagnostic. Activity and
 * effect ids surveyed in the `equipment` / `items` packs of the premium modules (DMG 2.0.0, PHB 2.2.0, Ravenloft 1.0.1).
 * `from`: the module's original value; a value changed by hand does not move.
 */

/** An effect change, in the format of dnd5e 6 effects (V14: `system.changes`). */
const change = (key, type, value) => ({ key, value, priority: null, type });

/** "Advantage on D20 Tests": attack rolls, saving throws (death saves too) and ability checks. */
const D20_TEST_ADVANTAGE = Object.freeze([
  ...["str", "dex", "con", "int", "wis", "cha"].flatMap(a => ["attack", "save", "check"]
    .map(roll => change(`system.abilities.${a}.${roll}.roll.mode`, "add", 1))),
  change("system.attributes.death.roll.mode", "add", 1)]);
/** A part of an activity's damage. */
const part = (number, denomination, types, bonus="") => ({ custom: { enabled: false, formula: "" }, number, denomination, bonus, types, scaling: { number: 1 } });
const formulaPart = (formula, types) => ({ custom: { enabled: true, formula }, number: null, denomination: 0, bonus: "", types, scaling: { number: 1 } });
const DART = types => [formulaPart("1d6", types)];

/** A consumption of uses (of the item or of the activity). */
const spend = (type, value) => ({ type, value: String(value), target: "", scaling: {} });

/** A "Reload" activity for a Guide weapon with reloading (model: the Automatic Rifle). */
const reload = (_id, name, type, shots) => ({
  _id, type: "utility", name,
  activation: { type, value: null, override: false, condition: "" },
  consumption: { scaling: { allowed: false }, spellSlot: true, targets: [spend("itemUses", -shots)] },
  uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
  target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: true },
  duration: { units: "inst", concentration: false, override: false }, effects: [], roll: { prompt: false, visible: false, name: "", formula: "" }
});
const reloads = shots => [
  { path: "system.activities.dasReloadAction0", value: reload("dasReloadAction0", "Reload (Action)", "action", shots) },
  { path: "system.activities.dasReloadBonus00", value: reload("dasReloadBonus00", "Reload (Bonus Action)", "bonus", shots) }
];

/** A carried effect created on the item. */
const worn = (name, changes) => ({ name, type: "base", transfer: true, disabled: false, statuses: [], system: { changes } });

/** Armor of Vulnerability: the data writes "bludegoning"; the bludgeoning Resistance and Vulnerability were not applied. */
const vulnerability = (resists) => ["bludgeoning", "piercing", "slashing"].map(t => change(`system.traits.${t === resists ? "dr" : "dv"}.value`, "add", t));
const vulnerabilityFrom = (resists) => vulnerability(resists).map(c => ((c.value === "bludgeoning") ? { ...c, value: "bludegoning" } : c));

/** O3: the Charmed of the Rings of Elemental Command lasts "until the start of your next turn" (the data counts anyone's turn). */
const CHARMED_UNTIL_NEXT_TURN = Object.freeze({ cN85nWiTzfGzWR7D: "casterTurnStart" });

/** O7: Elemental Bane — "Advantage on attack rolls against Elementals, which have Disadvantage on theirs against you". */
const ELEMENTAL_BANE = Object.freeze([
  { on: "preAttackRoll", if: { "target.creatureType": "elemental" }, do: [{ type: "advantage" }] },
  { on: "preAttackRoll", defends: true, if: { "source.creatureType": "elemental" }, do: [{ type: "disadvantage" }] }
]);

/** §346: the moonlight of the Moon Sickle; flames on a blade (the core's "torch" animation). */
const MOONLIGHT = Object.freeze({ bright: 15, dim: 30, units: "ft" });
const FLAMES = Object.freeze({ type: "torch", speed: 2, intensity: 2 });

/** Wand of Wonder: none of its activities declares its action (Magic). */
const WONDER_ACTIVITIES = ["Z62czXwABB7SN1lP", "4h4Aazi3L1MmByOt", "76MvwJBXwm1GbzfW", "F6QdFpERu7c4x6cd", "uDrKgJTXIcF0EM33", "yMZ4RIhJV1jvkKaf",
  "DIkFGxynTge6LTPJ", "Go7QGLKLGLggVcNK", "EhdR11nT5sMOi9h5", "cKz4qaK2elWiFRCS", "2x5DGGxGI3bgymqf", "6kTej94dEVrwxM9D", "hohchQU2VPFVUIWG",
  "R4TuLg6r7fTmIMF9", "Wxry2v7kMU16VG7T"];

/** Pearl of Power rosary: "casting a pearl spell takes a Bonus Action" — the activities follow the spell's action. */
const PRAYER_BEADS = ["SEwmmaZFABa5L61F", "i1xNzPeIb7VkHrh6", "yiGuTjneUv0F9NnC", "xjMwMrJpNfh3HZyP", "FGwlSZAUgTaknnt1", "VBwVZg8g1vPZ1xep"];

/**
 * §454: Nature's Sanctuary (Druid, Circle of the Land, level 14; SRD 5.2). In the compendium of the dnd5e 6.1 SRD
 * (`classes24`), and in its copy in the Player's Handbook 3.0.0, the feature has lost its four effects: its "Place Sanctuary
 * (Arid / Polar / Temperate / Tropical)" activities point to ids absent from the item, and dnd5e places nothing (neither
 * half Cover nor Resistance).
 * The SRD's premade (`actors24`, Druid level 17) still has them: they are recreated as they are, with their ids, and each
 * activity points only to the effect of its terrain (the data gave it all four).
 */
const SANCTUARY = [["dnd5eactivity000", "h0xW0mOYF8frKgHf", "Arid", "fire"], ["aNIM3GrB97GSNZHG", "7YVMASgXswIFXNs2", "Polar", "cold"],
  ["G1htmQaxEZ0kwRK0", "Gqgjm2NswU6f7qVL", "Temperate", "lightning"], ["0FT3EzkaLnht95Eo", "LKxwXqkEIXJR2XAa", "Tropical", "poison"]];
const SANCTUARY_FIXES = [
  ...SANCTUARY.map(([, effect, land, type]) => ({ effect, create: { name: `Nature's Ward: ${land}`, type: "base", transfer: false,
    disabled: false, img: "icons/magic/nature/vines-thorned-curled-glow-green.webp", statuses: ["coverHalf"],
    duration: { value: null, units: "seconds" }, system: { changes: [change("system.traits.dr.value", "add", type)] } } })),
  ...SANCTUARY.map(([activity, effect]) => ({ path: `system.activities.${activity}.effects`,
    from: SANCTUARY.map(([, id]) => ({ _id: id })), value: [{ _id: effect }] }))
];

export const ITEM_FIXES = Object.freeze({
  "natures-sanctuary": { dataFixes: SANCTUARY_FIXES },
  // Ring of Animal Influence (SRD 5.2): "Fear (affects only Beasts)" — the data's activity casts the spell as is.
  "ring-of-animal-influence": { spellTargets: { kn4eCuLZrcps7ujc: { types: ["beast"] } } },
  // Trident of Fish Command (SRD 5.2): Dominate Beast "on a Beast that has a Swim Speed". The spell already says "a Beast";
  // the item adds the swimming.
  "trident-of-fish-command": { spellTargets: { ANM9wvqTFJSH2o11: { unaffectedIf: { not: { "target.hasSpeed": "swim" } } } } },
  // Rings of Elemental Command (one identifier for the four: content/sources.mjs separates them). Air: "a fly Speed equal to
  // your Speed" — the effect gives only hovering. Earth: Wall of Stone at the ring's DC 18, not at the bearer's.
  // Water: "Aquatic, a swim Speed of 18 m" — no effect in the data.
  "ring-of-elemental-command-air": { grantsSpeeds: { fly: "walk" }, effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE },
  "ring-of-elemental-command-earth": {
    effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE,
    dataFixes: [{ path: "system.activities.xpuvWA5Jy39MYwCg.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 18, override: true } }]
  },
  // O3: Elemental Compulsion, "Charmed until the start of your next turn".
  "ring-of-elemental-command-fire": { effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE },
  "ring-of-elemental-command-water": {
    effectEnds: CHARMED_UNTIL_NEXT_TURN, triggers: ELEMENTAL_BANE,
    dataFixes: [{ effect: "dasWaterFocus000", create: worn("Water Focus", [change("system.traits.languages.value", "add", "aquan"), change("system.attributes.movement.swim", "upgrade", 60)]) }]
  },
  // Ring of X-ray Vision: the failed save targets an absent effect; "you suffer a level of Exhaustion" (runtime/cure.mjs raises
  // it).
  "ring-of-x-ray-vision": {
    dataFixes: [{ effect: "InZzuugyN8PbtKGR", create: { name: "Exhaustion", type: "base", transfer: false, disabled: false, statuses: ["exhaustion"], system: { changes: [] } } },
      // Guide 3.0.0: the save no longer designates any effect (2.0.0 designated this one, absent) — the Exhaustion
      // was no longer placed.
      { path: "system.activities.v41FhJBMoCPTochw.effects", from: [], value: [{ _id: "InZzuugyN8PbtKGR" }] }]
  },
  // Wands of Polymorph and of Web: "expend 1 charge" — their activities consume nothing.
  "wand-of-polymorph": { dataFixes: [{ path: "system.activities.dJ9lbA7B6ysE0Md8.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  "wand-of-web": { dataFixes: [{ path: "system.activities.P7PnWcum8exAm2EG.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  // Wand of Wonder: the Magic action, absent from all its activities (no cost counted).
  "wand-of-wonder": { dataFixes: WONDER_ACTIVITIES.map(id => ({ path: `system.activities.${id}.activation.type`, from: "", value: "action" })) },
  // Guide weapons with reloading: without a "Reload" activity (the Automatic Rifle has two), the weapon stays empty.
  "antimatter-rifle": { dataFixes: reloads(2) },
  "laser-pistol": { dataFixes: reloads(50) },
  "laser-rifle": { dataFixes: reloads(30) },
  // Trebuchet: the shot spends the activity's uses (none) instead of the item's charges that "Load" fills.
  // O8h (§351): and its minimum range ("can't hit a target within 18 m"), like the Mangonel below.
  "trebuchet": {
    minRange: { value: 60, units: "ft" },
    dataFixes: [{ path: "system.activities.GkViNDrZd4rImGoq.consumption.targets", from: [{ type: "activityUses", value: "2", scaling: {} }], value: [spend("itemUses", 2)] }]
  },
  // Revolver: the Guide's firearms table gives it 2d8 piercing — the Guide's item rolls 2d6.
  "revolver": { dataFixes: [{ path: "system.damage.base.denomination", from: 6, value: 8 }] },
  // Guide unarmed attack: "1 + Strength modifier" (the Handbook's), not "modifier + proficiency".
  "unarmed-strike": {
    dataFixes: [{
      path: "system.damage.base",
      from: { number: null, denomination: 0, types: ["bludgeoning"], custom: { enabled: true, formula: "@mod + @prof" }, scaling: { number: 1 }, bonus: "" },
      value: { number: null, denomination: null, types: ["bludgeoning"], custom: { enabled: false, formula: "" }, scaling: { number: 1 }, bonus: "1 + @mod" }
    }]
  },
  // Rod of Lordly Might: the attacks of the buttons carry neither the weapon's die, nor the modifier, nor the +3. Button 1:
  // a magic Longsword "that deals an extra 2d6 fire damage"; button 2: a Battleaxe (+3); button 3: a Spear (+3).
  "rod-of-lordly-might": {
    dataFixes: [
      { path: "system.activities.apuqiDlUPRWfQkhf.damage.parts", from: [part(2, 6, ["fire"], "-3")], value: [part(1, 8, ["slashing"], "@mod"), part(2, 6, ["fire"])] },
      { path: "system.activities.BsQ1WDJiSRkltvi5.damage.parts", from: [part(1, 8, ["slashing"])], value: [part(1, 8, ["slashing"], "@mod + 3")] },
      { path: "system.activities.5Mhd70dNk5UBYbXW.damage.parts", from: [part(1, 10, ["slashing"])], value: [part(1, 10, ["slashing"], "@mod + 3")] },
      { path: "system.activities.CVIAWq4QHDwg2R3U.damage.parts", from: [part(1, 8, ["piercing"])], value: [part(1, 6, ["piercing"], "@mod + 3")] }
    ]
  },
  // Scimitar of Speed: its attack has "special" activation (no cost counted); "one attack with it as a Bonus Action
  // on each of your turns" — the normal attack takes its place in the Attack action, a second activity carries the Bonus Action.
  "scimitar-of-speed": {
    dataFixes: [
      { path: "system.activities.bV5R1UvwSlRZ3Ffi.activation.type", from: "special", value: "action" },
      { path: "system.activities.bV5R1UvwSlRZ3Ffi.activation.condition", from: "Action or Bonus Action", value: "" },
      { path: "system.activities.dasSpeedBonusAtk", value: {
        _id: "dasSpeedBonusAtk", type: "attack", name: "Bonus Action Attack",
        activation: { type: "bonus", value: null, override: false, condition: "" },
        consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
        target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: true },
        duration: { units: "inst", concentration: false, override: false },
        attack: { critical: { threshold: null }, flat: false, type: { value: "", classification: "" }, ability: "", bonus: "" },
        damage: { critical: { bonus: "" }, includeBase: true, parts: [] }, effects: []
      } }
    ]
  },
  // Staff of Power: "+2 to AC, saving throws and spell attack rolls" — no effect carried in the data.
  "staff-of-power": {
    // Guide 3.0.0: the item now carries these bonuses ("Staff of Power" effect) — ours doubled them (`unless`).
    dataFixes: [{ effect: "dasStaffOfPower0", unless: "3qnJecDB1SMFTNLw",
      create: worn("Staff of Power", [change("system.attributes.ac.bonus", "add", "+2"),
      change("system.bonuses.abilities.save", "add", "+2"), change("system.bonuses.msak.attack", "add", "+2"), change("system.bonuses.rsak.attack", "add", "+2")]) }]
  },
  // Staff of Withering: "Disadvantage on Strength and Constitution checks and saves" — the Withered effect is empty.
  "staff-of-withering": {
    dataFixes: [{ effect: "x0R9R2vD4quIgYy2", path: "system.changes", from: [], value: ["str", "con"].flatMap(a => [
      change(`system.abilities.${a}.check.roll.mode`, "add", "-1"), change(`system.abilities.${a}.save.roll.mode`, "add", "-1")]) }]
  },
  // Glittering Helm: typed light armor, it replaced the worn armor (Unarmored Defense, Mage Armor, formation): a wondrous item.
  "helm-of-brilliance": { dataFixes: [{ path: "system.type.value", from: "light", value: "wondrous" }] },
  // Dynamite Stick: the throw has "personal" range (the Sphere fell on the caster); "thrown up to 18 m".
  // O9h (§363): the bundle — "each stick after the first increases the damage by 1d6"; `@scaling` is 1 for a single stick (dnd5e,
  // Scaling: the increase + 1), the data's formula gave 4d6 instead of 3d6.
  "dynamite-stick": { ranges: { "8vYrGCuiK0BcQ8k9": { value: 60, units: "ft" }, "4aJqDXopO4psnUXg": { value: 60, units: "ft" } },
    dataFixes: [{ path: "system.activities.4aJqDXopO4psnUXg.damage.parts.0.custom.formula", from: "(3 + @scaling)d6", value: "(2 + @scaling)d6" }] },
  // Torch: its attack spends a use that the item does not have (attack refused).
  // O9a (§354): "used as a Simple melee weapon" — dnd5e does not add proficiency to the attack of a consumable
  // (`@prof` is 0 there: the item's proficiency); the character's.
  "torch": {
    dataFixes: [
      { path: "system.activities.SouNhSdWdnznKCam.consumption.targets", from: [spend("itemUses", 1)], value: [] },
      { path: "system.activities.SouNhSdWdnznKCam.attack.bonus", from: "", value: "@attributes.prof" }
    ]
  },
  // Oil of Sharpness: "the coated weapon becomes a +3 Weapon" — the data's enchantment expires after one minute.
  "oil-of-sharpness": {
    dataFixes: ["qwUNBZRXUAvDcqDw", "RcpoKs7oJMugW7ib"].flatMap(effect => [
      { effect, path: "duration.value", from: 60, value: null }, { effect, path: "duration.expiry", from: "turnStart", value: null }])
  },
  // Oil of Slipperiness: pouring it on the ground does not consume the vial. O9h (§363): Freedom of Movement and Grease "for 8
  // hours" (the spell copies kept 1 hour and 1 minute).
  "oil-of-slipperiness": { dataFixes: [{ path: "system.activities.IQsAg45adQPcbS86.consumption.targets", from: [], value: [spend("itemUses", 1)] }],
    castDuration: { seconds: 28800 } },
  // Potion of Animal Friendship: save "DC 13", not the drinker's.
  "potion-of-animal-friendship": {
    dataFixes: [{ path: "system.activities.0Ecazu341cv88FXR.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 13, override: true } }]
  },
  // Potion of Mind Reading: without a use, drinking it does not consume it.
  "potion-of-mind-reading": {
    dataFixes: [{ path: "system.uses.max", from: "", value: "1" }, { path: "system.uses.autoDestroy", from: false, value: true }]
  },
  // Healing potions (Guide, Heroes of the Borderlands): "personal" range, they did not raise an ally at 0 HP; on touch,
  // like the Potion of Supreme Healing.
  "potion-of-healing": { dataFixes: [{ path: "system.activities.ZyWmXem7zzQwFFcF.range.units", from: "self", value: "touch" }] },
  "superior-potion-of-healing": { dataFixes: [{ path: "system.activities.eT46ucSUynLRTs6N.range.units", from: "self", value: "touch" }] },
  "supreme-potion-of-healing": { dataFixes: [{ path: "system.activities.GsHW5KoST4fZ30YX.range.units", from: "self", value: "touch" }] },
  // Poisoned Darts (trap): "1d3 darts, 1d6 poison each" (then 2d6, 4d6, 7d6 per dart depending on the level).
  // O2: a successful save avoids all the darts (the data gave half of them).
  "poisoned-darts": {
    saveDamage: { RvICMGIB0eFj7glp: "none", MSTCr3QSYGyolvAe: "none", dmaXYLZqje000jxt: "none", NDPRYh9wNKYZuDbL: "none" },
    dataFixes: [
      { path: "system.activities.RvICMGIB0eFj7glp.damage.parts", from: DART(["poison"]), value: [formulaPart("(1d3)d6", ["poison"])] },
      { path: "system.activities.MSTCr3QSYGyolvAe.damage.parts", from: [formulaPart("(1d3) * 2d6", ["poison"])], value: [formulaPart("(2 * 1d3)d6", ["poison"])] },
      { path: "system.activities.dmaXYLZqje000jxt.damage.parts", from: [part(4, 6, ["poison"])], value: [formulaPart("(4 * 1d3)d6", ["poison"])] },
      { path: "system.activities.NDPRYh9wNKYZuDbL.damage.parts", from: [part(7, 6, ["poison"])], value: [formulaPart("(7 * 1d3)d6", ["poison"])] }
    ]
  },
  "armor-of-vulnerability": {
    dataFixes: [["4JvSdW6SAx9uNYFH", "bludgeoning"], ["4htDgvx8qAmPJhBP", "slashing"], ["DiTXdHv9zE9HriKI", "piercing"]].map(([effect, type]) => ({
      effect, path: "system.changes", from: vulnerabilityFrom(type), value: vulnerability(type) }))
  },
  // Dwarven Belt: its single effect is shipped disabled.
  // O2: "Advantage on saves against the Poisoned condition".
  "belt-of-dwarvenkind": { saveAdvantage: ["poisoned"], dataFixes: [{ effect: "HNruvcSEl25DRvjj", path: "disabled", from: true, value: false }] },
  // Cloak of the Prestidigitator: "once per day" — the activity does not spend the use.
  "cape-of-the-mountebank": { dataFixes: [{ path: "system.activities.qsuojT0nn8ZkAY19.consumption.targets", from: [], value: [spend("itemUses", 1)] }] },
  // Cloak of the Bat: "a fly Speed of 12 m" — the flight effect gives none.
  "cloak-of-the-bat": {
    dataFixes: [{ effect: "LOByj7F1KjZdSUMi", path: "system.changes", from: [], value: [change("system.attributes.movement.fly", "upgrade", 40)] }]
  },
  // Eye and Hand of Vecna: "7d6 necrotic damage, half on a success" — the activity has no damage part.
  "eye-and-hand-of-vecna": { dataFixes: [{ path: "system.activities.Bgj4VKh3jykOu3P6.damage.parts", from: [], value: [part(7, 6, ["necrotic"])] }] },
  // Gem of Seeing: the key "trueseight" does not exist; the Truesight of 36 m.
  "gem-of-seeing": {
    dataFixes: [{ effect: "z8fm5PbP5qz4iJuP", path: "system.changes", from: [change("system.attributes.senses.trueseight", "upgrade", 120)],
      value: [change("system.attributes.senses.ranges.truesight", "upgrade", 120)] }]
  },
  // Gloves of Swimming and Climbing: "climb and swim Speeds equal to your Speed" — the effect adds 1 ft (the engine took
  // that foot for a real climb Speed): granted separately, the effect keeps the +5 to Athletics.
  "gloves-of-swimming-and-climbing": {
    grantsSpeeds: { climb: "walk", swim: "walk" },
    dataFixes: [{ effect: "Nh870Ujh6Eqy0RFi", path: "system.changes",
      from: [change("system.skills.ath.bonuses.check", "add", 5), change("system.attributes.movement.climb", "add", 1), change("system.attributes.movement.swim", "add", 1)],
      value: [change("system.skills.ath.bonuses.check", "add", 5)] }]
  },
  // Helm of Telepathy: Suggestion "once, until the next dawn".
  "helm-of-telepathy": {
    dataFixes: [
      { path: "system.activities.KeNwSWKR7BsH8e9G.uses", from: { spent: 0, recovery: [], max: "" }, value: { spent: 0, recovery: [{ period: "dawn", type: "recoverAll" }], max: "1" } },
      { path: "system.activities.KeNwSWKR7BsH8e9G.consumption.targets", from: [], value: [spend("activityUses", 1)] }
    ]
  },
  // Bilarro's Iron Bands: "can't be used again before the next dawn".
  "iron-bands-of-bilarro": {
    dataFixes: [
      { path: "system.uses", from: { spent: 0, recovery: [], max: "" }, value: { spent: 0, recovery: [{ period: "dawn", type: "recoverAll" }], max: "1" } },
      { path: "system.activities.YvxUL75GlG2OoFMg.consumption.targets", from: [], value: [spend("itemUses", 1)] }
    ],
    // O9a (§354): "a creature that can touch the bands, the Restrained one included, can take an action to make a DC 20 Strength
    // (Athletics) check" — that of the "Break Check" activity (a new failed attempt is left to the GM).
    actionEnds: { IgRS1gR2uBlWZnIK: { by: "bearer", roll: "check" } }
  },
  // Ioun Stone of Awareness: "Advantage on Initiative rolls and Wisdom (Perception) checks" — only Initiative was there.
  "awareness-ioun-stone": {
    dataFixes: [{ effect: "P2rx8Fq56YpwQfSm", path: "system.changes", from: [change("flags.dnd5e.initiativeAdv", "override", 1)],
      value: [change("flags.dnd5e.initiativeAdv", "override", 1), change("system.skills.prc.roll.mode", "add", 1)] }]
  },
  // Ioun Stone of Fortitude: "+2 to Constitution" — the data increases Strength.
  "fortitude-ioun-stone": {
    dataFixes: [{ effect: "hOigjfupZtZR2cy9", path: "system.changes",
      from: [change("system.abilities.str.value", "add", 2), change("system.abilities.str.value", "downgrade", 20)],
      value: [change("system.abilities.con.value", "add", 2), change("system.abilities.con.value", "downgrade", 20)] }]
  },
  // Iron Flask: "a creature you can see within 18 m" — the data says "personal".
  "iron-flask": { ranges: { UVei1X4pYM1VZDWv: { value: 60, units: "ft" } } },
  "necklace-of-prayer-beads": {
    dataFixes: PRAYER_BEADS.flatMap(id => [
      { path: `system.activities.${id}.activation.type`, from: "action", value: "bonus" },
      { path: `system.activities.${id}.activation.override`, from: false, value: true }])
  },
  // Onyx Dog: the mastiff's effect is transferred to the figurine's bearer (Blindsight of 18 m).
  // O4: like the other figurines, the mastiff acts right after its master.
  "onyx-dog-rare": { summon: { initiative: "after" }, dataFixes: [{ effect: "fMC3o8l8D2GamPbU", path: "transfer", from: true, value: false }] },
  // Comet (SRD 5.2): "you have Advantage on death saving throws for 1 year" — the "Death Save
  // Advantage" effect carries no change.
  comet: { dataFixes: [{ effect: "asqZlVwoKSS1ckCU", path: "system.changes", from: [],
    value: [change("system.attributes.death.roll.mode", "add", 1)] }] },
  // Hunting Trap (SRD 5.2): "its Speed is reduced to 0 until the start of its next turn; then, as long as it has not freed
  // itself, its movement is limited by the length of the chain (1 m in general)" — the "Trapped" effect is empty. The
  // Speed stays at 0 as long as the effect is carried: 1 m of chain does not let it leave its cell (a reading, not the text).
  "hunting-trap": { dataFixes: [{ effect: "9jl46RZ5GOjs9QlJ", path: "system.changes", from: [],
    value: [change("system.attributes.movement.multiplier", "override", "0")] }] },
  // Falling Net (SRD 5.2, trap): "the target succeeds automatically if it is Huge or larger" — the data's four
  // triggers make every creature roll the save.
  "falling-net": { saveAutoSuccess: { sizeAtLeast: "huge" } },
  // Broom of Flying (SRD 5.2): "fly Speed of 15 m […] which drops to 9 m if it carries more than 100 kg" — the "Activate
  // Broom" activity links the two effects (light load, heavy load) without a target: nothing was placed. It targets its user, who
  // chooses one of the two.
  "broom-of-flying": { choice: { effects: "one" },
    dataFixes: [{ path: "system.activities.2wrq53BtZk3dUEuW.target.affects.type", from: "", value: "self" }] },
  // Candle of Invocation (SRD 5.2): "while you are in this light, you have Advantage on D20 Tests" —
  // "Light Candle" links the "Lit Candle" effect without designating a target, and the effect is empty: nothing was placed.
  // The target becomes the user; the effect receives the Advantage on attack rolls, saving throws (death saves included) and
  // ability checks.
  "candle-of-invocation": { dataFixes: [
    { path: "system.activities.hG1Iplp3uG2fd39N.target.affects.type", from: "", value: "self" },
    { effect: "gN0PgSLPlbsD8T2g", path: "system.changes", from: [], value: D20_TEST_ADVANTAGE }] },
  // Rod of Alertness (SRD 5.2): "while you hold the rod, you have Advantage on Wisdom (Perception) checks and
  // Initiative rolls" — the data carries only the protective aura's effect.
  "rod-of-alertness": { dataFixes: [{ effect: "dasRodAlertness0", create: worn("Alertness", [
    change("system.skills.prc.roll.mode", "add", 1), change("system.attributes.init.roll.mode", "add", 1)]) }] },
  // "Cavalier's Shield" (SRD 5.2), Violent Strike: "if the target is a creature, you can push it up to 3 m; if it is your
  // size or smaller, you can also knock it Prone" — the data puts "Knocked Down" on every target hit and pushes nobody.
  // The push, optional in the rule, is always applied.
  "shield-of-the-cavalier": { effectsIf: { "target.sizeAtMost": "source" },
    triggers: [{ on: "hit", if: { "activity.id": "ABPaLpY5mrKpB4ou" },
      do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }] },
  // Dimensional Shackles (SRD 5.2): "the shackles prevent the creature they bind from using any extradimensional
  // means of movement, including teleportation" — the data's "Dimensionally Bound" effect is empty.
  "dimensional-shackles": { noTeleport: true },
  // Wand of Fear (SRD 5.2): "Fear (18 m cone)" — the data's activity casts the spell as is, 9 m cone.
  "wand-of-fear": { spellFixes: { "9c7SNgBZU2KJjgFg": [{ path: "system.target.template.size", from: "30", value: "60" }] } },
  // Staff of Charming (SRD 5.2), Resist Enchantment: "if you fail a saving throw against an enchantment spell that
  // targets only you, you can turn that failure into a success; not again until dawn" — the data's activity does nothing.
  // Reflect Enchantment: "if you succeed […], you can use your Reaction to expend 1 charge and turn the spell back on its
  // caster, as if you had cast it" (`saveReflect`).
  "staff-of-charming": { saveResist: { activity: "tEk1wNWngqDYOgOB", schools: ["enc"], singleTarget: true },
    saveReflect: { activity: "t8vD0vJ4MzCZIku2", schools: ["enc"], singleTarget: true } },
  // Orb of Dragonkind: "7 charges, 1d4 + 3 at dawn" — the item has none, its paid spells were refused.
  "orb-of-dragonkind": {
    dataFixes: [{ path: "system.uses.max", from: "", value: "7" }, { path: "system.uses.recovery", from: [], value: [{ period: "dawn", type: "formula", formula: "1d4 + 3" }] }]
  },
  // SRD 5.2 Orb of Dragonkind (`dragon-orb`): same defect as the Dungeon Master's Guide orb — "the orb has 7 charges and
  // regains 1d4 + 3 each day at dawn", the item has none.
  "dragon-orb": {
    dataFixes: [{ path: "system.uses.max", from: "", value: "7" },
      { path: "system.uses.recovery", from: [], value: [{ period: "dawn", type: "formula", formula: "1d4 + 3" }] }]
  },
  // Philter of Love (SRD 5.2): "you have the Charmed condition for 1 hour" — the data's effect lasts 10 minutes (the time limit to
  // see a creature after drinking).
  "philter-of-love": { dataFixes: [{ effect: "MLhvjPiSXOX1tkUr", path: "duration.value", from: 600, value: 3600 }] },
  // Mirror of Life Trapping (SRD 5.2): "Constructs automatically succeed on the saving throw".
  "mirror-of-life-trapping": { saveAutoSuccess: { types: ["construct"] } },
  // Periapt of Wound Closure: "a roll of 9 or lower on a death saving throw becomes 10" — no effect.
  "periapt-of-wound-closure": {
    dataFixes: [{ effect: "dasPeriaptWound0", create: worn("Periapt of Wound Closure", [change("system.attributes.death.roll.min", "upgrade", 10)]) }]
  },
  // Robe of Stars: "+1 to saving throws" — no effect.
  // Dungeon Master's Guide 3.0.0: the item now carries its +1 to saves ("Saving Throw Bonus" effect) —
  // ours doubled it (`unless`).
  "robe-of-stars": { dataFixes: [{ effect: "dasRobeOfStars00", unless: "RcwWrY6u4OPM5qZl",
    create: worn("Robe of Stars", [change("system.bonuses.abilities.save", "add", "+1")]) }] },
  // §457–§458: the six "48 hours of reading over 6 days" books of the Dungeon Master's Guide (+2 to an ability score,
  // maximum 30). "Read" ticks off one hour (48 uses). Its data applied the effect of another book (copy-paste from Guide
  // 2.0.0: Quickness, Gainful Exercise, Bodily Health, Clear Thought) or its own at every hour (Leadership, Understanding):
  // removed; the +2 is applied once, when the last hour exhausts the book (`onUsesSpent`, runtime/uses-spent.mjs). It
  // replaces the GM alert of §366 and §457.
  "manual-of-quickness-of-action": { onUsesSpent: { activity: "MeBH48FuUmQFEhUM", effects: ["yjQAL2g65jahNoBP"] },  // Dexterity
    dataFixes: [{ path: "system.activities.MeBH48FuUmQFEhUM.effects", from: [{ _id: "9npFjYvEL3twc99F" }], value: [] }] },
  "manual-of-gainful-exercise": { onUsesSpent: { activity: "QoMjlu00wQebXPDg", effects: ["ME2J4WX5cDLqGWDW"] },  // Force
    dataFixes: [{ path: "system.activities.QoMjlu00wQebXPDg.effects", from: [{ _id: "9npFjYvEL3twc99F" }], value: [] }] },
  "manual-of-bodily-health": { onUsesSpent: { activity: "L5OnUjZIn27NHd2E", effects: ["7W1n7zchV0g7BKyq"] },  // Constitution
    dataFixes: [{ path: "system.activities.L5OnUjZIn27NHd2E.effects", from: [{ _id: "9npFjYvEL3twc99F" }], value: [] }] },
  "tome-of-clear-thought": { onUsesSpent: { activity: "OCFufJcLGbTJqDqS", effects: ["nDtcdGVAy36CP4Wn"] },  // Intelligence
    dataFixes: [{ path: "system.activities.OCFufJcLGbTJqDqS.effects", from: [{ _id: "jXvtCEBoDCydH8fa" }], value: [] }] },
  "tome-of-leadership-and-influence": { onUsesSpent: { activity: "3dQNGt7ALqZaPgkD", effects: ["9npFjYvEL3twc99F"] },  // Charisme
    dataFixes: [{ path: "system.activities.3dQNGt7ALqZaPgkD.effects", from: [{ _id: "9npFjYvEL3twc99F" }], value: [] }] },
  "tome-of-understanding": { onUsesSpent: { activity: "5cPQGohyjYHSemQF", effects: ["jXvtCEBoDCydH8fa"] },  // Sagesse
    dataFixes: [{ path: "system.activities.5cPQGohyjYHSemQF.effects", from: [{ _id: "jXvtCEBoDCydH8fa" }], value: [] }] },
  // §457: Horseshoes of a Zephyr — "Attach Horseshoes" applies the "Faster" effect of the Horseshoes of Speed (`9lS2…`,
  // absent from the item), and the item lost its own. Recreated from SRD 6.1 (`equipment24`): ignore Difficult Terrain.
  "horseshoes-of-a-zephyr": { dataFixes: [
    { effect: "AYtAkgcEHRws0Qeo", create: { name: "Ignore Difficult Terrain", type: "base", transfer: false, disabled: false, statuses: [],
      img: "icons/tools/smithing/horsehoe-worn-steel-grey.webp", duration: { value: null, units: "seconds" },
      system: { magical: true, changes: [change("system.attributes.movement.ignoredDifficultTerrain", "add", "all")] } } },
    { path: "system.activities.Bm8dAa2MyA5NhcPU.effects", from: [{ _id: "9lS2LxCve4hPYGMn" }], value: [{ _id: "AYtAkgcEHRws0Qeo" }] }
  ] },
  // Sword of Sharpness: "an extra 14 slashing damage" on a 20 — the data makes it necrotic.
  "sword-of-sharpness": {
    dataFixes: [{ effect: "nxid1s2CZrB06HH8", path: "system.changes", from: SHARPNESS("14d1[necrotic]"), value: SHARPNESS("14[slashing]") }]
  },
  // Net: the activity points to a missing effect ("Caught in Net" has another id); "replaces one of the attacks of the
  // Attack action". O2: "a creature of Huge size or larger automatically succeeds".
  "net": {
    replacesAttack: ["3u15g2fvhp6MyN5O"],
    targets: { unaffectedIf: { not: { "target.sizeAtMost": "lg" } } },
    dataFixes: [{ path: "system.activities.3u15g2fvhp6MyN5O.effects", from: [{ _id: "cMQAYD7OnCQK6Ux9", onSave: false }], value: [{ _id: "67ofG0FVqrrkAHKa", onSave: false }] }]
  },
  /* ---- O2 (§336): saving throws and defenses, through the existing keys ---- */

  // "Advantage on saving throws against spells" — worn and attuned (adapter/saves.mjs).
  "mantle-of-spell-resistance": { saveAdvantage: ["magic"] },
  "ring-of-spell-turning": { saveAdvantage: ["magic"] },
  // O9e (§358): "… and spell attack rolls have Disadvantage against you" (the shield held).
  "spellguard-shield": { saveAdvantage: ["magic"], triggers: [{ on: "preAttackRoll", defends: true, if: { "activity.isSpell": true }, do: [{ type: "disadvantage" }] }] },
  "robe-of-the-archmagi": { saveAdvantage: ["magic"] },
  "scarab-of-protection": { saveAdvantage: ["magic"] },
  // O9b (§355): "Ebony Bane" — "when you hit a Celestial or a Humanoid, the attack also deals 3d6 necrotic damage"; the data
  // put them on every hit: removed from the attack, added on hit according to the type.
  "ebonbane": {
    saveAdvantage: ["magic"],
    dataFixes: [{ path: "system.activities.SDii9JGqHIjeOxdv.damage.parts", from: [{ number: 3, denomination: 6, types: ["necrotic"] }], value: [] }],
    ...BANE("ebonbane", ["celestial", "humanoid"], "3d6", "necrotic")
  },
  // "Advantage on saving throws against the Poisoned condition".
  "necklace-of-adaptation": { saveAdvantage: ["poisoned"] },
  "periapt-of-health": { saveAdvantage: ["poisoned"] },
  // Antitoxin: "Advantage on saving throws against the Poisoned condition for 1 hour" — the applied effect is empty; it now
  // carries the mark that adapter/saves.mjs reads (the vial is often consumed before the effect is applied).
  "antitoxin": {
    dataFixes: [{ effect: "DzWVacNiq6ggXbU9", path: "system.changes", from: [], value: [change("flags.dnd5e-combat.saveAdvantage.poisoned", "override", true)] }]
  },
  // Ring of Warmth: "cold damage you take is reduced by 2d8".
  "ring-of-warmth": { damageShield: { worn: "cold", formula: "2d8" } },
  // Holy Water: "on a success, no damage" (the data gave half).
  // O4: the throw "replaces one of the attacks of the Attack action".
  "holy-water": { saveDamage: { ArV3jMOIvfj5c5y9: "none" }, replacesAttack: ["ArV3jMOIvfj5c5y9"] },
  // Pale Tincture: nothing on a success; the Poisoned effect was not tied to the saving throw.
  "pale-tincture": {
    saveDamage: { Xm0k8JLnz00jgCg7: "none" },
    // O9a (§354): "poison damage can't be healed by any means while the creature is Poisoned".
    blocksHealing: true,
    dataFixes: [
      { path: "system.activities.Xm0k8JLnz00jgCg7.effects", from: [], value: [{ _id: "o6ZuvxhWeXsg50MH", onSave: false }] },
      // O9a (§354): the data's "HP maximum + 0" (to be set by hand) dropped to 0 once applied: the target died. Removed,
      // `blocksHealing` does the job.
      { effect: "o6ZuvxhWeXsg50MH", path: "system.changes", from: [{ key: "system.attributes.hp.max", value: 0, type: "add" }], value: [] }
    ]
  },
  // Lolth's Sting: Unconscious "if the roll is failed by 5 or more"; Poisoned on any failure.
  // O3: "wakes up if it takes damage or if another creature shakes it (an action)" — Poisoned remains.
  "lolths-sting": {
    failMargins: { zEQTKqd3uBj660cR: { min: 5 } },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "zEQTKqd3uBj660cR", do: [{ type: "remove" }] }],
    actionEnds: { zEQTKqd3uBj660cR: { by: "other", verb: "wake" } }
  },
  // Tentacle Rod: the Restrained saving throw inflicts nothing; the 3d6 apply at the start of the target's turns (batch O3).
  // O3: "3d6 psychic damage at the start of each of its turns", save repeated at the end (attached at 15 ft: §366;
  // releasing the target: remove the effect).
  // §366: "as long as it stays within 4.50 m" — the Restrained creature is freed as soon as the bearer and it are more than
  // 15 ft apart.
  "tentacle-rod": {
    endsWhen: { apart: { distance: 15, units: "ft" } },
    noDamage: ["yuASV7hKz3sa7L5P"],
    triggers: [
      { on: "startOfTurn", via: "effect", fromEffect: "JVnjmXHqpPkyKBXS", do: [{ type: "damage", to: "bearer", activity: "y9MnFdJWUat9KhbD" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "JVnjmXHqpPkyKBXS", do: [{ type: "resave" }] }
    ]
  },
  // "Sneezing Powder": "Constructs, Elementals, Oozes, Plants and Undead automatically succeed".
  // O3: "repeats the roll at the end of each of its turns".
  "dust-of-sneezing-and-choking": { includesOrigin: true, triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "AZcO17cLsTHbb0P9", do: [{ type: "resave" }] }], targets: { unaffectedIf: { any: ["construct", "elemental", "ooze", "plant", "undead"].map(t => ({ "target.creatureType": t })) } } },
  // Keoghtom's Ointment: "ends the Poisoned condition".
  "keoghtoms-ointment": { curesAll: ["poisoned"] },
  // Talismans: Disadvantage on the saving throw for Fiends and Undead (ultimate good), Celestials (absolute evil).
  // O9a (§354): "on a failure, the target falls into the fissure and is destroyed" — Dead; on a success, the data's 4d6.
  "talisman-of-pure-good": { saveDisadvantageFor: ["fiend", "undead"], triggers: [{ on: "failedSave", if: { "activity.id": "aXBr8uIgXMNnZdfy" }, do: [{ type: "status", status: "dead" }] }] },
  "talisman-of-ultimate-evil": { saveDisadvantageFor: ["celestial"], triggers: [{ on: "failedSave", if: { "activity.id": "zknPGzuSFtET9BIe" }, do: [{ type: "status", status: "dead" }] }] },

  /* ---- O3 (§337): end of effects, repeated saving throws, wake-ups ---- */

  // "It repeats the roll at the end of each of its turns" — Paralyzed, Frightened, Stunned, Blinded, Incapacitated with no end
  // in the data.
  "wand-of-paralysis": { effectDurations: { AwFDnHD5U7aOOzds: { seconds: 60 } }, triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "AwFDnHD5U7aOOzds", do: [{ type: "resave" }] }] },
  "whelm": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "esmyGn6aLpCfWsFm", do: [{ type: "resave" }] }] },
  "gem-of-brightness": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "05Lok63szRXdAafx", do: [{ type: "resave" }] }] },
  "pipes-of-haunting": { triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "29Rm9ru4fP60YFj3", do: [{ type: "resave" }] }] },
  // Carrion Crawler Mucus: the Paralyzed and Poisoned effect was not tied to the saving throw.
  "carrion-crawler-mucus": {
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "a9KfUV3KbbB5wrFY", do: [{ type: "resave" }] }],
    dataFixes: [{ path: "system.activities.StL0A8FviYKfGlQ8.effects", from: [], value: [{ _id: "a9KfUV3KbbB5wrFY", onSave: false }] }]
  },
  // Robe of Scintillating Colors: "Stunned until the effect ends", the end of your next turn; Staff of Thunder and Lightning:
  // "until the end of your next turn".
  "robe-of-scintillating-colors": { effectEnds: { yQoovzqIXdUiUcU4: "casterTurnEnd" } },
  // §457: "Thunder and Lightning" = Lightning (2d6) and Thunder (save or Stunned) together; the data (like SRD 6.1) adds an
  // empty damage part to it, removed.
  "staff-of-thunder-and-lightning": {
    effectEnds: { UTstWNbk0NXrKgS6: "casterTurnEnd" },
    dataFixes: [{ path: "system.activities.EtOETCHaEK0mcw03.damage.parts",
      from: [{ number: 2, denomination: 6, types: ["lightning"] }, { number: null, types: [] }], value: [part(2, 6, ["lightning"])] }]
  },
  // Dust of Disappearance: "right after an attack, damage or spell, the Invisible condition ends for that creature".
  // O9h (§363): "you and each creature and object within a 3 m Emanation" — the caster included; "for 2d4 minutes", the same
  // duration for all.
  "dust-of-disappearance": { breaksOn: ["attack", "damage", "spell"], includesOrigin: true,
    effectDurations: { MC5GAZMrAc4wSvAS: { formula: "2d4", units: "minutes" } } },
  // Oil of Taggit, Essence of Ether: Poisoned and Unconscious were a single effect; the creature "wakes up if it takes
  // damage" (or is shaken, for Essence of Ether) and stays Poisoned — the Poisoned becomes a separate effect.
  "oil-of-taggit": SLEEP_POISON("3E9Bg4ZYt098PHwu", "H2a1ShsSWCmSWfW7", "dasTaggitPoison0", 86400),
  "essence-of-ether": SLEEP_POISON("LyJvv1MFK97vRKM5", "izr2j393TujCLu53", "dasEtherPoison00", 28800),

  /* ---- O4 (§338): costs, areas, summons, smoke, light ---- */

  // Acid, Alchemist's Fire: "replace one of the attacks of the Attack action with throwing a vial"
  // (the whole action otherwise).
  "acid": { replacesAttack: ["PnWlLChqr5JsfCJC"] },
  "alchemists-fire": { replacesAttack: ["NVclbplLi9uFhKQE"] },
  // Item summons: the creature "acts right after you" (shares your Initiative) — they did not join combat.
  ...Object.fromEntries(["elemental-gem", "blue-elemental-gem", "emerald-elemental-gem", "red-elemental-gem", "yellow-elemental-gem",
    "bowl-of-commanding-water-elementals", "brazier-of-commanding-fire-elementals",
    "censer-of-controlling-air-elementals", "stone-of-controlling-earth-elementals", "bag-of-tricks", "bronze-griffon-rare", "ebony-fly-rare",
    "golden-lions-rare", "ivory-goats", "marble-elephant-rare", "obsidian-steed-very-rare", "serpentine-owl-rare",
    "silver-raven-uncommon"].map(id => [id, { summon: { initiative: "after" } }])),
  // "Baba Yaga's Dancing Broom": the object requires attunement per its text — the Dungeon Master's Guide item requires none.
  "baba-yagas-dancing-broom": { summon: { initiative: "after" }, dataFixes: [{ path: "system.attunement", from: "", value: "required" }] },
  // Horn of Valhalla: the warriors "roll their Initiative" and act on their turn.
  "silver-horn-of-valhalla": { summon: { initiative: "own" } },
  // Animated Shield (SRD 5.2): "remains animated for 1 minute, […] or until you die or have the Incapacitated condition".
  "animated-shield": { endsWhen: { incapacitated: "bearer" } },
  // SRD 5.2 — the other horns (brass, bronze, iron, and the generic item), like the silver one; the creatures an item brings
  // in that act on their own: the djinni of the Ring, the efreeti of the Bottle, the creature of the Iron Flask, the swarms of
  // the Pipes of the Sewers ("not under your control"). Without a declaration, placed in the middle of combat, they did not
  // enter it.
  ...Object.fromEntries(["brass-horn-of-valhalla", "bronze-horn-of-valhalla", "iron-horn-of-valhalla", "horn-of-valhalla",
    "ring-of-djinni-summoning", "efreeti-bottle", "iron-flask", "pipes-of-the-sewers"]
    .map(id => [id, { summon: { initiative: "own" } }])),
  // Staff of the Python: "the snake shares your Initiative count and takes its turn right after yours".
  "staff-of-the-python": { summon: { initiative: "after" } },
  // What is not a creature that acts: the whip of the Feather Token and the Dancing Sword (commanded by a Bonus Action of their
  // bearer), the image of the Deck of Illusions, the Flying Carpet.
  ...Object.fromEntries(["whip-feather-token", "dancing-sword", "deck-of-illusions", "carpet-of-flying"]
    .map(id => [id, { summon: { initiative: "none" } }])),
  // Smoke: "the area is heavily obscured" — Smoke Grenade, Smoke Urn, swarm of the "Staff of the Great Swarm".
  "grenade-smoke": { obscures: true },
  "eversmoking-bottle": { obscures: true },
  // Staff of Swarming Insects: its text restores 1d6 + 4 charges at dawn — the Dungeon Master's Guide item restores only 1d6.
  "staff-of-swarming-insects": { obscures: true, dataFixes: [{ path: "system.uses.recovery",
    from: [{ period: "dawn", type: "formula", formula: "1d6" }], value: [{ period: "dawn", type: "formula", formula: "1d6 + 4" }] }] },
  // Truth Serum: its text gives a DC of 11 — the item's saving throw is at 10.
  "truth-serum": { dataFixes: [{ path: "system.activities.gZRykfpoTDxT6cqO.save.dc.formula", from: "10", value: "11" }] },
  // Crystal Ball of Truesight: its text requires attunement and gives a DC of 17 to its Scrying — neither attunement nor DC
  // in the item, whereas the other three crystal balls of the Dungeon Master's Guide have them.
  "true-seeing-crystal-ball-of": { dataFixes: [
    { path: "system.attunement", from: "", value: "required" },
    { path: "system.activities.EsEZwTpUoGAXQskP.spell.challenge", from: { attack: null, save: null, override: false }, value: { attack: null, save: 17, override: true } }
  ] },
  // Mace of Terror: "each creature of your choice within 9 m of you" — centered on the bearer, allies spared.
  // (O3: "repeats the roll at the end of each of its turns".)
  "mace-of-terror": { ranges: { owojSA2KZWmv61Nj: { units: "self" } }, zoneAffects: "enemy",
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "amYapIKWPpJZ9EuO", do: [{ type: "resave" }] }] },
  // Decanter of Endless Water, Geyser: "one creature" in the Line, not all of them.
  // O9a (§354): Geyser — "on a failure, the creature falls Prone" (the data's text applies only the damage).
  "decanter-of-endless-water": { zoneMax: 1, zoneAffects: "enemy", triggers: [{ on: "failedSave", if: { "activity.id": "QObmaE8dWI8pIXFE" }, do: [{ type: "status", status: "prone" }] }] },
  // Lantern of Revealing: "burns for 6 hours with a flask of Oil, Bright Light for 9 m and Dim Light for 9 m more" (revealing
  // invisible creatures remains with the GM).
  "lantern-of-revealing": { carriedLight: { bright: 30, dim: 60, units: "ft", burn: { value: 6, units: "hour" }, fuel: "oil" } },
  // Bag of Beans (poured out): the explosion also hits the one who pours them.
  "bag-of-beans": { includesOrigin: true },

  /* ---- O5b (§340): extra damage against a creature type ---- */

  // Enchanted weapons (`<identifiant>-enchanted`: the weapon that carries the enchantment, adapter/content.mjs) —
  // Dragon Slayer: "an extra 3d6 damage of the weapon's type if the target is a Dragon"; Giant Slayer: "2d6 of the weapon's type"
  // against a Giant (its saving throw against Prone: batch O5c); Holy Avenger: "2d10 radiant" against a Fiend or an Undead;
  // "Executioner's Axe": "2d6 slashing" against a Humanoid (Temporary Hit Points: left to the GM).
  // §346: weapon light. Moon-Touched Sword: "drawn in Darkness, the blade sheds moonlight: Bright Light for 4.50 m
  // and Dim Light for 4.50 m more" (drawing: item menu), the item itself or the weapon it enchants.
  // Flame Tongue: "these flames shed Bright Light for 12 m and Dim Light for 12 m more",
  // as long as the "Ablaze" enchantment is on the weapon; flames of the Helm of Brilliance
  // ("Burst Into Flames"): bright for 3 m, dim for 3 m more.
  "moon-touched-sword": { carriedLight: MOONLIGHT },
  // Wand of the War Mage (SRD 5.2): "you ignore half cover when making a spell attack roll" —
  // the data's object carries only the bonus to spell attack rolls.
  "1-wand-of-the-war-mage-enchanted": { rangedFeat: { kind: "spell", cover: "half" } },
  // Dragon Scale Mail (SRD 5.2): "you have Advantage on saving throws against the breath of Dragons" — the +1 to AC and
  // the Resistance according to the dragon are in the data.
  "dragon-scale-mail-enchanted": { breathAdvantage: { types: ["dragon"] } },
  // Demon Armor (SRD 5.2), curse: "while you wear the armor, you have Disadvantage on attack rolls against demons and
  // on saving throws against their spells and special abilities" — nothing in the data.
  "demon-armor-enchanted": { saveDisadvantageAgainst: { subtypes: ["demon"] },
    triggers: [{ on: "preAttackRoll", if: { "target.creatureSubtype": "demon" }, do: [{ type: "disadvantage" }] }] },
  // Dwarven Plate (SRD 5.2): "if an effect moves you against your will along the ground, you can use your Reaction to
  // reduce the distance by up to 3 m" — the data's "Reduce Unwilling Movement" activity does not touch the engine's pushes.
  "dwarven-plate-enchanted": { reducesForcedMove: { distance: 10, units: "ft" } },
  // Ring of Shooting Stars (SRD 5.2), Lightning Spheres: "On a failed save, the creature takes Lightning damage based on the
  // number of spheres you created" — 1: 4d12, 2: 5d4, 3: 2d6, 4: 2d4; half on a success (the data's `onSave: "half"`). The data's
  // save has no damage part: it is given the one-sphere row, and `damageByCount` takes the row of the number created.
  "ring-of-shooting-stars": {
    damageByCount: { GLyk6XaqTk5JOVQ8: { from: "sZwpvVE0OpUNXe2B", formulas: ["4d12", "5d4", "2d6", "2d4"] } },
    dataFixes: [{ path: "system.activities.GLyk6XaqTk5JOVQ8.damage.parts", from: [],
      value: [{ number: 4, denomination: 12, bonus: "", types: ["lightning"], custom: { enabled: false, formula: "" },
        scaling: { mode: "", number: 1 } }] }] },
  "moon-touched-sword-enchanted": { carriedLight: MOONLIGHT },
  "flame-tongue-enchanted": { carriedLight: { bright: 40, dim: 80, units: "ft", animation: FLAMES, whileEnchanted: "MHnAqxEXBhUbnjPq" } },
  "helm-of-brilliance-enchanted": { carriedLight: { bright: 10, dim: 20, units: "ft", animation: FLAMES, whileEnchanted: "oZBFpi117yOXca3k" } },
  "dragon-slayer-enchanted": BANE("dragon-slayer", ["dragon"], "3d6", "weapon", true),
  // §345: "…and must succeed on a DC 15 Strength saving throw or fall Prone" (no saving throw activity in the data).
  "giant-slayer-enchanted": { triggers: [...BANE("giant-slayer", ["giant"], "2d6", "weapon", true).triggers,
    { on: "hit", if: { "target.creatureType": "giant" }, do: [{ type: "status", status: "prone", save: { ability: "str", dc: 15 } }] }] },
  "holy-avenger-enchanted": BANE("holy-avenger", ["fiend", "undead"], "2d10", "radiant", true),
  "executioners-axe-enchanted": BANE("executioners-axe", ["humanoid"], "2d6", "slashing", true),
  // Mace of Smiting (SRD 5.2): "on a 20 on the attack roll […], if a Construct has 25 Hit Points or fewer after taking
  // this damage, it is destroyed". The bonuses and the damage of the 20 are in the data;
  // the condition is applied after the damage.
  "mace-of-smiting": { triggers: [{ on: "hit",
    if: { "hit.critical": true, "target.creatureType": "construct", "target.hpAtMost": 25 },
    do: [{ type: "status", status: "dead" }] }] },
  // Weapons that carry their own identifier — Mace of Disruption: "2d6 radiant" against a Fiend or an Undead; "Radiant
  // Sword": "1d8 radiant" against an Undead; Sword of Kas: "2d10 slashing" against an Undead.
  // O9a (§354): "at 25 HP or fewer after this damage, DC 15 Wisdom saving throw or destroyed; on a success, Frightened"
  // — the data applied Frightened on a failure and never destroyed.
  "mace-of-disruption": {
    triggers: [...BANE("mace-of-disruption", ["fiend", "undead"], "2d6", "radiant").triggers,
      { on: "failedSave", if: { "activity.id": "sUoIpd68kJWIxRaU", "target.hpAtMost": 25 }, do: [{ type: "status", status: "dead" }] }],
    savedEffects: ["Z49QSPjltZ1NT28K"]
  },
  // §346: "the luminous blade emits Bright Light for 4.50 m and Dim Light for 4.50 m more" (the blade appears and disappears:
  // item menu; setting the radius with a Magic action remains with the GM).
  "sun-blade": { ...BANE("sun-blade", ["undead"], "1d8", "radiant"), carriedLight: { bright: 15, dim: 30, units: "ft" } },
  "sword-of-kas": BANE("sword-of-kas", ["undead"], "2d10", "slashing"),

  /* ---- O5c (§341) : options au toucher, critiques ---- */

  // Sword of Sharpness (enchantment): "on a 20, an extra 14 slashing damage and one level of Exhaustion"
  // (the 14: the data's Critical Hit, batch O1).
  "sword-of-sharpness-enchanted": { triggers: [{ on: "hit", if: { "hit.critical": true }, do: [{ type: "status", status: "exhaustion" }] }] },
  // Staff of Striking: "when you hit, you can expend up to 3 charges: 1d6 force damage per charge"
  // — offered at the damage roll, one charge per offer (the data's damage activity cost an action).
  "staff-of-striking": { hitRider: { damage: "sviFeLqVM4b4jHvc", item: "staff-of-striking" } },
  // Ring of the Ram: "if the attack hits, the target is pushed 1.50 m" (per charge expended: one charge, 1.50 m).
  // Dagger of Venom (§345): "a Bonus Action to coat the blade; the poison lasts 1 minute or until an attack with this
  // weapon hits: DC 15 Constitution saving throw or 2d10 poison damage and Poisoned"
  // — the "Poison Save" saving throw is imposed only under the "Poison Coat" enchantment, which the hit removes.
  "dagger-of-venom": { onHit: { save: "VHStJ3hZGwHAHcUQ", whileEnchanted: "f0WvHHwmTfdkF3OP", spends: true } },
  "ring-of-the-ram": { triggers: [{ on: "hit", do: [{ type: "move", mode: "push", distance: 5, units: "ft" }] }] },

  /* ---- O6 (§342): item Reactions (worn, and attuned if needed: adapter/triggers.mjs) ---- */

  // Ring of Evasion: "when you fail a Dexterity saving throw, a Reaction and 1 charge: you succeed".
  "ring-of-evasion": { rollBonus: { activity: "8uTVtEN7h4Mp33gB", on: ["save"], abilities: ["dex"], succeed: true } },
  // "Acrobat's Staff": "hit by an attack, a Reaction and 1 charge: +5 to AC against that attack" (like Shield).
  "quarterstaff-of-the-acrobat": {
    triggers: [{ on: "isHit", if: { "hit.stoppableBy": 5 }, do: [{ type: "use", activity: "uGF83fO9tijt8I01" }, { type: "penalty", formula: "5" }] }]
  },
  // Gloves of Missile Snaring: "hit by a ranged attack or a thrown weapon attack, a Reaction: damage reduced by 1d10 + Dex".
  "gloves-of-missile-snaring": {
    triggers: [{ on: "isHit", if: { "activity.isWeapon": true, "activity.isMelee": false }, do: [{ type: "use", activity: "x4IPCLTGbrUwWZxn" }, { type: "reduce" }] }]
  },
  // "Staff of the Thaumaturge": "a Reaction when another creature casts a spell that targets only you: the staff absorbs
  // its magic, cancels its effect and gains as many charges as the spell's level" (§344). The explosion beyond 50 charges
  // remains with the GM.
  "staff-of-the-magi": { gmAlert: { key: "BatonMage", activities: ["QcfPhLX9LBvOnShu"] }, saveAdvantage: ["magic"], triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "QcfPhLX9LBvOnShu" }, { type: "cancel" }] }] },
  // Rod of Absorption: "a Reaction to absorb a spell that targets only you and produces no area of effect; its effect is
  // canceled, its energy stored" (§344) — the "Absorb Spell" activity spends as many uses as the spell's level.
  "rod-of-absorption": { triggers: [{ on: "isTargeted", do: [{ type: "use", activity: "y66MTczY5BQfIonF" }, { type: "cancel" }] }] },
  // O8d (§347): Arrow-Catching Shield — "+2 to AC against ranged attack rolls, in addition to the shield's bonus; when an
  // attacker makes a ranged attack roll against a target within 1.50 m of you, you can use a Reaction to become the target".
  // The optional effect of the data ("Ranged Attack AC Bonus") stays disabled: the engine counts the +2 itself.
  "arrow-catching-shield": {
    rangedDefense: { ac: 2 },
    triggers: [{ on: "enemyAttacks", if: { "activity.isAttack": true, "activity.isMelee": false, "target.isSelf": false,
      "target.nearSelf": { distance: 5, units: "ft" } }, do: [{ type: "use", activity: "KZLj6yQjI7Ps1KkW" }, { type: "intercept" }] }]
  },
  // Shield of Missile Attraction: Resistance to damage from ranged weapon attacks; curse: such an attack against a creature
  // within 3 m of the bearer targets the bearer instead (lifting the curse remains with the GM).
  "shield-of-missile-attraction": { rangedDefense: { resistance: true, attract: 10 } },
  // O8e (§348): Berserker Axe — "Disadvantage on attack rolls with weapons other than this one" (curse, attuned); Oathbow —
  // "while your sworn enemy lives, Disadvantage on attack rolls with all other weapons" (the "Sworn Enemy" effect applied by
  // "Swear Oath"). The Axe's berserk rage remains with the GM.
  // O9c (§356): and its berserk rage — "whenever another creature damages you: DC 15 Wisdom or berserk rage".
  // "Vengeful Sword": the same Disadvantage with the other weapons, and "wounded in combat: DC 15 Wisdom or you attack whoever
  // wounded you".
  "berserker-axe-enchanted": { exclusiveWeapon: true, wrath: { kind: "berserk", save: { ability: "wis", dc: 15 } } },
  "sword-of-vengeance-enchanted": { exclusiveWeapon: true, wrath: { kind: "vengeance", save: { ability: "wis", dc: 15 } } },
  // §353: and against the sworn enemy, "Advantage on the roll; the target gains no benefit from half or
  // three-quarters cover, and no Disadvantage at long range".
  // The 3d6 Piercing: the data's "Attack Sworn Enemy" activity, to be chosen against it.
  "oathbow-enchanted": { exclusiveWeapon: { whileEffect: "EWoLqkPJeK9dwYhn" }, swornEnemy: { effect: "EWoLqkPJeK9dwYhn" } },
  // O8f (§349): hostile summons — The Skull (Deck of Many Things): "an Avatar of Death appears […]
  // vanishes at 0 HP or at your death"; "Scroll of Titan Summoning":
  // "the titan is Hostile toward all other creatures and vanishes at 0 HP". Own Initiative; "it targets only you"
  // and the avatar of the allies that wound it remain with the GM.
  "skull": { gmAlert: { key: "AvatarMort" }, summon: { initiative: "own", hostile: true, vanishesAtZero: true, vanishesWithCaster: true } },
  "scroll-of-titan-summoning": { gmAlert: { key: "Titan" }, summon: { initiative: "own", hostile: true, vanishesAtZero: true } },
  // O8h (§351): siege weapons in indirect fire — "cannot hit a target within 18 m of it" (the Trebuchet above;
  // firing over walls remains with the GM).
  "mangonel": { minRange: { value: 60, units: "ft" } },
  // O9g (§362): Boots of Speed — "Click Heels" did not target its bearer
  // (the effect went to the designated target, or to nobody): on self;
  // and "a creature that makes an Opportunity Attack against you has Disadvantage" as long as the effect is there.
  "boots-of-speed": {
    dataFixes: [{ path: "system.activities.ffXywPJdVzwe6NId.target.affects.type", from: "", value: "self" }],
    opportunityDisadvantage: { whileEffect: "XP45fDHAojcVjDc0" }
  },
  // O9g (§361): Cloak of Elvenkind — "Wisdom (Perception) checks made to perceive you have Disadvantage". "You have
  // Advantage on Dexterity (Stealth) checks": in the SRD 5.2 compendium, the worn effect has only an empty change — it
  // receives its key.
  "cloak-of-elvenkind": { hardToPerceive: true, dataFixes: [STEALTH_ADVANTAGE("hyU6mHq6YNhLZlTY")] },
  // Boots of Elvenkind (SRD 5.2): "you have Advantage on Dexterity (Stealth) checks" — same empty change.
  "boots-of-elvenkind": { dataFixes: [STEALTH_ADVANTAGE("gHyJQGFKkZJ2rbUe")] },
  // Potion of Invulnerability (SRD 5.2): "for 1 minute after drinking it, you have Resistance to all damage"
  // — the data says 10 minutes, on the activity as on the effect.
  "potion-of-invulnerability": {
    dataFixes: [{ effect: "ojfKVnyWWyc5EPA2", path: "duration.value", from: 600, value: 60 },
      { path: "system.activities.WGHHrNkceMYEl8as.duration.value", from: "10", value: "1" }]
  },
  // O9g (§360): The Jester (Deck of Many Things) — "Advantage on d20 Tests for 72 h": the "Card Effect: Advantage" activity
  // applied nothing; a 72 h effect is added to it (ability checks, saving throws, skills; attack rolls: §366).
  "jester": {
    // §366: attack rolls too (dnd5e has no effect key for their mode).
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "dasJesterAdvant0", if: { "source.hasEffect": "jester" }, do: [{ type: "advantage" }] }],
    dataFixes: [
      { effect: "dasJesterAdvant0", create: { name: "Jester: Advantage", type: "base", transfer: false, disabled: false, duration: { seconds: 259200 },
        system: { changes: [...["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
          { key: `system.abilities.${a}.check.roll.mode`, type: "upgrade", value: "1" }, { key: `system.abilities.${a}.save.roll.mode`, type: "upgrade", value: "1" }]),
          ...["acr","ani","arc","ath","dec","his","ins","itm","inv","med","nat","prc","prf","per","rel","slt","ste","sur"].map(k => ({ key: `system.skills.${k}.roll.mode`, type: "upgrade", value: "1" }))] } } },
      { path: "system.activities.6WJ08JWazu3OZign.effects", from: [], value: [{ _id: "dasJesterAdvant0" }] }
    ]
  },
  // O9g (§360): Ring of Invisibility — "a Magic action to give yourself the Invisible condition";
  // the data has neither activity nor effect: both are added to it (becoming visible again by a Bonus Action, or by taking
  // off the ring, still means removing the condition).
  "ring-of-invisibility": {
    dataFixes: [
      { effect: "dasRingInvisEff0", create: { name: "Invisible", type: "base", transfer: false, disabled: false, statuses: ["invisible"], system: { changes: [] } } },
      { path: "system.activities.dasRingInvisible", value: {
        _id: "dasRingInvisible", type: "utility", name: "Turn Invisible",
        activation: { type: "action", value: null, override: false, condition: "" },
        consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" },
        range: { override: false, units: "self" },
        target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "self" }, override: false, prompt: false },
        duration: { units: "inst", concentration: false, override: false }, effects: [{ _id: "dasRingInvisEff0" }],
        roll: { prompt: false, visible: false, name: "", formula: "" }
      } }
    ]
  },
  // O9f (§359): Manacles — "bound, the creature has Disadvantage on attack rolls"; escaping them:
  // the "Escape Check" activity (breaking them, "Burst Check", remains with the GM).
  // Rope of Entanglement — the Restrained creature tries the "Escape" activity.
  "manacles": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "hKJK8c3uwhFNdn5m", do: [{ type: "disadvantage" }] }],
    actionEnds: { hKJK8c3uwhFNdn5m: { by: "bearer", roll: "check" } }
  },
  "rope-of-entanglement": { actionEnds: { sYzIZOD83JG2W6wh: { by: "bearer", roll: "check" } } },
  // O9b (§355): Blackrazor — "when you reduce a creature to 0 HP, the sword kills it and devours its soul (except Constructs
  // or Undead); you gain Temporary Hit Points equal to its maximum HP"; Sword of Life Stealing —
  // "on a 20, 15 extra necrotic damage (the data) and you gain as many Temporary Hit Points".
  // Demonomicon of Iggwilv — "the damage of your spells against a Fiend: the maximum".
  "blackrazor": { devours: true },
  "sword-of-life-stealing-enchanted": { critFeeds: { amount: 15 } },
  // Vorpal Sword (SRD 5.2): "the weapon ignores Resistance to slashing damage" — nothing carried it. The 30 damage of the natural
  // 20 are in the data (Critical Hit bonus); the severed head remains with the GM.
  "vorpal-sword-enchanted": { ignoresResistance: { types: ["slashing"], if: { "activity.enchantedBy": "vorpal-sword" } } },
  // Dwarven Thrower (SRD 5.2): "when you hit with a ranged attack made with this weapon, it deals an extra 1d8 force damage,
  // or 2d8 if the target is a Giant". The data puts the 1d8 on the melee attack ("Attack") too, and "Throw" has nothing
  // for the Giant.
  "dwarven-thrower": {
    dataFixes: [{ path: "system.activities.bd1kKOncfoLha8CT.damage.parts",
      from: [{ number: 1, denomination: 8, types: ["force"] }], value: [] }],
    triggers: [{ on: "preDamageRoll", if: { "activity.id": "w3ATyMSroDLch6Re", "target.creatureType": "giant" },
      do: [{ type: "damage", formula: "1d8", damageType: "force" }] }]
  },
  // Sword of Wounding (SRD 5.2): "when you hit a creature […], the target takes an extra 2d6 necrotic damage and must
  // succeed on a DC 15 Constitution saving throw, or it can't regain Hit Points for 1 hour. It repeats the saving throw at
  // the end of each of its turns, ending the effect on a success."
  // The data's save ("Sword of Wounding Save") was not played by anything, and its "Wounded and Cannot Heal" effect is empty.
  "sword-of-wounding-enchanted": {
    onHit: { save: "sole" }, blocksHealing: true,
    triggers: [{ on: "endOfTurn", via: "effect", fromEffect: "UeuDQeM3fRIB0aMN", do: [{ type: "resave" }] }]
  },
  "demonomicon-of-iggwilv": { maxSpellDamageVs: ["fiend"] },
  // O9a (§354): poisons and traps — Torpor: "Speed is halved while it is Poisoned this way"; Rolling Stone:
  // "on a failure, Prone".
  "torpor": { effectChanges: { "4fBr9e0P9LVogtyq": [{ key: "system.attributes.movement.walk", type: "multiply", value: 0.5 }] } },
  "rolling-stone": { triggers: [{ on: "failedSave", if: { "activity.id": "MLbhL4DqA54XPO0N" }, do: [{ type: "status", status: "prone" }] }] },
  // Life Stealer: "a creature with fewer than 100 HP […] succeeds on a DC 15 Constitution saving throw or is killed outright;
  // Constructs and Undead automatically succeed" ("Life Stealing" activity, played on a natural 20;
  // it arrives on the enchanted weapon under another id: the weapon's only saving throw).
  "nine-lives-stealer-enchanted": { triggers: [{ on: "failedSave", if: { "activity.type": "save", "target.hpAtMost": 99,
    not: { any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } }, do: [{ type: "status", status: "dead" }] }] },
  // Rod of Rulership: "damaged by you or your allies, the target stops being Charmed" (like Charm Person).
  "rod-of-rulership": { triggers: [{ on: "isDamaged", via: "effect", fromEffect: "x1imiHMHJdzBfnVe", by: "originSide", do: [{ type: "remove" }] }] },
  // §352: Hammer of Thunderbolts (applied to a Maul or a Warhammer) — "if the thrown attack hits, the target and each
  // creature within 9 m of it other than you make a DC 17 Constitution saving throw or are Stunned until the end of your next
  // turn". The Stunned without a saving throw in the data ("Hurl Hammer") never goes through
  // (`effectsIf` false: the target is not the author); "Giants' Bane" remains with the GM.
  // Dungeon Master's Guide 3.0.0: the book adds the "Thunderclap" activity (the same saving throw, cast by hand after a throw that
  // hits). The engine already plays it on the hit (user's choice, 2026-11-21): casting it in addition is refused, forceable
  // (`automatic`), so that there is only one saving throw. The 2.0.0 hammer does not have this activity: nothing changes for it.
  "hammer-of-thunderbolts-enchanted": {
    effectsIf: { "target.isSelf": true },
    usageLimits: { xChnR5QIa3RWxr7K: { automatic: true } },
    triggers: [{ on: "hit", if: { "activity.isMelee": false }, do: [{ type: "status", status: "stunned", save: { ability: "con", dc: 17 }, around: { radius: 30, units: "ft" } }] }],
    effectEnds: { "status:stunned": "casterTurnEnd" }
  },
  // Ioun Stones of Absorption: "a Reaction: a spell of level 4 (8) or lower cast by a creature you can see is canceled".
  "absorption-ioun-stone": { counter: { level: 4 }, triggers: [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", activity: "VHm5fPkFAnT7Vb01", target: "source" }] }] },
  "greater-absorption-ioun-stone": { counter: { level: 8 }, triggers: [{ on: "castsSpell", if: { "target.seesSource": true }, do: [{ type: "use", activity: "1yWFZf1MJMoNof7b", target: "source" }] }] },
  // Ring of Feather Falling: "you descend 18 m per round and take no falling damage" — without a Reaction.
  // The ring has no activity: a "Feather Fall" activity with no cost is added to it (`dataFixes`), offered on the fall
  // without a Reaction.
  "ring-of-feather-falling": {
    triggers: [{ on: "falls", free: true, do: [{ type: "use", activity: "dasFeatherFall00" }, { type: "cancel" }] }],
    dataFixes: [{ path: "system.activities.dasFeatherFall00", value: {
      _id: "dasFeatherFall00", type: "utility", name: "Feather Fall",
      activation: { type: "special", value: null, override: false, condition: "" },
      consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] }, uses: { spent: 0, recovery: [], max: "" }, range: { override: false },
      target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "" }, override: false, prompt: false },
      duration: { units: "inst", concentration: false, override: false }, effects: [], roll: { prompt: false, visible: false, name: "", formula: "" }
    } }]
  },
  // Luck Blade (enchantment): "reroll a failed d20 Test, once per day; the new roll must be used".
  "luck-blade-enchanted": { rollBonus: { activity: "tXkbUpFL8jBRLpjM", on: ["attack", "save", "check"], reroll: {} } },

  /* ---- O7 (§343): passive defenses ---- */

  // Cloak of Displacement: "attack rolls against you have Disadvantage" — except when the "Displacement Suppressed" effect is
  // on (after damage, until the start of your next turn: player's toggle), when your Speed is 0 (2024 text: Grappled,
  // Restrained…) or when you are Incapacitated (2014 text, which carries the same identifier).
  "cloak-of-displacement": {
    triggers: [{ on: "preAttackRoll", defends: true,
      if: { not: { any: [{ "target.hasEffect": "cloak-of-displacement" }, { "target.speedZero": true },
        { "target.hasStatus": "incapacitated" }] } },
      do: [{ type: "disadvantage" }] }]
  },
  // Bracers of Defense: "+2 to AC if you wear no armor and no shield" — the effect stayed active with armor.
  "bracers-of-defense": { effectWhile: { ycuTEJoi9a8BO6xg: { if: { unarmored: true } } } },
  // Sentinel Shield: "Advantage on Initiative rolls and on Wisdom (Perception) checks" — only Initiative was there.
  "sentinel-shield": {
    dataFixes: [{ effect: "bHeGysatAXUbusV0", path: "system.changes", from: [change("flags.dnd5e.initiativeAdv", "add", true)],
      value: [change("flags.dnd5e.initiativeAdv", "add", true), change("system.skills.prc.roll.mode", "add", 1)] }]
  },
  // Ring of Free Action: "magic can neither reduce your Speed nor Paralyze or Restrain you" (worn and attuned; the
  // magical / nonmagical distinction remains with the GM: the immunity always applies).
  "ring-of-free-action": { grantsConditionImmunities: ["paralyzed", "restrained"] },
  // Caltrops: "its Speed drops to 0" — the effect targeted `movement.speed`, a value that dnd5e recomputes (no effect).
  "caltrops": { effectChanges: { HsbtDDdiWhk4d7WB: [{ key: "system.attributes.movement.walk", type: "override", value: 0, replace: true }] } },
  // Poisoned Needle: the applied effect does not have the Poisoned condition.
  "poisoned-needle": { effectStatuses: { waWQ0QcVncE6pU5B: ["poisoned"] } },
  // The Fool (Deck of Many Things): "Disadvantage on d20 Tests for 72 hours" — the effect is empty.
  // Ability checks (including skills and Initiative, which dnd5e derives from them)
  // and saving throws through the effect's keys; attack rolls through a trigger, as for The Jester (dnd5e has no effect key for
  // their mode).
  "fool": {
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "BkChhqAw5emn7aQp", if: { "source.hasEffect": "fool" },
      do: [{ type: "disadvantage" }] }],
    effectChanges: { BkChhqAw5emn7aQp: ["str", "dex", "con", "int", "wis", "cha"].flatMap(a => [
      { key: `system.abilities.${a}.save.roll.mode`, type: "add", value: "-1" },
      { key: `system.abilities.${a}.check.roll.mode`, type: "add", value: "-1" }]) }
  },

  // O9h (§363) — Basic Poison: "a Bonus Action to coat one weapon or up to three pieces of ammunition;
  // a creature that takes piercing or slashing damage from the poisoned weapon or ammunition takes an extra 1d4 poison
  // damage; the poison stays potent for 1 minute or until its damage is dealt".
  // The data has only the dice: a "coat" activity is added.
  "poison-basic": {
    dataFixes: [{ path: "system.activities.dasCoatWeapon000", value: {
      _id: "dasCoatWeapon000", type: "utility", name: "Coat Weapon",
      activation: { type: "bonus", value: null, override: false, condition: "" },
      consumption: { scaling: { allowed: false }, spellSlot: true, targets: [spend("itemUses", 1)] }, uses: { spent: 0, recovery: [], max: "" },
      range: { override: false, units: "self" },
      target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: "", type: "self" }, override: false, prompt: false },
      duration: { units: "inst", concentration: false, override: false }, effects: [], roll: { prompt: false, visible: false, name: "", formula: "" }
    } }],
    coats: { activity: "dasCoatWeapon000", damage: "KLsqFTXAS8fnlaYs", damageTypes: ["piercing", "slashing"], seconds: 60, ammunition: 3 }
  },
  // O9h (§363) — Burnt Othur Fumes: "a DC 13 Constitution save or 3d6 poison damage,
  // and it must repeat the save at the start of each of its turns; on each new failure, 1d6 poison damage;
  // after three successes, the poison ends". The data applies no effect to follow: an effect is created, applied on a failure;
  // counter of three successes (no failure threshold: 99).
  "burnt-othur-fumes": {
    dataFixes: [
      { effect: "dasOthurFumes000", create: { name: "Burnt Othur Fumes", type: "base", transfer: false, disabled: false, statuses: [], system: { changes: [] } } },
      { path: "system.activities.13ZvV9bxzM90FeQO.effects", from: [], value: [{ _id: "dasOthurFumes000", onSave: false }] }
    ],
    triggers: [{ on: "startOfTurn", via: "effect", fromEffect: "dasOthurFumes000",
      do: [{ type: "resave", tally: { successes: 3, failures: 99 } }, { type: "damage", to: "bearer", activity: "6o0JLH0kvEJ1n6D8" }] }]
  },
  // Bracers of Archery (SRD 5.2): "+2 to damage rolls made with these weapons" (Longbow, Shortbow). The data's effect
  // added it to the damage of any ranged weapon attack: it is emptied, and the +2 comes to the damage roll of a bow.
  "bracers-of-archery": {
    dataFixes: [{ effect: "PSGGfFEy4CjBVzyX", path: "system.changes", from: [change("system.bonuses.rwak.damage", "add", 2)],
      value: [] }],
    triggers: [{ on: "preDamageRoll", if: { "activity.isAttack": true, "activity.baseItem": ["longbow", "shortbow"] },
      do: [{ type: "damage", formula: "2", damageType: "weapon" }] }]
  },
  // O9h (§363) — "Potion of Pugilists": "each Unarmed Strike deals an extra 1d6 force damage on a hit; the effect lasts 10
  // minutes". The data has no effect: one is created, applied by "Drink",
  // and carries the dice (the drunk potion no longer exists).
  "potion-of-pugilism": {
    dataFixes: [
      { effect: "dasPugilismEff00", create: { name: "Potion of Pugilism", type: "base", transfer: false, disabled: false, duration: { seconds: 600 }, statuses: [], system: { changes: [] } } },
      { path: "system.activities.RoR08ONPd8se88h5.effects", from: [], value: [{ _id: "dasPugilismEff00" }] }
    ],
    triggers: [{ on: "preDamageRoll", via: "effect", fromEffect: "dasPugilismEff00", if: { "activity.weaponKind": ["unarmed"] },
      do: [{ type: "damage", formula: "1d6", damageType: "force" }] }]
  },
  // O9h (§363) — Potion of Resistance: a potion is drunk or fed to someone (Bonus Action) — the data limits it to the drinker.
  // On hit: the designated target, otherwise the drinker (adapter/usage.mjs).
  "potion-of-resistance": {
    dataFixes: [
      { path: "system.activities.n52xzzYU7CI8sywr.range.units", from: "self", value: "touch" },
      { path: "system.activities.n52xzzYU7CI8sywr.target.affects.type", from: "self", value: "creature" }
    ]
  },
  // O9h (§363) — "Pearl of Force": "any creature that failed the saving throw and is entirely within the area is
  // trapped in the sphere" for 1 minute — nothing enters or leaves (`encloses`, like Resilient Sphere);
  // "those that succeeded […] are pushed away from the center until they are no longer inside": 3 m (the radius).
  "bead-of-force": {
    dataFixes: [
      { effect: "dasBeadOfForce00", create: { name: "Sphere of Force", type: "base", transfer: false, disabled: false, duration: { seconds: 60 }, statuses: [], system: { changes: [] } } },
      { path: "system.activities.OZHtgfnTZWKOg9JP.effects", from: [], value: [{ _id: "dasBeadOfForce00", onSave: false }] }
    ],
    encloses: true,
    triggers: [{ on: "savedSave", do: [{ type: "move", mode: "push", distance: 10, units: "ft" }] }]
  },
  // O9h (§363) — Horn of Blasting: "20 percent chance that it explodes: 10d6 force damage to the blower, the horn is destroyed".
  "horn-of-blasting": { backfire: { after: ["FMTcQOb5MZKBohdN"], chance: 20, activity: "q8PShLHyh2ItXbkQ", destroys: true } },
  // O9h (§363) — Scroll of Protection: the 1.50 m Emanation lasts 5 minutes (the data says nothing of it); the type, chosen by
  // the scroll's enchantment, is read by `scroll-of-protection-<type>-enchanted` (content/sources.mjs): only these creatures are
  // stopped, affect nothing inside, and the emanation drops if the reader goes up to one of them.
  // The data enchants ANOTHER nonmagical object (`enchant.self` false): the scroll, being magical, could not receive its type
  // — it enchants itself (dnd5e, activity/enchant.mjs: `_triggerSubsequentActions`, no restriction).
  "scroll-of-protection": { effectDurations: { EDWprUVJxRYDOl4p: { seconds: 300 } },
    dataFixes: [{ path: "system.activities.SLT3PkMx7Cq6Rnon.enchant.self", from: false, value: true }] },
  ...Object.fromEntries(["aberration", "beast", "celestial", "construct", "dragon", "elemental", "humanoid", "fey", "fiend", "giant", "monstrosity",
    "ooze", "plant", "undead"].map(type => [`scroll-of-protection-${type}-enchanted`,
    { barrier: { radius: 5, units: "ft", onlyTypes: [type], shields: true, endsOnContact: true }, gmAlert: { key: "ParcheminProtection" } }])),

  // "Harkon's Bite" (Ravenloft): "+1 to checks and saving throws while you wear the collar" — the effect is not transferred.
  "harkons-bite": { dataFixes: [{ effect: "EzuxTW39OtnDWoi1", path: "transfer", from: false, value: true }] }
});

/**
 * O5b (§340): extra damage when the weapon hits a creature of these types — the weapon itself (`activity.identifier`),
 * or the weapon that carries this item's enchantment (`activity.enchantedBy`).
 */
/** The worn effect whose only change is empty receives Advantage on Dexterity (Stealth) checks. */
function STEALTH_ADVANTAGE(effect) {
  return { effect, path: "system.changes", from: [change("", "add", "")],
    value: [change("system.skills.ste.roll.mode", "add", 1)] };
}

function BANE(identifier, types, formula, damageType, enchanted=false) {
  const weapon = enchanted ? { "activity.enchantedBy": identifier } : { "activity.identifier": identifier };
  const target = (types.length > 1) ? { any: types.map(t => ({ "target.creatureType": t })) } : { "target.creatureType": types[0] };
  return { triggers: [{ on: "preDamageRoll", if: { "activity.isAttack": true, ...weapon, ...target }, do: [{ type: "damage", formula, damageType }] }] };
}

/** O3: a poison that puts to sleep — the Unconscious ends on damage or when shaken, the Poisoned remains its own effect. */
function SLEEP_POISON(activity, sleep, poison, seconds) {
  return {
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: sleep, do: [{ type: "remove" }] }],
    actionEnds: { [sleep]: { by: "other", verb: "wake" } },
    dataFixes: [
      { effect: sleep, path: "statuses", from: ["poisoned", "unconscious"], value: ["unconscious"] },
      { effect: sleep, path: "name", from: "Poisoned and Unconscious", value: "Unconscious" },
      { effect: poison, create: { name: "Poisoned", type: "base", transfer: false, disabled: false, statuses: ["poisoned"],
        duration: { value: seconds, units: "seconds", expiry: "turnStart" }, system: { changes: [] } } },
      { path: `system.activities.${activity}.effects`, from: [{ _id: sleep }], value: [{ _id: sleep, onSave: false }, { _id: poison, onSave: false }] }
    ]
  };
}

/** The changes of the Sword of Sharpness enchantment (only the Critical Hit part changes). */
function SHARPNESS(critical) {
  return [
    change("name", "override", "{} of Sharpness"), change("system.rarity", "override", "veryRare"),
    change("system.description.value", "override", "{}<p>@Embed[Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgSwordOfSharpn caption=false]</p>"),
    change("system.properties", "add", "mgc"), change("system.attunement", "override", "required"),
    change("activities[attack].damage.critical.bonus", "add", critical),
    change("system.price.value", "add", 40000), change("system.price.denomination", "override", "gp")
  ];
}
