/**
 * §65 — The four PC points found by the inventory (world `ravenloft` / `ravenloft-test2`).
 *  1. Agile Escape (Sylaene's Panther form, placed for the scenario): with a Bonus Action, the engine ASKS
 *     "Disengage or Hide"; Disengage: Bonus Action spent, disengaged; Hide: the Stealth check goes off.
 *  2. Bramo's Holy Water: on the Zombie (Undead) it works; on Kaalisti (Humanoid) it has no effect.
 *  3. Kaalisti's Suggestion on the Zombie: damage from an unknown author does not end it; Kaalisti's Fire Bolt does.
 *  4. Sylaene's cursed Ring of Warmth (declared by cos-reloaded-creatures): Bramo's Ray of Frost on her has its
 *     cold damage reduced.
 * The rolls are random: we replay until the wanted hit or failed save.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "PJ — Échappée agile au choix, Eau bénite, Suggestion, Anneau de chaleur maudit",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Kaalisti", "Bramo", "Sylaene"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Kaalisti, Bramo ou Sylaene absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const warlock = await ctx.token("Kaalisti");
    const wizard = await ctx.token("Bramo");
    const druid = await ctx.token("Sylaene");
    // The campaign's sheets only: elsewhere (`dnd-6`), tokens of the same name without the Holy Water or the Panther form.
    const out = await ctx.call("list-actors", {});
    const actors = Array.isArray(out) ? out : (out.actors ?? Object.values(out).find(Array.isArray));
    const pantherActor = actors.find(a => /^Sylaene \(Panth/.test(a.name));
    const hasHoly = await ctx.itemId(wizard.id, "holy-water").then(() => true, () => false);
    if ( !pantherActor || !hasHoly ) { ctx.log("forme Panthère de Sylaene ou Eau bénite de Bramo absente (fiches de la campagne) : non applicable"); return; }
    const grid = await ctx.gridSize();
    for ( const t of [zombi, warlock, wizard, druid] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    ctx.restore(() => ctx.removeStatusEffects(zombi, "dead"));
    const effectsNamed = async (token, re) => (await ctx.effects(token)).filter(e => !e.disabled && re.test(e.name ?? ""));
    const dialogAfter = async (known, re) => (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 }).catch(() => null))
      ?.windows?.find(w => re.test(`${w.title ?? ""} ${w.text ?? ""}`));
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);

    // 1. Agile Escape.
    if ( ctx.expect(!!pantherActor, "forme Panthère de Sylaene dans le monde") ) {
      const at = await ctx.position(zombi);
      const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
      await ctx.call("place-token", { actorId: pantherActor.id, x: at.x + 2 * grid, y: at.y });
      const panther = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: panther.id }).catch(() => {}));
      // Linked token: the Stealth effect stays on the world actor once the token is removed (the net only follows the scene).
      ctx.restore(async () => {
        const a = await ctx.call("get-actor", { actorId: pantherActor.id });
        for ( const e of (a.effects ?? []).filter(e => e.flags?.[MODULE_ID]?.hidden) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: pantherActor.id, effectId: e._id }).catch(() => {});
        }
      });
      await ctx.startCombat([panther, zombi]);
      const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
      const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
      const turnOf = async token => {
        for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1200); }
        return (await current()) === token.id;
      };
      const escape = async kind => {
        const k = await known();
        await ctx.use({ tokenId: panther.id, identifier: "nimble-escape", activityType: "utility" }).catch(() => null);
        const d = await dialogAfter(k, /Se désengager|Désengagement|Furtivité|Disengage|Hide/i);
        if ( !ctx.expect(!!d, `Échappée agile : le moteur demande l'action (« ${(d?.text ?? "aucune fenêtre").slice(0, 80)} »)`) ) return false;
        await ctx.call("answer-dialog", { id: d.id, button: kind });
        await sleep(2500);
        return true;
      };
      if ( ctx.expect(await turnOf(panther), "tour de la Panthère") && await escape("disengage") ) {
        const b = await ctx.engine("budget", { tokenId: panther.id });
        ctx.expect(b?.disengaged === true && (b?.bonus ?? 1) === 0, `Se désengager : désengagée, action Bonus dépensée (bonus ${b?.bonus}, désengagée ${b?.disengaged})`);
      }
      await ctx.nextTurn(); await sleep(1200);
      if ( ctx.expect(await turnOf(panther), "nouveau tour de la Panthère") ) {
        const since = await ctx.lastMessageId();
        if ( await escape("hide") ) {
          const b = await ctx.engine("budget", { tokenId: panther.id });
          const rolled = (await ctx.call("list-chat-messages", { limit: 20, ...(since ? { sinceId: since } : {}) })).messages ?? [];
          const stealth = rolled.some(m => /Stealth|Discrétion|Furtivité/i.test(`${m.flavor ?? ""} ${m.text ?? ""}`)) || (await effectsNamed({ id: panther.id }, /Furtivité/i).catch(() => [])).length;
          ctx.expect((b?.bonus ?? 1) === 0 && !b?.disengaged && !!stealth, `Se cacher : action Bonus dépensée, test de Discrétion lancé, pas désengagée (bonus ${b?.bonus}, désengagée ${b?.disengaged}, Discrétion ${!!stealth})`);
        }
      }
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    }

    // 2. Holy Water.
    const holy = async target => {
      const used = await ctx.use({ tokenId: wizard.id, identifier: "holy-water", targetTokenIds: [target.id] });
      const res = await ctx.settle(used.usageMessageId).catch(() => null);
      return res?.targets?.[0] ?? null;
    };
    await ctx.setHp(zombi, 100);
    const onZombi = await holy(zombi);
    ctx.expect(onZombi && !onZombi.unaffected, `Eau bénite sur le Zombi (Mort-vivant) : elle agit (${JSON.stringify(onZombi?.save ?? onZombi?.unaffected ?? null)})`);
    const onWarlock = await holy(warlock);
    ctx.expect(!!onWarlock?.unaffected, `Eau bénite sur Kaalisti (Humanoïde) : sans effet (${JSON.stringify(onWarlock?.unaffected ?? null)})`);

    // 3. Suggestion.
    await ctx.setHp(zombi, 100);
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /sugg/i));
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /Concentr/i));
    let suggested = false;
    for ( let i = 0; (i < 10) && !suggested; i++ ) {
      const used = await ctx.use({ tokenId: warlock.id, identifier: "suggestion", activityType: "save", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(800);
      suggested = (await effectsNamed(zombi, /sugg/i)).length > 0;
    }
    if ( ctx.expect(suggested, "Suggestion posée sur le Zombi (sauvegarde ratée, 10 essais au plus)") ) {
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 3 });
      await sleep(1500);
      ctx.expect((await effectsNamed(zombi, /sugg/i)).length > 0, "3 dégâts d'auteur inconnu : la suggestion tient");
      let hit = false;
      for ( let i = 0; (i < 15) && !hit; i++ ) {
        const used = await ctx.use({ tokenId: warlock.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        hit = !!r?.targets?.[0]?.hit;
      }
      await sleep(2000);
      if ( ctx.expect(hit, "Trait de feu de Kaalisti : touché (15 essais au plus)") ) {
        ctx.expect((await effectsNamed(zombi, /sugg/i)).length === 0, "dégâts infligés par le lanceur : la suggestion cesse");
      }
    }

    // 4. Anneau de chaleur maudit.
    await ctx.engineLog();   // vide le tampon
    let reduced = false;
    for ( let i = 0; (i < 10) && !reduced; i++ ) {
      await ctx.setHp(druid, 100);
      const used = await ctx.use({ tokenId: wizard.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [druid.id] });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      if ( !r?.targets?.[0]?.hit ) continue;
      await sleep(1500);
      reduced = (await ctx.engineLog()).some(l => /réduit les dégâts|reduces the damage|Chaleur/i.test(l));
      ctx.expect(reduced, "Rayon de givre de Bramo touche Sylaene : l'Anneau réduit les dégâts de froid");
      break;
    }
  }
};
