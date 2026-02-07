import { google, type sheets_v4 } from 'googleapis';
import { IntegrationError } from '@vena/shared';
import type { GoogleAuth } from './auth.js';

export class SheetsService {
  private sheets: sheets_v4.Sheets;

  constructor(auth: GoogleAuth) {
    this.sheets = google.sheets({ version: 'v4', auth: auth.getClient() });
  }

  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      return (res.data.values ?? []) as string[][];
    } catch (error) {
      throw new IntegrationError(
        `Failed to read range ${range} from spreadsheet ${spreadsheetId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-sheets',
      );
    }
  }

  async writeRange(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to write range ${range} to spreadsheet ${spreadsheetId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-sheets',
      );
    }
  }

  async appendRow(spreadsheetId: string, range: string, values: string[]): Promise<void> {
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [values] },
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to append row to spreadsheet ${spreadsheetId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-sheets',
      );
    }
  }

  async createSpreadsheet(title: string): Promise<string> {
    try {
      const res = await this.sheets.spreadsheets.create({
        requestBody: {
          properties: { title },
        },
      });

      const spreadsheetId = res.data.spreadsheetId;
      if (!spreadsheetId) {
        throw new Error('No spreadsheet ID returned');
      }

      return spreadsheetId;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(
        `Failed to create spreadsheet: ${error instanceof Error ? error.message : String(error)}`,
        'google-sheets',
      );
    }
  }
}
