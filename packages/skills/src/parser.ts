import matter from 'gray-matter';
import { type Skill, SkillError } from '@vena/shared';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  triggers: string[];
}

export class SkillParser {
  parse(content: string, source: Skill['source'], filePath: string): Skill {
    try {
      const { data, content: body } = matter(content);
      const frontmatter = data as Partial<SkillFrontmatter>;

      if (!frontmatter.name) {
        throw new SkillError('Missing required field: name', filePath);
      }
      if (!frontmatter.description) {
        throw new SkillError('Missing required field: description', filePath);
      }
      if (!frontmatter.version) {
        throw new SkillError('Missing required field: version', filePath);
      }
      if (!frontmatter.triggers || !Array.isArray(frontmatter.triggers)) {
        throw new SkillError('Missing or invalid field: triggers', filePath);
      }

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        version: frontmatter.version,
        triggers: frontmatter.triggers,
        systemPrompt: body.trim(),
        enabled: true,
        source,
        path: filePath,
      };
    } catch (error) {
      if (error instanceof SkillError) {
        throw error;
      }
      throw new SkillError(
        `Failed to parse SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
        filePath,
      );
    }
  }
}
