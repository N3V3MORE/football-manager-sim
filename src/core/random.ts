export interface RandomGenerator {
  next: () => number;
}

export const defaultRandomGenerator: RandomGenerator = {
  next: () => Math.random(),
};

export const createSeededRandomGenerator = (seed: number): RandomGenerator => {
  let state = seed >>> 0;
  return {
    next: () => {
      state += 0x6D2B79F5;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
};

export const resolveRandom = (rng?: RandomGenerator): (() => number) => {
  return typeof rng?.next === 'function' ? () => rng.next() : Math.random;
};