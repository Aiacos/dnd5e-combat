/**
 * §496 (B16) — dissipation bornée : `dispel: { upTo: 3, beyond: "none", keepBySlot: true }`. Arène de test : Magicien (token lié),
 * Clerc, Guerrier. Un trait d'essai est prêté au Magicien (une activité utilitaire qui vise une créature) ; sa règle est posée dans la
 * surcouche du monde (`overrideContent`, jamais en drapeau d'item). Le Clerc reçoit Bénédiction (à volonté) et bénit le Guerrier ; le
 * Magicien vise ensuite le Guerrier avec le trait.
 *  1. Bénédiction lancée au niveau 4 (au-delà du plafond 3) : rien, sans test — carte `dispel` : `resisted` [{ beyond: true, total: null }],
 *     Bénédiction toujours sur le Guerrier, aucune question au Clerc.
 *  2. Bénédiction au niveau 1, le Clerc la garde : la question « garder ? » s'ouvre chez le MJ (le Clerc n'a pas de joueur connecté),
 *     on choisit l'emplacement de niveau 1 (`pick1`) — carte `kept` [{ slot: 1 }], Bénédiction et concentration toujours là, un
 *     emplacement de niveau 1 en moins.
 *  3. Bénédiction au niveau 1, le Clerc la laisse finir (`pick0`) : carte `ended`, Bénédiction et concentration retirées, emplacements
 *     inchangés.
 * Bénédiction et concentration restées d'un passage précédent retirées d'abord (acteurs synthétiques compris) ; emplacements du Clerc,
 * trait, sort, surcouche remis. Toute fenêtre « le faire quand même » ouverte chez le MJ est acceptée (« go »), toute autre fermée.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-dissipation-bornee";
const ACTIVITY = "dasEssaiDissBorn";
// Nom en constante : le banc et la référence prennent le premier « name: » indenté de deux espaces pour le titre du scénario.
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

    // --- Fenêtres chez le MJ : aucune ne reste sans réponse --------------------------------------------------------------
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
    /** La question « garder le sort ? » (titre : le nom du trait), répondue par `button` ; rend vrai si elle a été vue. */
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

    // --- Acteurs : cible directe (acteur lié) ou acteur synthétique du token --------------------------------------------------
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

    // --- Emplacements du Clerc : 4 de niveau 1, remis à la fin --------------------------------------------------------------
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

    // --- Trait prêté, puis règle ----------------------------------------------------------------------------------------------
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
    /** Le trait sur le Guerrier ; `keep` : la réponse à la question « garder ? » (null : aucune question attendue). */
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
