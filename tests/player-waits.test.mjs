import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §290: combat windows without a timeout. Without a timeout, a question put to a player waits for its answer and is noted
 * for the GM's follow-up; "Force" makes their windows resolve on their side as at the end of the timeout; a player who leaves
 * counts as no answer. With a timeout (default setting), nothing changes: the core's request, as is.
 */
const { expireLater, forceOpenWindows, windowsUnlimited } = await import("../module/scripts/adapter/dialogs.mjs");
const { queryPlayer, playerWaits, forcePlayerWait, FORCE_WINDOWS_QUERY, PLAYER_WAITS_HOOK } = await import("../module/scripts/adapter/player-wait.mjs");

let unlimited = true;
let hookCalls = 0;
const users = new Map();

beforeEach(() => {
  unlimited = true;
  hookCalls = 0;
  users.clear();
  globalThis.game = { settings: { get: (scope, key) => (key === "combatWindowUnlimited" ? unlimited : 10) }, users: { get: id => users.get(id) } };
  globalThis.Hooks = { callAll: hook => { if ( hook === PLAYER_WAITS_HOOK ) hookCalls += 1; } };
  globalThis.foundry = { utils: { randomID: () => Math.random().toString(36).slice(2, 18) } };
});

afterEach(() => {
  vi.useRealTimers();
  forceOpenWindows();
  delete globalThis.game; delete globalThis.Hooks; delete globalThis.foundry;
});

/** A player whose answer is given by hand (`answer`), and who receives the "force" requests. */
function player(name="Alice") {
  const pending = [];
  const user = {
    id: `u-${name}`, name, active: true, forced: 0,
    query: vi.fn((query, payload, { timeout }) => {
      if ( query === FORCE_WINDOWS_QUERY ) {
        user.forced += 1;
        for ( const p of pending.splice(0) ) p.resolve("défaut");
        return Promise.resolve(1);
      }
      return new Promise((resolve, reject) => pending.push({ resolve, reject, timeout }));
    }),
    answer: value => pending.shift()?.resolve(value)
  };
  users.set(user.id, user);
  return user;
}

describe("§290 windows without a timeout: the GM forces", () => {
  it("the setting is read, false by default when unreadable", () => {
    expect(windowsUnlimited()).toBe(true);
    delete globalThis.game;
    expect(windowsUnlimited()).toBe(false);
  });

  it("without a timeout, a window waits; forcing resolves it like the timeout, only once", () => {
    const expire = vi.fn();
    const disarm = expireLater(expire, 10, true);
    expect(expire).not.toHaveBeenCalled();
    expect(forceOpenWindows()).toBe(1);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(forceOpenWindows()).toBe(0);
    disarm();
  });

  it("a disarmed window (the player answered) is no longer forced", () => {
    const expire = vi.fn();
    expireLater(expire, 10, true)();
    expect(forceOpenWindows()).toBe(0);
    expect(expire).not.toHaveBeenCalled();
  });

  it("with a timeout, the timer decides; §381: the GM can also force, only once", () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    expireLater(expire, 1000, false);
    vi.advanceTimersByTime(1000);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(forceOpenWindows()).toBe(0);
    const early = vi.fn();
    expireLater(early, 1000, false);
    expect(forceOpenWindows()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(early).toHaveBeenCalledTimes(1);
  });

  it("with a timeout, the question goes out with that timeout; §381: it is noted, so the GM can force", async () => {
    unlimited = false;
    const user = player();
    const asked = queryPlayer(user, "dnd5e-combat.reaction", { a: 1 }, { timeout: 20000, label: "Réaction" });
    expect(user.query).toHaveBeenCalledWith("dnd5e-combat.reaction", { a: 1 }, { timeout: 20000 });
    expect(playerWaits()).toMatchObject([{ userName: "Alice", label: "Réaction" }]);
    user.answer("ok");
    await expect(asked).resolves.toBe("ok");
    expect(playerWaits()).toEqual([]);
  });

  it("without a timeout, the wait is noted (who, for whom, what), then removed on the answer", async () => {
    const user = player();
    const actor = { uuid: "Actor.pal", name: "Paladin", img: "pal.webp" };
    const asked = queryPlayer(user, "dnd5e-combat.reaction", {}, { timeout: 20000, actor, label: "Réaction" });
    expect(user.query.mock.calls[0][2].timeout).toBeGreaterThan(60 * 60 * 1000);
    expect(playerWaits()).toMatchObject([{ userName: "Alice", actor: "Actor.pal", actorName: "Paladin", label: "Réaction" }]);
    expect(hookCalls).toBe(1);
    user.answer("bouclier");
    await expect(asked).resolves.toBe("bouclier");
    expect(playerWaits()).toEqual([]);
    expect(hookCalls).toBe(2);
  });

  it("force: the player's client resolves its windows, the question returns with the default answer", async () => {
    const user = player();
    const asked = queryPlayer(user, "dnd5e-combat.choice", {}, { timeout: 20000, label: "Choix" });
    const [wait] = playerWaits();
    await expect(forcePlayerWait(wait.id)).resolves.toBe(true);
    expect(user.forced).toBe(1);
    await expect(asked).resolves.toBe("défaut");
    expect(playerWaits()).toEqual([]);
    await expect(forcePlayerWait(wait.id)).resolves.toBe(false);
  });

  it("force with no window open on their side: the question is dropped after a short delay", async () => {
    vi.useFakeTimers();
    const user = player();
    user.query.mockImplementation(query => (query === FORCE_WINDOWS_QUERY ? Promise.resolve(0) : new Promise(() => {})));
    const asked = queryPlayer(user, "dnd5e-combat.choice", {}, { timeout: 20000 });
    const outcome = asked.then(() => "réponse", err => err.message);
    await forcePlayerWait(playerWaits()[0].id);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(outcome).resolves.toMatch(/forced/);
    expect(playerWaits()).toEqual([]);
  });

  it("a player who disconnects: the question fails, as with no answer", async () => {
    vi.useFakeTimers();
    const user = player("Bob");
    const asked = queryPlayer(user, "dnd5e-combat.rollSave", {}, { timeout: 40000 });
    const outcome = asked.then(() => "réponse", err => err.message);
    user.active = false;
    await vi.advanceTimersByTimeAsync(1100);
    await expect(outcome).resolves.toMatch(/disconnected/);
    expect(playerWaits()).toEqual([]);
  });
});
