/**
 * §448: the Wand of Magic Missiles (SRD 2024), a spell with projectiles cast by an item, from the DAS · Combat UI Bar and
 * with the engine's multiple aiming — like with the mouse: the Bar cell (`barUse`), dnd5e's level window, then one click per
 * projectile (`pickTarget` of ui/pointer.mjs, what a click on a creature calls during aiming). World `dnd-6`, arena.
 *  A. Outside the field: 3 projectiles, 3 cards, ONE charge of the wand (before: one per projectile, 3 for a cast).
 *  B. Inside the Wizard's Antimagic Field, "Use anyway": the 3 projectiles go (before: nothing went after aiming,
 *     the field was only lifted for the first use), card marked with the field's reason, ONE GM alert, one charge, the
 *     status still there afterwards.
 *  C. Double click on a cell refused by the field (Fire Bolt): a single "do it anyway" window, a single card.
 *  D. Replay of the stuck status (seen once on 2026-11-14): the Bandit enters the field, forces the wand, leaves — the status
 *     goes away. Replayed on 2026-11-15: the status goes away as soon as the token really leaves; the "stuck" one was a
 *     refused move (the token left in the field). Each of the Bandit's moves is therefore checked.
 * Resets positions, effects, HP; the lent wand and Fire Bolt are removed.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const WAND = "Compendium.dnd5e.equipment24.Item.dmgWandOfMagicMi";
const VICTIM = "Cible humanoïde";
const FIELD_REASON = /no spell can be cast|aucun sort|no power inside|aucun pouvoir|magic item|objet magique/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** On the GM's client: is the engine's multiple aiming open (and for how many projectiles)? */
const PICKING = `
const m = await import("/modules/dnd5e-combat/scripts/ui/pointer.mjs");
return m.picking ? { count: m.picking.count, done: m.picking.picks.length, item: m.picking.activity?.item?.name ?? null } : null;
`;
/** On the GM's client: one click per projectile on these tokens, like the mouse during aiming (`pickTarget(hover)`). */
const PICK = `
const m = await import("/modules/dnd5e-combat/scripts/ui/pointer.mjs");
const clicked = [];
for ( const id of args.ids ) {
  if ( !m.picking ) break;
  m.pickTarget(canvas.scene.tokens.get(id));
  clicked.push(id);
  await new Promise(r => setTimeout(r, 250));
}
return { clicked, open: !!m.picking };
`;
/** On the GM's client: the charges spent from an item of a token, and its antimagic effects (active or lifted). */
const STATE = `
const actor = canvas.scene.tokens.get(args.tokenId)?.actor;
const item = args.itemId ? actor?.items.get(args.itemId) : null;
return { spent: item?.system?.uses?.spent ?? null,
  antimagic: (actor?.effects ?? []).filter(e => e.statuses?.has("antimagic")).map(e => ({ id: e.id, disabled: e.disabled })) };
`;

export default {
  name: "baguette antimagie — projectiles d'un objet : une charge, forçables dans le champ jusqu'au bout, un seul double clic",

  async run(ctx) {
    await ctx.cast({ [VICTIM]: "mmBanditCaptain0" }, { near: "Magicien" });
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Bandit", VICTIM];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, bandit, victim] = await Promise.all(names.map(n => ctx.token(n)));
    const homes = new Map();
    for ( const t of [mage, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t),
      effects: new Set((await ctx.effects(t)).map(e => e._id ?? e.id)) });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    // Not `dialogsOnly`: dnd5e's level window ("Magic Missile", button "use") is an application, not a dialog.
    const dialogs = async () => ((await ctx.call("list-dialogs", { waitMs: 600 }).catch(() => null))?.windows ?? []);
    const ours = w => (w.title ?? "").endsWith(` — ${mage.name}`) || (w.title ?? "").endsWith(` — ${bandit.name}`) || (w.buttons ?? []).some(b => b.action === "use");
    ctx.restore(async () => {
      for ( const d of (await dialogs()).filter(ours) ) await ctx.call("answer-dialog", { id: d.id, button: (d.buttons ?? []).some(b => b.action === "cancel") ? "cancel" : "close" }).catch(() => {});
      for ( const t of [mage, bandit] ) {
        const h = homes.get(t.id);
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !h.effects.has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    });
    const grid = await ctx.gridSize();
    const m = homes.get(mage.id).pos;
    await ctx.call("move-token", { tokenId: victim.id, x: m.x + 6 * grid, y: m.y, elevation: 0 });
    // The Bandit waits outside the field, on a clear path (a refused move leaves the token in the field: seen on 2026-11-15, the
    // exit downward went through a refused cell, `moved: false` — that was the "stuck status" of the 2026-11-14 check).
    const outside = { x: m.x + 7 * grid, y: m.y + 2 * grid };
    const moveBandit = async (to, label) => {
      const r = await ctx.call("move-token", { tokenId: bandit.id, ...to, elevation: 0 });
      return ctx.expect(r?.moved !== false, `${label} : le Bandit s'est déplacé (${JSON.stringify(r?.after ?? r)})`);
    };
    await ctx.call("move-token", { tokenId: bandit.id, ...outside, elevation: 0 });
    await pause(1200);
    await ctx.setHp(victim, 200);

    const state = async (t, itemId=null) => (await ctx.call("run-script", { code: STATE, args: { tokenId: t.id, itemId } })).result;
    const picking = async () => (await ctx.call("run-script", { code: PICKING })).result;
    const usages = list => list.filter(x => x.type === "usage");
    const alerts = list => list.filter(x => x.flags?.[MODULE_ID]?.gmAlert);
    const legalityOf = (list, who) => list.filter(w => (w.title ?? "").endsWith(` — ${who.name}`));

    /**
     * A click on the wand's cell, like with the mouse: the "do it anyway" window (if the field refuses) receives `answer`,
     * dnd5e's level window "use", then one click per projectile on the target. Returns what happened and the messages created.
     */
    const fireWand = async (who, wandId, answer="go") => {
      const since = await ctx.lastMessageId();
      const seen = { legality: 0, level: 0, picking: null, clicked: 0 };
      await ctx.call("call-module-api", { moduleId: "darsh-dnd-ui", fn: "barUse", args: { tokenId: who.id, ref: `Item.${wandId}` } });
      for ( const stop = Date.now() + 20000; Date.now() < stop && !seen.picking; ) {
        for ( const w of await dialogs() ) {
          if ( legalityOf([w], who).length ) {
            seen.legality++;
            await ctx.call("answer-dialog", { id: w.id, button: answer });
            if ( answer !== "go" ) { await pause(2000); return { seen, messages: await ctx.messagesSince(since) }; }
          } else if ( (w.buttons ?? []).some(b => b.action === "use") ) {
            seen.level++;
            await ctx.call("answer-dialog", { id: w.id, button: "use" });
          }
        }
        seen.picking = await picking();
      }
      if ( seen.picking ) {
        const ids = Array(seen.picking.count).fill(victim.id);
        seen.clicked = (await ctx.call("run-script", { code: PICK, args: { ids }, waitMs: 15000 })).result?.clicked?.length ?? 0;
      }
      // Chained projectiles go one by one, each settled before the next: wait for all the cards (45 s at most).
      let messages = [];
      for ( const stop = Date.now() + 45000; Date.now() < stop; ) {
        await pause(1500);
        messages = await ctx.messagesSince(since);
        const cards = usages(messages);
        const steps = cards.map(c => c.flags?.[MODULE_ID]?.resolution?.step);
        if ( seen.picking && (cards.length >= seen.picking.count) && steps.every(s => ["done", "missed"].includes(s)) ) break;
      }
      await pause(1500);
      return { seen, messages: await ctx.messagesSince(since) };
    };

    // A. Outside the field: one charge for a cast of three projectiles.
    const wand = await ctx.ensureItem(mage, WAND, { byUuid: true, ready: true });
    await ctx.refill(mage, wand);
    let before = (await state(mage, wand)).spent;
    let run = await fireWand(mage, wand);
    ctx.expect(run.seen.picking?.count === 3, `A. hors du champ : la visée des projectiles s'ouvre (${run.seen.picking?.count ?? 0} projectile(s), ${run.seen.level} fenêtre(s) de niveau)`);
    ctx.expect(usages(run.messages).length === 3, `A. hors du champ : 3 cartes, une par projectile (${usages(run.messages).length})`);
    let after = (await state(mage, wand)).spent;
    ctx.expect(after - before === 1, `A. hors du champ : une seule charge dépensée pour le lancement (${before} → ${after})`);

    // B. The Field, then the forced wand.
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const field = await lend("phbsplAntimagicF");
    const used = await ctx.engine("use", { tokenId: mage.id, itemId: field, activityType: "utility" });
    for ( const r of used.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    if ( !ctx.expect((await state(mage)).antimagic.length > 0, "B. le Magicien porte le statut « antimagic »") ) return;
    await ctx.refill(mage, wand);
    before = (await state(mage, wand)).spent;
    run = await fireWand(mage, wand);
    ctx.expect(run.seen.legality === 1, `B. dans le champ : une fenêtre « le faire quand même » (${run.seen.legality})`);
    ctx.expect(run.seen.picking?.count === 3, `B. forcé : la visée des projectiles s'ouvre (${run.seen.picking?.count ?? 0})`);
    const cards = usages(run.messages);
    ctx.expect(cards.length === 3, `B. forcé : les 3 projectiles partent, 3 cartes (${cards.length})`);
    const reasons = cards[0]?.flags?.[MODULE_ID]?.overridden ?? [];
    ctx.expect(reasons.some(r => FIELD_REASON.test(r)), `B. forcé : la première carte porte la raison du champ (${reasons.join(" | ") || "aucune"})`);
    ctx.expect(alerts(run.messages).length === 1, `B. forcé : une seule alerte au MJ (${alerts(run.messages).length})`);
    after = await state(mage, wand);
    ctx.expect(after.spent - before === 1, `B. forcé : une seule charge dépensée (${before} → ${after.spent})`);
    ctx.expect(after.antimagic.length && after.antimagic.every(e => !e.disabled), `B. après : le statut est là et actif (${JSON.stringify(after.antimagic)})`);

    // C. Double click on a cell refused by the field: a single window, a single card.
    const bolt = await lend("phbsplFireBolt00");
    const since = await ctx.lastMessageId();
    const click = () => ctx.call("call-module-api", { moduleId: "darsh-dnd-ui", fn: "barUse", args: { tokenId: mage.id, ref: `Item.${bolt}`, targetIds: [victim.id] } });
    await click();
    await pause(150);
    await click();
    await pause(2500);
    const open = legalityOf(await dialogs(), mage);
    ctx.expect(open.length === 1, `C. double clic : une seule fenêtre « le faire quand même » (${open.length})`);
    for ( const w of open ) await ctx.call("answer-dialog", { id: w.id, button: "go" });
    for ( const stop = Date.now() + 20000; Date.now() < stop; ) {
      await pause(1500);
      for ( const w of legalityOf(await dialogs(), mage) ) await ctx.call("answer-dialog", { id: w.id, button: "go" });   // autre raison
      if ( usages(await ctx.messagesSince(since)).length ) break;
    }
    await pause(3000);
    const twice = await ctx.messagesSince(since);
    ctx.expect(usages(twice).length === 1, `C. double clic : une seule carte (${usages(twice).length})`);
    ctx.expect(alerts(twice).length === 1, `C. double clic : une seule alerte au MJ (${alerts(twice).length})`);
    for ( const c of usages(twice) ) await ctx.settle(c._id ?? c.id, { timeoutMs: 30000 }).catch(() => null);

    // D. Le Bandit entre, force la baguette, ressort : le statut part.
    await moveBandit({ x: m.x + grid, y: m.y }, "D. entrée dans le champ");
    await pause(2500);
    const bWand = await ctx.ensureItem(bandit, WAND, { byUuid: true, ready: true });
    await ctx.refill(bandit, bWand);
    if ( ctx.expect((await state(bandit)).antimagic.length > 0, "D. le Bandit entré dans le champ porte le statut") ) {
      run = await fireWand(bandit, bWand);
      ctx.expect(usages(run.messages).length === 3, `D. le Bandit, forcé : 3 cartes (${usages(run.messages).length})`);
      if ( await moveBandit(outside, "D. sortie du champ") ) await pause(3000);
      const left = await state(bandit);
      ctx.expect(!left.antimagic.length, `D. le Bandit sorti du champ : plus de statut (${JSON.stringify(left.antimagic)})`);
    }

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
