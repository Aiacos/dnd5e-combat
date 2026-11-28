/**
 * Issue #47 — the attack roll mode (Advantage, Disadvantage, normal roll): what the engine decides, what dnd5e rolls, and what
 * the single card says about it. The Sorcerer casts Fire Bolt at the Zombi.
 *  - Invisible Zombi: Disadvantage alone — two d20, the lower kept; the card's "Attack" line shows both dice
 *    ("22 (Disadvantage: 16, 19)", the 19 struck out; without the discarded die, "22 (d20: 16)" reads like a normal roll,
 *    or like two dice of which the higher is taken).
 *  - Invisible and Blinded Zombi: Advantage and Disadvantage cancel out — a single d20, the two reasons and "cancel out"
 *    on the card.
 *  - Blinded Zombi: Advantage alone — two d20, the higher kept, both dice on the card.
 * The conditions are removed at the end of the scenario. The card's dice rows (`chatRows`) are off for the run.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "issue 47 — mode du jet d'attaque : décidé, lancé, affiché",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const status = (id, active) => ctx.call("set-status", { tokenId: zombi.id, statusId: id, active });
    ctx.restore(() => status("invisible", false));
    ctx.restore(() => status("blinded", false));
    // The text summary under test: with `chatRows` on (a world choice), the card shows Midi-style dice blocks instead of the
    // « Attack: 22 (Disadvantage: 16, 19) » line.
    const rows = await ctx.engine("setting", { key: "chatRows", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "chatRows", value: rows.before }));

    async function shoot() {
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      await pause(1500);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const roll = attack?.rolls?.[0] ?? null;
      const mods = attack?.flags?.[MODULE_ID]?.modifiers ?? { advantage: [], disadvantage: [] };
      const list = side => (mods[side] ?? []).map(r => `${r.who}.${r.key}`);
      const cards = await ctx.engine("chatCards", { count: 12 });
      const card = cards.find(c => c.id === used.usageMessageId) ?? null;
      const line = card?.rolls?.[0] ?? "";
      ctx.log(`mode ${roll?.options?.advantageMode} · ${roll?.formula} · carte : ${JSON.stringify(card?.rolls ?? null)}`);
      // The attack roll card itself (folded by the single card, visible with "Details" or without a single card).
      const detail = cards.find(c => (c.type === "attack") && (c.origin === used.usageMessageId))?.verdict ?? [];
      return { mode: roll?.options?.advantageMode ?? null, formula: roll?.formula ?? "", line, lines: card?.rolls ?? [], detail,
        advantage: list("advantage"), disadvantage: list("disadvantage") };
    }
    // The numbers of the "Attack: 22 (d20: 16 …)" line after the total: one die for a normal roll, two otherwise.
    const diceShown = line => (line.match(/\(([^)]*)\)/)?.[1] ?? "").replace(/d20/g, "").match(/\d+/g) ?? [];
    const diceShownIn = text => text.match(/\d+/g) ?? [];

    // 1. Disadvantage alone.
    await status("invisible", true);
    const dis = await shoot();
    ctx.expect(dis.disadvantage.includes("target.unseen") && !dis.advantage.length, `Zombi invisible : Désavantage seul décidé (${dis.disadvantage.join(", ")})`);
    ctx.expect(dis.mode === -1 && /^2d20(kl|dis)/.test(dis.formula), `le jet est lancé au Désavantage : deux d20, le plus bas gardé (mode ${dis.mode}, ${dis.formula})`);
    ctx.expect(diceShown(dis.line).length === 2, `la carte montre les deux d20 du Désavantage (« ${dis.line} »)`);
    ctx.expect(dis.detail.some(l => diceShownIn(l).length === 2), `la carte du jet d'attaque les montre aussi (${JSON.stringify(dis.detail)})`);

    // 2. Advantage and Disadvantage: normal roll.
    await status("blinded", true);
    const both = await shoot();
    ctx.expect(both.advantage.includes("attacker.unseen") && both.disadvantage.includes("target.unseen"), `Zombi invisible et aveuglé : les deux raisons (${[...both.advantage, ...both.disadvantage].join(", ")})`);
    ctx.expect(both.mode === 0 && /^1d20/.test(both.formula), `ils s'annulent : un seul d20 (mode ${both.mode}, ${both.formula})`);
    ctx.expect(diceShown(both.line).length === 1, `la carte montre un seul d20 (« ${both.line} »)`);
    ctx.expect(!both.detail.some(l => /\d/.test(l)), `jet normal : pas de ligne de dés sous le jet d'attaque (${JSON.stringify(both.detail)})`);
    ctx.expect(both.lines.length >= 4, `la carte nomme l'Avantage, le Désavantage et dit qu'ils s'annulent (${both.lines.length} lignes)`);

    // 3. Avantage seul.
    await status("invisible", false);
    const adv = await shoot();
    ctx.expect(adv.advantage.includes("attacker.unseen") && !adv.disadvantage.length, `Zombi aveuglé : Avantage seul décidé (${adv.advantage.join(", ")})`);
    ctx.expect(adv.mode === 1 && /^2d20(kh|adv)/.test(adv.formula), `le jet est lancé à l'Avantage : deux d20, le plus haut gardé (mode ${adv.mode}, ${adv.formula})`);
    ctx.expect(diceShown(adv.line).length === 2, `la carte montre les deux d20 de l'Avantage (« ${adv.line} »)`);
    await status("blinded", false);
  }
};
