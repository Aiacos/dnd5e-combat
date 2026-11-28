/**
 * §404: attack spells cast with a higher-level spell slot — played in the "Spell Arena". Each spell is cast two
 * levels above its own by the Caster on the Target (999 HP); on the first hit, the damage formula must have the
 * dice "Using a Higher-Level Spell Slot" (two more). Melf's Acid Arrow: also on a miss (half damage), and
 * the "Lingering Acid" effect applied on a hit keeps the scaling (`flags.dnd5e.scaling`, read by its end-of-turn damage).
 * `SORTS=<identifiant,…>` plays only those.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.SORTS ?? "").split(",").map(s => s.trim()).filter(Boolean);

// [identifier, PHB id, spell level, base dice (number, faces)]
const SPELLS = [
  ["chromatic-orb", "phbsplChromaticO", 1, 3, 8],
  ["guiding-bolt", "phbsplGuidingBol", 1, 4, 6],
  ["ray-of-sickness", "phbsplRayofSickn", 1, 2, 8],
  ["witch-bolt", "phbsplWitchBolt0", 1, 2, 12],
  ["melfs-acid-arrow", "phbsplMelfsAcidA", 2, 4, 4],
  ["vampiric-touch", "phbsplVampiricTo", 3, 3, 6]
];
const UP = 2;

export default {
  name: "sorts d'attaque lancés à un niveau supérieur — dés en plus (§404)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const hp0 = await ctx.hp(target);
    const ids = SPELLS.map(s => s[0]);
    ctx.restore(async () => {
      await ctx.removeEffectsFrom(target, ...ids);
      await ctx.removeEffectsFrom(caster, ...ids);
      await ctx.setHp(target, hp0);
    });

    /** The formula of the first roll of a damage message. */
    const formulaOf = async id => {
      const m = (await ctx.call("list-chat-messages", { limit: 60 })).messages?.find(x => x.id === id);
      const raw = m?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return roll?.formula ?? null;
    };

    for ( const [identifier, phbId, level, number, faces] of SPELLS ) {
      if ( only.length && !only.includes(identifier) ) continue;
      await ctx.ensureItem(caster, PHB(phbId));
      const cast = level + UP;
      const want = `${number + UP}d${faces}`;
      // A critical doubles the dice (`8d4` for an Arrow at 4d4): the expected count, or its double.
      const diceOk = formula => {
        const m = /^(\d+)d(\d+)/.exec(formula ?? "");
        return !!m && (Number(m[2]) === faces) && [number + UP, 2 * (number + UP)].includes(Number(m[1]));
      };
      const needMiss = identifier === "melfs-acid-arrow";
      const seen = {};
      for ( let n = 1; (n <= 20) && !(seen.hit && (!needMiss || seen.miss)); n++ ) {
        await ctx.setHp(target, 999);
        await ctx.removeEffectsFrom(target, identifier);
        await ctx.removeEffectsFrom(caster, identifier);
        const used = await ctx.use({ tokenId: caster.id, identifier, activityType: "attack", consume: false, targetTokenIds: [target.id],
          usageConfig: { scaling: UP, spell: { slot: `spell${cast}` }, [MODULE_ID]: { damageType: "acid" } } });
        const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 60000 }).catch(() => null) : null;
        if ( !r?.damageRoll?.messageId ) continue;
        const key = r.targets?.[0]?.hit ? "hit" : "miss";
        if ( seen[key] ) continue;
        seen[key] = await formulaOf(r.damageRoll.messageId);
        if ( (key === "hit") && needMiss ) {
          await pause(1000);
          const lingering = (await ctx.effects(target)).find(e => (e._id === "NgglkyjzTbDh5Loa") || /Lingering Acid|Acide persistant/i.test(e.name ?? ""));
          ctx.expect(Number(lingering?.flags?.dnd5e?.scaling) === UP,
            `Flèche acide niveau ${cast} : « Lingering Acid » garde la montée (scaling ${lingering?.flags?.dnd5e?.scaling ?? "absent"})`);
        }
      }
      ctx.expect(!!seen.hit, `${identifier} : un coup au but en 20 essais`);
      if ( seen.hit ) ctx.expect(diceOk(seen.hit), `${identifier} niveau ${cast}, touché : ${seen.hit} (attendu ${want})`);
      if ( needMiss ) {
        ctx.expect(!!seen.miss, `${identifier} : un raté en 20 essais`);
        if ( seen.miss ) ctx.expect(diceOk(seen.miss), `${identifier} niveau ${cast}, raté : ${seen.miss} (moitié de ${want})`);
      }
    }

    // ---- §405: an activity of a spell that spends no slot, at its Concentration level ----
    /** The scaling noted on a use message (`system.scaling`), which `list-chat-messages` does not return. */
    const usageScaling = async id => (await ctx.call("run-script", { code: `return game.messages.get("${id}")?.system?.scaling ?? 0;` }))?.result;

    // Flame Blade: "Evoke Blade" cast at level 4 spends the slot and sets Concentration; the next attack (without a
    // slot) must roll 5d6 + mod (3d6 at level 2, +1d6 per level above).
    if ( !only.length || only.includes("flame-blade") ) {
      ctx.restore(async () => { await ctx.removeEffectsFrom(caster, "flame-blade"); });
      await ctx.ensureItem(caster, PHB("phbsplFlameBlade"));
      const evoked = await ctx.use({ tokenId: caster.id, identifier: "flame-blade", activityId: "OIU1htXAoSF0cU3U", consume: false,
        usageConfig: { scaling: UP, spell: { slot: `spell${2 + UP}` } } });
      await pause(1000);
      const concentration = (await ctx.effects(caster)).find(e => (e.statuses ?? []).includes("concentrating"));
      ctx.expect(Number(concentration?.flags?.dnd5e?.scaling) === UP,
        `Lame de feu évoquée au niveau ${2 + UP} : concentration à +${concentration?.flags?.dnd5e?.scaling ?? "?"} (${evoked?.usageMessageId ? "carte" : "pas de carte"})`);
      let hit = null;
      for ( let n = 1; (n <= 20) && !hit; n++ ) {
        await ctx.setHp(target, 999);
        const used = await ctx.use({ tokenId: caster.id, identifier: "flame-blade", activityId: "dnd5eactivity000", consume: false, targetTokenIds: [target.id] });
        const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 60000 }).catch(() => null) : null;
        if ( n === 1 ) ctx.expect(Number(await usageScaling(used?.usageMessageId)) === UP, `attaque de la Lame : carte à +${await usageScaling(used?.usageMessageId)}`);
        if ( r?.targets?.[0]?.hit && r.damageRoll?.messageId ) hit = await formulaOf(r.damageRoll.messageId);
      }
      ctx.expect(!!hit, "Lame de feu : un coup au but en 20 essais");
      if ( hit ) {
        const m = /^(\d+)d6/.exec(hit);
        ctx.expect(!!m && [3 + UP, 2 * (3 + UP)].includes(Number(m[1])), `Lame de feu niveau ${2 + UP}, touché : ${hit} (attendu ${3 + UP}d6 + mod)`);
      }
    }
  }
};
