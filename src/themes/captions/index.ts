import type { CaptionDna } from './types';
import { CLASSIC_DNA } from './classic';
import { LOUD_DNA } from './loud';
import { KEYNOTE_DNA } from './keynote';

export const CAPTION_DNAS: Record<string, CaptionDna> = {
  classic: CLASSIC_DNA,
  loud: LOUD_DNA,
  keynote: KEYNOTE_DNA,
};

export const getCaptionDna = (id?: string): CaptionDna => {
  if (!id) return CLASSIC_DNA;
  const dna = CAPTION_DNAS[id];
  if (!dna) {
    console.warn(`Unknown caption dna "${id}", falling back to "classic"`);
    return CLASSIC_DNA;
  }
  return dna;
};

export type { CaptionDna } from './types';
