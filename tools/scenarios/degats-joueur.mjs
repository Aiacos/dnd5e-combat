/**
 * Damage from an attack made by a PLAYER (§507). The damage roll starts from the action author's client (runtime/engine.mjs,
 * `onResolutionFlag`: `message.isAuthor`), then the active GM applies it: this is the path of all the tables, which no other
 * scenario plays (they roll everything from the GM). "Refusal Arena" (`node tools/arene-refus.mjs`), real player client
 * ("claude player", owner of the Refusal Mage, opened by the test bench: `players: true`). Checks:
 *  0. control: the Mage's weapon attack made by the GM wounds the Dummy;
 *  1. the same attack made on the player's side (target placed, activity used without a window): the damage card is the player's,
 *     and the GM applies it to the Dummy;
 *  2. True Strike cast on the player's side on their weapon: the weapon is enchanted, the weapon's attack wounds, the
 *     enchantment ends after it (Player's Handbook required, otherwise this part is not applicable).
 * A hit can miss (up to six tries) and a low die can give 0 (Mage's staff: 1d8 − 1): HP are read back from the
 * damage card. Restored: the Dummy's HP, borrowed spell, enchantment.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "dnd-players-handbook.spells";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "dégâts d'une attaque lancée par un joueur — arme, Frappe assurée (§507)",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const { sceneId } = await ctx.scene();
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const hp0 = await ctx.hp(dummy);
    ctx.restore(() => ctx.setHp(dummy, hp0));
    const { data: mtok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const sheet = async () => (await ctx.call("get-actor", { actorId: mtok.actorId })).items ?? [];
    const weapon = (await sheet()).find(i => (i.type === "weapon") && i.system?.equipped
      && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Mage a une arme équipée (${weapon?.name})`) ) return;
    const weaponUuid = `Actor.${mtok.actorId}.Item.${weapon._id}`;

    const who = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      const item = await fromUuid(args.weapon);
      return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null, owner: !!item?.isOwner,
        active: !!game.modules.get("${MODULE_ID}")?.api?.active, damageFlow: game.settings.get("${MODULE_ID}", "damageFlow") };`,
      { scene: sceneId, weapon: weaponUuid });
    ctx.log(`client joueur : ${JSON.stringify(who)}`);
    if ( !ctx.expect(!who.gm && who.owner && who.activeGM && who.active, "un client joueur propriétaire du Mage, un MJ actif, le Core actif") ) return;
    // The "Damage and healing" setting of a world where it may have been changed by hand: the one this scenario checks is
    // the automatic roll.
    if ( !["level", "auto"].includes(who.damageFlow) ) { ctx.log(`réglage « Dégâts et soins » = ${who.damageFlow} : non applicable`); return; }
    await ctx.asPlayer(`window.__dasErreurs = []; if ( !window.__dasEcoute ) { window.__dasEcoute = true;
      window.addEventListener("error", e => window.__dasErreurs.push(String(e.message)));
      window.addEventListener("unhandledrejection", e => window.__dasErreurs.push(String(e.reason?.message ?? e.reason))); } return true;`);

    // Cast on the player's side: target placed, activity used without a window (like a click in the bar or on the sheet).
    const playerUse = (itemUuid, activityType, dasFlags={}) => ctx.asPlayer(`
      try {
        canvas.tokens.get(args.dummy)?.setTarget(true, { releaseOthers: true });
        const item = await fromUuid(args.item);
        const activity = item.system.activities.find(a => a.type === args.type) ?? item.system.activities.contents[0];
        const r = await activity.use({ "${MODULE_ID}": { confirmed: true, autoReact: "none", ...args.flags } }, { configure: false }, {});
        return { ok: true, message: r?.message?.id ?? null };
      } catch(err) { return { error: String(err?.stack ?? err).slice(0, 600) }; }`,
      { item: itemUuid, type: activityType, dummy: dummy.id, flags: dasFlags });

    // A player's attack: `{ hit, before, after, rolled, author }` (rolled: total of the damage card), or null on an error.
    const playerAttack = async label => {
      await ctx.setHp(dummy, hp0);
      const since = await ctx.lastMessageId();
      const r = await playerUse(weaponUuid, "attack", { cost: "free" });
      if ( r?.error ) { ctx.expect(false, `${label} : erreur chez le joueur (${r.error})`); return null; }
      let res = null, msgs = [];
      for ( const stop = Date.now() + 20000; Date.now() < stop; await pause(500) ) {
        msgs = await ctx.messagesSince(since);
        res = msgs.map(m => m.flags?.[MODULE_ID]?.resolution).filter(Boolean).pop() ?? null;
        if ( (res?.step === "missed") || ((res?.step === "done") && msgs.some(m => m.type === "damage")) ) break;
      }
      await pause(1000);
      const card = msgs.find(m => m.type === "damage");
      const out = { hit: res?.targets?.some?.(t => t.hit) ?? null, step: res?.step ?? null, before: hp0, after: await ctx.hp(dummy),
        rolled: card ? (card.rolls ?? []).reduce((s, x) => s + Math.max(0, Number(x.total) || 0), 0) : null, author: card?.author ?? null };
      ctx.log(`${label} : ${JSON.stringify(out)}`);
      return out;
    };
    const expectDamage = (label, a) => {
      ctx.expect(a.author === who.user, `${label} : la carte de dégâts est lancée par le joueur (${a.author})`);
      ctx.expect((a.rolled !== null) && (a.after === a.before - a.rolled), `${label} : le MJ applique le jet du joueur (${a.before} − ${a.rolled} → ${a.after})`);
    };

    // 0. Control: the same weapon used by the GM.
    for ( let i = 1; i <= 6; i++ ) {
      await ctx.setHp(dummy, hp0);
      const u = await ctx.use({ tokenId: mage.id, itemId: weapon._id, targetTokenIds: [dummy.id], activityType: "attack", usageConfig: { [MODULE_ID]: { cost: "free" } } });
      const r = u.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
      await pause(1500);
      if ( !r?.targets?.find(x => x.name === dummy.name)?.hit ) continue;
      const after = await ctx.hp(dummy);
      ctx.expect(r.step === "done", `témoin MJ : touché, résolution terminée (PV ${hp0} → ${after})`);
      break;
    }

    // 1. Attaque d'arme du joueur.
    let a = null;
    for ( let i = 1; (i <= 6) && !a?.hit; i++ ) { a = await playerAttack(`attaque du joueur, essai ${i}`); if ( !a ) return; }
    if ( ctx.expect(!!a?.hit, "attaque du joueur : touché en six essais au plus") ) expectDamage("attaque du joueur", a);

    // 2. True Strike.
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(SPELLS) ) { ctx.log("Manuel des joueurs absent : Frappe assurée non applicable"); return; }
    const tsId = await ctx.ensureItem(mage, `Compendium.${SPELLS}.Item.phbsplTrueStrike`);
    const tsUuid = `Actor.${mtok.actorId}.Item.${tsId}`;
    const enchantments = async () => (await sheet()).find(i => i._id === weapon._id)?.effects?.length ?? 0;
    ctx.restore(async () => {
      const w = (await sheet()).find(i => i._id === weapon._id);
      for ( const e of w?.effects ?? [] ) await ctx.call("remove-embedded-effect", { documentType: "Item", uuid: weaponUuid, effectId: e._id }).catch(() => {});
    });
    const e0 = await enchantments();
    let t = null;
    for ( let k = 1; (k <= 6) && !t?.hit; k++ ) {
      const cast = await playerUse(tsUuid, "enchant", { enchantItem: weaponUuid });
      if ( cast?.error ) { ctx.expect(false, `Frappe assurée : erreur chez le joueur (${cast.error})`); return; }
      let on = e0;
      for ( const stop = Date.now() + 15000; (on <= e0) && (Date.now() < stop); await pause(500) ) on = await enchantments();
      if ( !ctx.expect(on > e0, `Frappe assurée, lancer ${k} : l'arme est enchantée (${e0} → ${on})`) ) return;
      // The aiming of the offered attack opens on the player's side (ui/pointer-offers.mjs): closed, the attack goes off as in 1.
      await pause(1500);
      await ctx.asPlayer(`try { (await import("/modules/${MODULE_ID}/scripts/ui/pointer.mjs")).stopTargeting?.(); } catch {} return true;`);
      t = await playerAttack(`Frappe assurée, lancer ${k}`);
      if ( !t ) return;
      await pause(1500);
      ctx.expect((await enchantments()) === e0, `Frappe assurée, lancer ${k} : l'enchantement tombe après l'attaque`);
    }
    if ( ctx.expect(!!t?.hit, "Frappe assurée : touché en six lancers au plus") ) expectDamage("Frappe assurée", t);
    const errors = await ctx.asPlayer(`return (window.__dasErreurs ?? []).slice(-10);`);
    ctx.expect(!errors.length, `aucune erreur dans la console du joueur (${JSON.stringify(errors)})`);
  }
};
