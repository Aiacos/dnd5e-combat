/**
 * §458 : `onUsesSpent` — les livres à 48 heures de lecture du Guide. Arène de test (Magicien). Le Magicien reçoit le Manuel de vitalité
 * (sa donnée posait à « Read » l'effet d'un autre livre) et le Traité de compréhension (qui posait son +2 à chaque heure) ; leur compteur
 * est mis à 46 heures lues. Une lecture (47) : rien. La dernière (48) : l'effet du livre sur le Magicien (+2 Constitution, +2 Sagesse),
 * une seule fois, carte de chat. Objets et effets retirés.
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
    // Chemins relatifs à `system` (connecteur : `prepared.system[<chemin>]`).
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
      const marked = async () => (await effectsOf()).filter(e => e.flags?.[MODULE_ID]?.usesSpent?.source === book.uuid);

      // `consume: true` : l'outil du connecteur ne décompte rien par défaut ; c'est la case cochée qui compte ici.
      await ctx.use({ tokenId: mage.id, itemId, activityId: book.read, consume: true });
      await pause(1500);
      ctx.expect(await spentOf(itemId) === 47, `${book.label} : une heure de plus cochée (${await spentOf(itemId)} / 48)`);
      ctx.expect(!(await marked()).length, `${book.label} : 47 heures lues, aucun effet`);
      ctx.expect(!(await effectsOf()).some(e => (e.name === book.effect) && !before.some(b => b._id === e._id)),
        `${book.label} : « Read » ne pose plus d'effet à chaque heure`);

      // `consume: true` : l'outil du connecteur ne décompte rien par défaut ; c'est la case cochée qui compte ici.
      await ctx.use({ tokenId: mage.id, itemId, activityId: book.read, consume: true });
      let got = [];
      for ( let i = 0; i < 20 && !got.length; i++ ) { await pause(300); got = await marked(); }
      ctx.log(`${book.label} : ${got.map(e => `${e.name} ${JSON.stringify(e.system?.changes ?? e.changes)}`).join(" | ") || "rien"}`);
      ctx.expect((got.length === 1) && (got[0].name === book.effect), `${book.label} : 48 heures lues, l'effet « ${book.effect} » posé une fois`);
      const after = await ability(book.ability);
      ctx.expect((base !== null) && (after === Math.min(30, base + 2)), `${book.label} : ${book.ability} ${base} → ${after}`);
    }
  }
};
