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
}
