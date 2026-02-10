import matter from 'gray-matter';
import { type Skill, type SkillRequirements, SkillError } from '@vena/shared';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  command?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  os?: string[];
  requires?: SkillRequirements;
}

export class SkillParser {
  parse(content: string, source: Skill['source'], filePath: string): Skill {
    try {
      const { data, content: body } = matter(content);
      const frontmatter = data as Partial<SkillFrontmatter>;

      if (!frontmatter.name) {
        throw new SkillError('Missing required field: name', filePath);
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(frontmatter.name)) {
        throw new SkillError(
          `Invalid skill name "${frontmatter.name}": must contain only alphanumeric characters, hyphens, and underscores`,
          filePath,
        );
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

      const systemPrompt = body.trim();

      if (systemPrompt.length > 10_000) {
        throw new SkillError(
          `System prompt exceeds 10,000 character limit (${systemPrompt.length} chars)`,
          filePath,
        );
      }

      const suspiciousPatterns = ['</skill>', '</available_skills>', '<system>'];
      for (const pattern of suspiciousPatterns) {
        if (systemPrompt.toLowerCase().includes(pattern.toLowerCase())) {
          throw new SkillError(
            `System prompt contains suspicious content: "${pattern}" — possible prompt injection`,
            filePath,
          );
        }
      }

      // Parse optional command dispatch field
      const command = typeof frontmatter.command === 'string' && frontmatter.command.trim()
        ? frontmatter.command.trim().replace(/^\//, '')  // strip leading /
        : undefined;

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        version: frontmatter.version,
        triggers: frontmatter.triggers,
        systemPrompt,
        enabled: true,
        source,
        path: filePath,
        command,
        userInvocable: frontmatter.userInvocable === true ? true : undefined,
        disableModelInvocation: frontmatter.disableModelInvocation === true ? true : undefined,
        os: Array.isArray(frontmatter.os) ? frontmatter.os : undefined,
        requires: frontmatter.requires ?? undefined,
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
