/**
 * Cleric and druid spells that carried several effects (compendium audit, 2026-09-27). The Cleric casts on the
 * Fighter (spells added at will for the scenario, removed at the end):
 *  1. Aid (level 2): a single effect, the one for the level cast ("+5 max HP") — the engine placed all eight profiles.
 *  2. Protection from Energy (fire), Enhance Ability (Wisdom), Enlarge/Reduce
 *     (enlarged, failed saving throw): a single effect, the chosen one.
 *  3. Protection from Poison: the Poisoned condition ends; the Fighter then saves with Advantage against an
 *     effect that poisons (the Zombie's Stinking Cloud), the Cleric — who has the spell on his sheet but not the effect — without.
 *  4. Raise Dead: the Fighter, Dead at 0 HP, comes back at 1 HP or more, without the Dead condition.
 * Puts back HP, effects and conditions.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sorts du clerc et du druide — effets au niveau lancé, effets au choix, poison, retour à la vie",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbsplAid0000000", "phbProtectionFro", "phbsplEnhanceAbi", "phbsplEnlargeRed", "phbsplProtection", "phbsplRevivify00"] ) {
      await ctx.ensureItem(cleric, SPELLS + id, atWill);
    }
    await ctx.ensureItem(zombi, SPELLS + "phbsplStinkingCl", atWill);
    const hp0 = await ctx.hp(fighter);
    const clericHp0 = await ctx.hp(cleric);
    const spellEffects = /pv max|Protection|Amélioration|Agrandissement|Rapetissement|concentr|Poison nauséabond/i;
    // The scenario's spell effects, by the spell's id (an effect's name follows the language of the GM's client).
    const SPELL_IDS = ["aid", "protection-from-energy", "enhance-ability", "enlarge-reduce", "protection-from-poison", "revivify", "stinking-cloud"];
    const cleanup = async () => {
      await ctx.removeEffectsNamed(fighter, spellEffects);
      await ctx.removeEffectsNamed(cleric, spellEffects);
      await ctx.removeEffectsFrom(fighter, ...SPELL_IDS);
      await ctx.removeEffectsFrom(cleric, ...SPELL_IDS);
      for ( const s of ["poisoned", "dead"] ) await ctx.call("set-status", { tokenId: fighter.id, statusId: s, active: false }).catch(() => {});
      await ctx.call("set-status", { tokenId: cleric.id, statusId: "poisoned", active: false }).catch(() => {});
      await ctx.setHp(fighter, hp0);
      await ctx.setHp(cleric, clericHp0);
    };
    ctx.restore(cleanup);
    const from = (token, identifier) => ctx.effectsFrom(token, identifier).then(list => list.map(e => ({ ...e, name: e.effect })));
    // The name, in the client's language, of an effect of the Cleric's item (the chosen profile), to recognize it once placed.
    const profileName = async (identifier, effectId) => {
      const item = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).find(i => i.system?.identifier === identifier);
      return (item?.effects ?? []).find(e => (e._id ?? e.id) === effectId)?.name ?? null;
    };
    // `roll`: healing or damage left to the card's button (Aid, Raise Dead) — the author's click, through api.mcp.rollCard.
    const cast = async (identifier, { roll=false, ...params }={}) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, consume: false, targetTokenIds: [fighter.id], ...params });
      if ( roll ) {
        await pause(1200);
        const r = await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(err => ({ error: err.message }));
        if ( !r?.rolled ) ctx.log(`jet de la carte (${identifier}) : ${JSON.stringify(r)}`);
      }
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return used;
    };

    // 1. Aid at level 2: the single "Level 2" profile.
    await cast("aid", { roll: true });
    const aid = await from(fighter, "aid");
    ctx.expect(aid.length === 1, `Aide : un seul effet posé (${aid.map(e => e.name).join(", ") || "aucun"})`);
    await cleanup();

    // 2. Effets au choix.
    const choices = [
      ["protection-from-energy", "DsflUNYKqETaLgxG", "Protection contre l'énergie"],
      ["enhance-ability", "EGnngHgGBzTyThW6", "Amélioration de caractéristique"]
    ];
    for ( const [identifier, choice, label] of choices ) {
      const wanted = await profileName(identifier, choice);
      await cast(identifier, { usageConfig: { [MODULE_ID]: { choice } } });
      const posed = await from(fighter, identifier);
      ctx.expect((posed.length === 1) && (posed[0].name === wanted), `${label} : un seul effet, le choisi « ${wanted} » (${posed.map(e => e.name).join(", ") || "aucun"})`);
      await cleanup();
    }
    // Enlarge: Con saving throw (the Fighter can succeed); we replay until a failure.
    let enlarged = null;
    const enlargeName = await profileName("enlarge-reduce", "Wi2E10l7n6Ka8k6u");
    for ( let n = 1; (n <= 20) && !enlarged; n++ ) {
      await cast("enlarge-reduce", { usageConfig: { [MODULE_ID]: { choice: "Wi2E10l7n6Ka8k6u" } } });
      const posed = await from(fighter, "enlarge-reduce");
      if ( posed.length ) enlarged = posed;
    }
    ctx.expect(enlarged?.length === 1 && (enlarged[0].name === enlargeName), `Agrandissement/rapetissement : un seul effet, « ${enlargeName} » (${enlarged?.map(e => e.name).join(", ") ?? "aucune sauvegarde ratée"})`);
    await cleanup();

    // 3. Protection contre le poison.
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "poisoned", active: true });
    await pause(800);
    await cast("protection-from-poison");
    const statuses = async token => (await ctx.effects(token)).flatMap(e => e.statuses ?? []);
    ctx.expect(!(await statuses(fighter)).includes("poisoned"), "Protection contre le poison : l'état Empoisonné cesse");
    ctx.expect((await from(fighter, "protection-from-poison")).length === 1, "Protection contre le poison : l'effet est posé");
    const saveMode = async target => {
      const used = await ctx.use({ tokenId: zombi.id, identifier: "stinking-cloud", activityType: "save", consume: false, targetTokenIds: [target.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      const save = (await ctx.messagesSince(used.usageMessageId)).find(m => (m.type === "save") && (m.alias === target.name));
      const raw = save?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return { found: !!save, mode: roll?.options?.advantageMode ?? null, formula: roll?.formula ?? "" };
    };
    const protectedSave = await saveMode(fighter);
    ctx.expect(protectedSave.found && (protectedSave.mode === 1), `le Guerrier protégé sauvegarde contre le poison avec l'avantage (${protectedSave.formula}, mode ${protectedSave.mode})`);
    // The `dnd-6` Cleric is a dwarf: Dwarven Resilience (§31) rightly gives him Advantage against Poisoned — the check "the spell
    // does not apply to its caster" is then not done on him.
    const dwarf = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).some(i => i.system?.identifier === "dwarven-resilience");
    const casterSave = await saveMode(cleric);
    if ( dwarf ) ctx.log(`le Clerc est nain (Résistance naine) : avantage attendu de son espèce (${casterSave.formula})`);
    else ctx.expect(casterSave.found && (casterSave.mode !== 1), `le Clerc, qui a le sort mais pas l'effet, sans avantage (${casterSave.formula}, mode ${casterSave.mode})`);
    await cleanup();

    // 4. Raise Dead.
    await ctx.setHp(fighter, 0);
    await ctx.call("set-status", { tokenId: fighter.id, statusId: "dead", active: true });
    await pause(1200);
    await cast("revivify", { roll: true });
    await pause(800);
    const hp = await ctx.hp(fighter);
    ctx.expect(hp >= 1, `Retour à la vie : le Guerrier revient à ${hp} PV`);
    ctx.expect(!(await statuses(fighter)).includes("dead"), "Retour à la vie : l'état Mort est retiré");
  }
};
