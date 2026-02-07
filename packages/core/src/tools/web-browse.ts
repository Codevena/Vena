import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { UrlValidator } from '../security/url-validator.js';

const MAX_CONTENT_LENGTH = 10000;

export class WebBrowseTool implements Tool {
  name = 'web_browse';
  description = 'Fetch a URL and return content as text';
  inputSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  };

  private urlValidator: UrlValidator;

  constructor(options?: { allowPrivateIPs?: boolean }) {
    this.urlValidator = new UrlValidator(options?.allowPrivateIPs ?? false);
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const url = input['url'] as string;

    const validation = this.urlValidator.validate(url);
    if (!validation.allowed) {
      return { content: `URL blocked: ${validation.reason}`, isError: true };
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Vena/1.0',
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          content: `HTTP ${response.status}: ${response.statusText}`,
          isError: true,
        };
      }

      const html = await response.text();
      const text = this.htmlToText(html);
      const truncated =
        text.length > MAX_CONTENT_LENGTH
          ? text.slice(0, MAX_CONTENT_LENGTH) + '\n...(truncated)'
          : text;

      return { content: truncated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to fetch URL: ${message}`, isError: true };
    }
  }

  private htmlToText(html: string): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br\s*\/?)>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');
    return text.trim();
  }
}
