import { execFile } from 'node:child_process';
import { ComputerError } from '@vena/shared';

export class KeyboardController {
  private runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], { timeout: 10_000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new ComputerError(`Keyboard action failed: ${err.message}`, { stderr }));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async typeText(text: string): Promise<void> {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await this.runAppleScript(
      `tell application "System Events" to keystroke "${escaped}"`,
    );
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    const modifierClause =
      modifiers && modifiers.length > 0
        ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
        : '';
    await this.runAppleScript(
      `tell application "System Events" to key code ${key}${modifierClause}`,
    );
  }

  async hotkey(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      throw new ComputerError('hotkey requires at least one key');
    }

    // Map common key names to AppleScript keystroke format
    const modifierMap: Record<string, string> = {
      cmd: 'command down',
      command: 'command down',
      ctrl: 'control down',
      control: 'control down',
      alt: 'option down',
      option: 'option down',
      shift: 'shift down',
    };

    const modifiers: string[] = [];
    let keystroke = '';

    for (const key of keys) {
      const mod = modifierMap[key.toLowerCase()];
      if (mod) {
        modifiers.push(mod);
      } else {
        keystroke = key;
      }
    }

    if (!keystroke) {
      throw new ComputerError('hotkey requires at least one non-modifier key');
    }

    const modClause = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : '';
    await this.runAppleScript(
      `tell application "System Events" to keystroke "${keystroke}"${modClause}`,
    );
  }

  async getClipboard(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('pbpaste', [], { timeout: 5_000 }, (err, stdout) => {
        if (err) {
          reject(new ComputerError(`Failed to read clipboard: ${err.message}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  async setClipboard(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = execFile('pbcopy', [], { timeout: 5_000 }, (err) => {
        if (err) {
          reject(new ComputerError(`Failed to set clipboard: ${err.message}`));
          return;
        }
        resolve();
      });
      proc.stdin?.write(text);
      proc.stdin?.end();
    });
  }
}
