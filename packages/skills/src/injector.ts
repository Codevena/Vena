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
  /**
   * Generate XML for system prompt injection.
   * Only includes model-invocable skills (excludes disableModelInvocation).
   */
  generate(skills: Skill[]): string {
    // Filter out skills that disable model invocation
    const modelSkills = skills.filter((s) => !s.disableModelInvocation);
    if (modelSkills.length === 0) {
      return '';
    }

    const entries = modelSkills
      .map((skill) => {
        const name = escapeXml(skill.name);
        const triggers = escapeXml(skill.triggers.join(', '));
        const description = escapeXml(skill.description);
        const prompt = escapeXml(skill.systemPrompt);
        const commandAttr = skill.command ? ` command="/${escapeXml(skill.command)}"` : '';
        return [
          `<skill name="${name}" triggers="${triggers}"${commandAttr}>`,
          `  <description>${description}</description>`,
          `  <prompt>${prompt}</prompt>`,
          `</skill>`,
        ].join('\n');
      })
      .join('\n');

    return `<available_skills>\n${entries}\n</available_skills>`;
  }
}
