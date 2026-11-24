/**
 * The same guard as `perf-planpath` (issue #92), where there are walls, doors and levels: Restored Keep. The wall shortcut
 * (`noEdgeBetween`) is compared with the core's collision test on every step of the token's level, steps across the scene boundary
 * included, and the routes around the token (walls, doors to open) are hashed to compare two engines.
 */
import { probePlanPath, expectSameAnswers } from "../lib/planpath-probe.mjs";

export default {
  scene: "keep",
  name: "perf-planpath-murs — walls and doors: the core is only skipped where it would find nothing (issue #92)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const out = await probePlanPath(ctx, mage, { cold: false });
    expectSameAnswers(ctx, out);
    if ( !out.steps.skipped ) ctx.expect(out.steps.collisions > 0, `the level has walls to collide with (${out.steps.collisions} step(s) stopped by the core)`);
  }
};
