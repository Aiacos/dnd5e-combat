import { describe, expect, it } from "vitest";
import { monsterTextLayer } from "../module/scripts/core/monster-layer.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { monsterEffectDurations } from "../module/scripts/core/monster-text.mjs";

// §460: the text layer of NPC abilities, moved out of the adapter so ATLAS computes what the engine plays. Synthetic examples.
describe("§460 : monsterTextLayer", () => {
  it("nothing without text, nor for a text that says nothing", () => {
    expect(monsterTextLayer({ html: "" })).toBeNull();
    expect(monsterTextLayer({ html: "<p>The creature hums a tune.</p>" })).toBeNull();
  });
  it("a push on a failed save (K8)", () => {
    const layer = monsterTextLayer({ html: "<p>Strength Saving Throw: DC 15. Failure: 10 damage, and the target is pushed up to 15 feet straight away from the beast.</p>",
      activities: [{ id: "aaaaaaaaaaaaaaaa", type: "save" }] });
    expect(layer.triggers).toEqual([{ on: "failedSave", do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]);
  });
  it("a drain that gives the HP back to the drainer", () => {
    const layer = monsterTextLayer({ html: "<p>The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the beast regains Hit Points equal to that amount.</p>",
      activities: [{ id: "aaaaaaaaaaaaaaaa", type: "attack" }] });
    expect(layer.drain).toBe(true);
  });
  // Seen in play: two monsters carry the same Vanish (same identifier, same ids); declared by identifier, the end "after
  // an attack roll" of the Will-o'-Wisp also dropped the other's Invisible, whose text does not provide for it. Synthetic
  // examples, of the same wording.
  it("an effect that ends after an attack roll: read from the text, not from the identifier", () => {
    const effects = [{ id: "cccccccccccccccc", statuses: ["invisible"] }];
    const activities = [{ id: "dddddddddddddddd", type: "utility", effects: ["cccccccccccccccc"] }];
    const untilAttack = "<p>The beast has the &Reference[Invisible] condition until its Concentration ends on this effect, "
      + "which ends early immediately after the beast makes an attack roll or uses Drain.</p>";
    const atWill = "<p>The beast gives itself the &Reference[Invisible] condition or ends that condition on itself.</p>";
    expect(monsterTextLayer({ html: untilAttack, identifier: "vanish", activities, effects }).breaksOn).toEqual(["attack"]);
    expect(monsterTextLayer({ html: atWill, identifier: "vanish", activities, effects })?.breaksOn).toBeUndefined();
    // With no effect to drop: nothing to declare.
    expect(monsterTextLayer({ html: untilAttack, identifier: "vanish", activities: [], effects: [] })?.breaksOn).toBeUndefined();
  });
  it("the Swallow building block discards the recurring damage read from the text", () => {
    const html = "<p>The target takes [[/damage 10 activity=bbbbbbbbbbbbbbbb]] Acid damage at the start of each of its turns.</p>";
    const acts = [{ id: "bbbbbbbbbbbbbbbb", type: "damage" }];
    expect(monsterTextLayer({ html, activities: acts })?.triggers?.length ?? 0).toBeGreaterThan(0);
    expect(monsterTextLayer({ html, activities: acts, swallow: true })?.triggers).toBeUndefined();
  });
});

describe("§484: light sensitivity — ability checks too", () => {
  const SUN = "<p>While in sunlight, the drider has Disadvantage on ability checks and attack rolls.</p>";
  it("in sunlight: Disadvantage on attack rolls (trigger) and on checks (rollDisadvantage)", () => {
    expect(monsterTextLayer({ html: SUN })).toEqual({
      triggers: [{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }],
      rollDisadvantage: { on: ["check"], if: { "self.inSunlight": true } }
    });
  });
  it("in Bright Light: the Bright Light fact", () => {
    const html = "<p>While in Bright Light, the beast has Disadvantage on ability checks and attack rolls.</p>";
    const layer = monsterTextLayer({ html });
    expect(layer.rollDisadvantage).toEqual({ on: ["check"], if: { "self.inBrightLight": true } });
  });
  it("a sentence that names only attack rolls: no Disadvantage on checks", () => {
    const layer = monsterTextLayer({ html: "<p>While in Bright Light, the cloaker has Disadvantage on attack rolls.</p>" });
    expect(layer.triggers).toHaveLength(1);
    expect(layer.rollDisadvantage).toBeUndefined();
  });
  it("the entry read passes the validator", () => {
    const facts = { "source.inSunlight": () => true, "self.inSunlight": () => true };
    expect(validateEntry(monsterTextLayer({ html: SUN }), { facts })).toEqual([]);
  });
});

describe("Bloodied Frenzy: while Bloodied, Advantage on saving throws too", () => {
  const FRENZY = "<p>While Bloodied, the berserker has Advantage on attack rolls and saving throws.</p>";
  it("attack rolls (trigger) and saving throws (rollAdvantage)", () => {
    expect(monsterTextLayer({ html: FRENZY })).toEqual({
      triggers: [{ on: "preAttackRoll", if: { "source.hasStatus": "bloodied" }, do: [{ type: "advantage" }] }],
      rollAdvantage: { on: ["save"], if: { "self.hasStatus": "bloodied" } }
    });
  });
  it("a sentence naming only attack rolls: no Advantage on saving throws", () => {
    const layer = monsterTextLayer({ html: "<p>While Bloodied, the brute has Advantage on attack rolls.</p>" });
    expect(layer.triggers).toHaveLength(1);
    expect(layer.rollAdvantage).toBeUndefined();
  });
  it("the read entry passes the validator; a wrong shape is refused", () => {
    const facts = { "source.hasStatus": () => true, "self.hasStatus": () => true };
    expect(validateEntry(monsterTextLayer({ html: FRENZY }), { facts })).toEqual([]);
    expect(validateEntry({ rollAdvantage: { on: ["attack"] } }, { facts })).toHaveLength(1);
    expect(validateEntry({ rollAdvantage: { on: ["save"], if: { "self.nope": true } } }, { facts })).toHaveLength(1);
  });
});

// Synthetic examples, reduced to the phrasings read (no book text).
describe("§334: the duration in turns of an effect with no condition, said of the target", () => {
  const data = { activities: [{ type: "save", effects: ["aaaaaaaaaaaaaaaa"] }],
    effects: [{ id: "aaaaaaaaaaaaaaaa", statuses: [] }] };
  it("\"the target's Speed is halved until the end of its next turn\": the end of the bearer's turn", () => {
    const html = "<p>Failure: 10 Fire damage, and the target's Speed is halved until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
  });
  it("the sentence that speaks of the creature (\"can't take this action again\") does not change the duration read", () => {
    const html = "<p>Failure: 10 Fire damage, and the target's Speed is halved until the end of its next turn. "
      + "Failure or Success: The beast can't take this action again until the start of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
    const alone = "<p>Failure or Success: The beast can't take this action again until the start of its next turn.</p>";
    expect(monsterEffectDurations(alone, data)).toEqual({});
  });
  it("\"This effect lasts until the end of its next turn\", in a separate sentence", () => {
    const html = "<p>Failure: The target's Speed is halved. This effect lasts until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
  });
  it("\"the target's next turn\" is the bearer's turn; \"the beast's next turn\", the creature's", () => {
    const own = "<p>Failure: The target's Speed is 0 until the end of the target's next turn.</p>";
    expect(monsterEffectDurations(own, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "bearerTurnEnd" } });
    const user = "<p>Hit: 5 damage, and the target can't climb until the start of the beast's next turn.</p>";
    expect(monsterEffectDurations(user, data)).toEqual({ effectEnds: { aaaaaaaaaaaaaaaa: "casterTurnStart" } });
  });
  it("two effects with no condition: we do not guess which", () => {
    const two = { activities: [{ type: "save", effects: ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"] }],
      effects: [{ id: "aaaaaaaaaaaaaaaa", statuses: [] }, { id: "bbbbbbbbbbbbbbbb", statuses: [] }] };
    const html = "<p>Failure: The target's Speed is halved until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, two)).toEqual({});
  });
  it("two sentences, two different durations: nothing is read for the effect with no condition", () => {
    const html = "<p>The beast has Advantage on attack rolls against the target until the start of the beast's next turn. "
      + "The target has Disadvantage on attack rolls until the end of its next turn.</p>";
    expect(monsterEffectDurations(html, data)).toEqual({});
  });
  it("a named condition keeps its reading (the effect that carries the condition)", () => {
    const named = { activities: [{ type: "save", effects: ["cccccccccccccccc"] }],
      effects: [{ id: "cccccccccccccccc", statuses: ["prone"] }] };
    const html = "<p>Failure: The target has the Prone condition until the end of the target's next turn.</p>";
    expect(monsterEffectDurations(html, named)).toEqual({ effectEnds: { cccccccccccccccc: "bearerTurnEnd" } });
  });
});

