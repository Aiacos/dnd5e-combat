/**
 * §447 — Le lot C12 de Ravenloft (module premium `dnd-ravenloft-horrors-within`, pack `options`), aptitudes prêtées aux personnages de
 * l'arène (comme `sous-classes-ravenloft`) :
 *  - Forme ombrale (Ensorceleur) : l'activité pose l'effet de l'item (donnée corrigée) — Résistances, `transformed` ; puis Trait de feu sur
 *    le Bandit avec l'Avantage (celui de la Sorcellerie innée).
 *  - Toucher de la mort (Occultiste) : le Bandit résiste au nécrotique ; Contact glacial du Manuel : dégâts réduits de moitié ; Contact
 *    glacial lancé par le don : dégâts entiers.
 *  - Courroux sauvage (Rôdeur) : l'Aura troublante dès la transformation (`atStart`) ; le Bandit le blesse — Représailles rôdeuses proposées,
 *    une attaque d'arme contre lui ; Neutralisé : la forme cesse (l'enchantement retiré).
 *  - Seconde peau (Guerrier) : Modification d'apparence lancée par le don, sans Concentration.
 */
const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Ravenloft, lot C12 — Forme ombrale, Toucher de la mort, Courroux sauvage (aura, Représailles, fin), Seconde peau",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Ensorceleur", "Occultiste", "Rôdeur", "Guerrier", "Bandit"];
    if ( !need.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const T = {};
    for ( const n of need ) T[n] = await ctx.token(n);
    const grid = await ctx.gridSize();
    for ( const t of Object.values(T) ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const bandit = T.Bandit;
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const delta0 = bdata.delta?.system ?? {};
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: {
      "delta.system.attributes.hp.max": delta0.attributes?.hp?.max ?? null, "delta.system.traits.dr.value": delta0.traits?.dr?.value ?? [] } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const lend = async (t, id) => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: r.id }).catch(() => {}));
      await pause(1000);
      return r.id;
    };
    const actorOf = t => ctx.call("get-actor", { actorId: t.actorId });
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (ids, re, ms=9000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return { labels: (d.buttons ?? []).map(x => x.label) }; }
        }
      }
      return null;
    };
    const place = async (t, dx, dy, ref) => { const p = await ctx.position(ref); await ctx.call("move-token", { tokenId: t.id, x: p.x + dx * grid, y: p.y + dy * grid, elevation: 0 }); };
    const changesOf = e => e.system?.changes ?? e.changes ?? [];

    // 1. Forme ombrale.
    const sorcerer = T.Ensorceleur;
    await place(bandit, 2, 0, sorcerer);
    await ctx.ensureItem(sorcerer, "Compendium.dnd-players-handbook.classes.Item.phbscrInnateSorc");
    const umbral = await lend(sorcerer, "rhwSSUmbralForQw");
    const umbralItem = ((await actorOf(sorcerer)).items ?? []).find(i => i._id === umbral);
    ctx.expect((umbralItem?.system?.activities?.kkoILNOHSzVHTCZX?.effects ?? []).some(e => e._id === "vAfLEL8A1fNW5JWb"),
      "Forme ombrale : l'activité porte l'effet de l'item (donnée corrigée à la création)");
    await ctx.use({ tokenId: sorcerer.id, itemId: umbral, activityId: "kkoILNOHSzVHTCZX", targetTokenIds: [sorcerer.id] }).catch(err => ctx.log(`Forme ombrale : ${err.message}`));
    ctx.restore(() => ctx.removeEffectsNamed(sorcerer, /Umbral|ombral|Innate|innée/i));
    let shadow = null;
    for ( let w = 0; (w < 20) && !shadow; w++ ) { await pause(500); shadow = (await ctx.effects(sorcerer)).find(e => !e.disabled && /Umbral|ombral/i.test(e.name ?? "")); }
    if ( ctx.expect(!!shadow, "Forme ombrale : l'effet est sur l'Ensorceleur") ) {
      ctx.expect(changesOf(shadow).some(c => (c.key === "system.traits.dr.value") && (c.value === "slashing")) && (shadow.statuses ?? []).includes("transformed"),
        "Forme ombrale : Résistances et état « transformé »");
      const bolt = await ctx.ensureItem(sorcerer, PHB + "phbsplFireBolt00", { system: { method: "atwill" } });
      await tough();
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: sorcerer.id, itemId: bolt, activityType: "attack", targetTokenIds: [bandit.id] }).catch(() => null);
      await pause(4000);
      const atk = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      ctx.expect(atk?.rolls?.[0]?.options?.advantageMode === 1, `Trait de feu sous la Forme ombrale : l'Avantage (mode ${atk?.rolls?.[0]?.options?.advantageMode})`);
    }

    // 2. Toucher de la mort : le Bandit résiste au nécrotique.
    const warlock = T.Occultiste;
    await place(bandit, 1, 0, warlock);
    await pause(800);
    /** Lance une attaque jusqu'à toucher ; rend { dealt, rolled } (PV perdus, total du jet de dégâts). */
    const necroticHit = async use => {
      for ( let n = 0; n < 10; n++ ) {
        await tough();
        await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.traits.dr.value": ["necrotic"] } });
        await pause(500);
        const before = await ctx.hp(bandit);
        const since = await ctx.lastMessageId();
        const u = await use().catch(err => { ctx.log(`lancement : ${err.message}`); return null; });
        await pause(1500);
        // Une activité « cast » rend son propre message : celui du sort lancé (sa copie sur la fiche) est le dernier message d'utilisation.
        const usage = (await ctx.messagesSince(since)).filter(m => m.type === "usage").at(-1)?.id ?? u?.usageMessageId;
        if ( !usage ) { ctx.log("aucun message d'utilisation"); return null; }
        const r = await ctx.settle(usage, { timeoutMs: 45000 }).catch(err => { ctx.log(`issue non lue : ${err.message}`); return null; });
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) {
          if ( n === 0 ) ctx.log(`  essai : rendu ${JSON.stringify(Object.keys(u ?? {}))}, message ${usage}${usage === u?.usageMessageId ? " (celui du lancement)" : ""}, cibles ${JSON.stringify(r?.targets ?? null)}`);
          continue;
        }
        await pause(3000);
        const dmg = (await ctx.messagesSince(usage)).filter(m => m.type === "damage").at(-1);
        const rolled = (dmg?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
        return { dealt: before - (await ctx.hp(bandit)), rolled };
      }
      return null;
    };
    const chill = await ctx.ensureItem(warlock, PHB + "phbsplChillTouch", { system: { method: "atwill" } });
    const plain = await necroticHit(() => ctx.use({ tokenId: warlock.id, itemId: chill, activityType: "attack", targetTokenIds: [bandit.id] }));
    if ( ctx.expect(!!plain, "Contact glacial du Manuel : un coup") ) ctx.expect(plain.dealt === Math.floor(plain.rolled / 2), `Résistance appliquée : ${plain.rolled} → ${plain.dealt} PV perdus`);
    const death = await lend(warlock, "rhwTouchofDeathA");
    // La copie du sort que l'activité « cast » crée sur la fiche (`flags.dnd5e.cachedFor` = …Activity.UZVF…) : le lancement l'utilise ;
    // le connecteur ne lance que le jet de l'activité qu'il utilise, donc l'attaque de la copie est utilisée directement (même chemin).
    const cachedOf = async (t, activityId) => ((await actorOf(t)).items ?? []).find(i => String(i.flags?.dnd5e?.cachedFor ?? "").endsWith(activityId));
    if ( !(await cachedOf(warlock, "UZVFEmVZMhLRl5vD")) ) {
      await ctx.use({ tokenId: warlock.id, itemId: death, activityId: "UZVFEmVZMhLRl5vD", targetTokenIds: [bandit.id] }).catch(() => null);
      await pause(1500);
    }
    const copy = await cachedOf(warlock, "UZVFEmVZMhLRl5vD");
    ctx.log(`Toucher de la mort : copie du sort ${copy ? `« ${copy.name} »` : "absente"}`);
    const viaFeat = copy ? await necroticHit(() => ctx.use({ tokenId: warlock.id, itemId: copy._id, activityType: "attack", targetTokenIds: [bandit.id] })) : null;
    if ( ctx.expect(!!viaFeat, "Contact glacial lancé par Toucher de la mort : un coup") ) {
      ctx.expect(viaFeat.dealt === viaFeat.rolled, `Toucher de la mort : la Résistance ignorée (${viaFeat.rolled} → ${viaFeat.dealt} PV perdus)`);
    }
    // Le même sort du Manuel, don présent : toujours réduit (« ce sort seulement »).
    const still = await necroticHit(() => ctx.use({ tokenId: warlock.id, itemId: chill, activityType: "attack", targetTokenIds: [bandit.id] }));
    if ( still ) ctx.expect(still.dealt === Math.floor(still.rolled / 2), `Contact glacial du Manuel, don présent : réduit (${still.rolled} → ${still.dealt})`);
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.traits.dr.value": delta0.traits?.dr?.value ?? [] } });

    // 3. Courroux sauvage.
    const ranger = T["Rôdeur"];
    await place(bandit, 1, 0, ranger);
    await pause(800);
    const tempmax0 = (await actorOf(ranger)).system?.attributes?.hp?.tempmax ?? 0;
    await ctx.call("update-actor", { actorId: ranger.actorId, actorData: { "system.attributes.hp.tempmax": 100 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: ranger.actorId, actorData: { "system.attributes.hp.tempmax": tempmax0 } }));
    const wrath = await lend(ranger, "rhwHWWrathofth3C");
    const since3 = await ctx.lastMessageId();
    await ctx.engine("use", { tokenId: ranger.id, itemId: wrath, activityType: "enchant" }).catch(err => ctx.log(`transformation : ${err.message}`));
    await pause(4000);
    const enchanted = async () => ((await actorOf(ranger)).items ?? []).find(i => i._id === wrath)?.effects?.some(e => (e.type === "enchantment") && !e.disabled) ?? false;
    ctx.log(`Courroux sauvage : enchantement ${await enchanted() ? "actif" : "absent"}`);
    const aura = (await ctx.messagesSince(since3)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.moment === "atStart"));
    if ( ctx.expect(!!aura, "Aura troublante dès la transformation (§447)") ) {
      const r = await ctx.settle(aura.id, { timeoutMs: 45000 }).catch(() => null);
      ctx.expect(r?.plan?.save?.ability === "wis" && (r?.targets ?? []).some(t => t.name === "Bandit"), `Sagesse du Bandit (${r?.targets?.map(t => t.name).join(", ")})`);
    }
    // Représailles rôdeuses : le Bandit le blesse.
    let retaliated = null;
    for ( let n = 0; (n < 30) && !retaliated; n++ ) {   // l'Armure ancestrale relève sa CA : le Bandit rate souvent
      await ctx.setHp(ranger, 80);   // maximum relevé plus haut : un critique ne le met pas à 0 (à 0 PV, pas de réaction)
      const ids = await known();
      // `autoReact: "ask"` : la fenêtre « blessé » s'ouvre (l'outil la ferme d'office, `none`) ; la question est répondue plus bas.
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [ranger.id],
        usageConfig: { [MODULE_ID]: { autoReact: "ask" } } }).catch(() => null);
      if ( !u?.usageMessageId ) break;
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Rôdeur")?.hit !== true ) continue;
      const asked = await answer(ids, /Wrath|Courroux/i, 9000);
      await pause(5000);
      // L'attaque de Représailles, lue dans le journal du moteur (« attack N → Bandit » du Rôdeur, après la fenêtre).
      const lines = await ctx.engineLog();
      const window = lines.findLastIndex(l => /Rôdeur is damaged: reaction window/.test(l));
      const back = (window >= 0) && lines.slice(window).some(l => /attack \d+ → Bandit/.test(l));
      retaliated = { asked: !!asked, back: !!back };
    }
    if ( ctx.expect(!!retaliated?.asked, "Représailles rôdeuses proposées quand le Bandit blesse le Rôdeur transformé") ) {
      ctx.expect(retaliated.back, "Représailles rôdeuses : une attaque d'arme du Rôdeur contre le Bandit");
    }
    // Neutralisé : la forme cesse.
    if ( await enchanted() ) {
      await ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: true });
      ctx.restore(() => ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: false }).catch(() => {}));
      let ended = false;
      for ( let w = 0; (w < 16) && !ended; w++ ) { await pause(500); ended = !(await enchanted()); }
      ctx.expect(ended, "Courroux sauvage : Neutralisé, la transformation cesse (§447)");
      await ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: false });
    }

    // 4. Seconde peau : Modification d'apparence lancée par le don, sans Concentration.
    const fighter = T.Guerrier;
    const skin = await lend(fighter, "rhwSecondSkinkc1");
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Alter|apparence|concentr/i));
    // La copie du sort sur la fiche (`flags.dnd5e.cachedFor`) : dnd5e lui retire les propriétés que l'activité « cast » liste.
    const cached = ((await actorOf(fighter)).items ?? []).find(i => String(i.flags?.dnd5e?.cachedFor ?? "").endsWith("ZrjtFFSbJZTj8Cfm"));
    ctx.log(`Seconde peau : copie du sort ${cached ? `« ${cached.name} », propriétés ${JSON.stringify(cached.system?.properties ?? [])}` : "absente"}`);
    // Modification d'apparence a trois activités (dnd5e demande laquelle, dans une liste) : celle de « Change Appearance » de la copie.
    const appearance = Object.entries(cached?.system?.activities ?? {}).find(([, a]) => /Appearance|apparence/i.test(a.name ?? ""))?.[0];
    const sinceSkin = await ctx.lastMessageId();
    if ( cached && appearance ) await ctx.use({ tokenId: fighter.id, itemId: cached._id, activityId: appearance, targetTokenIds: [fighter.id] }).catch(err => ctx.log(`Seconde peau : ${err.message}`));
    else ctx.log("Seconde peau : activité « Change Appearance » de la copie introuvable");
    await pause(3000);
    const effects = await ctx.effects(fighter);
    ctx.log(`Seconde peau : effets ${effects.map(e => e.name).join(", ") || "aucun"}`);
    const cast2 = (await ctx.messagesSince(sinceSkin)).some(m => m.type === "usage");
    ctx.expect(cast2, "Seconde peau : Modification d'apparence lancée par le don (sa carte d'utilisation)");
    const concentrating = effects.some(e => (e.statuses ?? []).includes("concentrating"));
    ctx.expect(!concentrating, "Seconde peau : sans Concentration");
  }
};
