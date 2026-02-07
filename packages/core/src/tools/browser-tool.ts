import type { Tool, ToolContext, ToolResult } from '@vena/shared';

export interface BrowserAdapter {
  launch(options?: { headless?: boolean }): Promise<void>;
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  getText(selector?: string): Promise<string>;
  screenshot(): Promise<Buffer>;
  evaluate?(script: string): Promise<unknown>;
  waitForSelector?(selector: string, timeoutMs?: number): Promise<void>;
  waitForTimeout?(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

export class BrowserTool implements Tool {
  name = 'browser';
  description = 'Control a web browser: navigate, click, click text, type, scroll, read text/html, evaluate scripts, take screenshots';
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate',
          'click',
          'click_text',
          'type',
          'scroll',
          'get_text',
          'get_html',
          'evaluate',
          'wait_for',
          'screenshot',
          'close',
        ],
        description: 'The browser action to perform',
      },
      url: { type: 'string', description: 'URL to navigate to (for navigate action)' },
      selector: { type: 'string', description: 'CSS selector (for click, type, get_text, scroll, wait_for)' },
      text: { type: 'string', description: 'Text to type or match (for type, click_text)' },
      exact: { type: 'boolean', description: 'Exact text match (for click_text)' },
      fuzzy: { type: 'boolean', description: 'Use fuzzy match (Levenshtein) for click_text' },
      min_score: { type: 'number', description: 'Minimum fuzzy match score 0..1 (click_text)' },
      nth: { type: 'number', description: 'Choose the nth match (1-based) for click_text' },
      x: { type: 'number', description: 'Horizontal scroll delta in pixels (for scroll)' },
      y: { type: 'number', description: 'Vertical scroll delta in pixels (for scroll)' },
      behavior: { type: 'string', enum: ['auto', 'smooth'], description: 'Scroll behavior (for scroll)' },
      script: { type: 'string', description: 'JavaScript to evaluate (for evaluate action)' },
      timeout_ms: { type: 'number', description: 'Timeout in milliseconds (for wait_for action)' },
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
        case 'click_text': {
          const text = input['text'] as string;
          const selector = input['selector'] as string | undefined;
          const exact = Boolean(input['exact']);
          const fuzzy = Boolean(input['fuzzy']);
          const minScoreRaw = input['min_score'] as number | undefined;
          const minScore = typeof minScoreRaw === 'number' ? Math.max(0, Math.min(1, minScoreRaw)) : 0.6;
          const nthRaw = input['nth'] as number | undefined;
          const nth = typeof nthRaw === 'number' && Number.isFinite(nthRaw) ? Math.max(1, Math.floor(nthRaw)) : 1;
          if (!text) return { content: 'Missing required parameter: text', isError: true };
          if (!this.adapter.evaluate) {
            return { content: 'Browser adapter does not support evaluate', isError: true };
          }
          const script = `
            (() => {
              const root = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document'};
              if (!root) return { ok: false, reason: 'root_not_found' };
              const matcher = ${exact ? 'true' : 'false'};
              const useFuzzy = ${fuzzy && !exact ? 'true' : 'false'};
              const minScore = ${minScore};
              const targetIndex = ${nth};
              const needle = ${JSON.stringify(text)};
              const needleLower = needle.toLowerCase();
              const levenshtein = (a, b) => {
                const m = a.length;
                const n = b.length;
                if (m === 0) return n;
                if (n === 0) return m;
                const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
                for (let i = 0; i <= m; i++) dp[i][0] = i;
                for (let j = 0; j <= n; j++) dp[0][j] = j;
                for (let i = 1; i <= m; i++) {
                  for (let j = 1; j <= n; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    dp[i][j] = Math.min(
                      dp[i - 1][j] + 1,
                      dp[i][j - 1] + 1,
                      dp[i - 1][j - 1] + cost
                    );
                  }
                }
                return dp[m][n];
              };
              const similarity = (a, b) => {
                const maxLen = Math.max(a.length, b.length);
                if (maxLen === 0) return 1;
                const dist = levenshtein(a, b);
                return 1 - dist / maxLen;
              };
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
              const candidates = [];
              while (walker.nextNode()) {
                const el = walker.currentNode;
                if (!(el instanceof HTMLElement)) continue;
                const t = (el.innerText || '').trim();
                if (!t) continue;
                if (matcher) {
                  if (t === needle) candidates.push({ el, text: t, score: 1 });
                  continue;
                }
                const lower = t.toLowerCase();
                if (!useFuzzy) {
                  if (lower.includes(needleLower)) candidates.push({ el, text: t, score: 1 });
                  continue;
                }
                const score = similarity(lower, needleLower);
                if (score >= minScore) {
                  candidates.push({ el, text: t, score });
                }
              }
              if (candidates.length === 0) return { ok: false, reason: 'not_found', count: 0 };
              if (useFuzzy) {
                candidates.sort((a, b) => b.score - a.score);
              }
              const index = targetIndex - 1;
              if (index < 0 || index >= candidates.length) {
                return { ok: false, reason: 'index_out_of_range', count: candidates.length };
              }
              const target = candidates[index];
              target.el.click();
              return { ok: true, matched: target.text, score: target.score, index: targetIndex, count: candidates.length };
            })()
          `;
          const result = await this.adapter.evaluate(script);
          const ok = typeof result === 'object' && result !== null && 'ok' in result ? (result as any).ok : false;
          if (!ok) {
            const reason = typeof result === 'object' && result !== null ? (result as any).reason : 'not_found';
            const details = selector ? ` in ${selector}` : '';
            return { content: `Text not found${details}: "${text}" (${reason})`, isError: true };
          }
          const matched = typeof result === 'object' && result !== null ? (result as any).matched : text;
          const score = typeof result === 'object' && result !== null ? (result as any).score : undefined;
          const count = typeof result === 'object' && result !== null ? (result as any).count : undefined;
          const scoreLabel = typeof score === 'number' ? ` (score ${score.toFixed(2)})` : '';
          const countLabel = typeof count === 'number' ? ` among ${count} matches` : '';
          return { content: `Clicked text: "${matched}"${countLabel}${scoreLabel}` };
        }
        case 'type': {
          const selector = input['selector'] as string;
          const text = input['text'] as string;
          if (!selector || !text) return { content: 'Missing required parameters: selector, text', isError: true };
          await this.adapter.type(selector, text);
          return { content: `Typed into ${selector}` };
        }
        case 'scroll': {
          const selector = input['selector'] as string | undefined;
          const behavior = (input['behavior'] as string) === 'smooth' ? 'smooth' : 'auto';
          if (!this.adapter.evaluate) {
            return { content: 'Browser adapter does not support evaluate', isError: true };
          }

          if (selector) {
            const script = `
              (() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return false;
                el.scrollIntoView({ behavior: ${JSON.stringify(behavior)}, block: 'center', inline: 'nearest' });
                return true;
              })()
            `;
            const ok = await this.adapter.evaluate(script);
            if (ok === false) {
              return { content: `Element not found: ${selector}`, isError: true };
            }
            return { content: `Scrolled to ${selector}` };
          }

          const hasX = typeof input['x'] === 'number';
          const hasY = typeof input['y'] === 'number';
          const x = hasX ? (input['x'] as number) : 0;
          const y = hasY ? (input['y'] as number) : 0;
          const dx = hasX || hasY ? x : 0;
          const dy = hasX || hasY ? y : 800;
          const script = `window.scrollBy({ left: ${dx}, top: ${dy}, behavior: ${JSON.stringify(behavior)} });`;
          await this.adapter.evaluate(script);
          return { content: `Scrolled by x=${dx}, y=${dy}` };
        }
        case 'get_text': {
          const selector = input['selector'] as string | undefined;
          const text = await this.adapter.getText(selector);
          const truncated = text.length > 10000 ? text.slice(0, 10000) + '\n...(truncated)' : text;
          return { content: truncated };
        }
        case 'get_html': {
          if (!this.adapter.evaluate) {
            return { content: 'Browser adapter does not support evaluate', isError: true };
          }
          const html = await this.adapter.evaluate('document.documentElement.outerHTML');
          const htmlStr = typeof html === 'string' ? html : JSON.stringify(html, null, 2);
          const truncated = htmlStr.length > 10000 ? htmlStr.slice(0, 10000) + '\n...(truncated)' : htmlStr;
          return { content: truncated };
        }
        case 'evaluate': {
          const script = input['script'] as string;
          if (!script) return { content: 'Missing required parameter: script', isError: true };
          if (!this.adapter.evaluate) {
            return { content: 'Browser adapter does not support evaluate', isError: true };
          }
          const result = await this.adapter.evaluate(script);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          const truncated = resultStr.length > 10000 ? resultStr.slice(0, 10000) + '\n...(truncated)' : resultStr;
          return { content: truncated };
        }
        case 'wait_for': {
          const selector = input['selector'] as string | undefined;
          const timeoutMs = input['timeout_ms'] as number | undefined;
          if (selector) {
            if (!this.adapter.waitForSelector) {
              return { content: 'Browser adapter does not support wait_for selector', isError: true };
            }
            await this.adapter.waitForSelector(selector, timeoutMs);
            return { content: `Waited for ${selector}` };
          }
          if (typeof timeoutMs === 'number') {
            if (!this.adapter.waitForTimeout) {
              return { content: 'Browser adapter does not support wait_for timeout', isError: true };
            }
            await this.adapter.waitForTimeout(timeoutMs);
            return { content: `Waited ${timeoutMs}ms` };
          }
          return { content: 'Missing required parameter: selector or timeout_ms', isError: true };
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
