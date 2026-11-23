/**
 * Fins génériques et enchantements (DF #246 du 2026-11-23, §521) : une fin générique (`endsWhen`) sur un item qui a une activité
 * « enchant » retirait ses définitions d'enchantement — les profils que l'activité propose (Gourdin magique : quatre) — alors que rien
 * n'était enchanté. Arène de test, Magicien : Gourdin magique prêté (SRD 2024 de dnd5e), une règle `endsWhen: { incapacitated: "bearer" }`
 * posée dans la surcouche du monde sur son identifiant, puis le Magicien Neutralisé : les profils restent. Témoin : le même item compte
 * bien ses profils avant.
 * Remis en état : état Neutralisé, surcouche, sort prêté.
 */
const SHILLELAGH = "Compendium.dnd5e.spells24.Item.phbsplShillelagh";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "fin générique sur un item à enchantement — les profils de Gourdin magique restent (#246)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const itemId = await ctx.ensureItem(mage, SHILLELAGH, { system: { method: "atwill" } });
    const { data: mTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const profiles = async () => {
      const item = ((await ctx.call("get-actor", { actorId: mTok.actorId })).items ?? []).find(i => i._id === itemId);
      return (item?.effects ?? []).filter(e => e.type === "enchantment").length;
    };
    const identifier = ((await ctx.call("get-actor", { actorId: mTok.actorId })).items ?? []).find(i => i._id === itemId)?.system?.identifier;
    const before = await profiles();
    ctx.log(`Gourdin magique (${identifier}) : ${before} profil(s) d'enchantement`);
    if ( !ctx.expect(before > 0, `Gourdin magique porte ses profils d'enchantement (${before})`) ) return;

    const { before: rule0 } = await ctx.engine("overrideContent", { identifier, entry: { endsWhen: { incapacitated: "bearer" } } });
    ctx.restore(() => ctx.engine("overrideContent", { identifier, entry: rule0 }).catch(() => {}));
    ctx.restore(() => ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false }).catch(() => {}));
    await pause(500);
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: true });
    await pause(3000);
    const after = await profiles();
    ctx.expect(after === before, `Neutralisé, rien d'enchanté : les ${before} profils restent sur le sort (${after})`);
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false });
    await pause(800);
    ctx.expect((await profiles()) === before, "toujours là après la fin de l'état");
  }
};
