/**
 * §436: dnd5e 6.1 antimagic held by the engine, `dnd-6` world, arena (like `releve-sorts-8`). Spells lent from the Player's
 * Handbook (at will). The Handbook's Antimagic Field lacks the SRD 6.1 region behavior: the engine adds it, dnd5e then places
 * the `antimagic` status.
 *  1. Cleric's Bless on the Fighter, far from the field: the applied effect is marked magical.
 *  2. The Wizard casts the Field: the region carries `dnd5e.antimagic`, the Wizard has the status.
 *  3. The Fighter enters the field: status, Bless suspended; he leaves it: no more status, Bless restored.
 *  4. The Zombie, outside, casts Sacred Flame on the Wizard: unaffected (reason `antimagic`), HP unchanged.
 *  4 bis. Telekinetic Thrust (Monster Manual, ability said to be magical): no effect on the Wizard;
 *     refused to the Zombie in the field.
 *  5. The Wizard casts Fire Bolt (one target; Magic Missile would first open projectile aiming): legality window —
 *     "Give up": nothing; "Use anyway": card marked `overridden` (the field's reason), alert to the GM.
 *  6. The Fighter, in the field, hits the Bandit with a nonmagical weapon: no legality issue, the attack resolves.
 * Restores positions, effects, HP.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "antimagie de dnd5e 6.1 — statut lu, effets suspendus, sort refusé et forçable, attaque ordinaire",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Clerc", "Guerrier", "Bandit", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, cleric, fighter, bandit, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, cleric, fighter, bandit, zombi];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const legality = async (who, ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${who.name}`));
        if ( d ) return d;
      }
      return null;
    };
    const reset = async () => {
      const d = await legality(mage, 300);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    };
    ctx.restore(reset);
    const lend = (t, id) => ctx.ensureItem(t, PHB + id, { system: { method: "atwill" } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(1200); };
    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));
    const bless = async () => (await ctx.effectsFrom(fighter, "bless")).find(e => !(e.statuses ?? []).includes("concentrating")) ?? null;
    const weaponOf = async t => ((await ctx.call("get-actor", { actorId: t.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && !(i.system?.properties ?? []).includes("mgc")
        && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack" && a.attack?.type?.value === "melee"))?._id ?? null;

    const m = homes.get(mage.id).pos;
    await place(fighter, m.x - 6 * grid, m.y);
    await place(cleric, m.x - 7 * grid, m.y);
    await place(zombi, m.x + 5 * grid, m.y);
    await place(bandit, m.x + 2 * grid, m.y);

    // 1. Bless, far from the field.
    const blessId = await lend(cleric, "phbsplBless00000");
    const b = await ctx.use({ tokenId: cleric.id, itemId: blessId, targetTokenIds: [fighter.id], consume: false });
    if ( b.usageMessageId ) await ctx.settle(b.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    let blessed = await bless();
    if ( !ctx.expect(!!blessed, "Bénédiction posée sur le Guerrier") ) return;
    ctx.expect(blessed.magical === true, `l'effet de Bénédiction (sort du Manuel) est marqué magique (magical=${blessed.magical})`);

    // 2. Le Champ.
    const field = await lend(mage, "phbsplAntimagicF");
    // Engine placement without a click (§47), as at the table: the connector alone (`use-activity`) cuts template placement.
    const used = await ctx.engine("use", { tokenId: mage.id, itemId: field, activityType: "utility" });
    for ( const r of used.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    const regions = used.regions ?? [];
    const fieldRegion = await (async () => {
      for ( const r of regions ) {
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: r.id }).catch(() => ({ data: null }));
        if ( (data?.behaviors ?? []).some(x => x.type === "dnd5e.antimagic") ) return data;
      }
      return null;
    })();
    ctx.expect(!!fieldRegion, `la région du Champ porte le comportement « dnd5e.antimagic » (${regions.length} région(s))`);
    ctx.expect((await statuses(mage)).has("antimagic"), "le Magicien porte le statut « antimagic »");

    // 3. Le Guerrier entre, puis sort.
    await place(fighter, m.x - grid, m.y);
    await pause(1000);
    blessed = await bless();
    ctx.expect((await statuses(fighter)).has("antimagic") && blessed?.suppressed === true,
      `dans le champ : statut et Bénédiction suspendue (suppressed=${blessed?.suppressed})`);
    await place(fighter, m.x - 6 * grid, m.y);
    await pause(1000);
    blessed = await bless();
    ctx.expect(!(await statuses(fighter)).has("antimagic") && blessed?.suppressed === false,
      `hors du champ : plus de statut, Bénédiction rétablie (suppressed=${blessed?.suppressed})`);

    // 4. Sacred Flame from outside on the Wizard.
    const flame = await lend(zombi, "phbsplSacredFlam");
    const hp = await ctx.hp(mage);
    const f = await ctx.use({ tokenId: zombi.id, itemId: flame, targetTokenIds: [mage.id], consume: false });
    if ( f.usageMessageId ) await ctx.settle(f.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    const log = (await ctx.engineLog()).filter(l => /unaffected/.test(l) && /\(antimagic/.test(l));
    ctx.expect(log.length > 0 && ((await ctx.hp(mage)) === hp), `Flamme sacrée sur le Magicien dans le champ → ${log.at(-1) ?? "rien au journal"}`);

    // 4 bis. A monster ability said to be magical (content/antimagic.mjs): the Poltergeist's Telekinetic Thrust, from the Monster
    // Manual — from outside on the Wizard: unaffected; from the field: the field's issue.
    const thrust = await ctx.ensureItem(zombi, "Compendium.dnd-monster-manual.actors.Actor.mmPoltergeist000.Item.mmTelekineticThr").catch(() => null);
    if ( thrust ) {
      const t = await ctx.use({ tokenId: zombi.id, itemId: thrust, targetTokenIds: [mage.id], consume: false });
      if ( t.usageMessageId ) await ctx.settle(t.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(1500);
      const tlog = (await ctx.engineLog()).filter(l => /unaffected/.test(l) && /\(antimagic/.test(l) && /Telekinetic|télékinétique/i.test(l));
      ctx.expect(tlog.length > 0, `Poussée télékinétique sur le Magicien dans le champ → ${tlog.at(-1) ?? "rien au journal"}`);
      await place(zombi, m.x, m.y + grid);
      const tIssues = await ctx.engine("issues", { tokenId: zombi.id, itemId: thrust });
      ctx.expect(tIssues.some(l => /no power inside|aucun pouvoir/i.test(l)), `dans le champ, la Poussée télékinétique est refusée (${tIssues.join(" ; ") || "aucun souci"})`);
      await place(zombi, m.x + 5 * grid, m.y);
    } else ctx.log("Manuel des monstres absent : capacité de monstre non jouée");

    // 5. Fire Bolt from the field: refused, forceable.
    const missile = await lend(mage, "phbsplFireBolt00");
    const issues = await ctx.engine("issues", { tokenId: mage.id, itemId: missile });
    ctx.expect(issues.some(l => /no spell can be cast|aucun sort/i.test(l)), `le souci du champ (${issues.join(" ; ") || "aucun souci"})`);
    const alerts = messages => messages.filter(msg => msg.flags?.[MODULE_ID]?.gmAlert);
    const usages = messages => messages.filter(msg => (msg.type === "usage") && (msg.flags?.[MODULE_ID]?.overridden?.length));
    // Like an engine click (`engine use`): dnd5e 6.1 would flatly refuse the spell (`requireMagic`), the engine's window
    // comes first.
    const attempt = async button => {
      const since = await ctx.lastMessageId();
      ctx.engine("use", { tokenId: mage.id, itemId: missile, activityType: "attack" }).catch(() => null);
      const d = await legality(mage);
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button });
      if ( button === "go" ) {
        // Another legality reason (no target designated…): overridden too, the card keeps the field's reason.
        const more = await legality(mage, 2500);
        if ( more ) await ctx.call("answer-dialog", { id: more.id, button: "go" });
      }
      await pause(button === "go" ? 3500 : 1500);
      return ctx.messagesSince(since);
    };
    let after = await attempt("cancel");
    if ( ctx.expect(!!after, "Trait de feu dans le champ : la fenêtre de légalité s'ouvre") ) {
      ctx.expect(!usages(after).length && !alerts(after).length, `renoncé : ni carte, ni alerte (${after.length} message(s))`);
    }
    after = await attempt("go");
    if ( ctx.expect(!!after, "la fenêtre se rouvre") ) {
      const reasons = usages(after)[0]?.flags?.[MODULE_ID]?.overridden ?? [];
      ctx.expect(reasons.some(r => /no spell can be cast|aucun sort/i.test(r)), `forcé : la carte porte la raison du champ (${reasons.join(" | ")})`);
      const text = alerts(after)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
      ctx.expect(!!text && /no spell can be cast|aucun sort/i.test(text), `une alerte au MJ, avec la raison du champ (${text})`);
      const card = usages(after)[0];
      if ( card ) await ctx.settle(card._id ?? card.id, { timeoutMs: 30000 }).catch(() => null);
    }

    // 6. A nonmagical attack in the field.
    await place(fighter, m.x + grid, m.y);
    const weapon = await weaponOf(fighter);
    if ( ctx.expect(!!weapon, "le Guerrier a une arme de corps à corps non magique") ) {
      const wIssues = await ctx.engine("issues", { tokenId: fighter.id, itemId: weapon });
      ctx.expect(!wIssues.some(l => /antimag|no spell|aucun sort|no power|aucun pouvoir/i.test(l)), `aucun souci d'antimagie (${wIssues.join(" ; ") || "aucun souci"})`);
      const a = await ctx.use({ tokenId: fighter.id, itemId: weapon, activityType: "attack", targetTokenIds: [bandit.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
      const res = a.usageMessageId ? await ctx.settle(a.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
      const step = res?.step ?? (a.usageMessageId ? (await ctx.resolution(a.usageMessageId).catch(() => null))?.step : null);
      ctx.expect(["done", "missed", "applied"].includes(step), `l'attaque du Guerrier se résout (étape ${step ?? "?"})`);
    }

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
