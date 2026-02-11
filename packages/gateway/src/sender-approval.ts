import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@vena/shared';

const logger = createLogger('gateway:sender-approval');

export type ApprovalMode = 'open' | 'pairing' | 'allowlist';

export interface SenderRecord {
  id: string;
  channelName: string;
  status: 'approved' | 'blocked' | 'pending';
  approvedAt?: string;
  blockedAt?: string;
  pairingCode?: string;
  lastSeen: string;
}

export interface SenderApprovalOptions {
  mode: ApprovalMode;
  dataDir: string;
}

export class SenderApproval {
  private mode: ApprovalMode;
  private senders: Map<string, SenderRecord> = new Map();
  private filePath: string;

  constructor(options: SenderApprovalOptions) {
    this.mode = options.mode;
    this.filePath = path.join(options.dataDir, 'senders.json');
    this.load();
  }

  isApproved(userId: string, channelName: string): boolean {
    if (this.mode === 'open') return true;

    const key = `${channelName}:${userId}`;
    const record = this.senders.get(key);

    if (!record) {
      // Auto-create as pending
      this.senders.set(key, {
        id: userId,
        channelName,
        status: 'pending',
        lastSeen: new Date().toISOString(),
      });
      this.save();
      return false;
    }

    record.lastSeen = new Date().toISOString();
    return record.status === 'approved';
  }

  generatePairingCode(userId: string, channelName: string): string {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const key = `${channelName}:${userId}`;

    this.senders.set(key, {
      id: userId,
      channelName,
      status: 'pending',
      pairingCode: code,
      lastSeen: new Date().toISOString(),
    });
    this.save();

    logger.info({ userId, channel: channelName, code }, 'Pairing code generated');
    return code;
  }

  verifyPairingCode(userId: string, channelName: string, code: string): boolean {
    const key = `${channelName}:${userId}`;
    const record = this.senders.get(key);

    if (!record || !record.pairingCode) return false;
    if (record.pairingCode !== code.toUpperCase()) return false;

    record.status = 'approved';
    record.approvedAt = new Date().toISOString();
    record.pairingCode = undefined;
    this.save();

    logger.info({ userId, channel: channelName }, 'Sender approved via pairing code');
    return true;
  }

  approve(userId: string, channelName: string): void {
    const key = `${channelName}:${userId}`;
    const existing = this.senders.get(key);

    this.senders.set(key, {
      id: userId,
      channelName,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      lastSeen: existing?.lastSeen ?? new Date().toISOString(),
    });
    this.save();

    logger.info({ userId, channel: channelName }, 'Sender approved');
  }

  block(userId: string, channelName: string): void {
    const key = `${channelName}:${userId}`;
    const existing = this.senders.get(key);

    this.senders.set(key, {
      id: userId,
      channelName,
      status: 'blocked',
      blockedAt: new Date().toISOString(),
      lastSeen: existing?.lastSeen ?? new Date().toISOString(),
    });
    this.save();

    logger.info({ userId, channel: channelName }, 'Sender blocked');
  }

  listSenders(): SenderRecord[] {
    return Array.from(this.senders.values());
  }

  getMode(): ApprovalMode {
    return this.mode;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as SenderRecord[];
        for (const record of data) {
          const key = `${record.channelName}:${record.id}`;
          this.senders.set(key, record);
        }
      }
    } catch (err) {
      logger.warn({ error: err }, 'Failed to load senders data');
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.senders.values()), null, 2));
    } catch (err) {
      logger.error({ error: err }, 'Failed to save senders data');
    }
  }
}
