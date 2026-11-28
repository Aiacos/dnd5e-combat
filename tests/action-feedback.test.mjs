import { describe, it, expect } from "vitest";
import { actionSound, noticeText, CORE_SOUNDS } from "../module/scripts/core/action-feedback.mjs";

describe("§252 retour d'action pour toute la table", () => {
  it("gives a core sound per action and per outcome", () => {
    expect(actionSound("pick", "success")).toBe(CORE_SOUNDS.unlock);
    expect(actionSound("force", "failure")).toBe(CORE_SOUNDS.thud);
    expect(actionSound("land", "success")).toBeNull();
    expect(actionSound("inconnue", "success")).toBeNull();
    expect(actionSound("hide", undefined)).toBeNull();
    // §500 (B20) : la mort par drain s'entend de toute la table.
    expect(actionSound("drainDeath", "success")).toBe(CORE_SOUNDS.thud);
    for ( const src of Object.values(CORE_SOUNDS) ) expect(src).toMatch(/^sounds\/.+\.ogg$/);
  });

  it("translates a `{ key, data }` text on each client, keeps a string as it is", () => {
    const localize = (key, data) => `${key}:${data?.n ?? ""}`;
    expect(noticeText("Déjà traduit", localize)).toBe("Déjà traduit");
    expect(noticeText({ key: "Retour.Action.Cache" }, localize)).toBe("Retour.Action.Cache:");
    expect(noticeText({ key: "X", data: { n: 2 } }, localize)).toBe("X:2");
    expect(noticeText(null, localize)).toBe("");
    expect(noticeText({}, localize)).toBe("");
  });
});
