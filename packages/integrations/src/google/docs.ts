import { google, type docs_v1 } from 'googleapis';
import { IntegrationError } from '@vena/shared';
import type { GoogleAuth } from './auth.js';

export class DocsService {
  private docs: docs_v1.Docs;

  constructor(auth: GoogleAuth) {
    this.docs = google.docs({ version: 'v1', auth: auth.getClient() });
  }

  async getDocument(docId: string): Promise<{ title: string; body: string }> {
    try {
      const res = await this.docs.documents.get({ documentId: docId });
      const title = res.data.title ?? '';
      const body = this.extractText(res.data.body);
      return { title, body };
    } catch (error) {
      throw new IntegrationError(
        `Failed to get document ${docId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-docs',
      );
    }
  }

  async createDocument(title: string, content?: string): Promise<string> {
    try {
      const res = await this.docs.documents.create({
        requestBody: { title },
      });

      const docId = res.data.documentId;
      if (!docId) {
        throw new Error('No document ID returned');
      }

      if (content) {
        await this.docs.documents.batchUpdate({
          documentId: docId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: content,
                },
              },
            ],
          },
        });
      }

      return docId;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        `Failed to create document: ${error instanceof Error ? error.message : String(error)}`,
        'google-docs',
      );
    }
  }

  async appendText(docId: string, text: string): Promise<void> {
    try {
      const doc = await this.docs.documents.get({ documentId: docId });
      const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;

      await this.docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: endIndex - 1 },
                text,
              },
            },
          ],
        },
      });
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        `Failed to append text to document ${docId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-docs',
      );
    }
  }

  async replaceText(docId: string, search: string, replace: string): Promise<void> {
    try {
      await this.docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: search,
                  matchCase: true,
                },
                replaceText: replace,
              },
            },
          ],
        },
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to replace text in document ${docId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-docs',
      );
    }
  }

  private extractText(body: docs_v1.Schema$Body | undefined): string {
    if (!body?.content) return '';

    const parts: string[] = [];
    for (const element of body.content) {
      if (element.paragraph?.elements) {
        for (const el of element.paragraph.elements) {
          if (el.textRun?.content) {
            parts.push(el.textRun.content);
          }
        }
      }
    }
    return parts.join('');
  }
}
