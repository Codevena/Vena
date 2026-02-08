import { describe, it, expect } from 'vitest';
import { CHARACTERS, getCharacter, listCharacters } from '../characters.js';

describe('Characters', () => {
  const CHARACTER_IDS = ['nova', 'sage', 'spark', 'ghost', 'atlas'];

  it('all 5 characters exist', () => {
    for (const id of CHARACTER_IDS) {
      expect(CHARACTERS[id]).toBeDefined();
    }
    expect(Object.keys(CHARACTERS)).toHaveLength(5);
  });

  it('each character has required fields', () => {
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id]!;
      expect(c.id).toBe(id);
      expect(typeof c.name).toBe('string');
      expect(typeof c.tagline).toBe('string');
      expect(Array.isArray(c.traits)).toBe(true);
      expect(c.voice).toBeDefined();
      expect(typeof c.voice.tone).toBe('string');
      expect(typeof c.voice.style).toBe('string');
      expect(typeof c.voice.avoids).toBe('string');
      expect(typeof c.soulPrompt).toBe('string');
      expect(c.soulPrompt.length).toBeGreaterThan(0);
    }
  });

  it('getCharacter returns correct character', () => {
    const nova = getCharacter('nova');
    expect(nova).toBeDefined();
    expect(nova!.id).toBe('nova');
    expect(nova!.name).toBe('Nova');

    const atlas = getCharacter('atlas');
    expect(atlas).toBeDefined();
    expect(atlas!.id).toBe('atlas');
  });

  it('getCharacter returns undefined for unknown ID', () => {
    expect(getCharacter('nonexistent')).toBeUndefined();
    expect(getCharacter('')).toBeUndefined();
  });

  it('listCharacters returns all 5 characters', () => {
    const characters = listCharacters();
    expect(characters).toHaveLength(5);
    const ids = characters.map((c) => c.id);
    for (const id of CHARACTER_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('each character has 5 traits', () => {
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id]!;
      expect(c.traits).toHaveLength(5);
      for (const trait of c.traits) {
        expect(typeof trait.dimension).toBe('string');
        expect(typeof trait.value).toBe('number');
        expect(typeof trait.label).toBe('string');
      }
    }
  });

  it('ghost has empty greeting', () => {
    const ghost = getCharacter('ghost');
    expect(ghost!.greeting).toBe('');
  });

  it('each character has ttsVoiceId set', () => {
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id]!;
      expect(typeof c.ttsVoiceId).toBe('string');
      expect(c.ttsVoiceId!.length).toBeGreaterThan(0);
    }
  });
});
