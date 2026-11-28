/**
 * §209, §216: hoisting oneself from a wall onto a ledge, gripping the edge to climb back down, and a climber's path, on Restored
 * Keep. Landmarks re-read on the map images (scene margin 1260 × 1540): the grassy courtyard east of the stable is open-air; the
 * stable's thatched roof is a Surface at 20 ft (Second Floor); south of the stable, a corridor covered by the stone roof of
 * the upper floor (at 20 ft).
 *  1. In the courtyard, against the stable's east wall, the Fighter climbs 3 cells (feet at 15 ft): the thatched roof is within
 *     reach to the west; "Hoist up": he gets a foothold on the roof, at 20 ft, at the level above, no longer climbing.
 *  2. From the roof, "Grip the edge" toward the east: he goes back over the edge and ends up hanging on the wall on the courtyard
 *     side, feet at 15 ft, climbing.
 *  3. In the covered corridor, against the stable's south wall: climbing stops at 15 ft (the stone roof) and no ledge is offered —
 *     hoisting onto the thatch would pass through its own ceiling (which 0.250.0 allowed).
 *  4. A climber's path no longer goes around the building through a door.
 *  5. In combat: the 3-cell climb used all its movement (30 ft, ×2 without climb speed); hoisting up is refused.
 * 2024 climbing rules for the duration of the test. Restores position, level, mode, climbing flag.
 */
const MODULE_ID = "dnd5e-combat";
const FIRST = "rcWKCTvbgKJhN2DV";
const COURTYARD = { x: 4760, y: 4760 };   // the courtyard, against the stable's east wall
const ROOF = { i: 34, j: 33 };            // the thatched roof cell, to the west
const CORRIDOR = { x: 4340, y: 5180 };    // the covered corridor, against the stable's south wall
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * §412: a rules refusal now opens the legality window instead of a flat refusal — the call waits for the answer. Here we give up
 * ("Give up") and the window's text joins `warnings`, like the old warning.
 */
async function declining(ctx, name, call) {
  const seen = [];
  let done = false;
  const pending = call().finally(() => { done = true; });
  while ( !done ) {
    const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 800 }).catch(() => null);
    for ( const d of r?.windows ?? [] ) {
      if ( !(d.title ?? "").endsWith(` — ${name}`) ) continue;
      seen.push([d.content, d.text].filter(Boolean).join(" "));
      await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    }
  }
  const out = await pending;
  return { ...out, warnings: [...(out?.warnings ?? []), ...seen] };
}

export default {
  scene: "keep",
  name: "escalade — se hisser sur un toit, s'agripper au bord, pas à travers un plafond, chemin et coût en combat",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const home = await ctx.position(hero);
    const place = async at => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, ...at, elevation: 0, levelId: FIRST });
      await pause(800);
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: home.elevation ?? 0, levelId: home.level }).catch(() => {});
    });
    // 2024 rules for the duration of the test (in "house" mode, a failed DC 15 check makes the climber fall: the result would
    // depend on the die).
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    const state = () => ctx.engine("climbState", { tokenId: hero.id });

    // 1. Climb in the courtyard, hoist onto the thatched roof.
    await place(COURTYARD);
    let up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    if ( !ctx.expect(up.done && (up.after.elevation === 15), `dans la cour, grimpe 3 cases : pieds à ${up.after.elevation} ft`) ) return;
    let s = await state();
    const west = (s.api?.ledges ?? []).find(l => l.dir === "w");
    ctx.expect(!!west && (west.ground === 20) && (west.level !== FIRST), `toit de chaume à l'ouest : sol ${west?.ground} ft, niveau ${west?.level}`);
    const h = await ctx.engine("hoist", { tokenId: hero.id, dir: "w" });
    ctx.expect(h.done && (h.after.elevation === 20) && (h.after.level !== FIRST) && (h.after.cell.i === ROOF.i) && (h.after.cell.j === ROOF.j),
      `se hisse sur le toit : case (${h.after.cell.i}, ${h.after.cell.j}), ${h.after.elevation} ft, niveau ${h.after.level}`);
    ctx.expect(!h.climbing && (h.after.movementAction !== "climb"), `sur le toit, plus en escalade (mode ${h.after.movementAction})`);

    // 2. From the roof, grip the edge toward the east to climb back down on the courtyard side.
    const g = await ctx.engine("grab", { tokenId: hero.id, dir: "e" });
    ctx.expect(g.edges.some(e => e.dir === "e") && !g.edges.some(e => e.dir === "w"),
      `bords proposés depuis le toit : ${g.edges.map(e => `${e.dir} (${e.elevation} ft)`).join(", ") || "aucun"} (l'est, côté cour ; pas l'ouest, où le toit continue)`);
    ctx.expect(g.done && g.climbing && (g.after.elevation === 15) && (g.after.level === FIRST) && (g.after.x === COURTYARD.x) && (g.after.y === COURTYARD.y),
      `s'agrippe au bord : accroché au mur côté cour, ${g.after.elevation} ft, niveau ${g.after.level}, en escalade (${g.climbing})`);

    // 3. In the covered corridor: climbing stops at 15 ft, and no ledge through its ceiling.
    await place(CORRIDOR);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    s = await state();
    ctx.expect(up.done && (up.after.elevation === 15), `dans le couloir couvert, grimpe jusqu'au plafond : pieds à ${up.after.elevation} ft`);
    ctx.expect(!(s.api?.ledges ?? []).length, `pas de rebord à travers le toit de pierre (${(s.api?.ledges ?? []).map(l => l.dir).join(", ") || "aucun"})`);

    // 4. A climber's path does not go around the building through a door.
    await place(COURTYARD);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    const plan = await ctx.engine("plan", { tokenId: hero.id, cell: ROOF });
    ctx.expect(!plan.found || ((plan.waypoints?.length ?? 0) <= 12), `vers la case du toit en escalade : ${plan.found ? `${plan.waypoints.length} points` : "pas de chemin"} (avant : une cinquantaine, par une porte)`);

    // 5. In combat: no more movement after 3 cells of climbing, hoisting up is refused.
    await place(COURTYARD);
    await ctx.startCombat([hero]);
    await pause(1500);
    up = await ctx.engine("climb", { tokenId: hero.id, cells: 3 });
    await pause(1200);
    // Without this check, the rest passed vacuously: a climber who stayed on the ground does not "hoist up" either.
    if ( !ctx.expect(up.done && (up.after.elevation === 15), `en combat, grimpe 3 cases : pieds à ${up.after.elevation} ft`) ) return;
    const left = (await ctx.engine("movement", { tokenId: hero.id })).combat;
    const refused = await declining(ctx, hero.name, () => ctx.engine("hoist", { tokenId: hero.id, dir: "w" }));
    ctx.expect(!refused.done && (refused.after.elevation === up.after.elevation), `en combat, déplacement dépensé ${left?.spent} sur ${left?.speed} : se hisser refusé (${refused.after.elevation} ft)`);
  }
};
