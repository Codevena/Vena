import type { Skill } from '@vena/shared';

export class SkillInjector {
  generate(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    const entries = skills
      .map((skill) => {
        const triggers = skill.triggers.join(', ');
        return `<skill name="${skill.name}" triggers="${triggers}">${skill.description}</skill>`;
      })
      .join('\n');

    return `<available_skills>\n${entries}\n</available_skills>`;
  }
}
