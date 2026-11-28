import { describe, expect, it } from "vitest";
import { apiShape, browserFamily, browserName, compareClients, connectionMarkdown, diagnose, fingerprint, pingStats, worstLevel } from "../module/scripts/core/connection.mjs";

const ids = list => list.map(f => `${f.level} ${f.id}`);

describe("§388 pingStats", () => {
  it("median, best, worst, irregularity; the clock offset read from the shortest trial", () => {
    const s = pingStats([
      { sent: 0, received: 100, remote: 5050 },
      { sent: 1000, received: 1040, remote: 6020 },   // the shortest: midpoint 1020 → offset 5000
      { sent: 2000, received: 2300, remote: 7150 },
      { lost: true }
    ]);
    expect(s).toMatchObject({ count: 4, lost: 1, min: 40, median: 100, worst: 300, jitter: 260, offset: 5000 });
  });
  it("no successful trial: nothing to measure", () => {
    expect(pingStats([{ lost: true }, { lost: true }])).toMatchObject({ count: 2, lost: 2, median: null, offset: null });
  });
});

describe("§388 empreinte du code", () => {
  it("the shape of an API, order irrelevant", () => {
    const a = { ui: { cost() {}, cell() {} }, open() {} };
    const b = { open() {}, ui: { cell() {}, cost() {} } };
    expect(apiShape(a)).toEqual(["open", "ui", "ui.cell", "ui.cost"]);
    // An instance and plain values: their live state does not enter the fingerprint.
    class Bar { constructor() { this.pending = 1; } render() {} }
    expect(apiShape({ bar: new Bar(), state: { ready: true }, open() {} })).toEqual(["open", "state"]);
    expect(fingerprint(apiShape(a))).toBe(fingerprint(apiShape(b)));
    expect(fingerprint(apiShape({ ...a, extra() {} }))).not.toBe(fingerprint(apiShape(a)));
    expect(fingerprint([])).toBeNull();
  });
});

describe("§388 compareClients", () => {
  const gm = { foundry: "14.370", system: "dnd5e 6.0.6", modules: [{ id: "dnd5e-combat", version: "0.280.0", code: "aaa" },
    { id: "darsh-loot", version: "0.20.0", code: "bbb" }], activeModules: ["dnd5e-combat", "darsh-loot", "babele"] };
  it("different version: page not reloaded; same version and other code: cache", () => {
    const d = compareClients(gm, { foundry: "14.370", system: "dnd5e 6.0.6",
      modules: [{ id: "dnd5e-combat", version: "0.279.0", code: "old" }, { id: "darsh-loot", version: "0.20.0", code: "zzz" }],
      activeModules: ["dnd5e-combat", "darsh-loot", "dice-so-nice"] });
    expect(d.modules).toEqual([
      { id: "dnd5e-combat", gm: "0.280.0", player: "0.279.0", code: false },
      { id: "darsh-loot", gm: "0.20.0", player: "0.20.0", code: true }
    ]);
    expect(d.missing).toEqual(["babele"]);
    expect(d.extra).toEqual(["dice-so-nice"]);
    expect(d.foundry).toBeNull();
  });
});

describe("§388 diagnose", () => {
  const reference = { foundry: "14.370", system: "dnd5e 6.0.6", language: "fr", viewedScene: "s1",
    modules: [{ id: "dnd5e-combat", version: "1", code: "x" }], activeModules: ["dnd5e-combat"] };
  const probe = { ...reference, gpu: "ANGLE (NVIDIA GeForce RTX 3080)", webgl2: true, maxTextureSize: 16384, canvas: true, fps: 60,
    hidden: false, character: "owned", errors: 0, browserFamily: "chromium" };
  const pings = { count: 10, lost: 0, min: 20, median: 30, worst: 50, jitter: 30, offset: 100 };

  it("tout va bien : ok seulement", () => {
    const f = diagnose({ pings, probe, reference });
    expect(worstLevel(f)).toBe("ok");
    expect(ids(f)).toEqual(["ok ping", "ok versions", "ok fps"]);
  });

  it("no response at all", () => {
    const f = diagnose({ pings: { count: 10, lost: 10, median: null }, probe: null, reference });
    expect(ids(f)).toEqual(["bad noAnswer"]);
  });

  it("answers the round trips but not the probe", () => {
    expect(ids(diagnose({ pings, probe: null, reference }))).toEqual(["bad noProbe", "ok ping"]);
  });

  it("problems sorted from most to least serious", () => {
    const f = diagnose({
      pings: { ...pings, median: 450, worst: 1200, jitter: 1150, lost: 1, offset: -12500 },
      probe: { ...probe, modules: [{ id: "dnd5e-combat", version: "1", code: "y" }], gpu: "Google SwiftShader", fps: 15, hidden: false,
        babele: true, babeleBrowses: false, babelePublished: 0, language: "en", character: "none", audioLocked: true, viewedScene: "s2", errors: 3,
        browserFamily: "firefox", diceSoNice: true },
      reference
    });
    expect(ids(f)).toEqual(["bad clock", "bad browserCache", "bad softwareGpu", "warn ping", "warn jitter", "warn lost", "warn babeleEmpty",
      "warn audioLocked", "warn fps", "warn errors", "info babeleLanguage", "info noCharacter", "info diceSoNice", "info browser", "info scene"]);
    expect(f.find(x => x.id === "clock").data.seconds).toBe(-12.5);
  });

  it("hidden window: frames per second do not count", () => {
    const f = diagnose({ pings, probe: { ...probe, hidden: true, fps: null }, reference });
    expect(ids(f)).toEqual(["warn hidden", "ok ping", "ok versions"]);
  });
});

describe("§388 divers", () => {
  it("browser name without the decoy brands", () => {
    expect(browserName([{ brand: "Not?A_Brand", version: "24" }, { brand: "Chromium", version: "152" }], "ua")).toBe("Chromium 152");
    expect(browserName([{ brand: "Chromium", version: "130" }, { brand: "Google Chrome", version: "130" }, { brand: "Not_A Brand", version: "8" }])).toBe("Google Chrome 130");
    expect(browserName(undefined, "Mozilla Firefox")).toBe("Mozilla Firefox");
  });
  it("frozen display (0 frames per second, window not hidden)", () => {
    const f = diagnose({ pings: { count: 1, lost: 0, min: 1, median: 1, worst: 1, jitter: 0 }, probe: { canvas: true, fps: 0, hidden: false }, reference: {} });
    expect(f.map(x => x.id)).toContain("frozen");
    expect(f.map(x => x.id)).not.toContain("fps");
  });
  it("famille du navigateur", () => {
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("chromium");
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("firefox");
    expect(browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe("safari");
    expect(browserFamily("Mozilla/5.0 Electron/30.0 Chrome/124")).toBe("chromium");
  });
  it("the Markdown: one finding per line, measurements folded, the role without a name", () => {
    const md = connectionMarkdown({ role: "Player 2", pings: { count: 10, lost: 0, min: 1, median: 2, worst: 3, offset: 0 },
      findings: [{ id: "ping", level: "ok", data: {} }, { id: "hidden", level: "warn", data: {} }],
      probe: { foundry: "14.370", gpu: "X", modules: [{ id: "dnd5e-combat", version: "1", code: "abc" }] } }, key => key);
    expect(md).toContain("### Titre — Player 2");
    expect(md).toContain("- ✅ Constat.ping");
    expect(md).toContain("- ⚠️ Constat.hidden");
    expect(md).toContain("<details>");
    expect(md).toContain("dnd5e-combat 1 [abc]");
  });
});
