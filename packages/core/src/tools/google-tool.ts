import type { Tool, ToolContext, ToolResult } from '@vena/shared';

// ── Adapter Interfaces (no googleapis dependency in core) ────────────

export interface GmailAdapter {
  listMessages(options?: { query?: string; maxResults?: number }): Promise<Array<{ id: string; from: string; subject: string; snippet: string; date: string }>>;
  getMessage(id: string): Promise<{ id: string; from: string; to: string; subject: string; body: string; date: string }>;
  sendMessage(to: string, subject: string, body: string): Promise<string>;
  replyToMessage(messageId: string, body: string): Promise<string>;
}

export interface CalendarAdapter {
  listEvents(options?: { timeMin?: string; timeMax?: string; maxResults?: number }): Promise<Array<{ id: string; summary: string; start: string; end: string; description?: string }>>;
  createEvent(event: { summary: string; start: string; end: string; description?: string; attendees?: string[] }): Promise<string>;
  deleteEvent(eventId: string): Promise<void>;
}

export interface DriveAdapter {
  listFiles(options?: { query?: string; maxResults?: number }): Promise<Array<{ id: string; name: string; mimeType: string; size?: string }>>;
  downloadFile(fileId: string): Promise<Buffer>;
  uploadFile(name: string, content: Buffer, mimeType: string): Promise<string>;
  createFolder(name: string): Promise<string>;
}

export interface DocsAdapter {
  getDocument(docId: string): Promise<{ title: string; body: string }>;
  createDocument(title: string, content?: string): Promise<string>;
  appendText(docId: string, text: string): Promise<void>;
}

export interface SheetsAdapter {
  readRange(spreadsheetId: string, range: string): Promise<string[][]>;
  writeRange(spreadsheetId: string, range: string, values: string[][]): Promise<void>;
  appendRow(spreadsheetId: string, range: string, values: string[]): Promise<void>;
  createSpreadsheet(title: string): Promise<string>;
}

export interface GoogleAdapters {
  gmail?: GmailAdapter;
  calendar?: CalendarAdapter;
  drive?: DriveAdapter;
  docs?: DocsAdapter;
  sheets?: SheetsAdapter;
}

// ── Tool ─────────────────────────────────────────────────────────────

export class GoogleTool implements Tool {
  name = 'google';
  description = 'Google Workspace: Gmail, Calendar, Drive, Docs, Sheets';
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'gmail_list', 'gmail_read', 'gmail_send', 'gmail_reply',
          'calendar_list', 'calendar_create', 'calendar_delete',
          'drive_list', 'drive_download', 'drive_upload', 'drive_mkdir',
          'docs_read', 'docs_create', 'docs_append',
          'sheets_read', 'sheets_write', 'sheets_append', 'sheets_create',
        ],
        description: 'The Google Workspace action to perform',
      },
      query: { type: 'string', description: 'Search query (gmail_list, drive_list)' },
      id: { type: 'string', description: 'Message/event/file/doc/spreadsheet ID' },
      to: { type: 'string', description: 'Recipient email (gmail_send)' },
      subject: { type: 'string', description: 'Email subject (gmail_send)' },
      body: { type: 'string', description: 'Email/doc body text' },
      title: { type: 'string', description: 'Title (docs_create, sheets_create, calendar_create)' },
      name: { type: 'string', description: 'File/folder name (drive_upload, drive_mkdir)' },
      start: { type: 'string', description: 'Event start ISO date (calendar_create)' },
      end: { type: 'string', description: 'Event end ISO date (calendar_create)' },
      range: { type: 'string', description: 'Cell range like A1:B10 (sheets_read, sheets_write)' },
      values: { type: 'array', description: 'Row values (sheets_write, sheets_append)' },
      max_results: { type: 'number', description: 'Max results to return (default 10)' },
    },
    required: ['action'],
  };

  private adapters: GoogleAdapters;

  constructor(adapters: GoogleAdapters) {
    this.adapters = adapters;
  }

  async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = input['action'] as string;
    const [service] = action.split('_');

    try {
      switch (action) {
        // ── Gmail ──
        case 'gmail_list': {
          if (!this.adapters.gmail) return this.notConfigured('Gmail');
          const msgs = await this.adapters.gmail.listMessages({
            query: input['query'] as string | undefined,
            maxResults: (input['max_results'] as number) ?? 10,
          });
          return { content: JSON.stringify(msgs, null, 2) };
        }
        case 'gmail_read': {
          if (!this.adapters.gmail) return this.notConfigured('Gmail');
          const id = input['id'] as string;
          if (!id) return this.missing('id');
          const msg = await this.adapters.gmail.getMessage(id);
          return { content: JSON.stringify(msg, null, 2) };
        }
        case 'gmail_send': {
          if (!this.adapters.gmail) return this.notConfigured('Gmail');
          const to = input['to'] as string;
          const subject = input['subject'] as string;
          const body = input['body'] as string;
          if (!to || !subject || !body) return this.missing('to, subject, body');
          const sentId = await this.adapters.gmail.sendMessage(to, subject, body);
          return { content: `Email sent (id: ${sentId})` };
        }
        case 'gmail_reply': {
          if (!this.adapters.gmail) return this.notConfigured('Gmail');
          const id = input['id'] as string;
          const body = input['body'] as string;
          if (!id || !body) return this.missing('id, body');
          const replyId = await this.adapters.gmail.replyToMessage(id, body);
          return { content: `Reply sent (id: ${replyId})` };
        }

        // ── Calendar ──
        case 'calendar_list': {
          if (!this.adapters.calendar) return this.notConfigured('Calendar');
          const events = await this.adapters.calendar.listEvents({
            maxResults: (input['max_results'] as number) ?? 10,
          });
          return { content: JSON.stringify(events, null, 2) };
        }
        case 'calendar_create': {
          if (!this.adapters.calendar) return this.notConfigured('Calendar');
          const summary = (input['title'] as string) ?? (input['subject'] as string);
          const start = input['start'] as string;
          const end = input['end'] as string;
          if (!summary || !start || !end) return this.missing('title, start, end');
          const eventId = await this.adapters.calendar.createEvent({
            summary, start, end,
            description: input['body'] as string | undefined,
          });
          return { content: `Event created (id: ${eventId})` };
        }
        case 'calendar_delete': {
          if (!this.adapters.calendar) return this.notConfigured('Calendar');
          const eventId = input['id'] as string;
          if (!eventId) return this.missing('id');
          await this.adapters.calendar.deleteEvent(eventId);
          return { content: 'Event deleted' };
        }

        // ── Drive ──
        case 'drive_list': {
          if (!this.adapters.drive) return this.notConfigured('Drive');
          const files = await this.adapters.drive.listFiles({
            query: input['query'] as string | undefined,
            maxResults: (input['max_results'] as number) ?? 10,
          });
          return { content: JSON.stringify(files, null, 2) };
        }
        case 'drive_download': {
          if (!this.adapters.drive) return this.notConfigured('Drive');
          const fileId = input['id'] as string;
          if (!fileId) return this.missing('id');
          const buffer = await this.adapters.drive.downloadFile(fileId);
          return { content: `Downloaded ${buffer.length} bytes`, metadata: { fileBuffer: buffer } };
        }
        case 'drive_upload': {
          if (!this.adapters.drive) return this.notConfigured('Drive');
          const name = input['name'] as string;
          const body = input['body'] as string;
          if (!name || !body) return this.missing('name, body');
          const id = await this.adapters.drive.uploadFile(name, Buffer.from(body, 'utf-8'), 'text/plain');
          return { content: `Uploaded ${name} (id: ${id})` };
        }
        case 'drive_mkdir': {
          if (!this.adapters.drive) return this.notConfigured('Drive');
          const name = input['name'] as string;
          if (!name) return this.missing('name');
          const folderId = await this.adapters.drive.createFolder(name);
          return { content: `Folder created: ${name} (id: ${folderId})` };
        }

        // ── Docs ──
        case 'docs_read': {
          if (!this.adapters.docs) return this.notConfigured('Docs');
          const docId = input['id'] as string;
          if (!docId) return this.missing('id');
          const doc = await this.adapters.docs.getDocument(docId);
          const truncated = doc.body.length > 10000 ? doc.body.slice(0, 10000) + '\n...(truncated)' : doc.body;
          return { content: `# ${doc.title}\n\n${truncated}` };
        }
        case 'docs_create': {
          if (!this.adapters.docs) return this.notConfigured('Docs');
          const title = input['title'] as string;
          if (!title) return this.missing('title');
          const docId = await this.adapters.docs.createDocument(title, input['body'] as string | undefined);
          return { content: `Document created: ${title} (id: ${docId})` };
        }
        case 'docs_append': {
          if (!this.adapters.docs) return this.notConfigured('Docs');
          const docId = input['id'] as string;
          const text = input['body'] as string;
          if (!docId || !text) return this.missing('id, body');
          await this.adapters.docs.appendText(docId, text);
          return { content: 'Text appended to document' };
        }

        // ── Sheets ──
        case 'sheets_read': {
          if (!this.adapters.sheets) return this.notConfigured('Sheets');
          const ssId = input['id'] as string;
          const range = input['range'] as string;
          if (!ssId || !range) return this.missing('id, range');
          const data = await this.adapters.sheets.readRange(ssId, range);
          return { content: JSON.stringify(data) };
        }
        case 'sheets_write': {
          if (!this.adapters.sheets) return this.notConfigured('Sheets');
          const ssId = input['id'] as string;
          const range = input['range'] as string;
          const values = input['values'] as string[][];
          if (!ssId || !range || !values) return this.missing('id, range, values');
          await this.adapters.sheets.writeRange(ssId, range, values);
          return { content: `Written to ${range}` };
        }
        case 'sheets_append': {
          if (!this.adapters.sheets) return this.notConfigured('Sheets');
          const ssId = input['id'] as string;
          const range = input['range'] as string;
          const row = input['values'] as string[];
          if (!ssId || !range || !row) return this.missing('id, range, values');
          await this.adapters.sheets.appendRow(ssId, range, row);
          return { content: `Row appended to ${range}` };
        }
        case 'sheets_create': {
          if (!this.adapters.sheets) return this.notConfigured('Sheets');
          const title = input['title'] as string;
          if (!title) return this.missing('title');
          const id = await this.adapters.sheets.createSpreadsheet(title);
          return { content: `Spreadsheet created: ${title} (id: ${id})` };
        }

        default:
          return { content: `Unknown action: ${action}`, isError: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Google ${service} error: ${message}`, isError: true };
    }
  }

  private notConfigured(service: string): ToolResult {
    return { content: `${service} is not configured. Set google.clientId and google.clientSecret in ~/.vena/vena.json`, isError: true };
  }

  private missing(params: string): ToolResult {
    return { content: `Missing required parameters: ${params}`, isError: true };
  }
}
