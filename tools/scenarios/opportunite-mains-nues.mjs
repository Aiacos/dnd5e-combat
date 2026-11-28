/**
 * §428: the unarmed Opportunity Attack. 2024 rules: "a melee attack with a weapon or an Unarmed Strike" —
 * a character holding only a bow therefore keeps theirs. The Unarmed Strike that the engine places on characters is created
 * unequipped (adapter/basics.mjs): it counts anyway (`meleeAttacksOf`, adapter/reactions.mjs).
 *  1. All the Rogue's weapons stowed, except their bow: the Zombie leaving their reach is threatened by them.
 *  2. The Rogue's Reaction window offers the Unarmed Strike; "do not react": the Reaction remains.
 * The Rogue's equipment and the Zombie's place are restored.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "attaque d'opportunité à mains nues — un personnage sans arme de mêlée en main",

  async run(ctx) {
    const rogue = await ctx.token("Roublard");
    const zombi = await ctx.token("Zombi");
    const script = async (code, args={}) => (await ctx.call("run-script", { waitMs: 8000, args, code }))?.result;
    const grid = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const at = await ctx.position(rogue);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));

    // The Rogue holds only their ranged weapon; the Unarmed Strike stays as it is (stowed, usually).
    const gear = await script(`const a = canvas.tokens.get(args.id).actor; const weapons = a.items.filter(i => i.type === "weapon");
      const before = weapons.map(i => ({ id: i.id, equipped: i.system.equipped }));
      const ranged = weapons.find(i => [...i.system.activities].some(x => (x.type === "attack") && (x.attack?.type?.value === "ranged")));
      await a.updateEmbeddedDocuments("Item", weapons.map(i => ({ _id: i.id, "system.equipped": i.id === ranged?.id })));
      const unarmed = weapons.find(i => i.system.identifier === "unarmed-strike");
      return { before, ranged: ranged?.name ?? null, unarmed: unarmed ? { name: unarmed.name, equipped: unarmed.system.equipped } : null };`, { id: rogue.id });
    ctx.restore(() => script(`const a = canvas.tokens.get(args.id).actor;
      await a.updateEmbeddedDocuments("Item", args.before.map(b => ({ _id: b.id, "system.equipped": b.equipped }))); return true;`, { id: rogue.id, before: gear.before }));
    if ( !ctx.expect(!!gear.unarmed, `le Roublard a une Attaque à mains nues (${gear.unarmed?.name ?? "absente"})`) ) return;
    ctx.expect(gear.unarmed.equipped === false, `elle n'est pas équipée, et seule l'arme à distance l'est (${gear.ranged ?? "aucune"})`);

    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await pause(800);
    await ctx.startCombat([zombi, rogue]);
    await pause(800);

    // 1. Who threatens the Zombie's departure?
    const away = { x: at.x + 5 * grid + grid / 2, y: at.y + grid / 2 };
    const threats = await ctx.engine("threats", { tokenId: zombi.id, point: away });
    ctx.expect(threats.includes("Roublard"), `le Roublard, sans arme de mêlée en main, menace quand même (${threats.join(", ") || "personne"})`);

    // 2. The window offers the Unarmed Strike.
    const moving = ctx.engine("move", { tokenId: zombi.id, point: away, stopAfterMs: 9000 }, { timeoutMs: 20000 }).catch(() => null);
    let offered = null;
    for ( const stop = Date.now() + 6000; !offered && (Date.now() < stop); ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 800 }).catch(() => null);
      offered = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${rogue.name}`) && (w.buttons ?? []).some(b => b.action === "none")) ?? null;
    }
    const labels = (offered?.buttons ?? []).filter(b => b.action !== "none").map(b => b.label);
    ctx.expect(!!offered && labels.some(l => l === gear.unarmed.name), `sa fenêtre de réaction propose l'Attaque à mains nues (${labels.join(", ") || "aucune fenêtre"})`);
    if ( offered ) await ctx.call("answer-dialog", { id: offered.id, button: "none" }).catch(() => {});
    await moving;
  }
};
