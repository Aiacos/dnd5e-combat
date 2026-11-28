/**
 * §286: work items of 2026-10-30, batch 4 (multiple areas, chosen targets), world `dnd-6`, Test Arena. The Cleric receives the
 * Player's Handbook spells (at will, nothing consumed), the Zombie is 10 cells east. Checks:
 *  - Meteor Swarm: dnd5e's placement (`api.mcp.placeRegionAt`, once per sphere) gives ONE region of four Spheres; the first two
 *    far from the Zombie, the last two on him → he makes his saving throw only once, the Cleric is spared;
 *  - Fire Storm: ten Cubes in a column, the Zombie under the last one → hit once; the placement refuses Cubes that touch only
 *    at a corner, or a Cube out of range (`api.mcp.rangedPlacement`, without opening the placement);
 *  - Chain Lightning: a secondary target more than 9 m from the first is flagged (`api.mcp.chainCheck`).
 * Puts back positions, HP, regions.
 */
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { meteor: "phbsplMeteorSwar", storm: "phbsplFireStorm0", chain: "phbsplChainLight" };

export default {
  name: "sorts lot 4 — Nuée de météores, Tempête de feu, Chaîne d'éclairs (zones multiples, cibles choisies)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Zombi requis : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });
    const zhp = await ctx.hp(zombi);
    const home = { cleric: await ctx.position(cleric), zombi: await ctx.position(zombi) };
    const before = new Set(((await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? []).map(r => r.id));
    const clearRegions = async () => {
      for ( const r of (await ctx.call("list-scene-objects", { types: ["Region"] })).objects?.Region ?? [] ) {
        if ( !before.has(r.id) ) await ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {});
      }
    };
    const reset = async () => {
      await clearRegions();
      for ( const [t, h] of [[cleric, home.cleric], [zombi, home.zombi]] ) {
        const now = await ctx.position(t);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      await ctx.setHp(zombi, zhp);
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** The Zombie `cells` cells east of the Cleric; returns the Zombie's center in pixels. */
    const placeZombi = async cells => {
      const c = await ctx.position(cleric);
      await ctx.call("move-token", { tokenId: zombi.id, x: c.x + (cells * grid), y: c.y, elevation: c.elevation ?? 0 });
      await pause(800);
      const z = await ctx.position(zombi);
      return { x: z.x + (grid / 2), y: z.y + (grid / 2) };
    };
    /**
     * Casts the spell without its area, places each template through dnd5e's placement (one `placeRegionAt` per point), then
     * waits for the resolution. Returns the resolution and the created region.
     */
    const castAt = async (key, points) => {
      await ctx.setHp(zombi, zhp);
      const start = await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn: "use", args: { tokenId: cleric.id, itemId: ids[key] }, waitMs: 500 });
      await pause(1500);
      for ( const p of points ) {
        const placed = await ctx.engine("placeRegionAt", p);
        if ( !placed?.placed ) throw new Error(`gabarit non posé en ${JSON.stringify(p)}`);
        await pause(500);
      }
      let r = start;
      for ( let n = 0; !r.settled && (n < 20); n++ ) r = await ctx.call("call-module-api", { callId: r.callId, waitMs: 4000 });
      const used = r.result;
      if ( !used?.messageId ) throw new Error(`utilisation sans message (${JSON.stringify(used)})`);
      const resolution = await ctx.settle(used.messageId, { timeoutMs: 60000 });
      return { resolution, regions: used.regions ?? [] };
    };

    await part("Nuée de météores", async () => {
      const z = await placeZombi(10);
      const far = { x: z.x, y: z.y - (14 * grid) };
      const { resolution, regions } = await castAt("meteor", [far, { x: far.x - (2 * grid), y: far.y }, z, { x: z.x, y: z.y + grid }]);
      ctx.expect(regions.length === 1 && regions[0].shapes.length === 4, `une région de quatre sphères (${JSON.stringify(regions.map(r => r.shapes))})`);
      const hits = (resolution.targets ?? []).filter(t => t.name === "Zombi");
      ctx.expect(hits.length === 1, `le Zombi, dans les deux dernières sphères seulement, est pris une fois (${hits.length})`);
      ctx.expect(!!hits[0]?.save, "il fait sa sauvegarde de Dextérité");
      ctx.expect(!(resolution.targets ?? []).some(t => t.name === "Clerc"), "le Clerc, à 10 cases, est épargné");
    });

    await part("Tempête de feu", async () => {
      const z = await placeZombi(10);
      // Ten 3 m Cubes in a column above the Zombie, the last on him: contiguous by a face.
      const points = Array.from({ length: 10 }, (_, k) => ({ x: z.x, y: z.y - ((9 - k) * 2 * grid) }));
      const { resolution, regions } = await castAt("storm", points);
      ctx.expect(regions.length === 1 && regions[0].shapes.length === 10, `une région de dix cubes (${JSON.stringify(regions.map(r => r.shapes.length))})`);
      const hits = (resolution.targets ?? []).filter(t => t.name === "Zombi");
      ctx.expect(hits.length === 1 && !!hits[0].save, `le Zombi, sous le dixième cube, fait sa sauvegarde une fois (${hits.length})`);
      ctx.expect(!(resolution.targets ?? []).some(t => t.name === "Clerc"), "le Clerc est épargné");
      // The placement: corner only, isolated Cube, Cube out of range (150 ft).
      const cube = (cx, cy) => ({ type: "rectangle", x: cx - grid, y: cy - grid, width: 2 * grid, height: 2 * grid });
      const check = shapes => ctx.engine("rangedPlacement", { tokenId: cleric.id, itemId: ids.storm, shapes });
      const ok = await check([cube(z.x, z.y), cube(z.x + (2 * grid), z.y)]);
      ctx.expect(ok.area?.contiguous === true && ok.area?.count === 10, `la donnée : dix cubes contigus (${JSON.stringify(ok.area)})`);
      ctx.expect(ok.problem === null, `deux cubes côte à côte : acceptés (${ok.problem})`);
      const corner = await check([cube(z.x, z.y), cube(z.x + (2 * grid), z.y + (2 * grid))]);
      ctx.expect(corner.problem === "apart", `deux cubes qui ne se touchent que par un coin : refusés (${corner.problem})`);
      const lone = await check([cube(z.x, z.y), cube(z.x + (2 * grid), z.y), cube(z.x + (8 * grid), z.y)]);
      ctx.expect(lone.problem === "apart", `un cube isolé : refusé (${lone.problem})`);
      const c = await ctx.position(cleric);
      const far = await check([cube(c.x + (40 * grid), c.y), cube(c.x + (42 * grid), c.y)]);
      ctx.expect(far.problem === "far", `un cube à 40 cases (200 ft) : hors de portée (${far.problem})`);
    });

    await part("Chaîne d'éclairs", async () => {
      await placeZombi(3);
      const near = await ctx.engine("chainCheck", { tokenId: cleric.id, itemId: ids.chain, targetIds: [zombi.id, cleric.id] });
      ctx.expect(!near.outliers.length, `deuxième cible à 3 cases (15 ft) de la première : acceptée (${JSON.stringify(near.outliers)})`);
      await placeZombi(8);
      const far = await ctx.engine("chainCheck", { tokenId: cleric.id, itemId: ids.chain, targetIds: [zombi.id, cleric.id] });
      ctx.expect(far.outliers.includes("Clerc"), `deuxième cible à 8 cases (40 ft) de la première : signalée (${JSON.stringify(far.outliers)})`);
    });
  }
};
