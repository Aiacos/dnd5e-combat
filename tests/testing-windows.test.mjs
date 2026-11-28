import { afterEach, describe, expect, it, vi } from "vitest";

const { windows } = await import("../module/scripts/runtime/testing-shared.mjs");

class Sidebar { hasFrame = false; }
class TokenTab { hasFrame = false; }
class DialogV2 { hasFrame = true; title = "Lancer quand même ?"; }

describe("api.mcp.windows — the windows, not the core's fixed interface", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stage = isGM => {
    const sidebar = new Sidebar();
    const tab = new TokenTab();
    const dialog = new DialogV2();
    vi.stubGlobal("game", { user: { isGM } });
        vi.stubGlobal("foundry", { applications: { instances: new Map([["sidebar", sidebar], ["tokens-tab", tab], ["dialog-1", dialog]]) } });
  };

  it("does not render the frameless interface (sidebar, tokens tab): closing it would leave `ui.chat.element` null", () => {
    stage(true);
    expect(windows()).toEqual([{ id: "dialog-1", title: "Lancer quand même ?", className: "DialogV2" }]);
  });

  it("refuse hors MJ", () => {
    stage(false);
    expect(() => windows()).toThrow("GM only");
  });
});
