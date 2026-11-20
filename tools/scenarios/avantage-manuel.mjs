/**
 * §480 : un Désavantage décidé par le moteur, écarté à la main au moment du jet. L'Ensorceleur tire un Trait de feu sur le Zombi
 * Invisible (Désavantage : cible non vue). Le choix du joueur est simulé là où dnd5e le pose, une fois les touches lues
 * (`dnd5e.postBuildAttackRollConfig`, `options.advantageMode`), comme la touche d'Avantage ou le bouton de la fenêtre de jet.
 *  1. Mode « normal » : un seul d20 ; la carte dit « écarté à la main » ; une alerte MJ nomme l'Ensorceleur.
 *  2. Mode « Avantage » : deux d20, le plus haut ; la carte dit « remplacé à la main ».
 *  3. Sans rien toucher : Désavantage, aucune ligne de plus, aucune nouvelle alerte.
 * L'état du Zombi et ses PV sont remis.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Désavantage écarté à la main au moment du jet — la carte et le MJ le savent",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const status = (id, active) => ctx.call("set-status", { tokenId: zombi.id, statusId: id, active });
    ctx.restore(() => status("invisible", false));
    const script = async (code, args={}) => (await ctx.call("run-script", { waitMs: 8000, args, code }))?.result;
    const alerts = () => script(`return game.messages.contents.filter(m => { const a = m.flags?.["${MODULE_ID}"]?.gmAlert;
      return a && a.text.includes(args.name); }).length;`, { name: sorc.name });

    async function shoot(mode) {
      if ( mode !== null ) await script(`Hooks.once("dnd5e.postBuildAttackRollConfig", (config, roll) => { roll.options.advantageMode = args.mode; }); return true;`, { mode });
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      await pause(1500);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const roll = attack?.rolls?.[0] ?? null;
      const cards = await ctx.engine("chatCards", { count: 12 });
      const card = cards.find(c => c.id === used.usageMessageId) ?? null;
      const lines = card?.rolls ?? [];
      ctx.log(`mode ${roll?.options?.advantageMode} · ${roll?.formula} · carte : ${JSON.stringify(lines)}`);
      return { mode: roll?.options?.advantageMode ?? null, formula: roll?.formula ?? "", lines,
        disadvantage: (attack?.flags?.[MODULE_ID]?.modifiers?.disadvantage ?? []).map(r => `${r.who}.${r.key}`) };
    }
    const mentions = (lines, word) => lines.some(l => l.toLowerCase().includes(word));

    await status("invisible", true);
    const before = await alerts();

    // 1. Jet normal choisi à la main.
    const normal = await shoot(0);
    ctx.expect(normal.disadvantage.includes("target.unseen"), `le moteur décide le Désavantage (${normal.disadvantage.join(", ")})`);
    ctx.expect(normal.mode === 0 && /^1d20/.test(normal.formula), `jet normal, un seul d20 (mode ${normal.mode}, ${normal.formula})`);
    ctx.expect(mentions(normal.lines, "set aside by hand"), `la carte dit « écarté à la main » (${JSON.stringify(normal.lines)})`);
    const afterNormal = await alerts();
    ctx.expect(afterNormal === before + 1, `une alerte MJ nomme l'Ensorceleur (${before} → ${afterNormal})`);

    // 2. Avantage choisi à la main.
    const adv = await shoot(1);
    ctx.expect(adv.mode === 1 && /^2d20(kh|adv)/.test(adv.formula), `jet à l'Avantage, deux d20 (mode ${adv.mode}, ${adv.formula})`);
    ctx.expect(mentions(adv.lines, "replaced by hand"), `la carte dit « remplacé à la main » (${JSON.stringify(adv.lines)})`);

    // 3. Sans rien toucher.
    const count = await alerts();
    const plain = await shoot(null);
    ctx.expect(plain.mode === -1, `sans choix : Désavantage (mode ${plain.mode}, ${plain.formula})`);
    ctx.expect(!mentions(plain.lines, "by hand"), `aucune ligne « à la main » (${JSON.stringify(plain.lines)})`);
    ctx.expect((await alerts()) === count, `aucune nouvelle alerte MJ`);
  }
};
