/**
 * §447 — Ravenloft's batch C12 (premium module `dnd-ravenloft-horrors-within`, pack `options`), features lent to the characters of
 * the arena (like `sous-classes-ravenloft`):
 *  - Umbral Form (Sorcerer): the activity places the item's effect (corrected data) — Resistances, `transformed`; then Fire Bolt on
 *    the Bandit with Advantage (that of Innate Sorcery).
 *  - "Death's Touch" (Warlock): the Bandit resists necrotic; the Manual's Chill Touch: damage halved; Chill Touch cast by the
 *    feature: full damage.
 *  - "Wild Wrath" (Ranger): the "Unsettling Aura" from the transformation (`atStart`); the Bandit wounds them — "Ranger's Reprisal"
 *    offered, a weapon attack against it; Incapacitated: the form ends (the enchantment removed).
 *  - "Second Skin" (Fighter): Alter Self cast by the feature, without Concentration.
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

    // 2. Death's Touch: the Bandit resists necrotic.
    const warlock = T.Occultiste;
    await place(bandit, 1, 0, warlock);
    await pause(800);
    /** Casts an attack until it hits; returns { dealt, rolled } (HP lost, damage roll total). */
    const necroticHit = async use => {
      for ( let n = 0; n < 10; n++ ) {
        await tough();
        await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.traits.dr.value": ["necrotic"] } });
        await pause(500);
        const before = await ctx.hp(bandit);
        const since = await ctx.lastMessageId();
        const u = await use().catch(err => { ctx.log(`lancement : ${err.message}`); return null; });
        await pause(1500);
        // A "cast" activity returns its own message: the one of the spell cast (its copy on the sheet) is the last use message.
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
    // The copy of the spell that the "cast" activity creates on the sheet (`flags.dnd5e.cachedFor` = …Activity.UZVF…): the
    // casting uses it; the connector only rolls the roll of the activity it uses, so the copy's attack is used directly
    // (same path).
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
    // The same Manual spell, feature present: still reduced ("this spell only").
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
    // Ranger's Reprisal: the Bandit wounds them.
    let retaliated = null;
    for ( let n = 0; (n < 30) && !retaliated; n++ ) {   // Ancestral Armor raises its AC: the Bandit often misses
      await ctx.setHp(ranger, 80);   // maximum raised higher: a critical does not put it at 0 (at 0 HP, no Reaction)
      const ids = await known();
      // `autoReact: "ask"`: the "wounded" window opens (the tool closes it by default, `none`); the question is answered below.
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [ranger.id],
        usageConfig: { [MODULE_ID]: { autoReact: "ask" } } }).catch(() => null);
      if ( !u?.usageMessageId ) break;
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Rôdeur")?.hit !== true ) continue;
      const asked = await answer(ids, /Wrath|Courroux/i, 9000);
      await pause(5000);
      // The Reprisal attack, read in the engine's journal (the Ranger's "attack N → Bandit", after the window).
      const lines = await ctx.engineLog();
      const window = lines.findLastIndex(l => /Rôdeur is damaged: reaction window/.test(l));
      const back = (window >= 0) && lines.slice(window).some(l => /attack \d+ → Bandit/.test(l));
      retaliated = { asked: !!asked, back: !!back };
    }
    if ( ctx.expect(!!retaliated?.asked, "Représailles rôdeuses proposées quand le Bandit blesse le Rôdeur transformé") ) {
      ctx.expect(retaliated.back, "Représailles rôdeuses : une attaque d'arme du Rôdeur contre le Bandit");
    }
    // Incapacitated: the form ends.
    if ( await enchanted() ) {
      await ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: true });
      ctx.restore(() => ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: false }).catch(() => {}));
      let ended = false;
      for ( let w = 0; (w < 16) && !ended; w++ ) { await pause(500); ended = !(await enchanted()); }
      ctx.expect(ended, "Courroux sauvage : Neutralisé, la transformation cesse (§447)");
      await ctx.call("set-status", { tokenId: ranger.id, statusId: "incapacitated", active: false });
    }

    // 4. Second Skin: Alter Self cast by the feature, without Concentration.
    const fighter = T.Guerrier;
    const skin = await lend(fighter, "rhwSecondSkinkc1");
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Alter|apparence|concentr/i));
    // The spell copy on the sheet (`flags.dnd5e.cachedFor`): dnd5e removes from it the properties that the "cast" activity lists.
    const cached = ((await actorOf(fighter)).items ?? []).find(i => String(i.flags?.dnd5e?.cachedFor ?? "").endsWith("ZrjtFFSbJZTj8Cfm"));
    ctx.log(`Seconde peau : copie du sort ${cached ? `« ${cached.name} », propriétés ${JSON.stringify(cached.system?.properties ?? [])}` : "absente"}`);
    // Alter Self has three activities (dnd5e asks which, in a list): the one of the copy's "Change Appearance".
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
