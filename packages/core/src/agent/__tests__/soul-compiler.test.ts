import { describe, it, expect } from 'vitest';
import { SoulCompiler } from '../soul-compiler.js';
import { CHARACTERS, listCharacters } from '@vena/shared';
import type { Character, UserProfile } from '@vena/shared';

const compiler = new SoulCompiler();

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'test',
    name: 'TestBot',
    tagline: 'A test character.',
    traits: [],
    voice: { tone: 'neutral', style: 'plain', avoids: 'nothing' },
    coreValues: [],
    boundaries: [],
    greeting: 'Hello',
    soulPrompt: 'You are TestBot. Be helpful.',
    ...overrides,
  };
}

describe('SoulCompiler', () => {
  it('compiles character identity header', () => {
    const result = compiler.compile(makeCharacter());
    expect(result).toContain('You are TestBot. A test character.');
  });

  it('includes soulPrompt content', () => {
    const result = compiler.compile(makeCharacter({ soulPrompt: 'Custom soul prompt here.' }));
    expect(result).toContain('Custom soul prompt here.');
  });

  it('includes user profile when provided', () => {
    const profile: UserProfile = { name: 'Alice', language: 'en' };
    const result = compiler.compile(makeCharacter(), profile);
    expect(result).toContain('About Your User');
    expect(result).toContain('Alice');
  });

  it('uses preferredName over name when available', () => {
    const profile: UserProfile = { name: 'Alice', preferredName: 'Ali', language: 'en' };
    const result = compiler.compile(makeCharacter(), profile);
    expect(result).toContain('Ali');
    expect(result).not.toContain('- Name: Alice');
  });

  it('includes language in user profile section', () => {
    const profile: UserProfile = { name: 'Bob', language: 'de' };
    const result = compiler.compile(makeCharacter(), profile);
    expect(result).toContain('Language: de');
  });

  it('includes timezone in user profile section', () => {
    const profile: UserProfile = { name: 'Bob', language: 'en', timezone: 'America/New_York' };
    const result = compiler.compile(makeCharacter(), profile);
    expect(result).toContain('Timezone: America/New_York');
  });

  it('includes notes in user profile section', () => {
    const profile: UserProfile = { name: 'Bob', language: 'en', notes: 'Prefers concise answers' };
    const result = compiler.compile(makeCharacter(), profile);
    expect(result).toContain('Context: Prefers concise answers');
  });

  it('handles missing userProfile gracefully', () => {
    const result = compiler.compile(makeCharacter());
    expect(result).not.toContain('About Your User');
  });

  it('compiles each of the 5 characters', () => {
    const characters = listCharacters();
    expect(characters).toHaveLength(5);

    for (const character of characters) {
      const result = compiler.compile(character);
      expect(result).toContain(`You are ${character.name}.`);
      expect(result).toContain(character.soulPrompt);
    }
  });
});
