import { convertLength } from "../core/units.mjs";

/**
 * Length conversion factors read from the system configuration
 * (CONFIG.DND5E.movementUnits.<unit>.conversion, expressed relative to the foot).
 * The only place that knows the shape of this configuration; the core receives only a table.
 * @returns {Record<string, number>}
 */
export function readUnitFactors() {
  const factors = {};
  for ( const [unit, config] of Object.entries(CONFIG.DND5E.movementUnits ?? {}) ) {
    if ( Number.isFinite(config?.conversion) ) factors[unit] = config.conversion;
  }
  return factors;
}

/**
 * A length expressed in the unit `to` (the grid's, usually); the value as is if a unit is unknown or
 * absent (`convertLength` then throws an error). `factors`: already read, for a loop.
 * @param {number} value
 * @param {string} from
 * @param {string} to
 * @param {Record<string, number>} [factors]
 */
export function lengthIn(value, from, to, factors=readUnitFactors()) {
  try { return convertLength(value, from, to, factors); }
  catch { return value; }
}
