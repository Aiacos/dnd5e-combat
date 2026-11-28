import { describe, it, expect } from "vitest";
import { open, advance, applicationPlan, STEPS } from "../module/scripts/core/action.mjs";
import { validateEntry } from "../module/scripts/core/content.mjs";
import { CONTENT } from "../module/scripts/content/index.mjs";
import { RESOLUTION_BASE } from "./helpers.mjs";

const T = (n, extra={}) => ({ token: `T${n}`, actor: `A${n}`, name: `Cible ${n}`, ac: 12, ...extra });
const base = RESOLUTION_BASE;
const roll = total => ({ total, isCritical: false, isFumble: false });
const damages = [{ type: "fire", value: 10, properties: [] }];
const effect = { id: "E", activity: "Act", when: "always" };

describe("§28 Wizard: what the core does with it", () => {
  it("Supported cantrip, attack: the missed target takes half, without effect", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author", potent: true, effects: [effect] }, targets: [] });
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(5), messageId: "a", targets: [T(1)] }));
    expect(resolution.step).toBe(STEPS.AWAITING_ROLLS);
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages }));
    expect(applicationPlan(resolution)[0]).toMatchObject({ token: "T1", multiplier: 0.5, effects: [], steps: [] });
  });
  it("without the ability, a miss stays a miss", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author" }, targets: [] });
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(5), messageId: "a", targets: [T(1)] }));
    expect(resolution.step).toBe(STEPS.MISSED);
  });
  it("Supported cantrip: a hit taken by a replica (Mirror Image) is not a miss — nothing", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author", potent: true, effects: [effect] }, targets: [] });
    const targets = [T(1, { duplicates: 3 })];
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(18), messageId: "a", targets }));
    ({ resolution } = advance(resolution, { type: "duplicatesRolled", token: "T1", dice: [5, 1, 1] }));
    expect(resolution.targets[0]).toMatchObject({ hit: false, reason: "duplicate" });
    expect(resolution.step).toBe(STEPS.MISSED);
    expect(applicationPlan(resolution)).toEqual([]);
  });
  it("Supported cantrip: a target behind Total Cover takes nothing, the missed target beside it half", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author", potent: true, effects: [effect] }, targets: [] });
    const targets = [T(1, { ac: null }), T(2)];
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: roll(5), messageId: "a", targets }));
    expect(resolution.targets.map(t => t.reason)).toEqual(["cover", "miss"]);
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages }));
    expect(applicationPlan(resolution).map(e => [e.token, e.multiplier])).toEqual([["T2", 0.5]]);
  });
  it("Supported cantrip, \"none\" save succeeded: half, without effect", () => {
    let { resolution } = open({ ...base, plan: { damage: "author", potent: true, save: { ability: "dex", dc: 13, onSave: "none" }, effects: [effect] },
      targets: [T(1)] });
    ({ resolution } = advance(resolution, { type: "saveRolled", actor: "A1", total: 18, messageId: "s" }));
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages }));
    expect(applicationPlan(resolution)[0]).toMatchObject({ multiplier: 0.5, effects: [] });
  });
  it("Spell Sculptor: the spared ally succeeds outright and takes nothing", () => {
    let { resolution } = open({ ...base, plan: { damage: "author", save: { ability: "dex", dc: 15, onSave: "half" } },
      targets: [T(1, { sculpted: true, autoFail: "paralyzed" }), T(2)] });
    expect(resolution.targets[0].save).toMatchObject({ success: true, auto: "sculpted" });
    expect(resolution.targets[1].save).toBe(null);
    ({ resolution } = advance(resolution, { type: "saveRolled", actor: "A2", total: 3, messageId: "s" }));
    ({ resolution } = advance(resolution, { type: "damageRolled", messageId: "d", damages }));
    const plan = applicationPlan(resolution);
    expect(plan[0].multiplier).toBe(0);
    expect(plan[1].multiplier).toBe(1);
  });
  it("Illusory Duplicate: the Reaction makes the attack miss, even a Critical Hit", () => {
    let { resolution } = open({ ...base, plan: { attack: true, damage: "author" }, targets: [] });
    ({ resolution } = advance(resolution, { type: "attackRolled", roll: { total: 30, isCritical: true, isFumble: false }, messageId: "a", targets: [T(1, { canReact: true })] }));
    ({ resolution } = advance(resolution, { type: "reactionResolved", token: "T1", used: "Calque illusoire", ac: 12, miss: true }));
    expect(resolution.targets[0]).toMatchObject({ hit: false, critical: false, reaction: "Calque illusoire" });
    expect(resolution.step).toBe(STEPS.MISSED);
  });
  it("schema and content", () => {
    expect(validateEntry({ potentCantrip: true, sculptSpells: true })).toEqual([]);
    expect(validateEntry({ potentCantrip: 1 })).toEqual(["potentCantrip: true or absent"]);
    expect(CONTENT["illusory-self"].triggers[0].do.map(s => s.type)).toEqual(["use", "miss"]);
    expect(CONTENT["spell-resistance"].saveAdvantage).toEqual(["magic"]);
  });
});
