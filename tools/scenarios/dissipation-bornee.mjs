/**
 * §496 (B16) — bounded dispel: `dispel: { upTo: 3, beyond: "none", keepBySlot: true }`. Test arena: Wizard (linked token),
 * Cleric, Fighter. A test feature is lent to the Wizard (a utility activity that targets a creature); its rule is placed in the
 * world overlay (`overrideContent`, never as an item flag). The Cleric receives Bless (at will) and blesses the Fighter; the
 * Wizard then targets the Fighter with the feature.
 *  1. Bless cast at level 4 (beyond the cap 3): nothing, no check — `dispel` card: `resisted` [{ beyond: true, total: null }],
 *     Bless still on the Fighter, no question to the Cleric.
 *  2. Bless at level 1, the Cleric keeps it: the "keep?" question opens on the GM's side (the Cleric has no connected player),
 *     we choose the level 1 slot (`pick1`) — card `kept` [{ slot: 1 }], Bless and concentration still there, one
 *     level 1 spell slot fewer.
 *  3. Bless at level 1, the Cleric lets it end (`pick0`): card `ended`, Bless and concentration removed, spell slots
 *     unchanged.
 * Bless and concentration left over from a previous pass removed first (synthetic actors included); the Cleric's spell slots,
 * feature, spell, overlay restored. Any "do it anyway" window open on the GM's side is accepted ("go"), any other is closed.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-dissipation-bornee";
const ACTIVITY = "dasEssaiDissBorn";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : dissipation bornée";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/magic/symbols/runes-star-pentagon-blue.webp",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §496.</p>" },
    activities: { [ACTIVITY]: { _id: ACTIVITY, type: "utility", activation: { type: "action", value: 1 },
      range: { units: "any", override: true }, target: { affects: { type: "creature", count: "1" } } } } } };
const RULE = { dispel: { upTo: 3, beyond: "none", keepBySlot: true } };

export default {
  name: "dissipation-bornee — rien au-delà du niveau 3 (pas de test), la créature concentrée garde son sort par sa Réaction et un emplacement (§496, brique B16)",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    const need = ["Magicien", "Clerc", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const mage = await ctx.token("Magicien");
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const { data: mTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    if ( !mTok.actorLink ) { ctx.log("Magicien non lié : non applicable (le trait prêté irait à l'acteur de base)"); return; }

    // --- Windows on the GM's side: none stays unanswered ------------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=1500) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };
    /** The "keep the spell?" question (title: the feature's name), answered with `button`; returns true if it was seen. */
    const answerKeep = async (button, ms=12000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: 1500, details: true }).catch(() => null);
        for ( const w of r?.windows ?? [] ) {
          seen.add(w.id);
          const isKeep = String(w.title ?? "").includes(ITEM_NAME) && (w.buttons ?? []).some(b => b.action === "pick1");
          const go = (w.buttons ?? []).find(b => b.action === "go");
          const answer = isKeep ? button : (go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null));
          ctx.log(`fenêtre « ${w.title} » : ${answer ?? "fermée"}`);
          await ctx.call("answer-dialog", { id: w.id, ...(answer ? { button: answer } : {}) }).catch(() => {});
          if ( isKeep ) return true;
        }
      }
      return false;
    };

    // --- Actors: direct target (linked actor) or the token's synthetic actor ---------------------------------------------
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clean = async () => {
      await ctx.removeEffectsFrom(fighter, "bless");
      await ctx.removeEffectsFrom(cleric, "bless");
      await ctx.removeStatusEffects(cleric, "concentrating");
    };
    await clean();
    ctx.restore(clean);

    // --- Cleric's spell slots: 4 of level 1, restored at the end -----------------------------------------------------------
    const { data: cTok } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
    const clericLinked = !!cTok.actorLink;
    const slotsOf = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
      const own = clericLinked ? null : data.delta?.system?.spells?.spell1;
      const base = (await ctx.call("get-actor", { actorId: data.actorId })).system?.spells?.spell1 ?? {};
      return { value: own?.value ?? base.value ?? 0, override: own?.override ?? base.override ?? null };
    };
    const setSlots = (value, override) => clericLinked
      ? ctx.call("update-actor", { actorId: cTok.actorId, actorData: { "system.spells.spell1.override": override, "system.spells.spell1.value": value } })
      : ctx.call("update-scene-object", { type: "Token", objectId: cleric.id, data: { "delta.system.spells.spell1.override": override, "delta.system.spells.spell1.value": value } });
    const slots0 = await slotsOf();
    await setSlots(4, 4);
    ctx.restore(() => setSlots(slots0.value, slots0.override).catch(() => {}));

    // --- Feature lent, then rule ----------------------------------------------------------------------------------------------
    await ctx.call("upsert-actor-item", { actorId: mTok.actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mTok.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    const blessId = await ctx.ensureItem(cleric, PHB + "phbsplBless00000", { system: { method: "atwill" } });

    // --- Gestes -----------------------------------------------------------------------------------------------------------------
    const blessOn = async () => (await ctx.effectsFrom(fighter, "bless")).length;
    const concentrating = async () => (await ctx.effects(cleric)).filter(e => (e.statuses ?? []).includes("concentrating")).length;
    const bless = async level => {
      const used = await ctx.use({ tokenId: cleric.id, itemId: blessId, consume: false, targetTokenIds: [fighter.id], usageConfig: { spell: { slot: `spell${level}` } } });
      await sweep(800);
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return { on: await blessOn(), conc: await concentrating() };
    };
    /** The feature on the Fighter; `keep`: the answer to the "keep?" question (null: no question expected). */
    const dispel = async (keep=null) => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: mage.id, itemId: lent, activityType: "utility", consume: false, targetTokenIds: [fighter.id] });
      const asked = keep ? await answerKeep(keep) : false;
      let card = null;
      for ( const stop = Date.now() + 15000; !card && (Date.now() < stop); await pause(700) ) {
        await sweep(300);
        card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.dispel)?.flags?.[MODULE_ID]?.dispel ?? null;
      }
      await pause(1000);
      return { card, asked };
    };
    const part = async (label, fn) => {
      try { await clean(); await pause(500); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await clean(); await sweep(300); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };

    await part("au-delà du plafond", async () => {
      const cast = await bless(4);
      if ( !ctx.expect(cast.on >= 1 && cast.conc === 1, `Bénédiction au niveau 4 posée (${cast.on}), le Clerc se concentre (${cast.conc})`) ) return;
      const { card } = await dispel();
      const r = card?.resisted?.[0] ?? null;
      ctx.expect(!!r && r.beyond === true && r.total === null && r.level === 4 && !card.ended.length && !card.kept.length,
        `carte : niveau 4 hors de portée, sans test (${JSON.stringify(card)})`);
      ctx.expect((await blessOn()) >= 1 && (await concentrating()) === 1, "Bénédiction et concentration toujours là");
      ctx.expect((await slotsOf()).value === 4, "aucun emplacement dépensé");
    });

    await part("gardée par un emplacement", async () => {
      const cast = await bless(1);
      if ( !ctx.expect(cast.on >= 1 && cast.conc === 1, `Bénédiction au niveau 1 posée (${cast.on}), le Clerc se concentre (${cast.conc})`) ) return;
      const { card, asked } = await dispel("pick1");
      ctx.expect(asked, "la question « garder ? » s'ouvre chez le MJ");
      const k = card?.kept?.[0] ?? null;
      ctx.expect(!!k && k.slot === 1 && k.level === 1 && !card.ended.length && !card.resisted.length, `carte : gardée par un emplacement de niveau 1 (${JSON.stringify(card)})`);
      ctx.expect((await blessOn()) >= 1 && (await concentrating()) === 1, "Bénédiction et concentration toujours là");
      ctx.expect((await slotsOf()).value === 3, `un emplacement de niveau 1 en moins (${(await slotsOf()).value})`);
    });

    await setSlots(4, 4);
    await part("laissée finir", async () => {
      const cast = await bless(1);
      if ( !ctx.expect(cast.on >= 1 && cast.conc === 1, `Bénédiction au niveau 1 posée (${cast.on}), le Clerc se concentre (${cast.conc})`) ) return;
      const { card, asked } = await dispel("pick0");
      ctx.expect(asked, "la question « garder ? » s'ouvre chez le MJ");
      ctx.expect(card?.ended?.length === 1 && !card.kept.length && !card.resisted.length, `carte : prend fin (${JSON.stringify(card)})`);
      ctx.expect((await blessOn()) === 0 && (await concentrating()) === 0, "Bénédiction et concentration retirées");
      ctx.expect((await slotsOf()).value === 4, "emplacements inchangés");
    });
  }
};
