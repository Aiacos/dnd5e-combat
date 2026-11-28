/**
 * §117, §416: what each automation level promises, checked at the level the world is on (read from the setting
 * `automationLevel`). The full run plays it at "full"; for the other two, change the setting, reload the client
 * (`node tools/reload.mjs`) and replay this scenario alone — the others assume "full".
 *
 *                                       Essential            Assisted             Full
 *  1. attack (Fire Bolt)                roll only, HP intact  resolved, damage     resolved, damage
 *  2. save spell (Burning H.)           no roll, no damage    saving throw, damage saving throw, damage
 *  3. Opportunity Attack                never judged          judged               judged
 *  4. content per item                  closed                closed               open
 *  5. basic action (unarmed)            exclusive choice known at all levels: Grapple OR Shove, never both
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "niveaux d'automatisation — attaque, sauvegarde, attaque d'opportunité, contenu, au niveau du monde",

  async run(ctx) {
    const level = (await ctx.engine("setting", { key: "automationLevel" }))?.now ?? "full";
    const resolves = level !== "essentials";
    const full = level === "full";
    ctx.log(`niveau du monde : ${level}`);
    const state = (await ctx.call("run-script", { waitMs: 8000, code: `
      const a = game.modules.get("${MODULE_ID}").api; return { level: a.level(), skipped: a.skippedRoutes().length };` })).result;
    ctx.expect(state.level === level, `le client du MJ tourne au niveau du réglage (${state.level})`);
    ctx.expect(full ? (state.skipped === 0) : (state.skipped > 0), `écoutes non branchées : ${state.skipped} (${full ? "aucune attendue" : "il en faut"})`);

    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const types = msgs => msgs.map(m => m.type).join(", ") || "aucun message";

    // 1. Attack: until a hit (levels that resolve), only once otherwise.
    for ( let shot = 1; shot <= 6; shot++ ) {
      const before = await ctx.hp(zombi);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      if ( !resolves ) {
        await pause(5000);
        const msgs = await ctx.messagesSince(since);
        ctx.expect(used.used && msgs.some(m => m.type === "attack"), `attaque : le jet d'attaque de dnd5e est lancé (${types(msgs)})`);
        ctx.expect(!msgs.some(m => m.flags?.[MODULE_ID]?.resolution) && !msgs.some(m => m.type === "damage"), "attaque : rien n'est résolu, aucun jet de dégâts enchaîné");
        ctx.expect((await ctx.hp(zombi)) === before, "attaque : PV intacts");
        break;
      }
      const r = await ctx.settle(used.usageMessageId);
      if ( !r.targets[0]?.hit ) { if ( shot === 6 ) ctx.expect(false, "attaque : touche en six essais"); continue; }
      ctx.expect(r.step === "done", `attaque : résolue (étape « ${r.step} »)`);
      ctx.expect(before - (await ctx.hp(zombi)) === r.targets[0].damage?.applied, `attaque : dégâts appliqués (${r.targets[0].damage?.applied} PV)`);
      break;
    }

    // 2. Save spell placed on the Zombie.
    {
      await ctx.setHp(zombi, hp0);
      const since = await ctx.lastMessageId();
      const zone = await ctx.use({ tokenId: sorc.id, identifier: "burning-hands", activityType: "save", area: { shape: "rectangle", ...(await ctx.box(zombi)) }, collectMs: 3000 });
      if ( zone.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone.regionId }).catch(() => {}));
      ctx.restore(() => ctx.removeEffectsNamed(sorc, /concentr/i).catch(() => {}));
      await pause(resolves ? 2000 : 5000);
      if ( resolves ) {
        const r = await ctx.settle(zone.usageMessageId);
        const msgs = await ctx.messagesSince(since);
        ctx.expect(r.step === "done" && msgs.some(m => m.type === "save"), `sauvegarde : demandée et résolue (${types(msgs)})`);
        ctx.expect((await ctx.hp(zombi)) < hp0, `sauvegarde : dégâts appliqués (${hp0} → ${await ctx.hp(zombi)})`);
      }
      else {
        const msgs = await ctx.messagesSince(since);
        ctx.expect(zone.used && !msgs.some(m => (m.type === "save") || (m.type === "damage")), `sauvegarde : ni jet ni dégâts lancés par le moteur (${types(msgs)})`);
        ctx.expect((await ctx.hp(zombi)) === hp0, "sauvegarde : PV intacts");
      }
    }

    // 3. Opportunity Attack: the Zombie stuck to the Fighter moves away, in combat.
    {
      const grid = await ctx.gridSize();
      const home = await ctx.position(zombi);
      const at = await ctx.position(fighter);
      ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
      await pause(800);
      await ctx.startCombat([zombi, fighter]);
      await pause(800);
      const names = await ctx.engine("threats", { tokenId: zombi.id, point: { x: at.x + 5 * grid + grid / 2, y: at.y + grid / 2 } });
      if ( resolves ) ctx.expect(names.includes("Guerrier"), `attaque d'opportunité : le Guerrier menace le départ du Zombi (${names.join(", ") || "personne"})`);
      else ctx.expect(names.length === 0, `attaque d'opportunité : jamais jugée à ce niveau (${names.join(", ") || "personne"})`);
    }

    // 4 et 5. Contenu par objet, action de base.
    const content = (await ctx.call("run-script", { waitMs: 8000, code: `
      const a = game.modules.get("${MODULE_ID}").api; let open = 0, unarmed = null;
      for ( const t of canvas.tokens.placeables ) for ( const i of (t.actor?.items ?? []) ) {
        const c = a.content.of(i);
        if ( c?.identifier === "unarmed-strike" ) unarmed = unarmed ?? (c.entry?.choice?.effects ?? null);
        else if ( c?.entry ) open++;
      }
      return { open, unarmed };` })).result;
    ctx.expect(full ? (content.open > 0) : (content.open === 0), `contenu par objet : ${content.open} entrée(s) lue(s) (${full ? "ouvert" : "fermé"} à ce niveau)`);
    if ( content.unarmed === null && !full ) ctx.log("aucune Attaque à mains nues sur la scène : choix exclusif non vérifié");
    else ctx.expect(content.unarmed === "one", `Attaque à mains nues : choix exclusif connu (Lutte ou Bousculade), à tous les niveaux (${content.unarmed})`);
  }
};
