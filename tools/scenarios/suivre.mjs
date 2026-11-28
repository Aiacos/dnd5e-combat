/**
 * Follow (SPEC §41.3): one token follows another, out of combat.
 *  1. The Cleric is ordered to follow the Fighter: the order is noted, and the Cleric moves into contact.
 *  2. The Fighter moves: the Cleric catches up, in contact with the Fighter's new position.
 *  3. No loop: the Fighter cannot start following the Cleric who is following the Fighter.
 *  4. The Cleric moved another way (its player takes control): the order lapses.
 *  5. "Stop following": the order lapses, and the Cleric no longer moves when the Fighter leaves again.
 * Sets up the Restored Keep reference layout; resets the orders and positions.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const STEPS = [[3, 0], [0, 3], [-3, 0], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2]];

export default {
  scene: "keep",   // §83: floors and stairs, in Restored Keep
  name: "suivre — un token en suit un autre, la boucle refusée, l'ordre qui tombe",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const follower = await ctx.token("Clerc");
    const leader = await ctx.token("Guerrier");
    const state = t => ctx.engine("followState", { tokenId: t.id });
    for ( const t of [follower, leader] ) ctx.restore(() => ctx.engine("unfollow", { tokenId: t.id }).catch(() => {}));

    const touching = (a, b) => (a.level === b.level) && (Math.max(Math.abs(a.cell.i - b.cell.i), Math.abs(a.cell.j - b.cell.j)) <= 1);
    /** Waits until the follower is in contact with the leader (following starts after a short delay, then walks). */
    const joined = async (timeoutMs=30000) => {
      for ( const stop = Date.now() + timeoutMs; Date.now() < stop; await pause(700) ) {
        const [f, l] = [await state(follower), await state(leader)];
        if ( touching(f.position, l.position) ) return true;
      }
      return false;
    };
    /** A reachable cell a few steps from the token, which it will reach by the engine's path. */
    const stepAway = async t => {
      const here = (await state(t)).position.cell;
      for ( const [di, dj] of STEPS ) {
        const cell = { i: here.i + di, j: here.j + dj };
        const p = await ctx.engine("plan", { tokenId: t.id, cell, maxCost: 1e9 });
        if ( p.found && p.arrives && p.waypoints.length ) return cell;
      }
      return null;
    };

    // 1. The order, and the move into contact.
    const r = await ctx.engine("follow", { followerId: follower.id, leaderId: leader.id });
    ctx.expect(r.following === true, "le Clerc reçoit l'ordre de suivre le Guerrier");
    ctx.expect((await state(follower)).leader === leader.id, "l'ordre est noté sur le Clerc");
    ctx.expect((await state(leader)).followers.includes(follower.id), "le Guerrier a un suiveur");
    ctx.expect(await joined(), "le Clerc vient au contact du Guerrier");

    // 2. Le meneur bouge : le suiveur le rejoint.
    const cell = await stepAway(leader);
    if ( !ctx.expect(!!cell, "une case où faire marcher le Guerrier") ) return;
    const before = (await state(follower)).position;
    await ctx.engine("move", { tokenId: leader.id, cell }, { timeoutMs: 60000 });
    ctx.expect(await joined(), "le Guerrier se déplace : le Clerc le rejoint au contact");
    const after = (await state(follower)).position;
    ctx.expect((after.cell.i !== before.cell.i) || (after.cell.j !== before.cell.j), `le Clerc a marché (${before.cell.i},${before.cell.j} → ${after.cell.i},${after.cell.j})`);
    ctx.expect((await state(follower)).leader === leader.id, "il suit toujours (sa propre marche ne casse pas l'ordre)");

    // 2 bis. By a staircase: the leader changes level, the follower too (levelled scene only).
    const { levels } = await ctx.call("list-levels", {}).catch(() => ({ levels: [] }));
    if ( levels?.length > 1 ) {
      const size = await ctx.gridSize();
      const home = (await state(leader)).position.level;
      const start = await ctx.engine("movement", { tokenId: leader.id });
      if ( start.viewedLevel ) ctx.restore(() => ctx.engine("view", { levelId: start.viewedLevel }));
      const stairs = (await ctx.engine("stairs", { tokenId: leader.id })).filter(s => s.levels.includes(home) && (s.levels.length > 1) && s.cells.length);
      let climbed = false;
      for ( const s of stairs.slice(0, 6) ) {
        const c = s.cells[Math.floor(s.cells.length / 2)];
        const point = { x: (c.j * size) + (size / 2), y: (c.i * size) + (size / 2) };
        const dest = (await ctx.engine("stairsAt", { tokenId: leader.id, point }))[0];
        if ( !dest ) continue;
        const r = await ctx.engine("takeStairs", { tokenId: leader.id, point, levelId: dest.id }, { timeoutMs: 120000 });
        if ( r.after.level !== dest.id ) continue;
        climbed = true;
        ctx.expect(await joined(60000), `le Guerrier prend l'escalier (${dest.name}) : le Clerc le suit sur l'autre niveau`);
        await ctx.engine("takeStairs", { tokenId: leader.id, point, levelId: home }, { timeoutMs: 120000 });
        ctx.expect(await joined(60000), "retour par l'escalier : le Clerc revient avec lui");
        break;
      }
      if ( !climbed ) ctx.log("aucun escalier atteignable : suivi d'un niveau à l'autre non exercé");
    }

    // 3. Pas de boucle.
    const loop = await ctx.engine("follow", { followerId: leader.id, leaderId: follower.id });
    ctx.expect(loop.following === false, "boucle refusée : le Guerrier ne suit pas le Clerc qui le suit");

    // 4. Taken back in hand: a move that does not come from following drops the order.
    const away = await stepAway(follower);
    if ( ctx.expect(!!away, "une case où déplacer le Clerc à la main") ) {
      await ctx.engine("move", { tokenId: follower.id, cell: away }, { timeoutMs: 60000 });
      await pause(1500);
      ctx.expect((await state(follower)).leader === null, "le Clerc déplacé à la main ne suit plus");
    }

    // 5. "Stop following".
    await ctx.engine("follow", { followerId: follower.id, leaderId: leader.id });
    ctx.expect(await joined(), "ordre redonné : le Clerc revient au contact");
    const stopped = await ctx.engine("unfollow", { tokenId: follower.id });
    ctx.expect(stopped.stopped === true && (await state(follower)).leader === null, "« Ne plus suivre » : l'ordre tombe");
    const rest = (await state(follower)).position;
    const cell2 = await stepAway(leader);
    if ( cell2 ) {
      await ctx.engine("move", { tokenId: leader.id, cell: cell2 }, { timeoutMs: 60000 });
      await pause(3000);
      const still = (await state(follower)).position;
      ctx.expect((still.cell.i === rest.cell.i) && (still.cell.j === rest.cell.j), "le Guerrier repart : le Clerc reste où il est");
    }
  }
};
