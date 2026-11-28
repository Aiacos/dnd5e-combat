/**
 * Discord feedback (Fanarie, 2026-11-18): Foundry V14 no longer displays the global illumination "Bright Light" checkbox
 * (`environment.globalLight.bright`); the Core puts it back in the Visibility tab of the scene configuration (ui/scene-bright.mjs).
 * On the displayed scene: the box is there, ticked according to the scene; ticking it and saving writes `true`, unticking
 * it `false`.
 * Restores the starting value.
 */
export default {
  name: "lumière vive — la case de l'illumination globale dans la configuration de scène",

  async run(ctx) {
    const { sceneId } = await ctx.scene();
    const bright = args => ctx.engine("sceneBright", args);
    const first = await bright();
    const before = first.saved;
    ctx.restore(() => ctx.call("update-scene", { sceneId, sceneData: { "environment.globalLight.bright": before } }).catch(() => {}));
    ctx.expect(first.present, "la case « Lumière vive » est dans la configuration de la scène");
    ctx.expect(first.checked === before, `elle montre la valeur de la scène (${first.checked} / ${before})`);
    const on = await bright({ check: true });
    ctx.expect(on.saved === true, `cochée puis enregistrée : la scène passe en lumière vive (${on.saved})`);
    const off = await bright({ check: false });
    ctx.expect(off.saved === false, `décochée puis enregistrée : lumière faible (${off.saved})`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
