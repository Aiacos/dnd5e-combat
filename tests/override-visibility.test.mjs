/**
 * Issue #178: world setting "Overrides visible to" (`overrideVisibility`) — who sees the "Forced" text and the "Rule overridden"
 * banner. Default: the whole table, as before. The GM always sees everything; whoever forced sees their own mark.
 */
import { describe, it, expect } from "vitest";
import { OVERRIDE_VISIBILITY_MODES, overridePublic, overrideShown } from "../module/scripts/core/forced.mjs";
import { SETTINGS_TABS } from "../module/scripts/core/settings-layout.mjs";

describe("issue #178: overrides visible to", () => {
  it("trois choix, `all` d'abord", () => {
    expect(OVERRIDE_VISIBILITY_MODES).toEqual(["all", "hideGM", "gmOnly"]);
  });

  it("whole table (default, and any unknown value): public, whoever forces", () => {
    for ( const mode of ["all", undefined, "nimporte"] ) {
      expect(overridePublic(mode, { byGM: true })).toBe(true);
      expect(overridePublic(mode, { byGM: false })).toBe(true);
    }
  });

  it("hide the GM's: the GM's discreet, a player's public", () => {
    expect(overridePublic("hideGM", { byGM: true })).toBe(false);
    expect(overridePublic("hideGM", { byGM: false })).toBe(true);
  });

  it("MJ seulement : aucune n'est publique", () => {
    expect(overridePublic("gmOnly", { byGM: true })).toBe(false);
    expect(overridePublic("gmOnly", { byGM: false })).toBe(false);
  });

  it("un MJ voit toujours la marque", () => {
    for ( const mode of OVERRIDE_VISIBILITY_MODES ) for ( const byGM of [true, false] ) {
      expect(overrideShown(mode, { byGM, viewerIsGM: true })).toBe(true);
    }
  });

  it("whoever forced sees their own; another player according to the setting", () => {
    expect(overrideShown("gmOnly", { byGM: false, viewerIsAuthor: true })).toBe(true);
    expect(overrideShown("gmOnly", { byGM: false })).toBe(false);
    expect(overrideShown("hideGM", { byGM: true })).toBe(false);
    expect(overrideShown("hideGM", { byGM: false })).toBe(true);
    expect(overrideShown("all", { byGM: true })).toBe(true);
  });

  it("the setting is filed with the GM alerts (chat tab)", () => {
    const chat = SETTINGS_TABS.find(t => t.id === "chat");
    expect(chat.keys).toContain("overrideVisibility");
    expect(chat.groups.find(g => g.id === "gmAlerts").keys).toContain("overrideVisibility");
  });
});
