/**
 * §99: an engine walk stops on the way — a click elsewhere (`stopWalking`, via `stopAfterMs` of `api.mcp.move`) or the game
 * pause (`pauseAfterMs`). The Zombie walks eight cells to the right, out of combat:
 *  - without interruption, it arrives;
 *  - stopped on the way, it stops on a cell (corner aligned to the grid), between the start and the arrival;
 *  - paused on the way, likewise, and the game is unpaused at the end.
 * Puts the Zombie back in place between each walk.
 * §166: stopping on the way is only judged in a VISIBLE GM window. Hidden (`document.hidden`, background window), the
 * browser no longer plays animations: the core chains all the pieces of the walk at once, the movement is already
 * "completed" when the stop arrives (seen on 2026-10-12) — nothing to stop. The scenario says so and only judges the complete walk.
 */
const CELLS = 8;

export default {
  name: "marche interrompue — clic ailleurs, pause",
  async run(ctx) {
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const start = await ctx.position(zombi);
    const home = () => ctx.call("move-token", { tokenId: zombi.id, x: start.x, y: start.y });
    ctx.restore(home);
    const goal = { x: start.x + (CELLS * grid), y: start.y };
    const point = { x: goal.x + (grid / 2), y: goal.y + (grid / 2) };
    const onGrid = p => (Math.round(p.x - start.x) % grid === 0) && (Math.round(p.y - start.y) % grid === 0);
    // In between: neither at the start nor at the arrival (the A* path may deviate from the line to avoid a token).
    const between = p => (p.x > start.x) && (p.x < goal.x);

    const full = await ctx.engine("move", { tokenId: zombi.id, point });
    ctx.expect((full.after.x === goal.x) && (full.after.y === goal.y), `marche complète : arrivé en ${full.after.x}, ${full.after.y} (${full.elapsedMs} ms)`);
    await home();

    if ( (await ctx.engine("status"))?.hidden ) {
      ctx.log("fenêtre du MJ en arrière-plan : les animations ne tournent pas, l'arrêt en route ne se juge pas (§166) — à rejouer fenêtre visible");
      return;
    }
    const stopped = await ctx.engine("move", { tokenId: zombi.id, point, stopAfterMs: Math.round(full.elapsedMs / 3) });
    ctx.expect(between(stopped.after) && onGrid(stopped.after),
      `arrêtée en route : ${(stopped.after.x - start.x) / grid} case(s) sur ${CELLS}, sur la grille (${stopped.elapsedMs} ms)`);
    await home();

    const paused = await ctx.engine("move", { tokenId: zombi.id, point, pauseAfterMs: Math.round(full.elapsedMs / 3) });
    ctx.expect(between(paused.after) && onGrid(paused.after),
      `pause en route : ${(paused.after.x - start.x) / grid} case(s) sur ${CELLS}, sur la grille (${paused.elapsedMs} ms)`);
  }
};
