import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * §380 (issue #36): the debugger's capture, on a fake console and window. The suite's errors are kept, not the others;
 * an error from a router subscriber is counted only once, with its label; a player sends its new entries to the active GM
 * and keeps them if sending fails.
 */
const debug = await import("../module/scripts/runtime/debug.mjs");
const { debugApi, installCapture, uninstallCapture, noteRouterError, noteRefused, trail, flush, receive, collectSections,
  knownRepos, isSuitePackage } = debug;

const frame = id => `Error: x\n    at f (https://h.forge-vtt.com/modules/${id}/scripts/a.mjs:3:4)`;
const errorFrom = (id, message="boom") => {
  const err = new Error(message);
  err.stack = `Error: ${message}\n    at f (https://h.forge-vtt.com/modules/${id}/scripts/a.mjs:3:4)`;
  return err;
};

function fakeTarget() {
  const listeners = {};
  const seen = { error: [], warn: [], log: [] };
  return {
    seen, listeners,
    console: { error: (...a) => seen.error.push(a), warn: (...a) => seen.warn.push(a), log: (...a) => seen.log.push(a) },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: type => { delete listeners[type]; }
  };
}

function modules(list) {
  const arr = list.map(([id, title, url=null]) => ({ id, title, url, active: true }));
  return Object.assign(arr, { get: id => arr.find(m => m.id === id) });
}

let target;
beforeEach(() => {
  uninstallCapture();
  target = fakeTarget();
  installCapture(target);
  debugApi.clear();
  debugApi.verbose(false);
  debugApi.clear();
  globalThis.game = { user: { id: "u-gm" }, modules: modules([["dnd5e-combat", "DAS · Core", "https://github.com/Darshyne/dnd5e-combat"],
    ["darsh-loot", "DAS · Loot & Trade", "https://github.com/Darshyne/darsh-loot"], ["other-mod", "Other"]]) };
});

afterEach(() => {
  uninstallCapture();
  delete globalThis.game;
});

describe("capture (§380)", () => {
  it("garde les erreurs de la suite, appelle toujours la console d'origine", () => {
    target.console.error("dnd5e-combat |", errorFrom("darsh-loot"));
    target.console.error(errorFrom("other-mod"));
    target.console.warn("darsh-loot | no pile here");
    expect(target.seen.error).toHaveLength(2);
    expect(target.seen.warn).toHaveLength(1);
    const list = debugApi.errors();
    expect(list.map(g => [g.kind, g.module])).toEqual(expect.arrayContaining([["error", "darsh-loot"], ["warn", "darsh-loot"]]));
    expect(list).toHaveLength(2);
    expect(list.every(g => g.clients[0] === "u-gm")).toBe(true);
  });

  it("a repeated error is counted", () => {
    target.console.error(errorFrom("dnd5e-combat", "Token abcdefghij123456 missing"));
    target.console.error(errorFrom("dnd5e-combat", "Token ZZZZZZZZZZ999999 missing"));
    expect(debugApi.errors()).toHaveLength(1);
    expect(debugApi.total()).toBe(2);
  });

  it("a router subscriber's error: its label and its hook, counted once", () => {
    const err = errorFrom("dnd5e-combat");
    noteRouterError({ label: "Brutal Strike", hook: "dnd5e.rollDamage", level: "error" }, err);
    target.console.error("dnd5e-combat | Brutal Strike", err);
    const [g] = debugApi.errors();
    expect(g).toMatchObject({ label: "Brutal Strike", hook: "dnd5e.rollDamage", count: 1, module: "dnd5e-combat" });
  });

  it("freezes the trail in the new error", () => {
    trail("use", "rage · utility");
    noteRefused({ hook: "preMoveToken", label: "turn budget" });
    target.console.error(errorFrom("dnd5e-combat"));
    const [g] = debugApi.errors();
    expect(g.trail.map(s => s.kind)).toEqual(["use", "refused"]);
    expect(g.trail[1].text).toBe("preMoveToken ← turn budget");
    expect(debugApi.trailList()).toHaveLength(2);
  });

  it("uncaught errors and rejected promises", () => {
    target.listeners.error({ error: errorFrom("darsh-loot", "uncaught") });
    target.listeners.unhandledrejection({ reason: errorFrom("dnd5e-combat", "rejected") });
    target.listeners.unhandledrejection({ reason: "plain" });       // no stack or prefix: outside the suite
    expect(debugApi.errors().map(g => g.kind).sort()).toEqual(["error", "rejection"]);
  });

  it("uninstalled: the original console given back, nothing more surveyed", () => {
    const original = target.console.error;
    uninstallCapture();
    expect(target.console.error).not.toBe(original);
    expect(target.listeners.error).toBeUndefined();
    target.console.error(errorFrom("dnd5e-combat"));
    expect(debugApi.errors()).toHaveLength(0);
  });

  it("verbose mode: the suite's lines only, and only when on", () => {
    target.console.log("dnd5e-combat | resolved");
    expect(debugApi.logs()).toHaveLength(0);
    debugApi.verbose(true);
    target.console.log("dnd5e-combat | resolved");
    target.console.log("other-mod | hello");
    target.console.log("plain");
    expect(debugApi.logs().map(l => l.module)).toEqual(["dnd5e-combat"]);
    expect(target.seen.log).toHaveLength(4);
  });

  it("a suite packet: title \"DAS · \", subscriber, or modules not yet read", () => {
    expect(isSuitePackage("darsh-loot")).toBe(true);
    expect(isSuitePackage("other-mod")).toBe(false);
    expect(isSuitePackage("system:dnd5e")).toBe(false);
    debugApi.register({ module: "other-mod", repo: "Someone/other", collect: () => ({ theme: "bg3" }) });
    expect(isSuitePackage("other-mod")).toBe(true);
    delete globalThis.game;
    expect(isSuitePackage("anything")).toBe(true);
  });

  it("before the modules are readable, an error waits for the init sorting", () => {
    const saved = globalThis.game;
    delete globalThis.game;
    target.console.error(errorFrom("third-mod"));
    target.console.error(errorFrom("darsh-loot"));
    expect(debugApi.errors()).toHaveLength(0);
    globalThis.game = saved;
    debug.replayEarly();
    expect(debugApi.errors().map(g => g.module)).toEqual(["darsh-loot"]);
  });
});

describe("voisins (§380)", () => {
  it("sections and repositories", () => {
    debugApi.register({ module: "darsh-dnd-ui", collect: () => ({ theme: "bg3" }) });
    debugApi.register({ module: "broken", collect: () => { throw new Error("nope"); } });
    expect(debugApi.register({})).toBe(false);
    const sections = collectSections();
    expect(sections).toEqual(expect.arrayContaining([{ module: "darsh-dnd-ui", data: { theme: "bg3" } },
      { module: "broken", data: { error: "Error: nope" } }]));
    debugApi.trail("darsh-loot", "search", "pile · 3 items");
    expect(debugApi.trailList().at(-1)).toMatchObject({ module: "darsh-loot", kind: "search" });
    expect(knownRepos()).toMatchObject({ "dnd5e-combat": "https://github.com/Darshyne/dnd5e-combat",
      "darsh-loot": "https://github.com/Darshyne/darsh-loot", "other-mod": "Someone/other" });
  });
});

describe("escalation to the active GM (§380)", () => {
  it("sends what is new, keeps it if sending fails, nothing without a GM", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue(true);
    globalThis.game.user = { id: "u-p1" };
    globalThis.game.users = { activeGM: null };
    target.console.error(errorFrom("dnd5e-combat"));
    expect(await flush()).toBe(false);                       // no GM: kept
    globalThis.game.users.activeGM = { isSelf: false, active: true, query };
    expect(await flush()).toBe(false);                       // failure: kept
    expect(await flush()).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    const [name, payload] = query.mock.calls[1];
    expect(name).toBe("dnd5e-combat.debug");
    expect(payload.userId).toBe("u-p1");
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].added).toBe(1);
    expect(await flush()).toBe(false);                       // rien de nouveau
  });

  it("the GM merges with the originating client", () => {
    target.console.error(errorFrom("dnd5e-combat"));
    const [mine] = debugApi.errors();
    expect(receive({ userId: "u-p1", items: [{ ...mine, added: 3 }] })).toBe(true);
    expect(receive({})).toBe(false);
    const [g] = debugApi.errors();
    expect(g.count).toBe(4);
    expect(g.clients).toEqual(["u-gm", "u-p1"]);
  });

  it("on the active GM itself, nothing is sent", async () => {
    const query = vi.fn();
    globalThis.game.users = { activeGM: { isSelf: true, active: true, query } };
    target.console.error(errorFrom("dnd5e-combat"));
    await flush();
    expect(query).not.toHaveBeenCalled();
  });
});


describe("rapport du runtime (§380)", () => {
  function table() {
    const users = [{ id: "u-gm", name: "Raphaël", isGM: true, active: true, isSelf: true }, { id: "u-p1", name: "Zoé", isGM: false, active: true }];
    Object.assign(users, { activeGM: users[0] });
    const settings = new Map([["dnd5e-combat.level", { namespace: "dnd5e-combat", key: "level", type: String, choices: { full: "", assisted: "" } }],
      ["dnd5e-combat.critTable", { namespace: "dnd5e-combat", key: "critTable", type: String }],
      ["dnd5e-combat.cover", { namespace: "dnd5e-combat", key: "cover", type: Boolean }],
      ["dnd5e-combat.vision", { namespace: "dnd5e-combat", key: "vision", type: Boolean, default: true }],
      ["third-mod.secret", { namespace: "third-mod", key: "secret", type: Boolean }]]);
    const values = { level: "full", critTable: "Table de Zoé", cover: true, secret: true, vision: true };
    Object.assign(globalThis.game, {
      version: "14.369", system: { id: "dnd5e", version: "6.0.6" }, i18n: { lang: "fr" }, world: { id: "dandd", title: "Curse of Strahd" },
      user: users[0], users, actors: [{ name: "Ireena Kolyana" }], items: [],
      settings: { settings, get: (ns, key) => values[key] }
    });
  }

  it("roles, world and actors masked, simple settings, a token's context without its name", () => {
    table();
    globalThis.game.user = { id: "u-p1" };
    target.console.error(errorFrom("dnd5e-combat", "Zoé lost Ireena Kolyana in Curse of Strahd"));
    trail("use", "rage · utility");
    const token = { name: "Ireena Kolyana", disposition: 1, elevation: 0, inCombat: false, actorLink: true,
      actor: { type: "character", statuses: new Set(["prone"]), items: [{ type: "feat", system: { identifier: "rage" } }],
        system: { details: { level: 3 }, traits: { size: "med" }, attributes: { hp: { value: 5, max: 20 } } } } };
    const { report, markdown } = debug.buildDebugReport({ description: "Zoé clicked", token });
    expect(report.errors[0].message).toBe("Error: Player 1 lost <actor> in <world>");
    expect(report.errors[0].clients).toEqual(["Player 1"]);
    expect(report.description).toBe("Player 1 clicked");
    expect(report.environment.settings).toEqual({ "dnd5e-combat.level": "full", "dnd5e-combat.cover": true });
    expect(report.environment.system).toBe("dnd5e 6.0.6");
    expect(report.context).toMatchObject({ actorType: "character", actorLevel: 3, statuses: "prone", items: "1: rage" });
    expect(markdown).not.toMatch(/Zoé|Raphaël|Ireena|Strahd/);
    const kept = debug.buildDebugReport({ includeNames: true });
    expect(kept.report.errors[0].message).toBe("Error: Player 1 lost Ireena Kolyana in <world>");
  });

  it("proposes the repository of the module implicated", () => {
    table();
    target.console.error(errorFrom("darsh-loot"));
    const { report } = debug.buildDebugReport();
    expect(debug.reportRepos(report).map(r => r.repo).slice(0, 2)).toEqual(["Darshyne/darsh-loot", "Darshyne/dnd5e-combat"]);
  });
});

describe("noise discarded (§380, seen in play on the player side)", () => {
  it("a repeated notification in the console is not an error; the wrapper does not implicate the engine", () => {
    const realError = globalThis.Error;
    const fake = frames => class extends realError { constructor(m) { super(m); this.stack = `Error\n${frames}`; } };
    const wrap = "    at c.warn (http://h/modules/dnd5e-combat/scripts/runtime/debug.mjs:144:65)";
    try {
      globalThis.Error = fake(`${wrap}\n    at #fetch (http://h/scripts/foundry.mjs:1:1)\n    at Notifications.notify (http://h/scripts/foundry.mjs:2:2)`);
      target.console.warn("DAS recorded an error.");
      globalThis.Error = fake(`${wrap}\n    at Fa (http://h/scripts/pixi.min.js:12:34)\n    at x (http://h/modules/tokenmagic/bundle.js:1:1)`);
      target.console.warn("PixiJS Deprecation Warning");
    } finally { globalThis.Error = realError; }
    expect(debugApi.errors()).toEqual([]);
  });
});

describe("context-menu entry (§380)", () => {
  it("the GM on any creature, a player on their own; removed by the world setting", async () => {
    const { debugMenuEntry } = await import("../module/scripts/ui/debug-report.mjs");
    let shown = true;
    Object.assign(globalThis.game, { i18n: { localize: k => k, format: k => k }, settings: { get: (ns, key) => (key === "debugMenu" ? shown : true) } });
    const mine = { actor: {}, isOwner: true };
    const theirs = { actor: {}, isOwner: false };
    game.user = { isGM: false };
    expect(debugMenuEntry(mine)?.label).toBe("DND5ECOMBAT.Debogueur.Menu");
    expect(debugMenuEntry(theirs)).toBeNull();
    game.user = { isGM: true };
    expect(debugMenuEntry(theirs)).not.toBeNull();
    expect(debugMenuEntry({ isOwner: true })).toBeNull();      // pas d'acteur
    shown = false;
    expect(debugMenuEntry(theirs)).toBeNull();
    expect(debugMenuEntry(mine)).toBeNull();
  });
});

describe("modules outside the suite and deprecations", () => {
  const pixiStack = "    at Fa (http://localhost:30000/scripts/pixi.min.js:12:34)\n"
    + "    at Object.get [as DisplacementFilter] (http://localhost:30000/scripts/pixi.min.js:869:471)\n"
    + "    at 956 (http://localhost:30000/modules/tokenmagic/module/bundle/tokenmagic.js:1:104936)";
  const pixiWarn = () => {
    target.console.groupCollapsed("%cPixiJS Deprecation Warning: %c%s", "color:#614108", "font-weight:normal",
      "filters.DisplacementFilter has moved to DisplacementFilter\nDeprecated since v7.1.0");
    target.console.warn(pixiStack);
    target.console.groupEnd();
  };
  beforeEach(() => {
    target.console.group = () => {};
    target.console.groupCollapsed = () => {};
    target.console.groupEnd = () => {};
    uninstallCapture();
    installCapture(target);
  });
  afterEach(() => debug.setCaptureAll(false));

  it("without \"all modules\", a warning from another module stays ignored", () => {
    pixiWarn();
    expect(debugApi.errors()).toHaveLength(0);
  });

  it("with \"all modules\": text from the console group, stack stays the stack, marked non-suite and deprecation", () => {
    debug.setCaptureAll(true);
    pixiWarn();
    const [g] = debugApi.errors();
    expect(g.message).toBe("PixiJS Deprecation Warning: filters.DisplacementFilter has moved to DisplacementFilter\nDeprecated since v7.1.0");
    expect(g.module).toBe("tokenmagic");
    expect(g.stack[0]).toContain("pixi.min.js");
    expect(g).toMatchObject({ kind: "warn", thirdParty: true, deprecation: true });
  });

  // §467: seen in play — the timeline's "Roll All" calls dnd5e, which a third-party module wraps with a deprecated option.
  const deprecatedVia = (owner, below) => {
    const err = new Error("The rollMode option of Combat#rollInitiative messageOptions is deprecated\nDeprecated since Version 14");
    err.stack = "Error: deprecated\n    at Object.logCompatibilityWarning (http://localhost:30000/scripts/foundry.mjs:1554:17)\n"
      + `    at Combat.rollInitiative (http://localhost:30000/modules/${owner}/scripts/a.js:251:20)\n`
      + "    at Combat5e.rollAll (http://localhost:30000/systems/dnd5e/dnd5e.mjs:92484:17)\n"
      + `    at #onClick (http://localhost:30000/modules/${below}/scripts/apps/frieze.mjs:332:37)`;
    return err;
  };

  it("a third-party module's deprecation is not DAS, even if a DAS module is lower in the stack", () => {
    target.console.warn(deprecatedVia("third-dep-mod", "darsh-loot"));
    expect(debugApi.errors()).toHaveLength(0);          // without "all modules": not kept, so no notice
    debug.setCaptureAll(true);
    target.console.warn(deprecatedVia("third-dep-mod", "darsh-loot"));
    expect(debugApi.errors()[0]).toMatchObject({ module: "third-dep-mod", thirdParty: true, deprecation: true });
  });

  it("a deprecation called by a DAS module stays DAS", () => {
    target.console.warn(deprecatedVia("darsh-loot", "darsh-loot"));
    expect(debugApi.errors()[0]).toMatchObject({ module: "darsh-loot", thirdParty: false, deprecation: true });
  });

  it("a suite error is not outside the suite; the closed group no longer colors the following lines", () => {
    debug.setCaptureAll(true);
    target.console.group("Something");
    target.console.groupEnd();
    target.console.error(errorFrom("darsh-loot"));
    const [g] = debugApi.errors();
    expect(g).toMatchObject({ module: "darsh-loot", thirdParty: false, deprecation: false, message: "Error: boom" });
  });

  it("in an open group, an ordinary line keeps its text, preceded by the group's label", () => {
    target.console.group("darsh-loot | sweep");
    target.console.warn("darsh-loot | odd value");
    target.console.groupEnd();
    expect(debugApi.errors()[0].message).toBe("darsh-loot | sweep — darsh-loot | odd value");
  });

  it("by default only the suite's errors are kept; a player passes the marks on to the GM", () => {
    debug.setCaptureAll(true);
    pixiWarn();
    target.console.error(errorFrom("darsh-loot"));
    const loot = debugApi.errors().find(g => g.module === "darsh-loot");
    expect(debug.defaultSelection()).toEqual([loot.sig]);
    debugApi.clear();
    receive({ userId: "u-player", items: [{ sig: "s1", kind: "warn", message: "x", thirdParty: true, deprecation: true, added: 1 }] });
    expect(debugApi.errors()[0]).toMatchObject({ thirdParty: true, deprecation: true });
  });

  it("uninstallCapture also restores the group functions", () => {
    expect(target.console.groupCollapsed.toString()).toContain("ConsoleGroup");
    uninstallCapture();
    for ( const name of ["group", "groupCollapsed", "groupEnd"] ) expect(target.console[name].toString()).not.toContain("ConsoleGroup");
  });
});

describe("badge: DAS and non-DAS errors counted separately, browser noise discarded", () => {
  afterEach(() => debug.setCaptureAll(false));

  it("total(\"suite\") ne compte que les erreurs DAS, total(\"others\") les autres", () => {
    debug.setCaptureAll(true);
    target.console.error(errorFrom("foreign-mod"));
    target.console.error(errorFrom("foreign-mod"));
    expect(debugApi.total("suite")).toBe(0);
    expect(debugApi.total("others")).toBe(2);
    target.console.error(errorFrom("darsh-loot"));
    expect(debugApi.total("suite")).toBe(1);
    expect(debugApi.total()).toBe(3);
  });

  it("ResizeObserver (window or console) is never reported, even with \"all modules\"", () => {
    debug.setCaptureAll(true);
    target.listeners.error({ message: "ResizeObserver loop completed with undelivered notifications." });
    target.listeners.error({ message: "ResizeObserver loop limit exceeded" });
    target.console.error("Uncaught ResizeObserver loop completed with undelivered notifications.");
    expect(debugApi.errors()).toEqual([]);
  });
});
