import type { Character, UserProfile } from '@vena/shared';

export class SoulCompiler {
  compile(character: Character, userProfile?: UserProfile): string {
    const sections: string[] = [];

    sections.push(`You are ${character.name}. ${character.tagline}`);
    sections.push(character.soulPrompt);

    if (userProfile) {
      sections.push(this.compileUserProfile(userProfile));
    }

    return sections.join('\n\n');
  }

  private compileUserProfile(profile: UserProfile): string {
    const lines = ['## About Your User'];
    lines.push(`- Name: ${profile.preferredName ?? profile.name}`);
    if (profile.language) lines.push(`- Language: ${profile.language}`);
    if (profile.timezone) lines.push(`- Timezone: ${profile.timezone}`);
    if (profile.notes) lines.push(`- Context: ${profile.notes}`);
    return lines.join('\n');
  }
}
