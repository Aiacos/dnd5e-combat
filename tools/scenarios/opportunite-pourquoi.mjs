/**
 * §479: say why an Opportunity Attack is not offered (Discord, 2026-11-19).
 *  1. The Zombie, left Neutral, next to the Rogue who is leaving: reason "notHostile", to tell the GM.
 *  2. The same movement, like a real one: a whispered GM alert names the Rogue and the Zombie; replayed, nothing more (once per
 *     combat).
 *  3. The Hostile Zombie: it threatens the Rogue, no reason is given.
 * The Zombie's disposition and place are restored.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "attaque d'opportunité — dire pourquoi elle n'est pas proposée",

  async run(ctx) {
    const rogue = await ctx.token("Roublard");
    const zombi = await ctx.token("Zombi");
    const script = async (code, args={}) => (await ctx.call("run-script", { waitMs: 8000, args, code }))?.result;
    const grid = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const at = await ctx.position(rogue);
    const disposition = await script(`return canvas.scene.tokens.get(args.id).disposition;`, { id: zombi.id });
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => script(`await canvas.scene.tokens.get(args.id).update({ disposition: args.d }); return true;`, { id: zombi.id, d: disposition }));

    await script(`await canvas.scene.tokens.get(args.id).update({ disposition: 0 }); return true;`, { id: zombi.id });
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await pause(800);
    await ctx.startCombat([zombi, rogue]);
    await pause(800);
    const away = { x: at.x - 5 * grid + grid / 2, y: at.y + grid / 2 };

    // 1. La raison, sans rien dire.
    const silent = await ctx.engine("missedOpportunities", { tokenId: rogue.id, point: away });
    const z = silent.find(m => m.name === zombi.name);
    ctx.expect(z?.reason === "notHostile" && z.notice === true, `Zombi Neutre : raison « notHostile », à dire au MJ (${JSON.stringify(silent)})`);

    // 2. Like a real movement: the GM alert, only once.
    const count = () => script(`return game.messages.contents.filter(m => { const a = m.flags?.["dnd5e-combat"]?.gmAlert;
      return a && a.text.includes(args.mover) && a.text.includes(args.attacker); }).length;`, { mover: rogue.name, attacker: zombi.name });
    const before = await count();
    await ctx.engine("missedOpportunities", { tokenId: rogue.id, point: away, explain: true });
    await pause(1500);
    const after = await count();
    ctx.expect(after === before + 1, `une alerte MJ nomme le Roublard et le Zombi (${before} → ${after})`);
    await ctx.engine("missedOpportunities", { tokenId: rogue.id, point: away, explain: true });
    await pause(1500);
    const again = await count();
    ctx.expect(again === after, `rejoué dans le même combat : pas de seconde alerte (${after} → ${again})`);

    // 3. Hostile: the attack is offered, no reason is given.
    await script(`await canvas.scene.tokens.get(args.id).update({ disposition: -1 }); return true;`, { id: zombi.id });
    await pause(500);
    const threats = await ctx.engine("threats", { tokenId: rogue.id, point: away });
    const hostile = await ctx.engine("missedOpportunities", { tokenId: rogue.id, point: away });
    ctx.expect(threats.includes(zombi.name) && !hostile.some(m => m.name === zombi.name),
      `Zombi Hostile : il menace, sans raison donnée (menaces : ${threats.join(", ") || "aucune"} ; raisons : ${JSON.stringify(hostile)})`);
  }
};
