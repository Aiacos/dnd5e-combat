/**
 * §301, batch C6 of the term-by-term pass: Reactions never offered. Spell arena (Caster, Ally, Enemy in contact).
 * Each part borrows its items from the Player's Handbook (with their source) and puts everything back.
 *  - Interception: the Enemy in contact hits the Caster; the Ally next to it, armed, reduces the damage (Reaction taken
 *    automatically);
 *  - Retaliation: the Enemy wounds the Ally; the Reaction attacks the Enemy with the Ally's weapon;
 *  - Slow Fall: the Ally (Monk 4) falls 30 ft — the window opens before the damage, it is reduced by 20;
 *  - Feather Fall: the Ally falls; the Caster, who knows the spell, reacts — no fall damage.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c6 — réactions : Interception, Représailles, Chute ralentie, Feuille morte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, enemy];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await unlend();
      for ( const t of all ) {
        for ( const s of ["prone", "falling"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { movementAction: "walk" } }).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const auto = { [MODULE_ID]: { autoReact: "first" } };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Answers the first new window with a matching button (the Reaction offered to the GM, who plays the NPCs). */
    const answer = async (ids, re, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return (d.buttons ?? []).map(x => x.label); }
        }
      }
      return null;
    };
    /** The Enemy strikes its target with its club until it hits (20 tries at most); returns the resolution of the hit. */
    const strike = async (target, club) => {
      for ( let n = 0; n < 20; n++ ) {
        await ctx.setHp(target, 999);
        const u = await ctx.use({ tokenId: enemy.id, itemId: club, activityType: "attack", targetTokenIds: [target.id], usageConfig: auto });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === target.name);
        if ( t?.hit ) return { r, t, usage: u.usageMessageId };
        await pause(800);
      }
      return null;
    };
    /** The Ally, in the air at 30 ft and "Falling", takes a step: it falls (2d6… 3d6 in dnd5e). */
    const drop = async () => {
      const p = await ctx.position(ally);
      await ctx.call("move-token", { tokenId: ally.id, x: p.x + ARENE_SORTS.grid * 3, y: p.y, elevation: 30 });
      await pause(1200);
      await ctx.call("set-status", { tokenId: ally.id, statusId: "falling", active: true });
      await pause(800);
      await ctx.engine("move", { tokenId: ally.id, cell: { i: ARENE_SORTS.tokens["Allié"][0] + 4, j: ARENE_SORTS.tokens["Allié"][1] } }).catch(() => null);
    };
    const landed = async () => {
      for ( let n = 0; n < 30; n++ ) { if ( ((await ctx.position(ally)).elevation ?? 0) === 0 ) return true; await pause(500); }
      return false;
    };

    await part("Interception", async () => {
      await lend(ally, `${PHB}.feats.Item.phbfstIntercepti`);
      await lend(ally, `${PHB}.equipment.Item.phbwepLongsword0`, { "system.equipped": true, "system.proficient": 1 });
      const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await pause(1200);
      const since = await ctx.lastMessageId();
      const hit = await strike(caster, club);
      if ( !ctx.expect(!!hit, "l'Ennemi touche le Lanceur (20 essais au plus)") ) return;
      const reaction = (hit.r?.events ?? hit.r?.log ?? []).find?.(e => e.type === "reactionResolved") ?? null;
      const applied = hit.t.damage?.applied ?? null;
      ctx.log(`coup : ${JSON.stringify({ damage: hit.t.damage, reaction: hit.t.reaction ?? reaction ?? null })}`);
      ctx.expect(/Intercept/i.test(JSON.stringify(hit.r ?? {})), "l'Allié intercepte (réaction prise d'office)");
      ctx.expect((applied !== null) && (applied < 13), `dégâts réduits avant l'application (${applied} appliqués ; un gourdin fait 13 au plus)`);
    });

    await part("Représailles", async () => {
      await lend(ally, `${PHB}.classes.Item.phbbrbRetaliatio`);
      await lend(ally, `${PHB}.equipment.Item.phbwepLongsword0`, { "system.equipped": true, "system.proficient": 1 });
      const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      // The Enemy in contact with the Ally ("a creature within 5 ft"), on the other side from the Caster.
      const a = await ctx.position(ally);
      await ctx.call("move-token", { tokenId: enemy.id, x: a.x, y: a.y + ARENE_SORTS.grid, elevation: 0 });
      await pause(1200);
      const since = await ctx.lastMessageId();
      const hit = await strike(ally, club);
      if ( !ctx.expect(!!hit, "l'Ennemi touche l'Allié (20 essais au plus)") ) return;
      // The riposte may miss: we read the Ally's use as a Reaction, hit or not.
      let back = false;
      for ( let i = 0; (i < 15) && !back; i++ ) {
        await pause(1000);
        back = (await ctx.messagesSince(since)).some(m => (m.tokenId === ally.id) && (m.type === "usage") && m.flags?.["dnd5e-combat"]?.reaction);
      }
      ctx.expect(!!back, "blessé, l'Allié riposte avec son épée longue");
    });

    await part("Chute ralentie", async () => {
      await lend(ally, `${PHB}.classes.Item.phbmnkMonk000000`, { "system.levels": 4 });
      await lend(ally, `${PHB}.classes.Item.phbmnkSlowFall00`);
      await pause(1200);
      const ids = await known();
      await drop();
      const labels = await answer(ids, /Slow Fall|Chute ralentie|Reduce|Réduire/i);
      ctx.expect(!!labels, `avant les dégâts, la Chute ralentie est proposée (${labels?.join(", ") ?? "aucune fenêtre"})`);
      ctx.expect(await landed(), "l'Allié est au sol");
      await pause(4000);
      const hp = await ctx.hp(ally);
      ctx.expect(hp === 999, `dégâts de chute réduits de 20 — ici à 0 (999 → ${hp})`);
    });

    await part("Feuille morte", async () => {
      await lend(caster, `${PHB}.spells.Item.phbsplFeatherFal`, { "system.method": "atwill" });
      await pause(1200);
      const ids = await known();
      await drop();
      const labels = await answer(ids, /Feather Fall|Feuille morte/i);
      ctx.expect(!!labels, `le Lanceur se voit proposer Feuille morte (${labels?.join(", ") ?? "aucune fenêtre"})`);
      ctx.expect(await landed(), "l'Allié est au sol");
      await pause(4000);
      ctx.expect(await ctx.hp(ally) === 999, `pas de dégâts de chute (${await ctx.hp(ally)})`);
    });
  }
};
