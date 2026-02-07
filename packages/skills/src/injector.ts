import type { Skill } from '@vena/shared';

function escapeXml(str: string): string {
  return str.replace(/[<>&"']/g, (c) => {
    const map: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return map[c] ?? c;
  });
}

export class SkillInjector {
  generate(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    const entries = skills
      .map((skill) => {
        const name = escapeXml(skill.name);
        const triggers = escapeXml(skill.triggers.join(', '));
        const description = escapeXml(skill.description);
        const prompt = escapeXml(skill.systemPrompt);
        return [
          `<skill name="${name}" triggers="${triggers}">`,
          `  <description>${description}</description>`,
          `  <prompt>${prompt}</prompt>`,
          `</skill>`,
        ].join('\n');
      })
      .join('\n');

    return `<available_skills>\n${entries}\n</available_skills>`;
  }
}
