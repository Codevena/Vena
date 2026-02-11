import type { Tool, ToolContext, ToolResult } from '@vena/shared';
import { createLogger } from '@vena/shared';

const logger = createLogger('image-tool');

export interface ImageToolOptions {
  provider: 'openai' | 'stability';
  model: string;
  apiKey?: string;
}

export class ImageTool implements Tool {
  name = 'image_generate';
  description = 'Generate images from text prompts using AI image generation (DALL-E 3 or Stability AI).';
  inputSchema: Record<string, unknown> = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The image generation prompt',
      },
      size: {
        type: 'string',
        enum: ['1024x1024', '1024x1792', '1792x1024'],
        description: 'Image size (default: 1024x1024)',
      },
      style: {
        type: 'string',
        enum: ['vivid', 'natural'],
        description: 'Image style (default: vivid)',
      },
    },
    required: ['prompt'],
  };

  private options: ImageToolOptions;

  constructor(options: ImageToolOptions) {
    this.options = options;
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const prompt = String(input['prompt'] ?? '');
    const size = String(input['size'] ?? '1024x1024');
    const style = String(input['style'] ?? 'vivid');

    if (!prompt) {
      return { content: 'prompt is required.', isError: true };
    }

    if (!this.options.apiKey) {
      return { content: 'Image generation API key not configured.', isError: true };
    }

    try {
      if (this.options.provider === 'openai') {
        return await this.generateWithOpenAI(prompt, size, style);
      }
      return { content: `Provider "${this.options.provider}" not yet supported.`, isError: true };
    } catch (err) {
      logger.error({ error: err }, 'Image generation failed');
      return { content: `Image generation failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  private async generateWithOpenAI(prompt: string, size: string, style: string): Promise<ToolResult> {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt,
        n: 1,
        size,
        style,
        response_format: 'url',
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API error (${resp.status}): ${text}`);
    }

    const data = (await resp.json()) as {
      data: Array<{ url?: string; revised_prompt?: string }>;
    };

    const image = data.data[0];
    if (!image?.url) {
      return { content: 'No image URL returned.', isError: true };
    }

    const result = [`Image generated successfully.`, `URL: ${image.url}`];
    if (image.revised_prompt) {
      result.push(`Revised prompt: ${image.revised_prompt}`);
    }

    logger.info({ prompt: prompt.slice(0, 80), size, style }, 'Image generated');
    return { content: result.join('\n') };
  }
}
