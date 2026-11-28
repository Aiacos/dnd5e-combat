/**
 * Wall of Fire (SPEC §169), world `dnd-6`, arena, free corner to the northwest. The Wizard (spell lent from the Player's
 * Handbook, at will) places the wall through `api.mcp.wall` (aiming by points, the clicks replaced by the points):
 *  - L-shaped, a point off the axis: the line straightened (no diagonal), two segments, core walls that block sight, not
 *    movement; the burning side opposite the Wizard (south), its burning face placed (3 m);
 *  - the Zombie, to the south against the wall, makes the saving throw on appearance;
 *  - on its turn, it crosses the wall to the north: damage without a saving throw; it crosses back south: nothing (once per
 *    turn); it ends its turn to the south: damage without a saving throw;
 *  - the flipped face goes to the north;
 *  - §170: lights on each side (10/20 ft), removed with the wall; the fire sound if darsh-animations is active;
 *  - as a ring around the Zombie: the placed disc becomes a thin ring ("ring" shape), its walls on the radius; the "which
 *    side" window (§171) answered "outward": the crown around burns; flipped inward, the Zombie ends its turn there: damage.
 * Restores positions, HP, combat; the regions and walls placed fall with the caster's restoration.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Mur de feu — sans diagonale, opaque, face brûlante, traversée, anneau",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien ou Zombi absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, zombi] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const regions = [];
    const sceneObjects = async type => (await ctx.call("list-scene-objects", { types: [type] })).objects?.[type] ?? [];
    ctx.restore(async () => {
      for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      await pause(1000);
      for ( const t of [mage, zombi] ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    });
    const P = (gx, gy) => ({ x: gx * grid, y: gy * grid });
    const place = async (t, gx, gy) => { await ctx.call("move-token", { tokenId: t.id, ...P(gx, gy), elevation: 0 }); await pause(800); };
    const fire = await ctx.ensureItem(mage, PHB + "phbsplWallofFire", { system: { method: "atwill" } });
    const state = async id => ctx.engine("wallSide", { regionId: id });
    const hits = async (re) => (await ctx.engineLog()).filter(l => re.test(l));

    await place(mage, 12, 30);
    await place(zombi, 14, 33);
    await ctx.setHp(zombi, 100);
    await ctx.startCombat([mage, zombi]);
    const current = async () => { const s = await ctx.combat(); const c = s.combat ?? s.combats?.[0] ?? s; return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await pause(1200); }
      return (await current()) === token.id;
    };
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien") ) return;
    // The end of the turn goes through the active GM's resolution (roll, card, animation): wait for the damage, 15 s at most.
    const burnt = async before => {
      let hp = await ctx.hp(zombi);
      for ( const stop = Date.now() + 15000; (hp >= before) && (Date.now() < stop); hp = await ctx.hp(zombi) ) await pause(500);
      return hp;
    };

    // 1. En L, un point hors de l'axe.
    await ctx.engineLog();
    const placed = await ctx.engine("wall", { tokenId: mage.id, itemId: fire, points: [P(11, 33), { x: 17 * grid, y: 33.4 * grid }, P(17, 35)] });
    if ( !ctx.expect(!!placed?.regionId, "Mur de feu : région posée") ) return;
    regions.push(placed.regionId);
    let s = null;
    for ( let i = 0; (i < 20) && !s?.burning; i++ ) { await pause(500); s = await state(placed.regionId); }
    const lines = s.shapes.filter(x => x.type === "line");
    ctx.expect((lines.length === 2) && lines.every(l => (Math.round(l.rotation) % 90) === 0) && (Math.round(lines[0].y) === 33 * grid),
      `sans diagonale : ${lines.map(l => `${Math.round(l.rotation)}° ${Math.round(l.length / grid * 5)} ft`).join(", ")}`);
    ctx.expect((s.walls.length === 2) && s.walls.every(w => (w.move === 0) && (w.sight === 20)), `opaque : ${s.walls.length} murs, déplacement ${s.walls.map(w => w.move).join("/")}, vue ${s.walls.map(w => w.sight).join("/")}`);
    ctx.expect(s.side === -1, `côté brûlant à l'opposé du Magicien (côté ${s.side})`);
    // §170: the light, on both sides; the sound (darsh-animations, if active).
    const above = s.lights.filter(l => l.y < 33 * grid).length, below = s.lights.filter(l => l.y > 33 * grid).length;
    ctx.expect((above > 0) && (below > 0) && s.lights.every(l => (l.bright === 10) && (l.dim === 20)), `lumière : ${s.lights.length} sources (${above} au nord, ${below} au sud), 10/20 ft`);
    ctx.log(`bruit de feu : ${s.sounds} son(s) d'ambiance`);
    const south = (s.burning?.shapes ?? []).find(x => x.type === "polygon" && x.points.some((v, i) => (i % 2) && (v > 33 * grid)));
    ctx.expect(!!south && (Math.max(...south.points.filter((_, i) => i % 2)) === 35 * grid), `face brûlante au sud, 10 ft (${JSON.stringify(s.burning?.shapes?.map(x => x.points))})`);
    await pause(2500);
    const posed = await hits(/area placed: \d+ token\(s\) covered, \d+ affected/);
    ctx.expect(posed.some(l => /covered, 1 affected/.test(l)), `apparition : le Zombi, contre le mur, est dans la zone (${posed.at(-1) ?? "rien"})`);
    await pause(2500);
    let hp = await ctx.hp(zombi);
    ctx.expect(hp < 100, `apparition : le Zombi subit le feu (${100 - hp} PV)`);

    // 2. Crossing, once per turn; end of turn on the burning side.
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi") ) return;
    await ctx.engineLog();
    let before = await ctx.hp(zombi);
    await ctx.engine("move", { tokenId: zombi.id, point: { x: 14.5 * grid, y: 31.5 * grid } });
    await pause(4000);
    hp = await ctx.hp(zombi);
    const crossed = await hits(/Zombi \(enter\)/);
    ctx.expect(crossed.length && (hp < before), `traversée vers le nord : dégâts (${before - hp} PV, ${crossed.length} rejeu)`);
    before = hp;
    await ctx.engine("move", { tokenId: zombi.id, point: { x: 14.5 * grid, y: 33.5 * grid } });
    await pause(3000);
    hp = await ctx.hp(zombi);
    ctx.expect(hp === before, `traversée retour, même tour : rien (${before - hp} PV)`);
    const cards = (await ctx.call("list-chat-messages", { limit: 6, flagScope: MODULE_ID })).messages ?? [];
    const noSave = cards.map(m => m.flags?.[MODULE_ID]?.resolution).filter(r => r?.targets?.length)
      .flatMap(r => r.targets).filter(t => t.save?.auto === "noSave");
    ctx.expect(noSave.length > 0, `la traversée : sans sauvegarde, dégâts pleins (${noSave.map(t => t.damage?.applied).join(", ")})`);
    let t0 = Date.now();
    await ctx.nextTurn();
    hp = await burnt(before);
    ctx.log(`fin de tour : dégâts lus après ${Date.now() - t0} ms`);
    const ended = await hits(/face brûlante|burning side.*Zombi \(turnEnd\)|Zombi \(turnEnd\)/);
    ctx.expect(ended.length && (hp < before), `fin de tour du côté brûlant : dégâts (${before - hp} PV)`);

    // 3. Flipped.
    s = await ctx.engine("wallSide", { regionId: placed.regionId, flip: true });
    const north = (s.burning?.shapes ?? []).some(x => x.type === "polygon" && x.points.some((v, i) => (i % 2) && (v < 33 * grid)));
    ctx.expect((s.side === 1) && north, `retournée : la face brûlante au nord (côté ${s.side})`);
    // The outer corner (northeast of the L's corner): covered by the square that joins the two bands.
    const covers = (poly, x, y) => { const xs = poly.points.filter((_, i) => !(i % 2)), ys = poly.points.filter((_, i) => i % 2);
      return (x > Math.min(...xs)) && (x < Math.max(...xs)) && (y > Math.min(...ys)) && (y < Math.max(...ys)); };
    ctx.expect((s.burning?.shapes ?? []).some(x => (x.type === "polygon") && covers(x, 18 * grid, 32 * grid)), "retournée : le coin extérieur du L est couvert");
    await ctx.call("delete-scene-object", { type: "Region", objectId: placed.regionId }).catch(() => {});
    await pause(1500);
    ctx.expect(!(await sceneObjects("Region")).some(r => [placed.regionId, s.burning?.id].includes(r.id ?? r._id)), "le mur retiré, sa face brûlante aussi");
    const lightsLeft = (await sceneObjects("AmbientLight")).filter(l => s.lights.some(x => (x.x === l.x) && (x.y === l.y))).length;
    ctx.expect(!lightsLeft, `le mur retiré, ses lumières aussi (${lightsLeft} restante(s))`);

    // 4. As a ring around the Zombie, the Wizard outside.
    if ( !ctx.expect(await turnOf(mage), "tour du Magicien (anneau)") ) return;
    await place(zombi, 14, 34);
    const centre = { x: 14.5 * grid, y: 34.5 * grid };
    const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === fire);
    // The Player's Handbook places a disc ("cylinder"), dnd5e a ring ("ring"); placing by coordinates, a disc.
    const ring = Object.entries(item?.system?.activities ?? {}).find(([, a]) => ["cylinder", "ring"].includes(a.target?.template?.type))?.[0];
    if ( !ctx.expect(!!ring, "anneau : activité trouvée") ) return;
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const used = await ctx.use({ tokenId: mage.id, itemId: fire, activityId: ring, consume: false, area: { shape: "circle", ...centre, radius: 2 * grid } });
    if ( !ctx.expect(!!used.regionId, "anneau : région posée") ) return;
    regions.push(used.regionId);
    // §171: the "which side" window opens for whoever placed it (here the GM) — outward.
    let asked = null;
    for ( let i = 0; (i < 10) && !asked; i++ ) {
      asked = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1000 }).catch(() => null))?.windows?.[0] ?? null;
    }
    if ( ctx.expect(!!asked, `anneau : on demande de quel côté il brûle (« ${asked?.title ?? "aucune fenêtre"} »)`) ) {
      await ctx.call("answer-dialog", { id: asked.id, button: "outward" });
    }
    s = null;
    for ( let i = 0; (i < 20) && !((s?.side === -1) && s?.burning); i++ ) { await pause(500); s = await state(used.regionId); }
    ctx.expect((s.side === -1) && (s.burning?.shapes?.[0]?.type === "ring"), `anneau : vers l'extérieur — la couronne autour brûle (côté ${s.side}, ${s.burning?.shapes?.map(x => x.type).join(", ")})`);
    s = await ctx.engine("wallSide", { regionId: used.regionId, flip: true });
    const ringShape = s.shapes.find(x => x.type === "ring");
    ctx.expect((s.shapes.length === 1) && !!ringShape && (ringShape.innerWidth + ringShape.outerWidth < grid),
      `anneau fin : ${s.shapes.map(x => `${x.type} ${Math.round(x.radius)} (${Math.round(x.innerWidth ?? 0)} + ${Math.round(x.outerWidth ?? 0)})`).join(", ")}`);
    ctx.expect((s.walls.length === 24) && s.walls.every(w => w.sight === 20), `anneau : ${s.walls.length} murs sur le rayon`);
    ctx.expect((s.side === 1) && (s.burning?.shapes?.[0]?.type === "circle"), `anneau retourné : vers l'intérieur (côté ${s.side})`);
    ctx.expect(s.lights.length > 0, `anneau : ${s.lights.length} lumières, ${s.sounds} son(s)`);
    await pause(3000);
    if ( !ctx.expect(await turnOf(zombi), "tour du Zombi (anneau)") ) return;
    before = await ctx.hp(zombi);
    t0 = Date.now();
    await ctx.nextTurn();
    hp = await burnt(before);
    ctx.log(`anneau, fin de tour : dégâts lus après ${Date.now() - t0} ms`);
    ctx.expect(hp < before, `anneau : le Zombi finit son tour dedans — dégâts (${before - hp} PV)`);
  }
};
