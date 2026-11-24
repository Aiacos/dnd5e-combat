/**
 * Measure and guard (issue #92, Aiacos, 2026-11-24): what `planPath` costs on open ground, and that what the engine no longer asks
 * dnd5e or the core gives the same answers. In the test arena (no wall): the first five calls of the page, the warm median, what one
 * search asks (occupied cells, collisions, the other tokens' sheets), the routes to every cell around the token (a hash, to compare
 * two engines), then the two open-ground shortcuts against dnd5e and the core on every cell and every step of the scene.
 * The times are logged, not judged: only the answers fail the scenario. The cold calls only mean something when this scenario is
 * the first of the pass (`npm run banc:passe -- perf-planpath`).
 */
import { probePlanPath, expectSameAnswers } from "../lib/planpath-probe.mjs";

export default {
  name: "perf-planpath — what planPath costs on open ground, same answers without asking dnd5e or the core (issue #92)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const out = await probePlanPath(ctx, mage);
    expectSameAnswers(ctx, out);
    ctx.expect(out.routes.none < out.routes.routes / 4, `most cells around the token have a route on open ground (${out.routes.routes - out.routes.none} of ${out.routes.routes}, hash ${out.routes.hash})`);
  }
};
