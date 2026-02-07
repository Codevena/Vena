import { chromium, type Browser, type Page } from 'playwright';
import { ComputerError } from '@vena/shared';

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(options?: { headless?: boolean }): Promise<void> {
    if (this.browser) {
      throw new ComputerError('Browser already launched');
    }
    this.browser = await chromium.launch({
      headless: options?.headless ?? true,
    });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
  }

  private getPage(): Page {
    if (!this.page) {
      throw new ComputerError('Browser not launched. Call launch() first.');
    }
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    await this.getPage().goto(url, { waitUntil: 'domcontentloaded' });
  }

  async click(selector: string): Promise<void> {
    await this.getPage().click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    await this.getPage().fill(selector, text);
  }

  async getText(selector?: string): Promise<string> {
    const page = this.getPage();
    if (selector) {
      const el = await page.$(selector);
      if (!el) {
        throw new ComputerError(`Element not found: ${selector}`);
      }
      return (await el.textContent()) ?? '';
    }
    return await page.innerText('body');
  }

  async waitForSelector(selector: string, timeoutMs?: number): Promise<void> {
    await this.getPage().waitForSelector(selector, { timeout: timeoutMs });
  }

  async waitForTimeout(timeoutMs: number): Promise<void> {
    await this.getPage().waitForTimeout(timeoutMs);
  }

  async screenshot(): Promise<Buffer> {
    const buffer = await this.getPage().screenshot({ type: 'png' });
    return Buffer.from(buffer);
  }

  async evaluate(script: string): Promise<unknown> {
    return await this.getPage().evaluate(script);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
