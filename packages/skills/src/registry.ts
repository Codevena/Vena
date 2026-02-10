import { type Skill, SkillError } from '@vena/shared';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  getEnabled(): Skill[] {
    return Array.from(this.skills.values()).filter((s) => s.enabled);
  }

  enable(name: string): void {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new SkillError(`Skill not found: ${name}`, name);
    }
    skill.enabled = true;
  }

  disable(name: string): void {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new SkillError(`Skill not found: ${name}`, name);
    }
    skill.enabled = false;
  }

  match(trigger: string): Skill[] {
    const lower = trigger.toLowerCase();
    return this.getEnabled().filter((skill) =>
      skill.triggers.some((t) => lower.includes(t.toLowerCase())),
    );
  }

  /** Find a skill by its slash command (e.g., "summarize" matches command: "summarize") */
  matchCommand(command: string): Skill | undefined {
    const normalized = command.toLowerCase().replace(/^\//, '');
    return this.getEnabled().find(
      (s) => s.command?.toLowerCase() === normalized,
    );
  }

  /** Get all skills that are user-invocable via slash commands */
  getUserInvocable(): Skill[] {
    return this.getEnabled().filter((s) => s.userInvocable && s.command);
  }

  /** Get skills eligible for model-driven invocation (excludes disableModelInvocation) */
  getModelInvocable(): Skill[] {
    return this.getEnabled().filter((s) => !s.disableModelInvocation);
  }
}
