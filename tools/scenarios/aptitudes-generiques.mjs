/**
 * §278–§281: generic bricks added for the content of other modules (a third-party class automation pack). Synthetic test items
 * lent to the Fighter, their rules placed in the world overlay (`api.mcp.overrideContent`), removed at the end:
 *  1. regain at Initiative (§278): an item's uses come back, a level of Exhaustion goes away, a use paid;
 *  2. condition ending at the start of the turn (§278): Frightened removed at the start of the Fighter's turn, then a level of
 *     Exhaustion;
 *  3. promised maximum damage (§279): an activity promises the maximum on the next attack; on a hit, dice at maximum, cost
 *     returned;
 *  4. next hit at maximum (§279): the Zombie carries an effect from a `maxNextHit` item — the next hit does the maximum,
 *     the effect goes away;
 *  5. grapple (§281): the saving throw against the Fighter's Grapple has Disadvantage (`inescapable`), and the Fighter who
 *     grapples the Zombie has Half Cover against the Sorcerer, not against the Zombie (`grappleCover`).
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ACT_MAX = "essaiMassue00001";
const ACT_PAY = "essaiPayeur00001";
const ITEMS = {
  pugnace: { name: "Essai : pugnace", identifier: "essai-pugnace-das", uses: { max: "1", spent: 0 } },
  secoue: { name: "Essai : se secouer", identifier: "essai-secoue-das", uses: { max: "1", spent: 1 } },
  massue: { name: "Essai : coup de massue", identifier: "essai-massue-das", uses: { max: "3", spent: 0 },
    activities: { [ACT_MAX]: { _id: ACT_MAX, type: "utility", name: "Promesse", activation: { type: "special" },
      consumption: { targets: [{ type: "itemUses", target: "", value: "1" }] } } } },
  danger: { name: "Essai : mise en danger", identifier: "essai-danger-das" },
  poigne: { name: "Essai : poigne", identifier: "essai-poigne-das" }
};
const RULES = {
  "essai-pugnace-das": { regainOnInitiative: { items: ["essai-secoue-das"], exhaustion: 1, uses: true } },
  "essai-secoue-das": { endsOwnConditions: { statuses: ["frightened"], at: "turnStart", exhaustion: true } },
  "essai-massue-das": { maxDamage: { activity: ACT_MAX, refundOnHit: true } },
  "essai-danger-das": { maxNextHit: true },
  "essai-poigne-das": { inescapable: true, grappleCover: "half" }
};

export default {
  name: "aptitudes génériques — regain à l'initiative, fin d'état au début du tour, dégâts maximaux, empoignade (§278–§281)",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const sorc = await ctx.token("Ensorceleur");
    const size = await ctx.gridSize();
    const scene = await ctx.scene();

    // --- Lent items and rules ----------------------------------------------------------------------------------------
    const ids = {};
    for ( const [key, it] of Object.entries(ITEMS) ) {
      const itemData = { name: it.name, type: "feat", img: "icons/svg/upgrade.svg",
        system: { identifier: it.identifier, ...(it.uses ? { uses: it.uses } : {}), ...(it.activities ? { activities: it.activities } : {}) } };
      await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "system.identifier", value: it.identifier } });
      ids[key] = await ctx.itemId(hero.id, it.identifier);
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: ids[key] }).catch(() => {}));
    }
    for ( const [identifier, entry] of Object.entries(RULES) ) {
      const { before } = await ctx.engine("overrideContent", { identifier, entry });
      ctx.restore(() => ctx.engine("overrideContent", { identifier, entry: before }).catch(() => {}));
    }
    const actorOf = () => ctx.call("get-actor", { actorId: hero.actorId });
    const itemOf = async key => (await actorOf()).items.find(i => i._id === ids[key]);
    const exhaustion0 = (await actorOf()).system?.attributes?.exhaustion ?? 0;
    ctx.restore(() => ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.exhaustion": exhaustion0, [`flags.${MODULE_ID}.-=maxDamage`]: null } }).catch(() => {}));
    ctx.restore(() => ctx.removeStatusEffects(hero, "frightened").catch(() => {}));
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    for ( const t of [hero, zombi] ) ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: t.x, y: t.y }).catch(() => {}));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "grappled").catch(() => {}));
    await ctx.call("move-token", { tokenId: hero.id, x: zombi.x - size, y: zombi.y });

    // --- 1. Regain on Initiative ------------------------------------------------------------------------------------
    await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.exhaustion": 2 } });
    await ctx.startCombat([hero, zombi, sorc]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const cid = (await state()).combatants.find(c => c.tokenId === hero.id)?.id;
    await ctx.call("roll-initiative", { combatId: ctx.ownCombat, combatantIds: [cid] });
    await sleep(2500);
    const afterInit = await actorOf();
    ctx.expect((await itemOf("secoue"))?.system?.uses?.spent === 0, `initiative : « se secouer » regagne son utilisation (dépensées ${(await itemOf("secoue"))?.system?.uses?.spent})`);
    ctx.expect(afterInit.system?.attributes?.exhaustion === 1, `initiative : un niveau d'Épuisement retiré (${afterInit.system?.attributes?.exhaustion})`);
    ctx.expect((await itemOf("pugnace"))?.system?.uses?.spent === 1, "initiative : « pugnace » dépense son utilisation");

    // --- 2. Condition ending at the start of the turn ----------------------------------------------------------------
    await ctx.call("set-status", { tokenId: hero.id, statusId: "frightened", active: true });
    const heroTurn = async () => {
      for ( let i = 0; i < 4; i++ ) {
        await ctx.nextTurn();
        await sleep(1500);
        const s = await state();
        if ( s.combatants?.find(c => c.id === s.currentCombatantId)?.tokenId === hero.id ) return true;
      }
      return false;
    };
    ctx.expect(await heroTurn(), "le tour du Guerrier arrive");
    const statuses = async () => (await actorOf()).effects.filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    ctx.expect(!(await statuses()).includes("frightened"), `début du tour : Effrayé retiré (${(await statuses()).join(", ") || "aucun état"})`);
    ctx.expect((await actorOf()).system?.attributes?.exhaustion === 1, "début du tour : l'état passe avant l'Épuisement");
    await heroTurn();
    ctx.expect((await actorOf()).system?.attributes?.exhaustion === 0, `tour suivant, sans état : l'Épuisement baisse (${(await actorOf()).system?.attributes?.exhaustion})`);

    // --- 3. Promised maximum damage ----------------------------------------------------------------------------------
    const weapon = (await actorOf()).items.find(i => (i.type === "weapon") && i.system?.equipped
      && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" && a.attack?.type?.value === "melee"));
    if ( !weapon ) return ctx.expect(false, "le Guerrier a une arme de corps à corps équipée");
    let hit = null;
    for ( let i = 0; (i < 6) && !hit; i++ ) {
      await ctx.setHp(zombi, hp0);
      await ctx.use({ tokenId: hero.id, itemId: ids.massue, activityType: "utility", consume: true });
      await sleep(800);
      const promise = (await actorOf()).flags?.[MODULE_ID]?.maxDamage;
      if ( i === 0 ) ctx.expect(!!promise, "la promesse du maximum est posée");
      const spent = (await itemOf("massue"))?.system?.uses?.spent;
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: hero.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      await sleep(800);
      if ( r.targets?.[0]?.hit ) hit = { since, spent };
      else ctx.expect(!(await actorOf()).flags?.[MODULE_ID]?.maxDamage, `raté (${i + 1}) : la promesse est perdue`);
    }
    if ( !hit ) ctx.expect(false, "aucun coup en six essais");
    else {
      const damage = (await ctx.messagesSince(hit.since)).find(m => m.type === "damage");
      const formula = (damage?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/\(\s*\d+\s*\*\s*\d+\s*\)/.test(formula), `touché : dés au maximum (« ${formula} »)`);
      ctx.expect(!(await actorOf()).flags?.[MODULE_ID]?.maxDamage, "touché : la promesse est tenue, effacée");
      const after = (await itemOf("massue"))?.system?.uses?.spent;
      ctx.expect(after === hit.spent - 1, `touché : l'utilisation est rendue (${hit.spent} → ${after})`);
    }

    // --- 4. Le prochain coup au maximum ------------------------------------------------------------------------------
    const zombiDoc = (await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id })).data;
    const where = zombiDoc.actorLink ? { documentType: "Actor", id: zombiDoc.actorId } : { uuid: `Scene.${scene.sceneId}.Token.${zombi.id}.Actor.${zombiDoc.actorId}` };
    await ctx.call("upsert-embedded-effect", { ...where, effectData: { name: "Essai : en danger", img: "icons/svg/hazard.svg", transfer: false,
      disabled: false, changes: [], origin: `Actor.${hero.actorId}.Item.${ids.danger}` } });
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Essai : en danger/).catch(() => {}));
    let marked = null;
    for ( let i = 0; (i < 6) && !marked; i++ ) {
      await ctx.setHp(zombi, hp0);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: hero.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      await sleep(1200);
      if ( r.targets?.[0]?.hit ) marked = since;
    }
    if ( !marked ) ctx.expect(false, "aucun coup en six essais (mise en danger)");
    else {
      const formula = ((await ctx.messagesSince(marked)).find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/\(\s*\d+\s*\*\s*\d+\s*\)/.test(formula), `en danger : dés au maximum (« ${formula} »)`);
      const left = (await ctx.effects(zombi)).filter(e => e.name === "Essai : en danger").length;
      ctx.expect(left === 0, `en danger : l'effet a servi (${left} restant)`);
    }

    // --- 5. Empoignade -----------------------------------------------------------------------------------------------
    let unarmed = null;
    for ( const until = Date.now() + 6000; !unarmed && (Date.now() < until); await sleep(400) ) {
      unarmed = (await actorOf()).items.find(i => i.flags?.[MODULE_ID]?.basicAction === "unarmed");
    }
    if ( !unarmed ) return ctx.expect(false, "attaque à mains nues posée sur le Guerrier");
    let held = false;
    let formula = "";
    for ( let i = 0; (i < 20) && !held; i++ ) {
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: hero.id, itemId: unarmed._id, activityType: "save", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, saveChoice: "best", choice: "dnd5eCombatGrapl" } } });
      const r = await ctx.settle(used.usageMessageId);
      await sleep(600);
      formula = (await ctx.messagesSince(since)).flatMap(m => m.rolls ?? []).find(x => /d20/.test(x.formula ?? ""))?.formula ?? formula;
      if ( r?.targets?.[0]?.save?.success === false ) held = true;
    }
    ctx.expect(/kl|dis/.test(formula), `sauvegarde contre la Lutte avec le Désavantage (« ${formula} »)`);
    if ( !ctx.expect(held, "le Guerrier agrippe le Zombi") ) return;
    await sleep(1000);
    const fromSorc = await ctx.engine("cover", { attackerId: sorc.id, targetId: hero.id });
    const fromZombi = await ctx.engine("cover", { attackerId: zombi.id, targetId: hero.id });
    ctx.expect(fromSorc?.degree === "half" || fromSorc?.degree === "threeQuarters", `agrippant : abri contre l'Ensorceleur (${fromSorc?.degree ?? "aucun"})`);
    ctx.expect((fromZombi?.degree ?? "none") === "none", `agrippant : pas d'abri contre le Zombi agrippé (${fromZombi?.degree ?? "aucun"})`);
  }
};
