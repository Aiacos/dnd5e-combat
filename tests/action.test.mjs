import { describe, it, expect } from "vitest";
import {
  open, advance, STEPS, RESOLUTION_VERSION, current, affectedTargets, pendingSaves, wantsDamageRoll,
  isCriticalHit, applicationPlan, undoPlan, pendingAllocation, allocateDarts
} from "../module/scripts/core/action.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
const base = RESOLUTION_BASE;
const roll = (total, extra={}) => ({ total, isCritical: false, isFumble: false, ...extra });
const types = commands => commands.map(c => c.type === "echo" ? `echo:${c.on}` : c.type);
const FIRE = [{ type: "fire", value: 8, properties: [] }];

/** Chains events and returns the final resolution and all the emitted commands. */
function play(first, ...events) {
  let { resolution, commands } = first;
  const all = [...commands];
  for ( const event of events ) {
    const step = advance(resolution, event);
    resolution = step.resolution;
    all.push(...step.commands);
  }
  return { resolution, commands: all };
}

const hp = (before, after, temp=[0, 0]) => ({ before: { value: before, temp: temp[0] }, after: { value: after, temp: temp[1] } });

describe("schema", () => {
  it("writes its version, and ignores a resolution of another schema", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [T(1)] });
    expect(resolution.v).toBe(RESOLUTION_VERSION);
    expect(current(resolution)).toBe(resolution);
    expect(current({ kind: "attack", step: "done" })).toBe(null);
    expect(current(undefined)).toBe(null);
  });
});

describe("attaque", () => {
  const plan = { attack: true, damage: "author" };

  it("attend le jet d'attaque, sans rien demander", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)] });
    expect(resolution.step).toBe(STEPS.AWAITING_ATTACK);
    expect(commands).toEqual([]);
    expect(wantsDamageRoll(resolution)).toBe(false);
  });

  it("takes the roll's targets, not those of the use", () => {
    const { resolution } = play(open({ ...base, plan, targets: [T(1)] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(2), T(3, { ac: 18 })] });
    expect(resolution.targets.map(t => [t.token, t.hit])).toEqual([["T2", true], ["T3", false]]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(wantsDamageRoll(resolution)).toBe(true);
  });

  it("closes as \"miss\" if nobody is hit, and says so on the attack message", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1)] }),
      { type: "attackRolled", roll: roll(5), messageId: "Atk", targets: [T(1)] });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(types(commands)).toEqual(["echo:attack"]);
  });

  it("a defenseless target at 5 ft takes a Critical Hit automatically", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(13), messageId: "Atk", targets: [T(1, { defenceless: true }), T(2)] });
    expect(resolution.targets.map(t => [t.critical, t.reason])).toEqual([[true, "autoCritical"], [false, "ac"]]);
    expect(isCriticalHit(resolution)).toBe(true);
  });

  it("O9a (§354): a target that takes no Critical Hit (Adamantine Armor) — a normal hit, even defenseless", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(13), messageId: "Atk", targets: [T(1, { defenceless: true, noCrit: true })] });
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: false, uncritted: true });
    expect(isCriticalHit(resolution)).toBe(false);
  });

  it("applies to the hit targets only, then opens the \"wounded\" window and cleans up", () => {
    const opened = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2, { ac: 18 })] },
      { type: "damageRolled", messageId: "Dmg", damages: FIRE });
    expect(types(opened.commands)).toEqual(["echo:attack", "apply"]);
    expect(opened.commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] }]);
    const done = advance(opened.resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(20, 12), effects: [] }] });
    expect(done.resolution.step).toBe(STEPS.DONE);
    expect(done.resolution.targets[0].damage).toEqual({ applied: 8 });
    expect(done.commands).toEqual([
      { type: "echo", on: "damage" }, { type: "window", window: "isDamaged", tokens: ["T1"] }, { type: "cleanup" }
    ]);
  });

  it("bearer = attack message (roll outside a card): judged on opening", () => {
    const { resolution } = open({ ...base, carrier: "Atk", origin: null, plan, targets: [],
      attack: { roll: roll(15), messageId: "Atk", targets: [T(1)] } });
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(resolution.attack.messageId).toBe("Atk");
  });

  it("an effect on hit (Chill Touch, Grapple) goes only to those who are hit", () => {
    const withEffect = { attack: true, damage: null, effects: [{ id: "E", activity: "Act", when: "always" }] };
    const { commands } = play(open({ ...base, plan: withEffect, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2, { ac: 18 })] });
    expect(commands.at(-1)).toEqual({ type: "apply", entries: [
      { token: "T1", actor: "A1", multiplier: 0, effects: [{ id: "E", activity: "Act" }], steps: [] }
    ] });
  });

  it("M3: the size condition travels with the effect until application (Wolf's Bite)", () => {
    const gate = JSON.stringify({ "target.sizeAtMost": "med" });
    const plan = { attack: true, damage: null, effects: [{ id: "P", activity: "Act", when: "always", if: gate }] };
    const { commands } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1)] });
    expect(commands.at(-1).entries[0].effects).toEqual([{ id: "P", activity: "Act", if: gate }]);
  });
});

describe("\"hit\" reaction window", () => {
  const plan = { attack: true, damage: "author" };
  const attacked = () => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1, { canReact: true }), T(2, { canReact: true, ac: 18 }), T(3)] });

  it("is written BEFORE waiting: step and pending requests are in the resolution", () => {
    const { resolution, commands } = attacked();
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    expect(resolution.pending).toEqual([{ kind: "reaction", window: "isHit", token: "T1" }]);   // T2 is not hit
    expect(commands).toEqual([{ type: "askReactions", window: "isHit", tokens: ["T1"] }]);
    expect(wantsDamageRoll(resolution)).toBe(false);
  });

  it("Shield: rejudged against the new AC, the hit becomes a miss", () => {
    const { resolution } = play(attacked(), { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(resolution.targets[0]).toMatchObject({ hit: false, reaction: "Bouclier", ac: 17 });
    expect(resolution.pending).toEqual([]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);   // T3 stays hit
  });

  it("a Critical Hit hits despite the Shield", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25, { isCritical: true }), messageId: "Atk", targets: [T(1, { canReact: true })] },
      { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 30 });
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: true });
  });

  it("without a reaction, the verdict does not move", () => {
    const { resolution, commands } = play(attacked(), { type: "reactionResolved", token: "T1", used: null, ac: 12 });
    expect(resolution.targets[0].hit).toBe(true);
    expect(types(commands)).toEqual(["askReactions", "echo:attack"]);
  });

  it("ignores an answer that is not expected", () => {
    const { resolution } = attacked();
    expect(advance(resolution, { type: "reactionResolved", token: "T3", used: "Bouclier", ac: 30 }).resolution).toBe(resolution);
  });
});

describe("duplicates (Mirror Image, §16.25)", () => {
  const plan = { attack: true, damage: "author" };
  const attacked = targets => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets });

  it("a hit target that has duplicates makes them play; missed or without duplicates, nothing", () => {
    const { resolution, commands } = attacked([T(1, { duplicates: 3 }), T(2, { duplicates: 3, ac: 18 }), T(3)]);
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    expect(resolution.pending).toEqual([{ kind: "duplicates", token: "T1" }]);
    expect(commands).toEqual([{ type: "rollDuplicates", tokens: ["T1"] }]);
  });

  it("a 3 or more: a duplicate takes the hit, the target is missed", () => {
    const { resolution } = play(attacked([T(1, { duplicates: 2 }), T(3)]), { type: "duplicatesRolled", token: "T1", dice: [1, 4] });
    expect(resolution.targets[0]).toMatchObject({ hit: false, critical: false, reason: "duplicate", duplicate: { dice: [1, 4], taken: true } });
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T3"]);
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
  });

  it("only 1s and 2s: the blow lands; alone, the missed target closes the action", () => {
    const kept = play(attacked([T(1, { duplicates: 3 })]), { type: "duplicatesRolled", token: "T1", dice: [1, 2, 2] });
    expect(kept.resolution.targets[0]).toMatchObject({ hit: true, duplicate: { taken: false } });
    const lost = play(attacked([T(1, { duplicates: 1 })]), { type: "duplicatesRolled", token: "T1", dice: [6] });
    expect(lost.resolution.step).toBe(STEPS.MISSED);
  });

  it("Shield first: a hit it makes miss does not reach the duplicates", () => {
    const shielded = play(attacked([T(1, { canReact: true, duplicates: 3 })]), { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(shielded.resolution.step).toBe(STEPS.MISSED);
    expect(types(shielded.commands)).not.toContain("rollDuplicates");
    const through = play(attacked([T(1, { canReact: true, duplicates: 3 })]), { type: "reactionResolved", token: "T1", used: null, ac: 12 });
    expect(through.commands.at(-1)).toEqual({ type: "rollDuplicates", tokens: ["T1"] });
  });

  it("ignores dice that are not expected", () => {
    const { resolution } = attacked([T(1, { duplicates: 3 })]);
    expect(advance(resolution, { type: "duplicatesRolled", token: "T9", dice: [6] }).resolution).toBe(resolution);
    expect(advance(resolution, { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 30 }).resolution).toBe(resolution);
  });
});

describe("distributed projectiles (Magic Missile, §16.27)", () => {
  const plan = { attack: false, damage: "system", darts: 4 };
  const FORCE = [{ type: "force", value: 3, properties: [] }];

  it("a single target receives all the projectiles, without a question", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1)] }), { type: "damageRolled", messageId: "Dmg", damages: FORCE });
    expect(pendingAllocation(resolution)).toBe(false);
    expect(commands.at(-1).entries[0]).toMatchObject({ token: "T1", multiplier: 4 });
  });

  it("several targets: the author distributes, each target takes the damage that many times", () => {
    const opened = open({ ...base, plan, targets: [T(1), T(2)] });
    expect(opened.commands).toEqual([{ type: "askAllocation", count: 4, targets: [{ token: "T1", name: "Cible 1" }, { token: "T2", name: "Cible 2" }] }]);
    const { commands } = play(opened, { type: "damageRolled", messageId: "Dmg", damages: FORCE }, { type: "allocated", counts: { T1: 3, T2: 1 } });
    expect(commands.at(-1).entries.map(e => [e.token, e.multiplier])).toEqual([["T1", 3], ["T2", 1]]);
  });

  it("a wrong distribution is straightened out: one each, the rest to the first", () => {
    expect(allocateDarts(4, ["A", "B"], { A: 5, B: 2 })).toEqual({ A: 3, B: 1 });
    expect(allocateDarts(3, ["A", "B"], { A: 0, B: 3 })).toEqual({ A: 0, B: 3 });
    expect(allocateDarts(2, ["A", "B", "C"], {})).toEqual({ A: 1, B: 1, C: 0 });
  });

  it("applies nothing while the distribution is missing", () => {
    const { resolution, commands } = play(open({ ...base, plan, targets: [T(1), T(2)] }), { type: "damageRolled", messageId: "Dmg", damages: FORCE });
    expect(types(commands)).not.toContain("apply");
    expect(pendingAllocation(resolution)).toBe(true);
  });
});

describe("sauvegarde", () => {
  const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  const effects = [{ id: "E1", activity: "Act", when: "failedSave" }, { id: "E2", activity: "Act", when: "always" }];
  const plan = { save, damage: "author", effects };
  const opened = () => open({ ...base, plan, targets: [T(1), T(2)] });

  it("asks for the saves on opening, and tells the author to roll their damage", () => {
    const { resolution, commands } = opened();
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(commands).toEqual([{ type: "requestSaves", targets: [
      { token: "T1", actor: "A1", name: "Cible 1" }, { token: "T2", actor: "A2", name: "Cible 2" }
    ] }]);
    expect(wantsDamageRoll(resolution)).toBe(true);
  });

  it("succeeds from the DC; the first roll counts; an unknown is ignored", () => {
    let { resolution } = play(opened(), { type: "saveRolled", actor: "A1", total: 15, messageId: "s1" });
    expect(resolution.targets[0].save).toEqual({ total: 15, success: true, messageId: "s1" });
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 2, messageId: "s2" }).resolution).toBe(resolution);
    expect(advance(resolution, { type: "saveRolled", actor: "A9", total: 2, messageId: "s3" }).resolution).toBe(resolution);
  });

  it("§18.9: Legendary Resistance — the failure counts as a success, the total stays that of the roll", () => {
    const { commands, resolution } = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 4, messageId: "s1", resisted: true }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(resolution.targets[0].save).toEqual({ total: 4, success: true, messageId: "s1", resisted: true });
    expect(commands.at(-1).entries.map(e => e.multiplier)).toEqual([0.5, 1]);
  });

  it("§487: a success opens the \"succeeds on a saving throw against\" window, on that token only, a failure does not", () => {
    const ok = advance(opened().resolution, { type: "saveRolled", actor: "A1", total: 15, messageId: "s1" });
    expect(ok.commands).toEqual([{ type: "window", window: "savesAgainst", tokens: ["T1"] }]);
    const ko = advance(opened().resolution, { type: "saveRolled", actor: "A2", total: 14, messageId: "s2" });
    expect(ko.commands.filter(c => c.type === "window")).toEqual([]);
    // Legendary Resistance: the creature succeeds, the window opens too.
    const lr = advance(opened().resolution, { type: "saveRolled", actor: "A2", total: 3, messageId: "s3", resisted: true });
    expect(lr.commands).toEqual([{ type: "window", window: "savesAgainst", tokens: ["T2"] }]);
  });

  it("serves two tokens of the same actor one after the other", () => {
    const twins = [T(1), { ...T(2), actor: "A1" }];
    const { resolution } = play(open({ ...base, plan, targets: twins }),
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A1", total: 3, messageId: "s2" });
    expect(resolution.targets.map(t => t.save.success)).toEqual([true, false]);
  });

  it("waits for all the saves AND the damage roll, in any order, and applies only once", () => {
    const a = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE }, { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" });
    expect(types(a.commands)).toEqual(["requestSaves", "window"]);
    const b = play(a, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(types(b.commands)).toEqual(["requestSaves", "window", "apply"]);
    expect(b.resolution.applying).toBe(true);
    expect(advance(b.resolution, { type: "damageRolled", messageId: "D2", damages: FIRE }).resolution).toBe(b.resolution);
  });

  it("half damage on a success, all on a failure; the \"failedSave\" effect spares whoever succeeds", () => {
    const { commands } = play(opened(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 0.5, effects: [{ id: "E2", activity: "Act" }], steps: [] },
      { token: "T2", actor: "A2", multiplier: 1, effects: [{ id: "E1", activity: "Act" }, { id: "E2", activity: "Act" }], steps: [] }
    ]);
  });

  it("§19: a \"saved\" effect goes only to whoever succeeds (Ray of Enfeeblement); an onSave step knows who succeeded", () => {
    const withSaved = { save, damage: null, effects: [{ id: "EF", activity: "Act", when: "failedSave" }, { id: "ES", activity: "Act", when: "saved" }],
      steps: [{ when: "always", type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half" }, { when: "failedSave", type: "status", status: "prone" }] };
    const { commands } = play(open({ ...base, plan: withSaved, targets: [T(1), T(2)] }),
      { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 0, effects: [{ id: "ES", activity: "Act" }],
        steps: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half", saved: true }] },
      { token: "T2", actor: "A2", multiplier: 0, effects: [{ id: "EF", activity: "Act" }],
        steps: [{ type: "damage", formula: "2d4", damageType: "necrotic", onSave: "half", saved: false }, { type: "status", status: "prone" }] }
    ]);
  });

  it("onSave none et full", () => {
    for ( const [onSave, expected] of [["none", 0], ["full", 1]] ) {
      const { resolution } = play(open({ ...base, plan: { save: { ...save, onSave }, damage: "author" }, targets: [T(1)] }),
        { type: "saveRolled", actor: "A1", total: 20, messageId: "s" });
      expect(applicationPlan(resolution)[0].multiplier).toBe(expected);
    }
  });

  it("automatic failure: no roll requested, full damage; a roll arriving afterwards is ignored", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1, { autoFail: "paralyzed" }), T(2)] });
    expect(resolution.targets[0].save).toEqual({ total: null, success: false, messageId: null, auto: "paralyzed" });
    expect(commands[0].targets.map(t => t.token)).toEqual(["T2"]);
    expect(pendingSaves(resolution).map(t => t.token)).toEqual(["T2"]);
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 20, messageId: "s" }).resolution).toBe(resolution);
  });

  it("unaffected target (§16.8: not a Humanoid): no save, no effect; alone, the action is closed", () => {
    const off = { reason: "type", detail: "humanoid" };
    const { resolution, commands } = open({ ...base, plan: { save, effects }, targets: [T(1, { unaffected: off }), T(2)] });
    expect(resolution.targets[0].unaffected).toEqual(off);
    expect(commands[0].targets.map(t => t.token)).toEqual(["T2"]);
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T2"]);
    const done = play({ resolution, commands: [] }, { type: "saveRolled", actor: "A2", total: 1, messageId: "s" });
    expect(applicationPlan(done.resolution).map(e => e.token)).toEqual(["T2"]);
    const alone = open({ ...base, plan: { save, effects }, targets: [T(1, { unaffected: off })] });
    expect(alone.resolution.step).toBe(STEPS.DONE);
    expect(alone.commands).toEqual([]);
  });

  it("Uncanny Dodge (§16.11): the reaction halves the attack's damage, the target stays hit", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution, commands } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true }), T(2)] });
    expect(resolution.step).toBe(STEPS.AWAITING_REACTION);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Esquive instinctive", ac: 12, halve: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, halved: true, reaction: "Esquive instinctive" });
    ({ resolution, commands } = advance(resolution, { type: "damageRolled", messageId: "d", damages: FIRE }));
    const entries = commands.find(c => c.type === "apply").entries;
    expect(entries.map(e => e.multiplier)).toEqual([0.5, 1]);
  });

  it("Sentinel at Death's Door (§19.9): half damage, and the Critical Hit is no more than a hit", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25, { isCritical: true }), messageId: "a", targets: [T(1, { canReact: true })] });
    expect(resolution.targets[0].critical).toBe(true);
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Sentinelle", ac: 12, halve: true, uncrit: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: false, halved: true, uncritted: true });
    expect(isCriticalHit(resolution)).toBe(false);
  });

  it("a reaction that changes nothing about the automatic Critical Hit (Paralyzed at 5 ft) leaves it a Critical Hit", () => {
    const plan = { attack: true, damage: "author" };
    let { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { canReact: true, defenceless: true })] });
    expect(resolution.targets[0]).toMatchObject({ critical: true, reason: "autoCritical" });
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Esquive instinctive", ac: 12, halve: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: true, halved: true });
  });

  it("riposte (§16.9): the damage taken by the attacker is logged, and undone with the action", () => {
    let { resolution } = play(open({ ...base, plan: { attack: true, damage: "author" }, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1)] },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    ({ resolution } = advance(resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(20, 12), effects: [] }],
      extra: [{ token: "Src", actor: "ASrc", name: "Bouclier de feu", ...hp(30, 21) }] }));
    expect(resolution.step).toBe(STEPS.DONE);
    expect(undoPlan(resolution).hp).toEqual([
      { actor: "ASrc", restore: { value: 30, temp: 0 } },
      { actor: "A1", restore: { value: 20, temp: 0 } }
    ]);
    expect(resolution.targets[0].damage.applied).toBe(8);
  });

  it("attack on an unaffected target: the roll happens, but nothing reaches it", () => {
    const { resolution } = play(open({ ...base, plan: { attack: true, damage: "author" }, targets: [] }),
      { type: "attackRolled", roll: roll(25), messageId: "a", targets: [T(1, { unaffected: { reason: "immune", detail: "charmed" } })] });
    expect(resolution.targets[0].hit).toBe(true);
    expect(affectedTargets(resolution)).toEqual([]);
    expect(resolution.step).toBe(STEPS.MISSED);
  });

  it("without damage and everyone automatically failing: applied on opening", () => {
    const { commands } = open({ ...base, plan: { save, effects }, targets: [T(1, { autoFail: "stunned" })] });
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries[0].multiplier).toBe(0);
  });
});

describe("attack that imposes a save (poisoned bite)", () => {
  const plan = {
    attack: true, damage: "author",
    save: { ability: "con", dc: 13, onSave: "none", activity: "Poison", chained: true },
    effects: [{ id: "Empoisonne", activity: "Poison", when: "failedSave" }]
  };
  const bitten = () => play(open({ ...base, plan, targets: [] }),
    { type: "attackRolled", roll: roll(15), messageId: "Atk", targets: [T(1), T(2), T(3, { ac: 18 })] });

  it("asks for the save only from those who are hit, after the verdict", () => {
    const { commands } = bitten();
    expect(types(commands)).toEqual(["echo:attack", "requestSaves"]);
    expect(commands[1].targets.map(t => t.token)).toEqual(["T1", "T2"]);
  });

  it("the successful save avoids the poison, not the bite's damage", () => {
    const { commands } = play(bitten(), { type: "damageRolled", messageId: "D", damages: FIRE },
      { type: "saveRolled", actor: "A1", total: 18, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 4, messageId: "s2" });
    expect(commands.at(-1).entries).toEqual([
      { token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] },
      { token: "T2", actor: "A2", multiplier: 1, effects: [{ id: "Empoisonne", activity: "Poison" }], steps: [] }
    ]);
  });

  it("the missed target rolls nothing", () => {
    const { resolution } = bitten();
    expect(advance(resolution, { type: "saveRolled", actor: "A3", total: 1, messageId: "s" }).resolution).toBe(resolution);
    expect(affectedTargets(resolution).map(t => t.token)).toEqual(["T1", "T2"]);
  });
});

describe("damage, healing and utilities with no attack roll", () => {
  it("\"damage\" activity: the system rolls, the author has nothing to do, everyone takes it", () => {
    const { resolution, commands } = play(open({ ...base, plan: { damage: "system" }, targets: [T(1)] }),
      { type: "damageRolled", messageId: "D", damages: FIRE });
    expect(wantsDamageRoll(resolution)).toBe(false);
    expect(commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 1, effects: [], steps: [] }]);
  });

  it("healing: HP restored are written as a negative loss, and do not open the \"wounded\" window", () => {
    const healed = play(open({ ...base, plan: { damage: "system", heal: true }, targets: [T(1)] }),
      { type: "damageRolled", messageId: "D", damages: [{ type: "healing", value: 7, properties: [] }] });
    const { resolution, commands } = advance(healed.resolution, { type: "applied", entries: [{ token: "T1", actor: "A1", ...hp(5, 12), effects: [] }] });
    expect(resolution.targets[0].damage).toEqual({ applied: -7 });
    expect(types(commands)).toEqual(["echo:damage", "cleanup"]);
  });

  it("Bless: effects alone are placed on opening", () => {
    const { commands } = open({ ...base, plan: { effects: [{ id: "Beni", activity: "Act", when: "always" }] }, targets: [T(1), T(2)] });
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries.map(e => e.effects)).toEqual([[{ id: "Beni", activity: "Act" }], [{ id: "Beni", activity: "Act" }]]);
  });
});

describe("journal et annulation", () => {
  const save = { ability: "dex", dc: 15, onSave: "half", activity: "Act", chained: false };
  const done = () => play(open({ ...base, plan: { save, damage: "author", effects: [{ id: "E", activity: "Act", when: "failedSave" }] }, targets: [T(1), T(2)] }),
    { type: "damageRolled", messageId: "D", damages: FIRE },
    { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 3, messageId: "s2" },
    { type: "applied", entries: [
      { token: "T1", actor: "A1", ...hp(20, 18, [3, 1]), effects: [] },
      { token: "T2", actor: "A2", ...hp(20, 12), effects: ["Actor.A2.ActiveEffect.x"] }
    ] });

  it("records HP lost (temporary included) and effects created, then can undo everything, from most recent to oldest", () => {
    const { resolution } = done();
    expect(resolution.targets.map(t => t.damage.applied)).toEqual([4, 8]);
    expect(undoPlan(resolution)).toEqual({
      hp: [{ actor: "A2", restore: { value: 20, temp: 0 } }, { actor: "A1", restore: { value: 20, temp: 3 } }],
      effects: ["Actor.A2.ActiveEffect.x"]
    });
  });

  it("a target with no damage applied has no HP entry in the log", () => {
    const { resolution } = play(open({ ...base, plan: { effects: [{ id: "E", activity: "Act", when: "always" }] }, targets: [T(1)] }),
      { type: "applied", entries: [{ token: "T1", actor: "A1", before: null, after: null, effects: ["fx"] }] });
    expect(resolution.log).toEqual([{ at: "applyEffect", token: "T1", actor: "A1", effect: "fx" }]);
  });

  it("accepts nothing more once closed; is cancelled once, and says so again on the damage message", () => {
    const { resolution } = done();
    expect(advance(resolution, { type: "saveRolled", actor: "A1", total: 1, messageId: "z" }).resolution).toBe(resolution);
    const { resolution: cancelled, commands } = advance(resolution, { type: "undone" });
    expect(cancelled.step).toBe(STEPS.UNDONE);
    expect(commands).toEqual([{ type: "echo", on: "damage" }]);
    expect(advance(cancelled, { type: "undone" }).resolution).toBe(cancelled);
  });

  it("never modifies the original resolution", () => {
    const { resolution } = open({ ...base, plan: { save, damage: "author" }, targets: [T(1)] });
    const frozen = JSON.stringify(resolution);
    advance(resolution, { type: "saveRolled", actor: "A1", total: 20, messageId: "s" });
    advance(resolution, { type: "damageRolled", messageId: "D", damages: FIRE });
    expect(JSON.stringify(resolution)).toBe(frozen);
  });

  it("an unknown event changes nothing", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [] });
    expect(advance(resolution, { type: "nimporte" }).resolution).toBe(resolution);
  });
});

describe("effect choice (exclusive effects, Hex)", () => {
  const options = [{ id: "Str", label: "Force" }, { id: "Dex", label: "Dextérité" }, { id: "Con", label: "Constitution" }];
  const effects = [
    { id: "Str", activity: "Act", when: "always" }, { id: "Dex", activity: "Act", when: "always" },
    { id: "Con", activity: "Act", when: "always" }, { id: "Aut", activity: "Act", when: "always" }   // Aut : hors du choix
  ];
  const plan = { effects, choice: { prompt: null, options } };
  const cast = () => open({ ...base, plan, targets: [T(1)] });

  it("asks the author for the choice before applying, and writes it as pending", () => {
    const { resolution, commands } = cast();
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    expect(resolution.choice).toBe(null);
    expect(resolution.pending).toEqual([{ kind: "choice" }]);
    expect(commands).toEqual([{ type: "askChoice", prompt: null, options }]);
  });

  it("applies only the chosen effect, plus those that are not up for choice", () => {
    const { resolution, commands } = play(cast(), { type: "choiceMade", id: "Dex" });
    expect(resolution.choice).toBe("Dex");
    expect(resolution.pending).toEqual([]);
    expect(types(commands)).toEqual(["askChoice", "apply"]);
    expect(commands.at(-1).entries).toEqual([{ token: "T1", actor: "A1", multiplier: 0, effects: [
      { id: "Dex", activity: "Act" }, { id: "Aut", activity: "Act" }
    ], steps: [] }]);
  });

  it("choice made in advance (\"Grapple\" menu): no question, the chosen effect applies", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)], choice: "Con" });
    expect(resolution.choice).toBe("Con");
    expect(types(commands)).toEqual(["apply"]);
    expect(commands.at(-1).entries[0].effects).toEqual([{ id: "Con", activity: "Act" }, { id: "Aut", activity: "Act" }]);
  });

  it("advance choice outside the options: ignored, the question is asked", () => {
    const { resolution, commands } = open({ ...base, plan, targets: [T(1)], choice: "Cha" });
    expect(resolution.choice).toBe(null);
    expect(types(commands)).toEqual(["askChoice"]);
  });

  it("§401: with a save, the per-target choice waits for the last one and names only the targets that failed", () => {
    const failEffects = effects.map(e => ({ ...e, when: "fail" }));
    const per = { effects: failEffects, save: { ability: "cha", dc: 13, onSave: "none" }, choice: { prompt: null, options, perTarget: true } };
    const opened = open({ ...base, plan: per, targets: [T(1), T(2)] });
    expect(types(opened.commands)).not.toContain("askChoice");   // not at the same time as the save windows
    let step = advance(opened.resolution, { type: "saveRolled", actor: "A1", total: 5, messageId: "s1" });
    expect(types(step.commands)).not.toContain("askChoice");
    step = advance(step.resolution, { type: "saveRolled", actor: "A2", total: 20, messageId: "s2" });
    expect(step.commands.find(c => c.type === "askChoice")?.perTarget).toEqual([{ token: "T1", name: "Cible 1" }]);
    const done = advance(step.resolution, { type: "choiceMade", choices: { T1: "Dex" } });
    const byToken = Object.fromEntries(done.commands.at(-1).entries.map(e => [e.token, e.effects.map(x => x.id)]));
    expect(byToken).toEqual({ T1: ["Dex", "Aut"], T2: [] });
  });

  it("§401: all the targets succeed — no question, nothing is asked", () => {
    const per = { effects: effects.map(e => ({ ...e, when: "fail" })), save: { ability: "cha", dc: 13, onSave: "none" }, choice: { prompt: null, options, perTarget: true } };
    const opened = open({ ...base, plan: per, targets: [T(1)] });
    const step = advance(opened.resolution, { type: "saveRolled", actor: "A1", total: 20, messageId: "s1" });
    expect(types(step.commands)).toEqual(["window", "apply"]);
  });

  it("§401: one choice per target — the question names each target, each receives its own", () => {
    const per = { effects, choice: { prompt: null, options, perTarget: true } };
    const opened = open({ ...base, plan: per, targets: [T(1), T(2)] });
    expect(opened.commands).toEqual([{ type: "askChoice", prompt: null, options, perTarget: [{ token: "T1", name: "Cible 1" }, { token: "T2", name: "Cible 2" }] }]);
    const { resolution, commands } = play(opened, { type: "choiceMade", choices: { T1: "Str", T2: "Cha" } });
    expect(resolution.choice).toEqual({ T1: "Str", T2: "Str" });   // T2: outside the options → the first
    const byToken = Object.fromEntries(commands.at(-1).entries.map(e => [e.token, e.effects.map(x => x.id)]));
    expect(byToken).toEqual({ T1: ["Str", "Aut"], T2: ["Str", "Aut"] });
    const other = play(open({ ...base, plan: per, targets: [T(1), T(2)] }), { type: "choiceMade", choices: { T1: "Dex", T2: "Con" } });
    expect(Object.fromEntries(other.commands.at(-1).entries.map(e => [e.token, e.effects[0].id]))).toEqual({ T1: "Dex", T2: "Con" });
  });

  it("ignores an id outside the options, and an answer that is not expected", () => {
    const { resolution } = cast();
    expect(advance(resolution, { type: "choiceMade", id: "Cha" }).resolution).toBe(resolution);
    const { resolution: chosen } = play(cast(), { type: "choiceMade", id: "Str" });
    expect(advance(chosen, { type: "choiceMade", id: "Dex" }).resolution).toBe(chosen);
  });

  it("without `choice` in the plan, all the effects apply as before", () => {
    const { resolution, commands } = open({ ...base, plan: { effects }, targets: [T(1)] });
    expect(resolution.plan.choice).toBe(null);
    expect(types(commands)).toEqual(["apply"]);
    expect(commands[0].entries[0].effects).toHaveLength(4);
  });

  it("with an attack: the choice is asked only once the verdict is given, and only if someone is hit", () => {
    const attackPlan = { attack: true, effects, choice: { prompt: "Laquelle ?", options } };
    const missed = play(open({ ...base, plan: attackPlan, targets: [T(1)] }), { type: "attackRolled", roll: roll(5), messageId: "R", targets: [T(1)] });
    expect(missed.resolution.step).toBe(STEPS.MISSED);
    expect(types(missed.commands)).toEqual(["echo:attack"]);
    const hit = play(open({ ...base, plan: attackPlan, targets: [T(1)] }), { type: "attackRolled", roll: roll(15), messageId: "R", targets: [T(1)] });
    expect(types(hit.commands)).toEqual(["echo:attack", "askChoice"]);
    expect(hit.commands[1].prompt).toBe("Laquelle ?");
  });
});

describe("outcome steps of the plan (SPEC §16: move, status)", () => {
  const push = { when: "failedSave", type: "move", mode: "push", distance: 10, units: "ft" };
  const pull = { when: "always", type: "move", mode: "pull", distance: 10, units: "ft", if: { "target.sizeAtMost": "lg" } };

  it("a save: the \"failedSave\" step goes only to those who failed, without its \"when\"", () => {
    const first = open({ ...base, plan: { save: { ability: "con", dc: 13, onSave: "half" }, damage: "author", steps: [push] }, targets: [T(1), T(2)] });
    const { resolution, commands } = play(first,
      { type: "saveRolled", actor: "A1", total: 5, messageId: "s1" },
      { type: "saveRolled", actor: "A2", total: 18, messageId: "s2" },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    const apply = commands.find(c => c.type === "apply");
    expect(apply.entries.find(e => e.token === "T1").steps).toEqual([{ type: "move", mode: "push", distance: 10, units: "ft" }]);
    expect(apply.entries.find(e => e.token === "T2").steps).toEqual([]);
    expect(resolution.plan.steps).toEqual([push]);
  });

  it("an attack: the \"always\" step goes to each hit target, with its condition", () => {
    const first = open({ ...base, plan: { attack: true, damage: "author", steps: [pull] }, targets: [T(1), T(2)] });
    const { commands } = play(first,
      { type: "attackRolled", roll: roll(15), messageId: "a", targets: [T(1, { ac: 10 }), T(2, { ac: 20 })] },
      { type: "damageRolled", messageId: "d", damages: FIRE });
    const apply = commands.find(c => c.type === "apply");
    expect(apply.entries.map(e => e.token)).toEqual(["T1"]);
    expect(apply.entries[0].steps).toEqual([{ type: "move", mode: "pull", distance: 10, units: "ft", if: { "target.sizeAtMost": "lg" } }]);
  });

  it("without steps: an empty list, never absent", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [T(1)] });
    expect(resolution.plan.steps).toEqual([]);
  });
});

describe("§19.6: save margin (\"if it fails the save by 5 or more\")", () => {
  const save = { ability: "con", dc: 19, onSave: "none", activity: "Act", chained: false };
  const plan = { save, damage: null, effects: [{ id: "EF", activity: "Act", when: "failedSave", margin: { min: 5 } }, { id: "EH", activity: "Act", when: "failedSave", margin: { max: 4 } }],
    steps: [{ when: "failedSave", type: "status", status: "prone", margin: { min: 5 } }] };
  it("missed by 5: the effect at 5 and the step; missed by 2: only the effect at 4 at most; succeeded: nothing", () => {
    const { commands } = play(open({ ...base, plan, targets: [T(1), T(2), T(3)] }),
      { type: "saveRolled", actor: "A1", total: 14, messageId: "s1" }, { type: "saveRolled", actor: "A2", total: 17, messageId: "s2" },
      { type: "saveRolled", actor: "A3", total: 20, messageId: "s3" });
    const [a, b, c] = commands.at(-1).entries;
    expect(a.effects.map(e => e.id)).toEqual(["EF"]);
    expect(a.steps.map(s => s.status)).toEqual(["prone"]);
    expect(b.effects.map(e => e.id)).toEqual(["EH"]);
    expect(b.steps).toEqual([]);
    expect(c.effects).toEqual([]);
  });
});

describe("Critical Hit by exceeding the AC (§207)", () => {
  const plan = { attack: true, damage: "author" };
  it("22 against AC 12 with a margin of 10: Critical Hit, per target; without margin, a simple hit", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(22), messageId: "Atk", targets: [T(1), T(2, { ac: 15 })], critMargin: 10 });
    expect(resolution.targets.map(t => [t.hit, t.critical, t.reason])).toEqual([[true, true, "beatsAc"], [true, false, "ac"]]);
    expect(isCriticalHit(resolution)).toBe(true);
    const plain = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(22), messageId: "Atk", targets: [T(1)] }).resolution;
    expect(plain.targets[0]).toMatchObject({ hit: true, critical: false, reason: "ac" });
  });
  it("a Shield that raises the AC cancels the margin, the blow still hits", () => {
    const { resolution } = play(open({ ...base, plan, targets: [] }),
      { type: "attackRolled", roll: roll(22), messageId: "Atk", targets: [T(1, { canReact: true })], critMargin: 10 },
      { type: "reactionResolved", token: "T1", used: "Bouclier", ac: 17 });
    expect(resolution.targets[0]).toMatchObject({ hit: true, critical: false, reaction: "Bouclier" });
  });
});

describe("§402: automatic success by type", () => {
  it("a target marked autoSucceed is recorded as succeeded without a roll", async () => {
    const { open, STEPS } = await import("../module/scripts/core/action.mjs");
    const r = open({ id: "r", activity: "a", source: "s", origin: "m", plan: { save: { ability: "con", dc: 15 }, effects: [] },
      targets: [{ token: "t1", actor: "a1", name: "Golem", autoSucceed: "type:construct" }, { token: "t2", actor: "a2", name: "Orc" }] });
    const golem = r.resolution.targets.find(t => t.token === "t1");
    expect(golem.save).toMatchObject({ success: true, auto: "type:construct" });
    expect(r.resolution.targets.find(t => t.token === "t2").save).toBeNull();
    expect(r.commands.find(c => c.type === "requestSaves")?.targets.map(t => t.token)).toEqual(["t2"]);
  });
});

describe("unknown event", () => {
  it("a type inherited from Object.prototype is not a transition: the resolution comes back as is", () => {
    const { resolution } = open({ ...base, plan: { attack: true }, targets: [T(1)] });
    for ( const type of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "inconnu", undefined] ) {
      expect(advance(resolution, { type })).toEqual({ resolution, commands: [] });
    }
  });
});
