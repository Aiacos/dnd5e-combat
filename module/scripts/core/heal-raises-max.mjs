/**
 * A heal that also raises maximum HP by the same amount (content key `healRaisesMax`, with `effectsFirst`): Heroes' Feast — "its HP
 * maximum increases by 2d10, and it gains the same number of HP". The rolled amount is added to the changes of the effect
 * placed before the heal. Pure functions.
 */

/** The total of the healing parts of a roll (`[{ type, value }]`). */
export function healingTotal(rolled) {
  return (rolled ?? []).filter(d => d?.type === "healing").reduce((n, d) => n + (Number(d.value) || 0), 0);
}

/** The changes of an effect, with the maximum HP increase (`system.attributes.hp.tempmax`) — replaced if it was already there. */
export function withMaxRaise(changes, amount) {
  const key = "system.attributes.hp.tempmax";
  return [...(changes ?? []).filter(c => c.key !== key), { key, type: "add", value: amount, priority: null }];
}
