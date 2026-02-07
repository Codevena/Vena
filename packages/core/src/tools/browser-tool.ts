import type { Tool, ToolContext, ToolResult } from '@vena/shared';

export interface BrowserAdapter {
  launch(options?: { headless?: boolean }): Promise<void>;
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  getText(selector?: string): Promise<string>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
}

export class BrowserTool implements Tool {
  name = 'browser';
  description = 'Control a web browser: navigate, click, type, read text, take screenshots';
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'click', 'type', 'get_text', 'screenshot', 'close'],
        description: 'The browser action to perform',
      },
      url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
      selector: { type: 'string', description: 'CSS selector (for click, type, get_text)' },
      text: { type: 'string', description: 'Text to type (for type action)' },
    },
    required: ['action'],
  };

  private adapter: BrowserAdapter;
  private launched = false;

  constructor(adapter: BrowserAdapter, private headless = true) {
    this.adapter = adapter;
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = input['action'] as string;

    try {
      // Auto-launch on first use
      if (!this.launched && action !== 'close') {
        await this.adapter.launch({ headless: this.headless });
        this.launched = true;
      }

      switch (action) {
        case 'navigate': {
          const url = input['url'] as string;
          if (!url) return { content: 'Missing required parameter: url', isError: true };
          await this.adapter.navigate(url);
          return { content: `Navigated to ${url}` };
        }
        case 'click': {
          const selector = input['selector'] as string;
          if (!selector) return { content: 'Missing required parameter: selector', isError: true };
          await this.adapter.click(selector);
          return { content: `Clicked ${selector}` };
        }
        case 'type': {
          const selector = input['selector'] as string;
          const text = input['text'] as string;
          if (!selector || !text) return { content: 'Missing required parameters: selector, text', isError: true };
          await this.adapter.type(selector, text);
          return { content: `Typed into ${selector}` };
        }
        case 'get_text': {
          const selector = input['selector'] as string | undefined;
          const text = await this.adapter.getText(selector);
          const truncated = text.length > 10000 ? text.slice(0, 10000) + '\n...(truncated)' : text;
          return { content: truncated };
        }
        case 'screenshot': {
          const buffer = await this.adapter.screenshot();
          return { content: `Screenshot taken (${buffer.length} bytes)`, metadata: { screenshot: buffer } };
        }
        case 'close': {
          await this.adapter.close();
          this.launched = false;
          return { content: 'Browser closed' };
        }
        default:
          return { content: `Unknown action: ${action}`, isError: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Browser error: ${message}`, isError: true };
    }
  }
}
