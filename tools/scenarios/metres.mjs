/**
 * A scene in meters (1.5 m grid, scene "metres" of `dnd-6`): the engine converts the sheets' distances, written in
 * feet (SPEC §5.7). The Wizard and the Bard:
 *  1. in combat, the Speed and the turn's movement cap are in meters (30 ft → 9 m), and a walk of four cells
 *     spends 6 of it;
 *  2. the thrown dagger (6 m / 18 m): no Disadvantage at three cells (4.5 m), long-range Disadvantage at six (9 m);
 *  3. the Bard made Hostile for the duration of the test, in contact with the Wizard: the ranged attack has the melee Disadvantage,
 *     and leaving their reach (1.5 m) is an Opportunity Attack threat, staying in contact is not.
 * Restores positions, the Bard's disposition and combat.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const close = (a, b) => Math.abs(a - b) < 1e-6;

export default {
  name: "metres — une scène à 1,5 m par case : Vitesse, portée, allonge",
  scene: "metres",

  async run(ctx) {
    const mage = await ctx.token("Magicien").catch(() => null);
    const bard = await ctx.token("Barde").catch(() => null);
    if ( !mage || !bard ) { ctx.log("Magicien ou Barde absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const at = { x: 2900, y: 1900 };
    const center = (dx, dy) => ({ x: at.x + (dx * grid) + (grid / 2), y: at.y + (dy * grid) + (grid / 2) });
    await ctx.stage({ tokens: { Magicien: [at.x, at.y], Barde: [at.x + (6 * grid), at.y] } });
    await pause(500);
    const dagger = await ctx.itemId(mage.id, "dagger");

    // 1. Movement, in meters.
    await ctx.startCombat([mage, bard]);
    const c = await ctx.combat();
    for ( const [t, value] of [[mage, 20], [bard, 10]] ) {
      const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
      if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
    }
    if ( ((await ctx.combat()).combatants ?? []).find(x => x.isCurrent || x.current)?.name !== mage.name ) await ctx.nextTurn();
    await pause(1000);
    const start = await ctx.engine("movement", { tokenId: mage.id });
    const speed = start.combat?.speed;
    ctx.expect(start.combat?.units === "m", `unité du déplacement : ${start.combat?.units}`);
    ctx.expect(Number.isFinite(speed) && close(speed % 1.5, 0) && (speed < 20),
      `Vitesse convertie en mètres (multiple de 1,5) : ${speed}`);
    ctx.expect(close(start.cap, speed), `plafond du tour = la Vitesse : ${start.cap} m`);
    await ctx.engine("move", { tokenId: mage.id, point: center(-4, 0) });
    await pause(1500);
    const walked = await ctx.engine("movement", { tokenId: mage.id });
    ctx.expect(close(walked.combat?.spent ?? NaN, 6), `quatre cases à pied : ${walked.combat?.spent} m dépensés (attendu 6)`);
    await ctx.call("move-token", { tokenId: mage.id, x: at.x, y: at.y, elevation: 0 });
    await pause(800);

    // 2. The range of the thrown dagger (20/60 ft = 6/18 m).
    const reasons = () => ctx.engine("attackReasons", { attackerId: mage.id, targetId: bard.id, itemId: dagger, attackMode: "thrown" });
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + (3 * grid), y: at.y, elevation: 0 });
    await pause(800);
    const near = await reasons();
    ctx.expect(!near.disadvantage.includes("situation.longRange"), `à 4,5 m : pas de portée longue (${near.disadvantage.join(", ") || "aucun Désavantage"})`);
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + (6 * grid), y: at.y, elevation: 0 });
    await pause(800);
    const far = await reasons();
    ctx.expect(far.disadvantage.includes("situation.longRange"), `à 9 m : portée longue (${far.disadvantage.join(", ") || "aucun Désavantage"})`);

    // 3. The Bard's reach (1.5 m), made Hostile for the duration of the test.
    const { data: bardData } = await ctx.call("get-scene-object", { type: "Token", objectId: bard.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bard.id, data: { disposition: bardData.disposition } }));
    await ctx.call("update-scene-object", { type: "Token", objectId: bard.id, data: { disposition: -1 } });
    await ctx.call("move-token", { tokenId: bard.id, x: at.x + grid, y: at.y, elevation: 0 });
    await pause(800);
    const adjacent = await reasons();
    ctx.expect(adjacent.adjacentHostiles.includes(bard.name), `au contact : le Barde est un ennemi adjacent (${adjacent.adjacentHostiles.join(", ") || "personne"})`);
    ctx.expect(adjacent.disadvantage.includes("situation.closeCombat"),
      `au contact : Désavantage du corps à corps (${adjacent.disadvantage.join(", ") || "aucun"})`);
    const away = await ctx.engine("threats", { tokenId: mage.id, point: center(-3, 0) });
    ctx.expect(away.some(n => n.startsWith(bard.name)), `quitter l'allonge (4,5 m plus loin) : menace du Barde (${away.join(", ") || "aucune"})`);
    const stay = await ctx.engine("threats", { tokenId: mage.id, point: center(0, 1) });
    ctx.expect(!stay.some(n => n.startsWith(bard.name)), `rester au contact (en diagonale) : pas de menace (${stay.join(", ") || "aucune"})`);
  }
};
