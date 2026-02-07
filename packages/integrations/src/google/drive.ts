import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { IntegrationError } from '@vena/shared';
import type { GoogleAuth } from './auth.js';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
  webViewLink: string;
}

export class DriveService {
  private drive: drive_v3.Drive;

  constructor(auth: GoogleAuth) {
    this.drive = google.drive({ version: 'v3', auth: auth.getClient() });
  }

  async listFiles(options?: {
    query?: string;
    folderId?: string;
    maxResults?: number;
  }): Promise<DriveFile[]> {
    try {
      const qParts: string[] = [];
      if (options?.query) qParts.push(options.query);
      if (options?.folderId) qParts.push(`'${options.folderId}' in parents`);
      qParts.push('trashed = false');

      const res = await this.drive.files.list({
        q: qParts.join(' and '),
        pageSize: options?.maxResults ?? 25,
        fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
      });

      return (res.data.files ?? []).map((file) => this.mapFile(file));
    } catch (error) {
      throw new IntegrationError(
        `Failed to list Drive files: ${error instanceof Error ? error.message : String(error)}`,
        'google-drive',
      );
    }
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    try {
      const res = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );

      return Buffer.from(res.data as ArrayBuffer);
    } catch (error) {
      throw new IntegrationError(
        `Failed to download Drive file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-drive',
      );
    }
  }

  async uploadFile(
    name: string,
    content: Buffer,
    mimeType: string,
    folderId?: string,
  ): Promise<string> {
    try {
      const parents = folderId ? [folderId] : undefined;
      const readable = new Readable();
      readable.push(content);
      readable.push(null);

      const res = await this.drive.files.create({
        requestBody: {
          name,
          parents,
        },
        media: {
          mimeType,
          body: readable,
        },
        fields: 'id',
      });

      const id = res.data.id;
      if (!id) {
        throw new Error('No file ID returned');
      }

      return id;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        `Failed to upload file ${name}: ${error instanceof Error ? error.message : String(error)}`,
        'google-drive',
      );
    }
  }

  async createFolder(name: string, parentId?: string): Promise<string> {
    try {
      const parents = parentId ? [parentId] : undefined;

      const res = await this.drive.files.create({
        requestBody: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents,
        },
        fields: 'id',
      });

      const id = res.data.id;
      if (!id) {
        throw new Error('No folder ID returned');
      }

      return id;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        `Failed to create folder ${name}: ${error instanceof Error ? error.message : String(error)}`,
        'google-drive',
      );
    }
  }

  async shareFile(fileId: string, email: string, role: string = 'reader'): Promise<void> {
    try {
      await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'user',
          role,
          emailAddress: email,
        },
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to share Drive file ${fileId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-drive',
      );
    }
  }

  private mapFile(file: drive_v3.Schema$File): DriveFile {
    return {
      id: file.id ?? '',
      name: file.name ?? '',
      mimeType: file.mimeType ?? '',
      size: file.size ?? '0',
      modifiedTime: file.modifiedTime ?? '',
      webViewLink: file.webViewLink ?? '',
    };
  }
}
