import { execFile } from 'node:child_process';
import { ComputerError } from '@vena/shared';

export interface WindowInfo {
  app: string;
  title: string;
}

export class AppController {
  private runAppleScript(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], { timeout: 10_000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new ComputerError(`App control failed: ${err.message}`, { stderr }));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async openApp(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('open', ['-a', name], { timeout: 10_000 }, (err) => {
        if (err) {
          reject(new ComputerError(`Failed to open app: ${name}`, { error: err.message }));
          return;
        }
        resolve();
      });
    });
  }

  async quitApp(name: string): Promise<void> {
    await this.runAppleScript(`tell application "${name}" to quit`);
  }

  async focusApp(name: string): Promise<void> {
    await this.runAppleScript(`tell application "${name}" to activate`);
  }

  async listWindows(): Promise<WindowInfo[]> {
    const script = `
      set windowList to ""
      tell application "System Events"
        set appProcesses to every process whose visible is true
        repeat with proc in appProcesses
          set appName to name of proc
          try
            set wins to every window of proc
            repeat with w in wins
              set winTitle to name of w
              set windowList to windowList & appName & "|||" & winTitle & "\\n"
            end repeat
          end try
        end repeat
      end tell
      return windowList
    `;

    const output = await this.runAppleScript(script);
    if (!output) return [];

    return output
      .split('\n')
      .filter((line) => line.includes('|||'))
      .map((line) => {
        const [app, title] = line.split('|||');
        return { app: app ?? '', title: title ?? '' };
      });
  }

  async setVolume(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    // macOS volume is 0-100
    await this.runAppleScript(`set volume output volume ${clamped}`);
  }

  async setBrightness(level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, level));
    const normalized = clamped / 100;
    await this.runAppleScript(
      `tell application "System Events" to tell appearance preferences to set dark mode to false`,
    );
    // Use CoreBrightness via AppleScript bridge
    await this.runAppleScript(
      `do shell script "brightness ${normalized}" `,
    );
  }
}
