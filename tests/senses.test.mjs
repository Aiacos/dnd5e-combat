/**
 * Bloc générique `sense` (core/senses.mjs) : un sens déclaré par du contenu — il localise une créature sans la voir, ou compte
 * comme une vue — et `wardsDetection`, ce qui en protège. Règle pure : portée, murs, cible détectée ou non, protection.
 */
import { describe, it, expect } from "vitest";
import { senseVerdict, bestVerdict, wardedAgainst, sensesIn, SENSE_VERDICTS, detectsTarget, mutedSenses, hidesIdentity }
  from "../module/scripts/core/senses.mjs";
import { validateEntry } from "../module/scripts/core/content/entry.mjs";
import { ENTRY_KEYS } from "../module/scripts/core/content.mjs";

const near = { distance: 20, walled: false, matches: true, wards: [] };

describe("sens déclaré : le verdict sur une cible", () => {
  const locate = { kind: "locate", range: 30 };
  it("dans la portée, sans mur, cible détectée : localisée ; « sight » : vue", () => {
    expect(senseVerdict(locate, near)).toBe("locate");
    expect(senseVerdict({ kind: "sight", range: 30 }, near)).toBe("sight");
  });
  it("au-delà de la portée, ou la cible n'est pas de celles que le sens détecte : rien", () => {
    expect(senseVerdict(locate, { ...near, distance: 31 })).toBe(null);
    expect(senseVerdict(locate, { ...near, distance: 30 })).toBe("locate");
    expect(senseVerdict(locate, { ...near, matches: false })).toBe(null);
  });
  it("un mur l'arrête, sauf le sens qui les traverse (`walls: false`)", () => {
    expect(senseVerdict(locate, { ...near, walled: true })).toBe(null);
    expect(senseVerdict({ ...locate, walls: false }, { ...near, walled: true })).toBe("locate");
  });
  it("`reveals: \"presence\"` : la présence est sue, pas la position", () => {
    expect(senseVerdict({ ...locate, reveals: "presence" }, near)).toBe("presence");
  });
  it("une vue ne voit pas une cible Invisible ; un sens qui localise, si", () => {
    expect(senseVerdict({ kind: "sight", range: 30 }, { ...near, invisible: true })).toBe(null);
    expect(senseVerdict(locate, { ...near, invisible: true })).toBe("locate");
  });
  it("une brume arrête toute vue ; des ténèbres aussi, sauf la vue qui les perce (`through`)", () => {
    const sight = { kind: "sight", range: 30 };
    const piercing = { ...sight, through: ["darkness"] };
    expect(senseVerdict(sight, { ...near, darkness: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, darkness: true })).toBe("sight");
    expect(senseVerdict(sight, { ...near, fog: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, fog: true })).toBe(null);
    expect(senseVerdict(piercing, { ...near, darkness: true, invisible: true })).toBe(null);
    // Ni la brume ni les ténèbres n'arrêtent un sens qui localise.
    expect(senseVerdict(locate, { ...near, fog: true, darkness: true })).toBe("locate");
  });
  it("`needs` : éteint tant que le porteur est Aveuglé (`sight`) ou Assourdi (`hearing`)", () => {
    const eyes = { kind: "sight", range: 30, needs: "sight" };
    const ears = { kind: "locate", range: 30, needs: "hearing" };
    expect(senseVerdict(eyes, { ...near, blind: true })).toBe(null);
    expect(senseVerdict(eyes, { ...near, deaf: true })).toBe("sight");
    expect(senseVerdict(ears, { ...near, deaf: true })).toBe(null);
    expect(senseVerdict(ears, { ...near, blind: true })).toBe("locate");
    // Sans `needs`, ni l'un ni l'autre ne l'éteint (une vue qui ne passe pas par les yeux).
    expect(senseVerdict({ kind: "sight", range: 30 }, { ...near, blind: true, deaf: true })).toBe("sight");
  });
  it("la présence seule ne dépend pas de la vue, même pour un sens de genre « sight »", () => {
    const presence = { kind: "sight", range: 30, reveals: "presence" };
    expect(senseVerdict(presence, { ...near, invisible: true, fog: true })).toBe("presence");
  });
  it("`reveals: \"aura\"` : une aura sur ce qui est déjà vu — ni position ni vue ; les murs et les protections l'arrêtent", () => {
    const aura = { kind: "locate", range: 30, reveals: "aura", magic: "div" };
    expect(senseVerdict(aura, near)).toBe("aura");
    expect(senseVerdict(aura, { ...near, distance: 35 })).toBe(null);
    expect(senseVerdict(aura, { ...near, walled: true })).toBe(null);
    expect(senseVerdict(aura, { ...near, matches: false })).toBe(null);
    expect(senseVerdict(aura, { ...near, wards: ["div"] })).toBe(null);
  });
  it("le meilleur verdict de plusieurs sens l'emporte", () => {
    expect(SENSE_VERDICTS).toEqual(["aura", "presence", "locate", "sight"]);
    expect(bestVerdict(["aura", null])).toBe("aura");
    expect(bestVerdict(["aura", "locate"])).toBe("locate");
    expect(bestVerdict(["presence", null, "locate"])).toBe("locate");
    expect(bestVerdict([null, "sight", "locate"])).toBe("sight");
    expect(bestVerdict([null, undefined])).toBe(null);
    expect(bestVerdict([])).toBe(null);
  });
});

describe("protection contre la détection (`wardsDetection`)", () => {
  it("une protection contre une école n'arrête que les sens de cette école", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["div"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 30, magic: true }, ["div"])).toBe(false);
    expect(wardedAgainst({ kind: "locate", range: 30 }, ["div"])).toBe(false);
  });
  it("une protection contre la magie arrête tout sens magique, d'une école ou non, pas un sens naturel", () => {
    expect(wardedAgainst({ kind: "locate", range: 30, magic: "div" }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60, magic: true }, ["magic"])).toBe(true);
    expect(wardedAgainst({ kind: "locate", range: 60 }, ["magic"])).toBe(false);
  });
  it("la cible protégée n'est pas perçue par ce sens", () => {
    expect(senseVerdict({ kind: "locate", range: 30, magic: "div" }, { ...near, wards: ["div"] })).toBe(null);
    expect(senseVerdict({ kind: "locate", range: 30 }, { ...near, wards: ["div", "magic"] })).toBe("locate");
  });
});

describe("`detectedAs` : perçue aussi comme d'autres types", () => {
  const undead = { "target.creatureType": ["undead"] };
  const living = { not: { "target.creatureType": ["construct", "undead"] } };
  const humanoid = { "target.creatureType": "humanoid" };
  it("sans la clé, seul son type compte", () => {
    expect(detectsTarget(undead, humanoid)).toBe(false);
    expect(detectsTarget(living, humanoid)).toBe(true);
    expect(detectsTarget(null, humanoid)).toBe(true);
  });
  it("avec, le sens qui cherche ce type la trouve ; celui qui la trouvait déjà la trouve toujours", () => {
    expect(detectsTarget(undead, humanoid, ["undead"])).toBe(true);
    expect(detectsTarget(living, humanoid, ["undead"])).toBe(true);
    expect(detectsTarget({ "target.creatureType": ["fiend"] }, humanoid, ["undead"])).toBe(false);
  });
  it("les autres faits de la condition tiennent toujours", () => {
    const facts = { ...humanoid, "target.hasStatus": id => id === "poisoned" };
    expect(detectsTarget({ ...undead, "target.hasStatus": "poisoned" }, facts, ["undead"])).toBe(true);
    expect(detectsTarget({ ...undead, "target.hasStatus": "diseased" }, facts, ["undead"])).toBe(false);
  });
});

describe("`senseNeeds` : un sens de la fiche qui dépend de l'ouïe ou de la vue", () => {
  const echo = [{ blindsight: "hearing" }];
  it("éteint tant que son porteur est Assourdi, pas autrement", () => {
    expect(mutedSenses(echo, { deaf: true })).toEqual(["blindsight"]);
    expect(mutedSenses(echo, { blind: true })).toEqual([]);
    expect(mutedSenses(echo, {})).toEqual([]);
    expect(mutedSenses([], { deaf: true, blind: true })).toEqual([]);
  });
  it("plusieurs items, plusieurs sens", () => {
    const needs = [{ blindsight: "hearing" }, { seeAll: "sight", blindsight: "hearing" }, undefined];
    expect(mutedSenses(needs, { deaf: true, blind: true }).sort()).toEqual(["blindsight", "seeAll"]);
    expect(mutedSenses(needs, { blind: true })).toEqual(["seeAll"]);
  });
});

describe("réglage `anonymousLocated` : l'identité d'une créature perçue sans être vue", () => {
  it("éteint : jamais cachée", () => {
    for ( const kind of ["heard", "located", "aura", null] ) expect(hidesIdentity(kind, false), String(kind)).toBe(false);
  });
  it("allumé : cachée pour une créature entendue ou localisée ; pas pour une aura, posée sur ce qui est vu", () => {
    expect(hidesIdentity("heard", true)).toBe(true);
    expect(hidesIdentity("located", true)).toBe(true);
    expect(hidesIdentity("aura", true)).toBe(false);
    expect(hidesIdentity(null, true)).toBe(false);
  });
});

describe("déclaration dans le contenu", () => {
  it("les clés sont au schéma", () => {
    expect(ENTRY_KEYS).toContain("detectedAs");
    expect(ENTRY_KEYS).toContain("senseNeeds");
    expect(ENTRY_KEYS).toContain("sense");
    expect(ENTRY_KEYS).toContain("wardsDetection");
  });
  it("une entrée porte un sens ou une liste de sens", () => {
    const one = { kind: "locate", range: 30 };
    expect(sensesIn({ sense: one })).toEqual([one]);
    expect(sensesIn({ sense: [one, { kind: "sight", range: 10 }] })).toHaveLength(2);
    expect(sensesIn({})).toEqual([]);
    expect(sensesIn(null)).toEqual([]);
  });
  it("valide : genre, portée, et les options connues", () => {
    const facts = { "target.creatureType": null };
    const ok = { sense: { kind: "locate", range: 30, units: "ft", via: "effect", fromEffect: "abcdefghij012345", walls: false,
      magic: "div", reveals: "presence", detects: { "target.creatureType": ["undead"] } } };
    expect(validateEntry(ok, { facts })).toEqual([]);
    const two = { sense: [{ kind: "sight", range: 10, through: ["darkness"], needs: "sight" },
      { kind: "locate", range: 60, magic: true, needs: "hearing" }] };
    expect(validateEntry(two, { facts })).toEqual([]);
    expect(validateEntry({ wardsDetection: ["div", "magic"] }, { facts })).toEqual([]);
    expect(validateEntry({ sense: { kind: "locate", range: 30, reveals: "aura" } }, { facts })).toEqual([]);
    expect(validateEntry({ detectedAs: ["undead"] }, { facts })).toEqual([]);
    expect(validateEntry({ senseNeeds: { blindsight: "hearing", seeAll: "sight" } }, { facts })).toEqual([]);
  });
  it("refuse : genre inconnu, portée absente, option ou fait inconnus, protection vide", () => {
    const facts = { "target.creatureType": null };
    const bad = [{ sense: { kind: "smell", range: 30 } }, { sense: { kind: "locate" } }, { sense: { kind: "locate", range: 0 } },
      { sense: { kind: "locate", range: 30, colour: "red" } }, { sense: { kind: "locate", range: 30, walls: true } },
      { sense: { kind: "locate", range: 30, fromEffect: "abcdefghij012345" } },
      { sense: { kind: "locate", range: 30, reveals: "name" } },
      { sense: { kind: "locate", range: 30, through: ["darkness"] } }, { sense: { kind: "sight", range: 30, through: ["fog"] } },
      { sense: { kind: "sight", range: 30, through: [] } }, { sense: { kind: "sight", range: 30, needs: "smell" } },
      { sense: { kind: "locate", range: 30, detects: { "target.unknownFact": true } } }, { sense: [] },
      { wardsDetection: [] }, { wardsDetection: "div" }, { wardsDetection: [""] },
      { detectedAs: [] }, { detectedAs: "undead" }, { senseNeeds: {} }, { senseNeeds: { blindsight: "smell" } },
      { senseNeeds: ["blindsight"] }];
    for ( const entry of bad ) expect(validateEntry(entry, { facts }).length, JSON.stringify(entry)).toBeGreaterThan(0);
  });
});
