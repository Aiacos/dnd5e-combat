import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MODULE_ID } from "../module/scripts/constants.mjs";

/**
 * §397 : le premier round commence seul quand tout le monde a lancé — une seule fois. Une réponse du serveur qui porte plusieurs
 * initiatives (PNJ groupés, « lancer les PNJ » de dnd5e) appelle `updateCombatant` une fois par combattant, alors que
 * `combat.started` ne change qu'à la réponse suivante du serveur.
 */
const routes = new Map();
vi.mock("../module/scripts/runtime/router.mjs", () => ({ route: (hook, handler) => routes.set(hook, handler) }));
vi.mock("../module/scripts/runtime/group-roll.mjs", () => ({ requestGroupRoll: vi.fn(async () => null) }));
vi.mock("../module/scripts/adapter/vision.mjs", () => ({ canSee: () => true }));
vi.mock("../module/scripts/adapter/summons.mjs", () => ({ summonItemOf: () => null }));

const { registerCombatLaunch, LAUNCH_STATE } = await import("../module/scripts/runtime/combat-launch.mjs");

const settings = new Map();

beforeEach(() => {
  routes.clear();
  settings.clear();
  settings.set(`${MODULE_ID}.${LAUNCH_STATE}`, { combat: "C1" });
  globalThis.game = {
    user: { isGM: true }, users: { activeGM: { isSelf: true } },
    settings: { register: () => {}, get: (scope, key) => settings.get(`${scope}.${key}`), set: async (scope, key, value) => settings.set(`${scope}.${key}`, value) }
  };
  registerCombatLaunch();
});

afterEach(() => { delete globalThis.game; });

/** Un combat dont `startCombat` se comporte comme celui de Foundry : `started` ne passe à vrai qu'à la réponse du serveur. */
function fakeCombat(count) {
  const combatants = Array.from({ length: count }, (_, i) => ({ id: `c${i}`, initiative: null, token: null }));
  const combat = {
    id: "C1", started: false, combatants, starts: 0,
    async startCombat() { this.starts += 1; await new Promise(r => setTimeout(r, 5)); this.started = true; return this; },
    async updateEmbeddedDocuments() {}
  };
  for ( const c of combatants ) c.combat = combat;
  return combat;
}

describe("§397 : le premier round ne commence qu'une fois", () => {
  it("trois initiatives dans la même réponse du serveur : un seul startCombat", async () => {
    const combat = fakeCombat(3);
    for ( const c of combat.combatants ) c.initiative = 12;
    await Promise.all(combat.combatants.map(c => routes.get("updateCombatant")(c, { initiative: 12 })));
    expect(combat.starts).toBe(1);
    expect(combat.started).toBe(true);
  });

  it("un départ qui échoue n'empêche pas le suivant", async () => {
    const combat = fakeCombat(2);
    for ( const c of combat.combatants ) c.initiative = 12;
    const start = combat.startCombat;
    combat.startCombat = async () => { throw new Error("refusé"); };
    await expect(routes.get("updateCombatant")(combat.combatants[0], { initiative: 12 })).rejects.toThrow("refusé");
    combat.startCombat = start;
    await routes.get("updateCombatant")(combat.combatants[1], { initiative: 12 });
    expect(combat.starts).toBe(1);
  });

  it("tant qu'il manque une initiative, rien ne commence", async () => {
    const combat = fakeCombat(2);
    combat.combatants[0].initiative = 12;
    await routes.get("updateCombatant")(combat.combatants[0], { initiative: 12 });
    expect(combat.starts).toBe(0);
  });
});
