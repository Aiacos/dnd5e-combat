/**
 * Issue #178 : réglage de monde « Dérogations visibles par » (`overrideVisibility`) — qui voit le texte « Forcé » et le bandeau « Règle
 * passée outre ». Défaut : toute la table, comme avant. Le MJ voit toujours tout ; celui qui a forcé voit sa propre marque.
 */
import { describe, it, expect } from "vitest";
import { OVERRIDE_VISIBILITY_MODES, overridePublic, overrideShown } from "../module/scripts/core/forced.mjs";
import { SETTINGS_TABS } from "../module/scripts/core/settings-layout.mjs";

describe("issue #178 : dérogations visibles par", () => {
  it("trois choix, `all` d'abord", () => {
    expect(OVERRIDE_VISIBILITY_MODES).toEqual(["all", "hideGM", "gmOnly"]);
  });

  it("toute la table (défaut, et toute valeur inconnue) : publique, qui que ce soit qui force", () => {
    for ( const mode of ["all", undefined, "nimporte"] ) {
      expect(overridePublic(mode, { byGM: true })).toBe(true);
      expect(overridePublic(mode, { byGM: false })).toBe(true);
    }
  });

  it("cacher celles du MJ : celle du MJ discrète, celle d'un joueur publique", () => {
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

  it("celui qui a forcé voit la sienne ; un autre joueur selon le réglage", () => {
    expect(overrideShown("gmOnly", { byGM: false, viewerIsAuthor: true })).toBe(true);
    expect(overrideShown("gmOnly", { byGM: false })).toBe(false);
    expect(overrideShown("hideGM", { byGM: true })).toBe(false);
    expect(overrideShown("hideGM", { byGM: false })).toBe(true);
    expect(overrideShown("all", { byGM: true })).toBe(true);
  });

  it("le réglage est rangé avec les alertes au MJ (onglet chat)", () => {
    const chat = SETTINGS_TABS.find(t => t.id === "chat");
    expect(chat.keys).toContain("overrideVisibility");
    expect(chat.groups.find(g => g.id === "gmAlerts").keys).toContain("overrideVisibility");
  });
});
