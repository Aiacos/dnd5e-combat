import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MACROS } from "../tools/macros/index.mjs";
import { macroDocuments, stableId } from "../tools/packs.mjs";

const DIR = path.resolve(import.meta.dirname, "..", "tools", "macros");

describe("compendium \"GM Tools\" (§56)", () => {
  it("each macro in tools/macros/ appears there, only once", () => {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith(".js")).sort();
    expect(MACROS.map(m => m.file).sort()).toEqual(files);
  });

  it("each macro compiles (async function body, like a script macro)", () => {
    const AsyncFunction = (async () => {}).constructor;
    for ( const doc of macroDocuments() ) expect(() => new AsyncFunction(doc.command), doc.name).not.toThrow();
  });

  it("ids stables, au format Foundry, et distincts", () => {
    const ids = macroDocuments().map(d => d._id);
    for ( const id of ids ) expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(stableId("x")).toBe(stableId("x"));
  });

  it("the module declares the compendium", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "module", "module.json"), "utf8"));
    expect(manifest.packs?.find(p => p.name === "outils")).toMatchObject({ type: "Macro", path: "packs/outils" });
  });
});
