import assert from 'node:assert/strict';

import { calculateImpactCoefficient, clampRating } from '../../src/core/playerRatingUtils';

export const checkPlayerRatingUtilsPreserveSharedCurves = () => {
  assert.equal(clampRating(0.4), 1);
  assert.equal(clampRating(54.49), 54);
  assert.equal(clampRating(54.5), 55);
  assert.equal(clampRating(120), 99);

  assert.equal(calculateImpactCoefficient(70), 0.9);
  assert.equal(calculateImpactCoefficient(83), 1.03);
  assert.equal(calculateImpactCoefficient(84), 1.1);
  assert.equal(calculateImpactCoefficient(87), 1.34);
  assert.equal(calculateImpactCoefficient(88), 1.5);
  assert.equal(calculateImpactCoefficient(90), 1.8);
};
