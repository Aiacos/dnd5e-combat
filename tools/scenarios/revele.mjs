/**
 * Starry Wisp: the target "can't benefit from the Invisible condition" (SPEC §16.36, `revealsInvisible`). World
 * `ravenloft`: Zombie made Invisible; Sylaene shoots Starry Wisp at it — "target not seen" (Disadvantage) as long as she has
 * not hit it; once it is hit (effect "Illuminated"), the next shot no longer carries that reason. Not applicable without
 * Sylaene and the Zombie.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "révélé — Poussière d'étoile annule Invisible",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Sylaene", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Sylaene ou le Zombi absent : non applicable"); return; }
    const druid = await ctx.token("Sylaene");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Illumin|Starry|Poussi/i));
    ctx.restore(() => ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: false }));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "invisible"));
    await ctx.removeEffectsNamed(zombi, /Illumin|Starry|Poussi/i);
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });

    const shoot = async () => {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: druid.id, identifier: "starry-wisp", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const mods = attack?.flags?.[MODULE_ID]?.modifiers ?? { advantage: [], disadvantage: [] };
      const reasons = [...(mods.advantage ?? []), ...(mods.disadvantage ?? [])].map(x => `${x.who}.${x.key}`);
      return { hit: !!r.targets[0]?.hit, reasons };
    };

    let first = null;
    let hit = false;
    for ( let n = 1; (n <= 12) && !hit; n++ ) {
      const shot = await shoot();
      first ??= shot;
      hit = shot.hit;
    }
    ctx.log(`premier tir : ${first.reasons.join(", ") || "aucune raison"}`);
    ctx.expect(first.reasons.includes("target.unseen"), "Zombi invisible, pas encore illuminé : « cible non vue »");
    ctx.expect(hit, "Poussière d'étoile finit par toucher");
    if ( !hit ) return;
    await pause(1500);
    const lit = (await ctx.effects(zombi)).some(e => /Illumin|Starry|Poussi/i.test(e.name ?? ""));
    ctx.expect(lit, "le Zombi porte « Illuminé »");
    const after = await shoot();
    ctx.log(`tir suivant : ${after.reasons.join(", ") || "aucune raison"}`);
    ctx.expect(!after.reasons.includes("target.unseen"), "illuminé : il ne bénéficie plus d'Invisible (plus de « cible non vue »)");

    // Even in the display: the Invisibility effect is suspended for as long as the reveal lasts, then resumes.
    const invisibleEffects = async () => (await ctx.effects(zombi)).filter(e => (e.statuses ?? []).includes("invisible"));
    const veiled = await invisibleEffects();
    ctx.expect(veiled.length && veiled.every(e => e.disabled), `effet d'Invisibilité suspendu (${veiled.map(e => `${e.name}: ${e.disabled ? "désactivé" : "actif"}`).join(", ")})`);
    await ctx.removeEffectsNamed(zombi, /Illumin|Starry|Poussi/i);
    await pause(1500);
    const back = await invisibleEffects();
    ctx.expect(back.length && back.every(e => !e.disabled), "illumination retirée : l'invisibilité reprend");

    // Illuminated first, invisible afterwards: the effect is born suspended.
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: false });
    await ctx.removeStatusEffects(zombi, "invisible");
    let lit2 = false;
    for ( let n = 1; (n <= 12) && !lit2; n++ ) lit2 = (await shoot()).hit;
    ctx.expect(lit2, "Zombi de nouveau illuminé");
    await pause(1500);
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "invisible", active: true });
    await pause(1500);
    const born = await invisibleEffects();
    ctx.expect(born.length && born.every(e => e.disabled), "rendu invisible en étant illuminé : l'effet naît suspendu");
  }
};
