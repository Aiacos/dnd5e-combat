/**
 * §342, batch O6 of the item pass: item Reactions. Test arena (Cleric, Fighter).
 *  1. Ring of Evasion worn and attuned: the Fighter fails the Dexterity saving throw against Sacred Flame; the engine offers it
 *     the ring (window on the GM's side, the player not being connected); accepted, the saving throw becomes a success.
 *  2. The ring stowed (neither worn nor attuned): a failure opens no window.
 *  3. Attached rules: Staff of the Acrobat, Missile-Catching Gloves, Ioun Stones of Absorption, Ring of Feather Falling (activity
 *     added on creation).
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o6 — Anneau d'esquive totale (réaction, porté seulement), réactions d'objets attachées",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const flame = await ctx.ensureItem(cleric, `${SPELLS}phbsplSacredFlam`, { system: { method: "atwill" } });
    const ring = await ctx.ensureItem(fighter, `${DMG}dmgRingOfEvasion`);
    const wear = on => ctx.call("upsert-actor-item", { actorId, itemData: { system: { equipped: on, attuned: on } }, match: { path: "_id", value: ring } });

    /** Sacred Flame on the Fighter until a failure; returns { asked, success }: did a ring window open, and the outcome. */
    const failOnce = async answer => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(fighter, hp0);
        const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
        const used = await ctx.use({ tokenId: cleric.id, itemId: flame, activityType: "save", consume: false, targetTokenIds: [fighter.id],
          usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 5000 }).catch(() => null))?.windows
          ?.find(w => /Evasion|esquive/i.test(`${w.title ?? ""} ${w.text ?? ""} ${w.content ?? ""}`)) ?? null;
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: answer });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        const save = r?.targets?.find(t => t.name === "Guerrier")?.save;
        if ( d ) return { asked: true, success: save?.success ?? null };
        if ( save?.success === false ) return { asked: false, success: false };
      }
      return null;
    };

    // 1. Worn and attuned.
    await wear(true);
    await pause(400);
    const worn = await failOnce("pick1");
    ctx.expect(worn?.asked === true, "Anneau porté : la sauvegarde de Dextérité ratée ouvre la fenêtre de l'anneau");
    if ( worn?.asked ) ctx.expect(worn.success === true, `accepté, la sauvegarde est réussie (${worn.success})`);

    // 2. Stowed.
    await wear(false);
    await pause(400);
    const stored = await failOnce("pick0");
    ctx.expect(stored && (stored.asked === false), "Anneau rangé : un échec n'ouvre aucune fenêtre");

    // 3. Attached rules.
    for ( const id of ["dmgQuarterstaffO", "dmgGlovesOfMissi", "dmgAbsorptionIou", "dmgRingOfFeather"] ) await ctx.ensureItem(fighter, `${DMG}${id}`).catch(() => null);
    const rules = Object.fromEntries(((await ctx.engine("identify", { tokenId: fighter.id })) ?? []).map(r => [r.identifier, r]));
    for ( const [id, key] of [["quarterstaff-of-the-acrobat", "triggers"], ["gloves-of-missile-snaring", "triggers"], ["absorption-ioun-stone", "counter"],
      ["ring-of-feather-falling", "triggers"]] ) {
      ctx.expect((rules[id]?.rules ?? []).includes(key), `${id} : ${key} (${(rules[id]?.rules ?? []).join(", ") || "absent"})`);
    }
    const feather = rules["ring-of-feather-falling"];
    if ( feather ) {
      const data = await ctx.engine("itemData", { tokenId: fighter.id, itemId: feather.id, paths: ["system.activities.dasFeatherFall00.name"] });
      ctx.expect(data?.["system.activities.dasFeatherFall00.name"] === "Feather Fall", "Anneau de feuille morte : activité ajoutée à la création");
    }
  }
};
