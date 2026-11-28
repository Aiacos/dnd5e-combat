/**
 * The items of the 2024 Player's Handbook (SPEC §49): what dnd5e leaves by hand on their effects.
 */

/** The "Burning." / "Embrasement" effect placed by Alchemist's Fire (same id in the Player's Handbook and its copies). */
const ALCHEMISTS_FIRE_BURNING = "HL12olRyPOCmmMQ5";

/** The Healer's Kit activities whose range is "personal" (Player's Handbook, and a common third-party copy): on touch. */
const HEALERS_KIT_ACTIVITIES = ["bsWqOT06BB3Vb2hg", "1jlZEx9V2TITY9OT"];

/** Open flame: orange light that flickers (the core's "torch" animation). */
const FLAME = { type: "torch", speed: 2, intensity: 2 };

/** §121 : une heure (torche, bougie) ; une flasque d'huile, 6 heures. */
const HOUR = { value: 1, units: "hour" };
const OIL = { value: 6, units: "hour" };
/** §346: the Hooded Lantern, hood lowered — Dim Light out to 1.50 m. */
const HOOD = { bright: 0, dim: 5 };
const BULLSEYE = { bright: 60, dim: 120, units: "ft", angle: 53, burn: OIL, fuel: "oil" };

export const GEAR = Object.freeze({
  // §52: carried light sources (2024 Player's Handbook) — radius of the Bright Light, then OUTER radius of the dim.
  // Candle: "Bright Light in a 1.50 m radius and Dim Light for an additional 1.50 m"; Lamp: "bright in a 4.50 m radius and dim
  // for an additional 9 m"; Hooded Lantern: "bright in a 9 m radius and dim for an additional 9 m"; §346: "a Bonus Action to
  // lower the hood: Dim Light in a 1.50 m radius" (`hooded`, menu of the lit item);
  // Bullseye Lantern: "bright in an 18 m Cone and dim for an additional 18 m"; Torch: "bright in a 6 m radius and dim for an
  // additional 6 m".
  // §121: "a torch burns for 1 hour", "a lit candle […] for 1 hour" (the burned unit disappears); "a lamp [a
  // lantern] burns Oil" — "a flask of Oil burns for 6 hours […]; not necessarily in a row: you can put it out and
  // relight it up to 6 hours in all". The torch and the candle too can be put out and relit (user's choice, 2026-10-10).
  "candle": { carriedLight: { bright: 5, dim: 10, units: "ft", animation: FLAME, burn: HOUR } },
  "lamp": { carriedLight: { bright: 15, dim: 45, units: "ft", animation: FLAME, burn: OIL, fuel: "oil" } },
  "lantern-hooded": { carriedLight: { bright: 30, dim: 60, units: "ft", burn: OIL, fuel: "oil", hooded: HOOD } },
  // O1 (§335): a second Hooded Lantern from the Handbook, as a consumable, under the identifier "hooded-lantern".
  "hooded-lantern": { carriedLight: { bright: 30, dim: 60, units: "ft", burn: OIL, fuel: "oil", hooded: HOOD } },
  // The Bullseye Lantern: "lantern-bullseye" in the Player's Handbook, "bullseye-lantern" in dnd5e's SRD.
  "lantern-bullseye": { carriedLight: BULLSEYE },
  "bullseye-lantern": { carriedLight: BULLSEYE },
  "torch": { carriedLight: { bright: 20, dim: 40, units: "ft", animation: FLAME, burn: HOUR } },
  // Tinderbox: "using it to light a Candle, a Lamp, a Lantern or a Torch […] takes a Bonus Action".
  "tinderbox": { kindles: true },
  // §187: Caltrops — "cover a 1.50 m by 1.50 m cell within 1.50 m of you; a creature that enters the area for the first time
  // on a turn makes a DC 15 Dexterity save or takes 1 piercing damage and its Speed drops to 0 until the start of its next turn;
  // it takes 10 minutes to pick them up". Ball Bearings — "an area 3 m on a side within 3 m of you; […] DC 10 or Prone; 10
  // minutes to pick them up". The area stays on the ground (runtime/scatter.mjs): whoever enters it stops on its first cell, then
  // the save.
  "caltrops": { scatter: true, triggers: [{ on: "enter", do: [{ type: "replay" }] }] },
  "ball-bearings": { scatter: true, triggers: [{ on: "enter", do: [{ type: "replay" }] }] },
  // §54: Oil — a failed Dexterity save leaves the target oiled for 1 minute; as long as it is, fire damage
  // deals 5 more to it (runtime/oil.mjs). The "Throw" activity
  // places no effect: the "oiled" mark carries it.
  // §188: "when you take the Attack action, you can replace one of your attacks with the throw of a flask" (the throw,
  // not the spreading); "spreading […] a 1.50 m square area" which, "once lit, burns until the end of the turn 2 rounds after it is
  // lit (12 seconds) and deals 5 fire damage to any creature that enters the area or ends its turn there, once per
  // turn" (runtime/flammable.mjs).
  "oil": {
    triggers: [{ on: "failedSave", do: [{ type: "mark", mark: "oiled", label: "Marque.Huile", seconds: 60 }] }],
    replacesAttack: ["FoeoumkYcnAsGCRo"],
    flammable: { ground: true, damage: "5", type: "fire", rounds: 2, seconds: 12, on: ["enter", "turnEnd"] },
    // §195: the puddle is a slippery surface ("covered in ice or oil", Slippers of Spider Climbing).
    slippery: true
  },
  // §195: Slippers of Spider Climbing (Dungeon Master's Guide) — "climb, descend, cross vertical surfaces and walk on the ceiling,
  // hands free. You have a climb Speed equal to your Speed. But not on a slippery surface, covered in ice or oil
  // for example". The ceiling: core/climb.mjs; the speed, absent from the data, kept by the active GM as long as they are worn and
  // attuned (runtime/speed-grants.mjs). Limit: on a slippery surface, this climb speed remains (only the ceiling is refused).
  "slippers-of-spider-climbing": { notOnSlippery: true, grantsSpeeds: { climb: "walk" } },
  // Cloak of Arachnida: "a climb Speed equal to your Speed" — the data's effect writes 1 (`upgrade`), like Spider
  // Climb; the effect is transferred by the item (not created on the actor): the Speed is granted to it alongside, and the
  // `upgrade` keeps the greater of the two.
  "cloak-of-arachnida": { grantsSpeeds: { climb: "walk" } },
  // Eyes of the Eagle, Robe of Eyes (SRD 5.2): "you have Advantage on Wisdom (Perception) checks that rely on sight" —
  // the data carries nothing for it. At the Search action, which finds only what the searcher can see (core/search.mjs).
  "eyes-of-the-eagle": { searchBonus: { advantage: true } },
  "robe-of-eyes": { searchBonus: { advantage: true } },
  // §53: Elixir of Health — "the following conditions end: Blinded, Deafened, Paralyzed and Poisoned"; Potion of Vitality —
  // "removes any Exhaustion level and ends the Poisoned condition" (Hit Dice at their maximum for 24 h: left to the GM).
  "elixir-of-health": { curesAll: ["blinded", "deafened", "paralyzed", "poisoned"] },
  "potion-of-vitality": { curesAll: ["exhaustion", "poisoned"] },
  // §208: Boots of Leaping and Speed — "once on each of your turns, jump up to 9 m for only 3 m of movement".
  "boots-of-striding-and-springing": { jump: { fixed: { distance: 30, cost: 10, from: "equipped" } } },
  // §53: Growth — "the \"enlarge\" effect of the Enlarge/Reduce spell"; Diminution — "the \"reduce\" effect"
  // (the spell's effects, same ids in the Player's Handbook and the SRD: content/spells.mjs, SIZE_CHANGES).
  "potion-of-growth": { potionEffect: "Wi2E10l7n6Ka8k6u" },
  // "When you drink this potion, you can cast the level 3 version of the Animal Friendship spell": on a Beast.
  "potion-of-animal-friendship": { castTargets: true },
  // Heroism: "10 Temporary Hit Points […] and the effect of the Bless spell" — the item's "Blessed" effect (dHNT1jBXfvYuNH16)
  // is not linked to the healing activity (gdyQxFAXH5PM9qy5) in the Guide's data: we link it there.
  "potion-of-heroism": { choice: { pool: { gdyQxFAXH5PM9qy5: ["dHNT1jBXfvYuNH16"] } } },
  // Flight: "a fly Speed equal to your Speed […] and you can hover" — the "Flyer" effect gives only
  // hovering. Climbing: "a climb Speed equal to your Speed" — the "Climber" effect has no change.
  "potion-of-flying": { effectChanges: { GIybtF2qEmtPCOZj: [{ key: "system.attributes.movement.fly", type: "upgrade", value: "@walk" }] } },
  "potion-of-climbing": { effectChanges: { D6fYii3nkDC4Tsbi: [{ key: "system.attributes.movement.climb", type: "upgrade", value: "@walk" }] } },
  "potion-of-diminution": { potionEffect: "NXdtOxX4HvPeodml" },
  // Healer's Kit: a Utilize action and a use stabilize an Unconscious creature at 0 HP, without a
  // Medicine check — dnd5e's utility activity does nothing (runtime/stabilize.mjs).
  // Its range is "personal" in the Player's Handbook (and a common third-party copy) although it targets a creature: on touch.
  "healers-kit": {
    stabilizes: true,
    ranges: Object.fromEntries(HEALERS_KIT_ACTIVITIES.map(id => [id, { value: 5, units: "ft" }])),
    targets: { unaffectedIf: { any: [{ "target.atZero": false }, { "target.isDead": true }] } }
  },
  // Alchemist's Fire: "the target […] takes 1d4 fire damage and starts burning" — the applied effect lacks dnd5e's
  // `burning` condition (a plain name): `burns` declares it "On Fire", the general rule does the rest (§212,
  // runtime/burning.mjs: 1d4 fire at the start of each of its turns, "Extinguish the flames" with an action, Prone).
  "alchemists-fire": { burns: [ALCHEMISTS_FIRE_BURNING] }
});
