/**
 * Issue #269 (journal §545): the Critical Hit is decided target by target. One attack from the Guerrier hits two targets within
 * 5 ft: the Zombi, Paralyzed (automatic Critical Hit), and the Bandit (normal hit). The damage is rolled once, normally, and the
 * extra critical dice beside it, in the same message: the Zombi loses the normal damage plus the critical dice, the Bandit the
 * normal damage only. The engine's card says which target took the critical dice.
 * Both targets get 300 HP and AC 5 for the test. Restores settings, statuses, AC, HP and positions.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "critique par cible (#269) — deux cibles touchées, une seule Paralysée : seule elle prend les dés du critique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Zombi", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} required: not applicable`); return; }
    const guerrier = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const { data: g } = await ctx.call("get-scene-object", { type: "Token", objectId: guerrier.id });
    // Both targets within 5 ft of the Guerrier, on either side (positions put back by `stage`, last).
    await ctx.stage({ tokens: { Zombi: [g.x + grid, g.y], Bandit: [g.x - grid, g.y] } });
    await pause(500);

    const setting = async (key, value) => {
      const r = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: r.before }));
    };
    // The scenario fixes the settings it checks: standard critical, no lowered margin, damage chained without a click.
    await setting("criticalMode", "standard");
    await setting("critMargin", 0);
    await setting("damageFlow", "auto");

    // 300 HP and AC 5 on both targets (token deltas, put back as they were).
    for ( const t of [zombi, bandit] ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const hp0 = await ctx.hp(t);
      const max0 = data.delta?.system?.attributes?.hp?.max ?? null;
      const ac0 = data.delta?.system?.attributes?.ac ?? null;
      ctx.restore(async () => {
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id,
          data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {});
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id,
          data: ac0 === null ? { "delta.system.attributes.-=ac": null } : { "delta.system.attributes.ac": ac0 } }).catch(() => {});
        await ctx.setHp(t, hp0).catch(() => {});
      });
    }
    const tough = async () => {
      for ( const t of [zombi, bandit] ) await ctx.call("update-scene-object", { type: "Token", objectId: t.id,
        data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300, "delta.system.attributes.ac": { calc: "flat", flat: 5 } } });
    };
    ctx.restore(async () => {
      await ctx.removeStatusEffects(zombi, "paralyzed");
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: false }).catch(() => {});
    });
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: true });
    await pause(500);

    const sum = list => (list ?? []).reduce((acc, d) => acc + (Number(d.value ?? d.total) || 0), 0);

    // Up to 8 swings: a natural 20 makes both targets critical, a miss proves nothing — swing again from 300 HP.
    let found = null;
    for ( let n = 0; (n < 8) && !found; n++ ) {
      await tough();
      await pause(300);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: guerrier.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [zombi.id, bandit.id] })
        .catch(err => ({ error: err.message }));
      if ( used.error || !used.usageMessageId ) { ctx.expect(false, `attack with the greatsword: ${used.error ?? "no usage card"}`); return; }
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const z = r?.targets?.find(t => t.name === "Zombi");
      const b = r?.targets?.find(t => t.name === "Bandit");
      if ( n === 0 ) ctx.expect((r?.targets ?? []).length === 2, `the attack has two targets (${(r?.targets ?? []).map(t => t.name).join(", ")})`);
      if ( !(z?.hit && z.critical && b?.hit && !b.critical) ) {
        ctx.log(`swing ${n + 1}: Zombi ${z?.hit ? (z.critical ? "critical" : "hit") : "miss"}, Bandit ${b?.hit ? (b.critical ? "critical" : "hit") : "miss"} — again`);
        await pause(800);
        continue;
      }
      await pause(1500);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      found = { r, z, b, damage };
    }
    if ( !ctx.expect(!!found, "a swing hits the Paralyzed Zombi (critical) and the Bandit (normal hit), 8 tries at most") ) return;

    const { r, z, b, damage } = found;
    ctx.expect(z.reason === "autoCritical", `Zombi: automatic Critical Hit, Paralyzed within 5 ft (${z.reason})`);
    // The connector passes only a few roll options: the split is read on the engine's resolution (`damageRoll`), the rolls on the card.
    const rolls = damage?.rolls ?? [];
    ctx.expect(!!damage, "one damage message");
    ctx.expect(rolls.length > 0 && rolls.every(x => x.options?.isCritical !== true),
      `no roll of the message is a critical roll (${rolls.map(x => x.formula).join(" | ")})`);
    const split = r.damageRoll ?? {};
    ctx.expect((split.critical ?? []).length > 0, `the critical dice are rolled apart (${JSON.stringify(split.critical ?? null)})`);
    ctx.expect(sum(rolls) === sum(split.damages) + sum(split.critical),
      `the card's rolls are the normal damage plus the critical dice (${sum(rolls)} = ${sum(split.damages)} + ${sum(split.critical)})`);
    ctx.expect((damage?.flags?.[MODULE_ID]?.criticalFor ?? []).some(u => String(u).endsWith(zombi.id))
      && !(damage?.flags?.[MODULE_ID]?.criticalFor ?? []).some(u => String(u).endsWith(bandit.id)), "the message names the Zombi alone as critical");

    const normalTotal = sum(split.damages);
    const extraTotal = sum(split.critical);
    const lostZ = 300 - (await ctx.hp(zombi));
    const lostB = 300 - (await ctx.hp(bandit));
    ctx.expect(lostB === normalTotal, `Bandit: loses the normal damage only (${lostB}, roll ${normalTotal})`);
    ctx.expect(lostZ === normalTotal + extraTotal, `Zombi: loses the normal damage plus the critical dice (${lostZ}, ${normalTotal} + ${extraTotal})`);
    ctx.expect((r.targets.find(t => t.name === "Zombi")?.damage?.applied ?? null) === lostZ
      && (r.targets.find(t => t.name === "Bandit")?.damage?.applied ?? null) === lostB, "the engine's card records each target's own damage");

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `no error in the GM console${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
