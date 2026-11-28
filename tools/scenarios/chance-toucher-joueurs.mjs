/**
 * What the hit chance badge shows a PLAYER (world setting `hitChancePlayers`, #247 / DF #249). "Refusals Arena"
 * (`node tools/arene-refus.mjs`), real player client ("claude player", owner of the Refusals Mage, opened by the test
 * bench: `players: true`). The badge is that of the attack menu preview (`previewMenuAttack`, ui/pointer-mouse.mjs), shown on the
 * player's side for the Mage's weapon against the Dummy, in contact. Checks, level by level:
 *  - `full`: the percentage and the AC;
 *  - `percent`: the percentage, without the AC;
 *  - `advantage`, with no reason for Advantage or Disadvantage: no badge;
 *  - `advantage`, the Mage Prone: the "Disadvantage" line and its reason, no percentage, no AC, no color;
 *  - `off`: no badge, even Prone.
 * Reset: the world setting, the cover preview, the player client's setting, the Prone condition.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "chance de toucher vue par un joueur — pourcentage et CA, pourcentage, avantage et désavantage seuls, rien (#247)",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const { sceneId } = await ctx.scene();
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const { data: mtok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const weapon = ((await ctx.call("get-actor", { actorId: mtok.actorId })).items ?? []).find(i => (i.type === "weapon")
      && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Mage a une arme équipée (${weapon?.name})`) ) return;
    const weaponUuid = `Actor.${mtok.actorId}.Item.${weapon._id}`;

    // World settings: restored as they were at the end.
    const level0 = (await ctx.engine("setting", { key: "hitChancePlayers" }))?.now ?? "full";
    const preview0 = (await ctx.engine("setting", { key: "coverPreview" }))?.now ?? false;
    ctx.restore(() => ctx.engine("setting", { key: "hitChancePlayers", value: level0 }));
    ctx.restore(() => ctx.engine("setting", { key: "coverPreview", value: preview0 }));
    // Without the cover preview: its lines show at every level and would mask what is checked here.
    await ctx.engine("setting", { key: "coverPreview", value: false });
    ctx.restore(() => ctx.call("set-status", { tokenId: mage.id, statusId: "prone", active: false }).catch(() => {}));

    const who = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      const item = await fromUuid(args.weapon);
      const before = game.settings.get("${MODULE_ID}", "hitChance");
      if ( before !== true ) await game.settings.set("${MODULE_ID}", "hitChance", true);
      return { gm: game.user.isGM, owner: !!item?.isOwner, active: !!game.modules.get("${MODULE_ID}")?.api?.active, before };`,
      { scene: sceneId, weapon: weaponUuid });
    ctx.log(`client joueur : ${JSON.stringify(who)}`);
    if ( !ctx.expect(!who.gm && who.owner && who.active, "un client joueur propriétaire du Mage, le Core actif") ) return;
    if ( who.before !== true ) {
      ctx.restore(() => ctx.asPlayer(`await game.settings.set("${MODULE_ID}", "hitChance", ${JSON.stringify(who.before)}); return true;`));
    }

    /** The badge of the attack preview, on the player's side: `{ shown, classes, lines: [{ kind, text }] }`. */
    const badge = () => ctx.asPlayer(`
      const ui = await import("/modules/${MODULE_ID}/scripts/ui/pointer-mouse.mjs");
      const hc = await import("/modules/${MODULE_ID}/scripts/ui/hitchance.mjs");
      const me = canvas.tokens.get(args.mage)?.document, target = canvas.tokens.get(args.dummy)?.document;
      const item = await fromUuid(args.weapon);
      const activity = item.system.activities.find(a => a.type === "attack");
      hc.hideHitChance();
      try { ui.previewMenuAttack(new DOMRect(200, 200, 160, 40), me, target, activity); }
      catch(err) { hc.hideHitChance(); return { error: String(err?.stack ?? err).slice(0, 900) }; }
      await new Promise(r => setTimeout(r, 300));
      const el = document.querySelector(".dnd5e-combat-hitchance");
      const out = { shown: !!el && !el.hidden, classes: el ? [...el.classList] : [],
        lines: el ? [...el.children].map(c => ({ kind: c.className, text: c.textContent })) : [] };
      hc.hideHitChance();
      return out;`, { mage: mage.id, dummy: dummy.id, weapon: weaponUuid });
    const at = async (level, label) => {
      await ctx.engine("setting", { key: "hitChancePlayers", value: level });
      await pause(1500);
      const b = await badge();
      ctx.log(`${label} : ${JSON.stringify(b)}`);
      if ( b.error ) throw new Error(`aperçu chez le joueur : ${b.error}`);
      return b;
    };
    const kinds = b => b.lines.map(l => l.kind);
    const colour = b => b.classes.some(c => ["good", "fair", "poor"].includes(c));
    const acLine = b => b.lines.some(l => (l.kind === "detail") && /\b(AC|CA)\b/.test(l.text));

    const full = await at("full", "pourcentage et CA");
    ctx.expect(full.shown && kinds(full).includes("percent") && acLine(full),
      `« pourcentage et CA » : le pourcentage et la CA (${JSON.stringify(full.lines)})`);

    const percent = await at("percent", "pourcentage seul");
    ctx.expect(percent.shown && kinds(percent).includes("percent") && !acLine(percent),
      `« pourcentage seul » : le pourcentage, pas la CA (${JSON.stringify(percent.lines)})`);

    const quiet = await at("advantage", "avantage et désavantage seuls, sans raison");
    ctx.expect(!quiet.shown, `« avantage et désavantage seuls », rien à dire : aucune pastille (${JSON.stringify(quiet.lines)})`);

    await ctx.call("set-status", { tokenId: mage.id, statusId: "prone", active: true });
    await pause(1500);
    const prone = await at("advantage", "avantage et désavantage seuls, À terre");
    ctx.expect(prone.shown && kinds(prone).includes("disadvantage"),
      `« avantage et désavantage seuls », À terre : la ligne Désavantage (${JSON.stringify(prone.lines)})`);
    ctx.expect(!kinds(prone).includes("percent") && !acLine(prone) && !colour(prone),
      `… sans pourcentage, sans CA, sans couleur (${JSON.stringify(prone.classes)})`);

    const off = await at("off", "rien, À terre");
    ctx.expect(!off.shown, `« rien » : aucune pastille, même À terre (${JSON.stringify(off.lines)})`);
  }
};
