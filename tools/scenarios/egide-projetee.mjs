/**
 * Projected Ward (SPEC §38), world `dnd-6`. The Wizard receives Arcane Ward and Projected Ward (Player's Handbook), creates its
 * ward (full); the Zombie hits the Fighter, within 9 m of the Wizard, until it hits; the Reaction is taken automatically
 * (`autoReact: "first"`). Checks:
 *  - the ward absorbs: its spend > 0, the "absorbs" card is signed by the Wizard;
 *  - damage taken by the Fighter + absorbed = damage of the roll (the ward first, the rest to the Fighter);
 *  - following hits until the ward is exhausted: on each hit, taken + absorbed = roll; when it is no longer enough, it
 *    takes what it has left and the Fighter the rest (the excess, once the ward is at 0 HP, goes back to the protected
 *    creature); empty, nothing absorbed.
 * Restores HP, positions, effects; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "égide projetée — l'égide du Magicien absorbe les dégâts du Guerrier",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Guerrier ou Zombi absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const wardId = await ctx.ensureItem(mage, CLASSES + "phbwzdArcaneWard");
    await ctx.ensureItem(mage, CLASSES + "phbwzdProjectedW");

    const all = [mage, fighter, zombi];
    const hp0 = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const zHome = await ctx.position(zombi);
    const clearNew = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      const target = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    for ( const t of all ) ctx.restore(() => ctx.setHp(t, hp0.get(t.id)));
    for ( const t of all ) ctx.restore(() => clearNew(t));

    const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = zItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Zombi a une attaque (${weapon?.name})`) ) return;
    const spentOf = async () => {
      const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === wardId);
      return Number(item?.system?.uses?.spent) || 0;
    };
    const f = await ctx.position(fighter);
    await ctx.call("move-token", { tokenId: zombi.id, x: f.x + grid, y: f.y, elevation: f.elevation });
    await pause(800);
    const fighterMax = (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max ?? hp0.get(fighter.id);

    /** The Zombie hits the Fighter (full HP) until it hits; returns the roll's damage, the HP loss, the ward's spend, the cards. */
    const strike = async () => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(fighter, fighterMax);
        const spent0 = await spentOf();
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [fighter.id],
          usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( !r?.targets?.find(t => t.name === "Guerrier")?.hit ) continue;
        await pause(2500);
        const msgs = await ctx.messagesSince(since);
        const damage = msgs.find(m => m.type === "damage");
        const dealt = (damage?.rolls ?? []).reduce((s, x) => s + (x.total ?? 0), 0);
        return { dealt, lost: fighterMax - (await ctx.hp(fighter)), absorbed: (await spentOf()) - spent0, msgs };
      }
      return null;
    };

    // Ward created, full ("Create Ward", one use per Long Rest).
    await ctx.use({ tokenId: mage.id, itemId: wardId, activityId: "Hha69hPMTYWhDE4A", consume: true });
    await pause(1200);
    ctx.log(`égide créée : dépensé ${await spentOf()}`);

    const hit = await strike();
    if ( !ctx.expect(!!hit, "le Zombi touche le Guerrier (20 essais au plus)") ) return;
    const card = hit.msgs.find(m => m.flags?.[MODULE_ID]?.absorbed);
    ctx.expect(hit.absorbed > 0, `l'égide du Magicien absorbe ${hit.absorbed} (jet ${hit.dealt})`);
    ctx.expect(hit.lost + hit.absorbed === hit.dealt, `Guerrier : ${hit.lost} PV perdus + ${hit.absorbed} absorbés = ${hit.dealt}`);
    ctx.expect(!!card && /Magicien|claude/i.test(card.alias ?? ""), `carte « absorbe » signée du Magicien (${card?.alias})`);

    // Following hits until the ward is exhausted: partial, then empty.
    const seen = { partial: false, empty: false };
    for ( let n = 0; (n < 8) && !seen.empty; n++ ) {
      const next = await strike();
      if ( !next ) break;
      ctx.expect(next.lost + next.absorbed === next.dealt, `coup ${n + 2} : ${next.lost} PV perdus + ${next.absorbed} absorbés = ${next.dealt}`);
      if ( (next.absorbed > 0) && (next.lost > 0) ) seen.partial = true;
      if ( next.absorbed === 0 ) seen.empty = true;
    }
    ctx.expect(seen.empty, "l'égide épuisée n'absorbe plus rien");
    ctx.log(`absorption partielle vue : ${seen.partial}`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
