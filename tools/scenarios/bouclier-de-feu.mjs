/**
 * §266: Fire Shield — "the flames shed Bright Light in a 3 m radius and Dim Light for 3 m beyond that".
 * The Wizard casts it (warm or cold shield, chosen in the window): the placed effect carries the token's light.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Bouclier de feu — l'effet fait briller le lanceur",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    ctx.restore(() => ctx.removeEffectsFrom(mage, "fire-shield"));
    await ctx.ensureItem(mage, "Compendium.dnd-players-handbook.spells.Item.phbsplFireShield", { system: { method: "atwill" } });
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const use = ctx.use({ tokenId: mage.id, identifier: "fire-shield", targetTokenIds: [mage.id] });
    // The "single effect" window: the first button.
    for ( let i = 0; i < 10; i++ ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1000, details: true }).catch(() => null);
      const d = r?.windows?.[0];
      if ( d?.buttons?.length ) { await ctx.call("answer-dialog", { id: d.id, button: d.buttons[0].action ?? d.buttons[0].label }).catch(() => {}); break; }
    }
    await use;
    await pause(2500);
    const effects = (await ctx.effects(mage)).filter(e => /Shield|Bouclier/i.test(e.name ?? "") && !/^Shield$/i.test(e.name ?? ""));
    const changes = effects.flatMap(e => e.changes ?? e.system?.changes ?? []);
    const bright = changes.find(c => c.key === "token.light.bright");
    const dim = changes.find(c => c.key === "token.light.dim");
    ctx.expect(effects.length > 0, `le bouclier est posé (${effects.map(e => e.name).join(", ") || "rien"})`);
    ctx.expect(String(bright?.value) === "10" && String(dim?.value) === "20", `lumière vive ${bright?.value}, faible ${dim?.value}`);
  }
};
