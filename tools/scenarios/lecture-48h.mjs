/**
 * §458: `onUsesSpent` — the 48-hour reading books of the Dungeon Master's Guide. Arène de test (Wizard). The Wizard gets the
 * Manual of Bodily Health (its data put another book's effect on "Read") and the Tome of Understanding (which put its +2 on
 * every hour); their counter is set to 46 hours read. One reading (47): nothing. The last one (48): the book's effect on the
 * Wizard (+2 Constitution, +2 Wisdom), only once, chat card. Objects and effects removed.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const BOOKS = [
  { uuid: `${DMG}dmgManualOfBodil`, read: "L5OnUjZIn27NHd2E", effect: "Healthy", ability: "con", label: "Manuel de vitalité" },
  { uuid: `${DMG}dmgTomeOfUnderst`, read: "5cPQGohyjYHSemQF", effect: "Understanding", ability: "wis", label: "Traité de compréhension" }
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "livres à 48 heures de lecture — le +2 à la fin de la lecture, une fois (onUsesSpent)",

  async run(ctx) {
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const actorId = mage.actorId;
    const effectsOf = async () => (await ctx.call("get-actor", { actorId })).effects ?? [];
    // Paths relative to `system` (connector: `prepared.system[<chemin>]`).
    const ability = async key => (await ctx.call("get-actor", { actorId, preparedPaths: [`abilities.${key}.value`] }).catch(() => null))
      ?.prepared?.system?.[`abilities.${key}.value`] ?? null;
    const spentOf = async itemId => ((await ctx.call("get-actor", { actorId })).items ?? []).find(i => i._id === itemId)?.system?.uses?.spent ?? null;
    const before = await effectsOf();
    ctx.restore(async () => {
      const added = (await effectsOf()).filter(e => !before.some(b => b._id === e._id) && e.flags?.[MODULE_ID]?.usesSpent);
      for ( const e of added ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
    });

    for ( const book of BOOKS ) {
      const itemId = await ctx.ensureItem(mage, book.uuid);
      const base = await ability(book.ability);
      await ctx.call("upsert-actor-item", { actorId, itemData: { "system.uses.spent": 46 }, match: { path: "_id", value: itemId } });
      // The book lent by the scenario does not always keep its compendium uuid: the effect is recognized by its mark and its name.
      const marked = async () => (await effectsOf()).filter(e => e.flags?.[MODULE_ID]?.usesSpent && (e.name === book.effect));

      // `consume: true`: the connector's tool counts nothing by default; the ticked box is what counts here.
      await ctx.use({ tokenId: mage.id, itemId, activityId: book.read, consume: true });
      await pause(1500);
      ctx.expect(await spentOf(itemId) === 47, `${book.label} : une heure de plus cochée (${await spentOf(itemId)} / 48)`);
      ctx.expect(!(await marked()).length, `${book.label} : 47 heures lues, aucun effet`);
      ctx.expect(!(await effectsOf()).some(e => (e.name === book.effect) && !before.some(b => b._id === e._id)),
        `${book.label} : « Read » ne pose plus d'effet à chaque heure`);

      // `consume: true`: the connector's tool counts nothing by default; the ticked box is what counts here.
      await ctx.use({ tokenId: mage.id, itemId, activityId: book.read, consume: true });
      ctx.log(`${book.label} : après la 2e lecture, ${await spentOf(itemId)} / 48 cochées`);
      let got = [];
      for ( let i = 0; i < 20 && !got.length; i++ ) { await pause(300); got = await marked(); }
      ctx.log(`${book.label} : ${got.map(e => `${e.name} ${JSON.stringify(e.system?.changes ?? e.changes)}`).join(" | ") || "rien"}`);
      ctx.expect((got.length === 1) && (got[0].name === book.effect), `${book.label} : 48 heures lues, l'effet « ${book.effect} » posé une fois`);
      const after = await ability(book.ability);
      ctx.expect((base !== null) && (after === Math.min(30, base + 2)), `${book.label} : ${book.ability} ${base} → ${after}`);
    }
  }
};
