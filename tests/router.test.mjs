import { describe, it, expect } from "vitest";
import { createRouter } from "../module/scripts/runtime/router.mjs";

function setup({ executor=true }={}) {
  const hooks = new Map();
  const errors = [];
  const router = createRouter({
    subscribe: (hook, fn) => hooks.set(hook, [...(hooks.get(hook) ?? []), fn]),
    isExecutor: () => executor,
    report: (entry, err) => errors.push(`${entry.label}: ${err.message}`)
  });
  const fire = (hook, ...args) => hooks.get(hook)[0](...args);
  return { hooks, errors, router, fire };
}

describe("routeur de hooks", () => {
  it("attaches each hook only once, whatever the number of registrants", () => {
    const { hooks, router } = setup();
    router.on("createChatMessage", () => {});
    router.on("createChatMessage", () => {});
    router.on("moveToken", () => {});
    expect(hooks.get("createChatMessage")).toHaveLength(1);
    expect(hooks.get("moveToken")).toHaveLength(1);
  });

  it("calls the registrants in registration order, with the hook's arguments", () => {
    const { router, fire } = setup();
    const seen = [];
    router.on("h", (a, b) => seen.push(["un", a, b]));
    router.on("h", (a, b) => seen.push(["deux", a, b]));
    fire("h", 1, 2);
    expect(seen).toEqual([["un", 1, 2], ["deux", 1, 2]]);
  });

  it("skips the registrants reserved for the active GM on the other clients", () => {
    const { router, fire } = setup({ executor: false });
    const seen = [];
    router.on("h", () => seen.push("mj"), { executor: true });
    router.on("h", () => seen.push("tous"));
    fire("h");
    expect(seen).toEqual(["tous"]);
  });

  it("a synchronous error is logged and does not stop the following ones", () => {
    const { router, fire, errors } = setup();
    const seen = [];
    router.on("h", () => { throw new Error("boum"); }, { label: "premier" });
    router.on("h", () => seen.push("second"));
    expect(fire("h")).toBe(true);
    expect(seen).toEqual(["second"]);
    expect(errors).toEqual(["premier: boum"]);
  });

  it("a rejected promise is logged, without being awaited", async () => {
    const { router, fire, errors } = setup();
    const seen = [];
    router.on("h", async () => { throw new Error("tard"); }, { label: "lent" });
    router.on("h", () => seen.push("second"));
    fire("h");
    expect(seen).toEqual(["second"]);
    await Promise.resolve(); await Promise.resolve();
    expect(errors).toEqual(["lent: tard"]);
  });

  it("false cancels only if the registrant is declared cancelable, and then stops the chain", () => {
    const { router, fire } = setup();
    const seen = [];
    router.on("callAll", () => false);
    router.on("callAll", () => seen.push("suivant"));
    expect(fire("callAll")).toBe(true);
    expect(seen).toEqual(["suivant"]);

    router.on("pre", () => false, { cancellable: true });
    router.on("pre", () => seen.push("jamais"), { cancellable: true });
    expect(fire("pre")).toBe(false);
    expect(seen).toEqual(["suivant"]);
  });

  it("describes who listens to what, in order", () => {
    const { router } = setup();
    router.on("h", () => {}, { label: "a", executor: true });
    router.on("h", () => {}, { label: "b", cancellable: true });
    expect(router.describe()).toEqual({ h: [
      { label: "a", executor: true, cancellable: false },
      { label: "b", executor: false, cancellable: true }
    ] });
  });
});

describe("§220 Theater of the mind", () => {
  it("when paused, nothing passes except the startup and the \"always\" registrations", async () => {
    const { createRouter } = await import("../module/scripts/runtime/router.mjs");
    const hooks = {};
    let paused = false;
    const router = createRouter({ subscribe: (h, fn) => { hooks[h] = fn; }, isExecutor: () => true, report: () => {}, paused: () => paused });
    const seen = [];
    router.on("updateToken", () => seen.push("normal"));
    router.on("updateToken", () => seen.push("always"), { always: true });
    router.on("ready", () => seen.push("ready"));
    hooks.updateToken(); hooks.ready();
    paused = true;
    hooks.updateToken(); hooks.ready();
    expect(seen).toEqual(["normal", "always", "ready", "always", "ready"]);
  });
});

describe("§395 Lancer sans DAS", () => {
  it("the router passes the hook's arguments to `paused`, and re-reads the state after a registrant that marks", async () => {
    const { createRouter } = await import("../module/scripts/runtime/router.mjs");
    const hooks = {};
    const router = createRouter({ subscribe: (h, fn) => { hooks[h] = fn; }, isExecutor: () => true, report: () => {},
      paused: (hook, args) => !!args[0]?.vanilla });
    const seen = [];
    router.on("preCreateRegion", doc => { if ( doc.mine ) doc.vanilla = true; }, { always: true, marks: true });
    router.on("preCreateRegion", () => seen.push("engine"));
    hooks.preCreateRegion({ mine: false });
    hooks.preCreateRegion({ mine: true });
    hooks.preCreateRegion({ vanilla: true });
    expect(seen).toEqual(["engine"]);
  });
});
