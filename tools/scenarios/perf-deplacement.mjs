/**
 * Measure (baileywiki's report, 2026-11-24): what a token walking step by step costs the GM client and the server. The Wizard walks
 * 12 one-square steps, one at a time, each awaited until its animation ends — first out of combat, then in combat. During the walk a
 * probe macro counts every message the client sends to the server (`game.socket.emit`: event, document type, action), and the
 * engine's timing report (`api.perf`) is reset before and read after. The scenario fails if the engine makes the server write on
 * every step of a plain token (no effect, no zone, no link) out of combat: more than one document write per four steps besides the
 * moves themselves.
 */
const MODULE_ID = "dnd5e-combat";
const MACRO = "DAS — performance probe";
const pause = ms => new Promise(r => setTimeout(r, ms));

const PROBE = `
const args = { op: typeof op !== "undefined" ? op : null, tokenId: typeof tokenId !== "undefined" ? tokenId : null, steps: typeof steps !== "undefined" ? steps : 0 };
const key = "__dasPerfProbe";
if ( args.op === "start" ) {
  const state = globalThis[key] = { emits: {}, docs: {}, original: game.socket.emit };
  game.socket.emit = function(event, request, ...rest) {
    const type = request?.type ?? "";
    const action = request?.action ?? "";
    const k = [event, type, action].filter(Boolean).join(" ");
    state.emits[k] = (state.emits[k] ?? 0) + 1;
    return state.original.call(this, event, request, ...rest);
  };
  state.hooks = [];
  for ( const action of ["create", "update", "delete"] ) {
    for ( const name of ["Actor", "Item", "ActiveEffect", "Token", "Combat", "Combatant", "ChatMessage", "Region", "Scene", "User", "Setting", "AmbientLight", "Tile", "Wall"] ) {
      const hook = action + name;
      const id = Hooks.on(hook, (doc, a, b, c) => {
        const k = hook + (doc?.parent ? " in " + doc.parent.documentName : "");
        state.docs[k] = (state.docs[k] ?? 0) + 1;
      });
      state.hooks.push([hook, id]);
    }
  }
  game.modules.get("${MODULE_ID}").api.perf.reset();
  return { started: true, actors: game.actors.size, tokens: canvas.scene.tokens.size };
}
if ( args.op === "walk" ) {
  const doc = canvas.scene.tokens.get(args.tokenId);
  const g = canvas.scene.grid.size;
  const t0 = performance.now();
  const steps = [];
  for ( let i = 0; i < args.steps; i++ ) {
    const dir = (Math.floor(i / 3) % 2) ? -1 : 1;
    const s = performance.now();
    await doc.move({ x: doc.x + dir * g, y: doc.y, action: "walk" }, { showRuler: false });
    await doc.object?.movementAnimationPromise;
    steps.push(Math.round(performance.now() - s));
  }
  globalThis[key].walk = { ms: Math.round(performance.now() - t0), steps };
  return globalThis[key].walk;
}
if ( args.op === "stop" ) {
  const state = globalThis[key];
  if ( !state ) return { error: "no probe" };
  game.socket.emit = state.original;
  for ( const [hook, id] of state.hooks ) Hooks.off(hook, id);
  delete globalThis[key];
  const perf = game.modules.get("${MODULE_ID}").api.perf;
  return { emits: state.emits, docs: state.docs, walk: state.walk, perf: perf.report().slice(0, 15), longTasks: perf.longTasks() };
}
return { error: "op?" };
`;

export default {
  name: "perf-deplacement — a walking token: requests to the server and engine hook time, step by step (baileywiki's report)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien needed: not applicable"); return; }
    const mage = await ctx.token("Magicien");
    const start = await ctx.position(mage);
    ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: start.x, y: start.y, ignoreWalls: true }));

    const made = await ctx.call("create-macro", { macroData: { name: MACRO, type: "script", command: PROBE } });
    const macroId = made?.data?.id ?? made?.data?._id ?? made?.id ?? made?._id ?? made?.macro?.id;
    if ( !macroId ) throw new Error(`macro not created: ${JSON.stringify(made).slice(0, 300)}`);
    ctx.restore(() => ctx.call("trash-document", { documentType: "Macro", documentId: macroId }).catch(() => {}));

    const run = async (args, waitMs=8000) => { const r = await ctx.call("run-macro", { macroId, args, waitMs }); return r?.data ?? r; };
    const STEPS = 12;
    const measure = async label => {
      const begun = await run({ op: "start" });
      ctx.log(`[${label}] world: ${begun?.result?.actors ?? "?"} actors, scene: ${begun?.result?.tokens ?? "?"} tokens`);
      await run({ op: "walk", tokenId: mage.id, steps: STEPS });
      // The walk outlasts the 8 s of one answer: it goes on; let the engine's queue finish.
      await pause(STEPS * 900);
      const out = (await run({ op: "stop" }))?.result ?? {};
      ctx.log(`[${label}] walk: ${JSON.stringify(out.walk)}`);
      ctx.log(`[${label}] messages to the server: ${JSON.stringify(out.emits)}`);
      ctx.log(`[${label}] documents: ${JSON.stringify(out.docs)}`);
      ctx.log(`[${label}] long tasks: ${JSON.stringify(out.longTasks)}`);
      for ( const r of out.perf ?? [] ) ctx.log(`  ${r.hook} « ${r.label} » : ${r.calls} calls, ${Math.round(r.totalMs)} ms, max ${Math.round(r.maxMs)} ms`);
      const writes = Object.entries(out.emits ?? {}).filter(([k]) => k.startsWith("modifyDocument") && !/^modifyDocument Token update$/.test(k))
        .reduce((sum, [, n]) => sum + n, 0);
      return { writes, out };
    };

    const calm = await measure("out of combat");
    ctx.expect(calm.writes <= STEPS / 4, `out of combat, the engine writes little during the walk (${calm.writes} writes besides the moves for ${STEPS} steps)`);

    await ctx.startCombat([mage]);
    const fight = await measure("in combat");
    ctx.log(`in combat: ${fight.writes} writes besides the moves for ${STEPS} steps`);
  }
};
