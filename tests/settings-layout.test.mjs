import { describe, it, expect } from "vitest";
import { SETTINGS_TABS, placeSettings, matchesQuery, validateWindow } from "../module/scripts/core/settings-layout.mjs";

describe("layout of the settings window", () => {
  it("each setting is filed only once", () => {
    const keys = SETTINGS_TABS.flatMap(t => t.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("the tabs have a unique id and an icon", () => {
    expect(new Set(SETTINGS_TABS.map(t => t.id)).size).toBe(SETTINGS_TABS.length);
    for ( const t of SETTINGS_TABS ) expect(t.icon).toMatch(/^fa-/);
  });
  it("an unfiled setting falls into the last tab, a missing setting does not appear", () => {
    const tabs = placeSettings(["cover", "nouveauReglage"]);
    expect(tabs.find(t => t.id === "combat").keys).toEqual(["cover"]);
    expect(tabs.at(-1).keys).toEqual(["nouveauReglage"]);
    expect(tabs.find(t => t.id === "general").keys).toEqual([]);
  });
  it("search ignores case and accents", () => {
    expect(matchesQuery("lumiere", "Indicateur de lumière")).toBe(true);
    expect(matchesQuery("FURTIV", "Règles de Furtivité")).toBe(true);
    expect(matchesQuery("abri", "Cônes de vision")).toBe(false);
    expect(matchesQuery("", "n'importe quoi")).toBe(true);
  });
  it("a neighboring layout: its tabs keep their fields, its unfiled settings fall into its last tab", () => {
    const tabs = [{ id: "a", label: "X.A", keys: ["one"] }, { id: "b", label: "X.B", keys: ["two"] }];
    const placed = placeSettings(["two", "one", "loose"], tabs);
    expect(placed.map(t => [t.id, t.label, t.keys])).toEqual([["a", "X.A", ["one"]], ["b", "X.B", ["two", "loose"]]]);
    expect(placed[0].tools).toEqual([]);
  });
  it("a neighboring module's declaration is checked", () => {
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: ["k"], tools: [{ id: "t", open: () => null }] }] })).toEqual([]);
    expect(validateWindow({ namespace: "", tabs: [] }).length).toBe(2);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: "k" }, { id: "a", keys: [] }] }).length).toBe(2);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: [], tools: [{ id: "t" }] }] }).length).toBe(1);
  });
});

describe("§291: a single window for the DAS suite", async () => {
  const { isSuiteTitle, shortTitle, orderModules } = await import("../module/scripts/core/settings-layout.mjs");

  it("a suite module is recognized by its public title \"DAS · …\"", () => {
    expect(isSuiteTitle("DAS · Combat UI")).toBe(true);
    expect(isSuiteTitle("DAS·Loot & Trade")).toBe(true);
    expect(isSuiteTitle("Dice So Nice")).toBe(false);
    expect(isSuiteTitle("DASH · Something")).toBe(false);
    expect(isSuiteTitle(undefined)).toBe(false);
  });

  it("l'onglet porte le nom court", () => {
    expect(shortTitle("DAS · Shadows & Ambience")).toBe("Shadows & Ambience");
    expect(shortTitle("Autre module")).toBe("Autre module");
  });

  it("le moteur d'abord, puis par nom", () => {
    const order = orderModules([{ id: "b", title: "Loot" }, { id: "core", title: "Core" }, { id: "a", title: "Animations" }], "core");
    expect(order.map(m => m.id)).toEqual(["core", "a", "b"]);
  });
});

describe("§291: a workshop at the end", async () => {
  const { orderModules, validateWindow } = await import("../module/scripts/core/settings-layout.mjs");

  it("a module that asks for the end goes after the others, the engine stays first", () => {
    const order = orderModules([{ id: "hb", title: "Homebrew", end: true }, { id: "z", title: "Zeta" }, { id: "core", title: "Core" }, { id: "a", title: "Animations" }], "core");
    expect(order.map(m => m.id)).toEqual(["core", "a", "z", "hb"]);
  });

  it("the tab declares itself: object, `kind` settings or workshop", () => {
    const tabs = [{ id: "w", keys: [] }];
    expect(validateWindow({ namespace: "x", tabs, tab: { end: true, kind: "workshop", icon: "fa-solid fa-flask" } })).toEqual([]);
    expect(validateWindow({ namespace: "x", tabs, tab: "fin" })).toEqual(["tab: object expected"]);
    expect(validateWindow({ namespace: "x", tabs, tab: { kind: "atelier" } })).toEqual(["tab.kind: \"settings\" or \"workshop\" expected"]);
  });
});

describe("settings grouped by rule (2026-11-06)", async () => {
  const { SETTINGS_TABS, groupSettings, subState, validateWindow } = await import("../module/scripts/core/settings-layout.mjs");
  const fr = JSON.parse((await import("node:fs")).readFileSync(new URL("../module/lang/fr.json", import.meta.url), "utf8"));

  it("each group files only settings of its tab, only once, and has its translated title", () => {
    for ( const tab of SETTINGS_TABS ) {
      const seen = new Set();
      for ( const group of tab.groups ?? [] ) {
        expect(fr[`DND5ECOMBAT.Reglages.Groupe.${group.id}`], group.id).toBeTruthy();
        for ( const key of group.keys ) {
          expect(tab.keys, `${tab.id}/${group.id}`).toContain(key);
          expect(seen.has(key), key).toBe(false);
          seen.add(key);
        }
        for ( const [key, rule] of Object.entries(group.sub) ) {
          expect(group.keys, key).toContain(key);
          expect(group.keys, rule.parent).toContain(rule.parent);
        }
        if ( group.tag ) expect(fr[`DND5ECOMBAT.Reglages.Etiquette.${group.tag}`]).toBeTruthy();
      }
      // All the settings of a grouped tab have their frame (the "Other" frame remains a safety net).
      if ( tab.groups ) expect(tab.keys.filter(k => !seen.has(k)), tab.id).toEqual([]);
    }
    expect(fr["DND5ECOMBAT.Reglages.Groupe.other"]).toBeTruthy();
  });

  it("frames: the group's order, absent ones omitted, the rest in \"other\"; without groups, a list without a title", () => {
    const groups = [{ id: "a", keys: ["x", "y"] }, { id: "b", keys: ["z"] }];
    expect(groupSettings(["y", "w", "x"], groups).map(g => [g.id, g.keys])).toEqual([["a", ["x", "y"]], ["other", ["w"]]]);
    expect(groupSettings(["x"], undefined)).toEqual([{ id: null, sub: {}, keys: ["x"] }]);
    expect(groupSettings([], groups)).toEqual([]);
  });

  it("option of a rule: indented under it, greyed out when the rule is off, in cascade", () => {
    const group = { keys: ["gmAlerts", "gmAlertBanner", "gmAlertSeconds"],
      sub: { gmAlertBanner: { parent: "gmAlerts", off: [false] }, gmAlertSeconds: { parent: "gmAlertBanner", off: [false] } } };
    const values = { gmAlerts: true, gmAlertBanner: true };
    const v = k => values[k];
    expect(subState("gmAlerts", group, v)).toEqual({ sub: false, off: false });
    expect(subState("gmAlertSeconds", group, v)).toEqual({ sub: true, off: false });
    values.gmAlerts = false;
    expect(subState("gmAlertBanner", group, v)).toEqual({ sub: true, off: true });
    expect(subState("gmAlertSeconds", group, v)).toEqual({ sub: true, off: true });
    // The rule in another scope (another frame): greyed out, without indentation.
    expect(subState("gmAlertSeconds", { ...group, keys: ["gmAlertSeconds"] }, v)).toEqual({ sub: false, off: true });
  });

  it("flanking turned off greys out its options; success at a cost has its pause", () => {
    const combat = SETTINGS_TABS.find(t => t.id === "combat");
    const flank = combat.groups.find(g => g.id === "flanking");
    expect(subState("flankingSide", flank, () => "off").off).toBe(true);
    expect(subState("flankingSide", flank, () => "pc").off).toBe(false);
    const cost = combat.groups.find(g => g.id === "successAtCost");
    expect(subState("successAtCostHold", cost, () => false).off).toBe(true);
  });

  it("groups declared by a neighbor are checked", () => {
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: ["x"], groups: [{ id: "g", keys: ["x"], sub: { x: { parent: "y", off: [false] } } }] }] })).toEqual([]);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: ["x"], groups: [{ keys: "x" }] }] }).length).toBeGreaterThan(0);
    expect(validateWindow({ namespace: "m", tabs: [{ id: "a", keys: ["x"], groups: [{ id: "g", keys: [], sub: { x: { parent: "y" } } }] }] }).length).toBeGreaterThan(0);
  });
});
