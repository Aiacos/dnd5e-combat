/**
 * Les attaques d'un item qui ignorent l'abri (`attackIgnoresCover: true | "half"`, DF #245 du 2026-11-23, §521 ; demande
 * darsh-homebrew#10, Éclat de feu de sort). Arène de test : le Guerrier interposé entre l'Ensorceleur et le Zombi donne un abri partiel
 * (case choisie par la règle du moteur, `coveringCell` d'abri.mjs). L'abri qui reste à l'attaque de Trait de feu (`cover`, `effective`) :
 *  1. sans règle : partiel ;
 *  2. `attackIgnoresCover: true` sur `fire-bolt` (surcouche du monde) : plus rien ;
 *  3. `"half"` : plus rien non plus contre un abri partiel ;
 *  4. règle retirée : de nouveau partiel.
 * Remis en état : position du Guerrier, surcouche.
 */
import { coveringCell } from "./abri.mjs";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "abri ignoré par les attaques d'un item — attackIgnoresCover (#245)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ensorceleur", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ensorceleur, Zombi ou Guerrier absent : non applicable"); return; }
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const itemId = await ctx.itemId(sorc.id, "fire-bolt");
    if ( !ctx.expect(!!itemId, "l'Ensorceleur a Trait de feu") ) return;
    const home = { x: guerrier.x, y: guerrier.y };
    ctx.restore(() => ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y }).catch(() => {}));
    const cell = coveringCell({ sorc, zombi, guerrier, tokens, size: await ctx.gridSize() });
    if ( !cell ) { ctx.log("aucune case libre où le Guerrier couvrirait : non applicable"); return; }
    await ctx.call("move-token", { tokenId: guerrier.id, x: cell.x, y: cell.y });
    await pause(800);
    const left = async () => (await ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id, itemId, effective: true }))?.degree ?? "none";

    const raw = await left();
    if ( !ctx.expect(raw === "half", `sans règle : abri partiel contre Trait de feu (${raw})`) ) return;
    const { before } = await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { attackIgnoresCover: true } });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "fire-bolt", entry: before }).catch(() => {}));
    // Une surcouche du monde déjà posée sur Trait de feu : gardée, la clé ajoutée par-dessus.
    if ( before ) await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { ...before, attackIgnoresCover: true } });
    await pause(300);
    const ignored = await left();
    ctx.expect(ignored === "none", `attackIgnoresCover: true — l'abri partiel ne compte plus (${ignored})`);
    await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: { ...(before ?? {}), attackIgnoresCover: "half" } });
    await pause(300);
    const half = await left();
    ctx.expect(half === "none", `attackIgnoresCover: "half" — l'abri partiel ne compte plus non plus (${half})`);
    await ctx.engine("overrideContent", { identifier: "fire-bolt", entry: before });
    await pause(300);
    const back = await left();
    ctx.expect(back === "half", `règle retirée : de nouveau partiel (${back})`);
  }
};
