/**
 * §239 (issue #14): a cell cut by a wall that does not follow the grid (cave) no longer gives Cover against everyone.
 * Arena: a diagonal wall cuts the corner of the Zombie's cell opposite the Sorcerer — the corner is in the "rock", behind
 * the Zombie. Before §239, the line to that corner was always blocked: Half Cover. Expected: no Cover. Then a real wall between
 * the two: the Cover stays (total). Restores the walls.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "abri — case coupée par un mur de grotte : pas d'abri derrière soi",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const g = await ctx.gridSize();
    const a = await ctx.position(sorc);
    const z = await ctx.position(zombi);
    const sx = (z.x >= a.x) ? 1 : -1;
    const sy = (z.y >= a.y) ? 1 : -1;
    if ( Math.max(Math.abs(z.x - a.x), Math.abs(z.y - a.y)) < 2 * g ) { ctx.log("Ensorceleur trop près du Zombi : non applicable"); return; }

    // The corner of the Zombie's cell on the side opposite the Sorcerer, and a cut at 40% of a cell on each of the two edges.
    const c = { x: z.x + (sx > 0 ? g : 0), y: z.y + (sy > 0 ? g : 0) };
    const p = { x: c.x - (sx * 0.4 * g), y: c.y };
    const q = { x: c.x, y: c.y - (sy * 0.4 * g) };
    const cut = [p.x + (p.x - q.x), p.y + (p.y - q.y), q.x + (q.x - p.x), q.y + (q.y - p.y)].map(Math.round);
    // A real wall, midway between the two, perpendicular to the line joining them, six cells long.
    const m = { x: (a.x + z.x + g) / 2, y: (a.y + z.y + g) / 2 };
    const len = Math.hypot(z.x - a.x, z.y - a.y);
    const n = { x: -(z.y - a.y) / len, y: (z.x - a.x) / len };
    const between = [m.x - (n.x * 3 * g), m.y - (n.y * 3 * g), m.x + (n.x * 3 * g), m.y + (n.y * 3 * g)].map(Math.round);

    const wallIds = [];
    const addWall = async coords => {
      const created = await ctx.call("create-walls", { walls: [{ c: coords }] });
      const id = (created?.walls ?? []).map(w => w.id ?? w._id).find(Boolean);
      if ( !id ) throw new Error(`mur non créé (${JSON.stringify(created).slice(0, 200)})`);
      wallIds.push(id);
      await pause(800);
      return id;
    };
    ctx.restore(async () => { for ( const id of wallIds ) await ctx.call("delete-scene-object", { type: "Wall", objectId: id }).catch(() => {}); });

    const open = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    const label = c => c ? `${c.degree}${c.byCreature ? " (créature)" : " (mur)"}` : "aucun abri";
    ctx.log(`sans mur : ${label(open)}`);

    await addWall(cut);
    const cave = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    ctx.log(`coin de la case coupé derrière le Zombi (${cut.join(", ")}) : ${label(cave)}`);
    // Without §239, a line blocked by the wall: Half Cover "(mur)", even when a creature already gave one.
    ctx.expect(label(cave) === label(open), `le coin dans la roche ne change rien (${label(open)} → ${label(cave)})`);

    const id = await addWall(between);
    const walled = await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id });
    ctx.log(`mur entre les deux (${between.join(", ")}) : ${walled?.degree ?? "aucun abri"}`);
    ctx.expect(walled?.degree === "total", "un vrai mur entre les deux : abri total");
    await ctx.call("delete-scene-object", { type: "Wall", objectId: id });
    wallIds.splice(wallIds.indexOf(id), 1);
  }
};
