// Registers the roster with the combat engine.
import { registerCharacter } from '../combat/registry';
import type { CharacterDef } from '../combat/types';
import { BASTION } from './bastion';
import { MIRAGE } from './mirage';
import { RIOT } from './riot';
import { SOLENNE } from './solenne';
import { VESPER } from './vesper';

export const ROSTER: CharacterDef[] = [VESPER, MIRAGE, SOLENNE, BASTION, RIOT];
for (const c of ROSTER) registerCharacter(c);
