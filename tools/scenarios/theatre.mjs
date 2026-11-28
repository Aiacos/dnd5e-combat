/**
 * §220: Theater of the Mind — the switch between the chosen automation and dnd5e alone (Arena, Fighter against the Zombie).
 *  1. Enabled: the button is in the GM's token toolbar, lit; a Fighter attack produces no resolution from the engine
 *     (dnd5e alone: its card, its roll).
 *  2. Disabled: the same attack is resolved by the engine.
 * Resets the setting.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "théâtre de l'esprit — automatisations en pause, puis rétablies",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Zombi requis : non applicable"); return; }
    const hero = await ctx.token("Guerrier");
    const zombie = await ctx.token("Zombi");
    const before = await ctx.engine("setting", { key: "theaterOfMind" });
    ctx.restore(() => ctx.engine("setting", { key: "theaterOfMind", value: before.before ?? false }));
    const sword = await ctx.itemId(hero.id, "greatsword").catch(() => null) ?? await ctx.itemId(hero.id, "longsword");
    const resolved = async () => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: hero.id, itemId: sword, activityType: "attack", targetTokenIds: [zombie.id] });
      await pause(4000);
      const { messages } = await ctx.call("list-chat-messages", { limit: 15, ...(since ? { sinceId: since } : {}) });
      return (messages ?? []).filter(m => m.flags?.[MODULE_ID]?.resolution || m.flags?.resolution).length;
    };

    await ctx.engine("setting", { key: "theaterOfMind", value: true });
    await pause(1500);
    const tool = await ctx.engine("controls", {}).catch(() => null);
    if ( tool ) ctx.expect(tool.theater?.active === true, `bouton dans la barre des jetons, allumé (${JSON.stringify(tool.theater)})`);
    const off = await resolved();
    ctx.expect(off === 0, `Théâtre de l'esprit actif : aucune résolution du moteur (${off})`);

    await ctx.engine("setting", { key: "theaterOfMind", value: false });
    await pause(1500);
    const on = await resolved();
    ctx.expect(on > 0, `rétabli : l'attaque est résolue par le moteur (${on})`);
  }
};
