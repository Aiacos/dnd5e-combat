/**
 * §489 : la relance forcée d'un jet d'attaque (étape `reroll`, Parade d'un monstre) — validation, rejugement du coup par le cœur avec
 * le nouveau jet, faits `attack.fumble` / `attack.rerolled` (riposte sur un échec critique du nouveau jet). Exemples synthétiques.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { open, advance, STEPS } from "../module/scripts/core/action.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { nearMissTargets } from "../module/scripts/core/success-at-cost.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

const facts = { "hit.critical": true, "activity.isMelee": true, "attack.fumble": true, "attack.rerolled": true };
const v = entry => validateEntry(entry, { facts });
const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 15, ...extra });
const roll = (total, extra={}) => ({ total, isCritical: false, isFumble: false, ...extra });
const ACTIVITY = "abcdefghijklmnop";

/** La Parade d'un monstre, comme une campagne la déclarerait. */
const parry = { triggers: [
  { on: "isHit", if: { "hit.critical": false, "activity.isMelee": true }, do: [{ type: "use" }, { type: "reroll" }] },
  { on: "isMissed", free: true, if: { "attack.rerolled": true, "attack.fumble": true },
    do: [{ type: "use", activity: ACTIVITY, target: "source", free: true }] }] };

/** Une attaque qui touche T1 (15 contre CA 15), en attente de sa réaction. */
function hitAwaitingReaction(first=roll(15)) {
  let { resolution } = open({ ...RESOLUTION_BASE, plan: { attack: true, damage: "author" }, targets: [] });
  ({ resolution } = advance(resolution, { type: "attackRolled", roll: first, messageId: "a", targets: [T(1, { canReact: true })] }));
  expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
  return resolution;
}

describe("§489 : validation de reroll", () => {
  it("la Parade : isHit + use + reroll, puis la riposte gratuite sur échec critique", () => {
    expect(v(parry)).toEqual([]);
  });
  it("refuse reroll sans réaction use, hors fenêtre « touché », ou avec une option", () => {
    const misplaced = "triggers[0].do: \"reroll\" requires the isHit or allyIsHit moment and a \"use\" reaction";
    expect(v({ triggers: [{ on: "isHit", do: [{ type: "reroll" }] }] })).toEqual([misplaced]);
    expect(v({ triggers: [{ on: "isMissed", do: [{ type: "use" }, { type: "reroll" }] }] })).toEqual([misplaced]);
    expect(v({ triggers: [{ on: "allyIsHit", do: [{ type: "use" }, { type: "reroll" }] }] })).toEqual([]);
    expect(v({ triggers: [{ on: "isHit", do: [{ type: "use" }, { type: "reroll", keep: "best" }] }] }))
      .toEqual(["triggers[0].do[1]: \"reroll\" takes no option"]);
  });
  it("use free : true ou absent", () => {
    expect(v({ triggers: [{ on: "isMissed", do: [{ type: "use", free: false }] }] })).toEqual(["triggers[0].do[0].free: true or absent"]);
  });
});

describe("§489 : le cœur rejuge le coup avec le jet relancé", () => {
  it("le nouveau jet rate : la cible n'est plus touchée, le jet relancé est noté", () => {
    let resolution = hitAwaitingReaction();
    const again = roll(9, { from: 15 });
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 15, roll: again }));
    expect(resolution.targets[0]).toMatchObject({ hit: false, critical: false, reason: "miss", reaction: "Parade", rerolled: again });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(resolution.attack.roll.total).toBe(15);   // le jet d'origine reste celui de l'attaque
  });
  it("un 1 naturel au nouveau jet : échec critique", () => {
    let resolution = hitAwaitingReaction();
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 15, roll: roll(30, { isFumble: true, natural: 1 }) }));
    expect(resolution.targets[0]).toMatchObject({ hit: false, reason: "fumble" });
    expect(resolution.targets[0].rerolled.isFumble).toBe(true);
  });
  it("le nouveau jet touche encore, ou devient un critique : c'est lui qui compte", () => {
    let resolution = hitAwaitingReaction();
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 15, roll: roll(17) }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: false });
    resolution = hitAwaitingReaction();
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Parade", ac: 15, roll: roll(25, { isCritical: true, natural: 20 }) }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: true });
  });
  it("sans jet relancé, rien ne change (réaction sans reroll)", () => {
    let resolution = hitAwaitingReaction();
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Autre", ac: 15 }));
    expect(resolution.targets[0]).toMatchObject({ hit: true });
    expect(resolution.targets[0].rerolled).toBeUndefined();
  });
  it("succès à un prix : la cible relancée se juge sur le nouveau total", () => {
    const targets = [{ token: "T1", ac: 15, hit: false, reason: "miss", rerolled: { total: 14 } }, { token: "T2", ac: 15, hit: false, reason: "miss" }];
    expect(nearMissTargets({ total: 10 }, targets, 2)).toEqual([{ token: "T1", by: 1 }]);
  });
});

describe("§489 : faits attack.fumble et attack.rerolled", () => {
  let factsFor;
  const actor = { id: "A1" };
  beforeAll(async () => {
    globalThis.Hooks ??= { on() {}, once() {}, callAll() {}, call: () => true };
    globalThis.game ??= { user: { isGM: true }, users: {}, modules: { get: () => null }, settings: { register() {}, get: () => undefined },
      i18n: { localize: k => k, format: k => k, lang: "en" }, messages: { get: () => null } };
    globalThis.foundry ??= { utils: { throttle: fn => fn, debounce: fn => fn, isNewerVersion: () => false } };
    globalThis.CONFIG ??= { DND5E: { movementUnits: { ft: { conversion: 1 } } }, specialStatusEffects: {}, queries: {} };
    globalThis.fromUuidSync = uuid => ((uuid === "T1") ? { actor } : null);
    await import("../module/scripts/adapter/content.mjs");
    ({ factsFor } = await import("../module/scripts/adapter/facts.mjs"));
  });
  const resolutionWith = (target, attackRoll=roll(15)) => ({ attack: { roll: attackRoll }, targets: [{ token: "T1", ...target }] });
  it("le nouveau jet d'une Parade décide de l'échec critique", () => {
    const f = factsFor({ target: actor, resolution: resolutionWith({ hit: false, rerolled: roll(3, { isFumble: true }) }) });
    expect(f["attack.fumble"](true)).toBe(true);
    expect(f["attack.rerolled"](true)).toBe(true);
    const g = factsFor({ target: actor, resolution: resolutionWith({ hit: false, rerolled: roll(9) }) });
    expect(g["attack.fumble"](true)).toBe(false);
  });
  it("sans relance : le jet de l'attaque", () => {
    const f = factsFor({ target: actor, resolution: resolutionWith({ hit: false }, roll(3, { isFumble: true })) });
    expect(f["attack.fumble"](true)).toBe(true);
    expect(f["attack.rerolled"](false)).toBe(true);
    expect(factsFor({ target: actor })["attack.fumble"](false)).toBe(true);
  });
});
