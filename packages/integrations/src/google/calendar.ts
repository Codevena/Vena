import { google, type calendar_v3 } from 'googleapis';
import { IntegrationError } from '@vena/shared';
import type { GoogleAuth } from './auth.js';

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
  location: string;
}

export class CalendarService {
  private calendar: calendar_v3.Calendar;

  constructor(auth: GoogleAuth) {
    this.calendar = google.calendar({ version: 'v3', auth: auth.getClient() });
  }

  async listEvents(options?: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    try {
      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: options?.timeMin,
        timeMax: options?.timeMax,
        maxResults: options?.maxResults ?? 25,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return (res.data.items ?? []).map((event) => this.mapEvent(event));
    } catch (error) {
      throw new IntegrationError(
        `Failed to list calendar events: ${error instanceof Error ? error.message : String(error)}`,
        'google-calendar',
      );
    }
  }

  async createEvent(event: {
    summary: string;
    start: string;
    end: string;
    description?: string;
    attendees?: string[];
  }): Promise<string> {
    try {
      const res = await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
          attendees: event.attendees?.map((email) => ({ email })),
        },
      });

      return res.data.id ?? '';
    } catch (error) {
      throw new IntegrationError(
        `Failed to create calendar event: ${error instanceof Error ? error.message : String(error)}`,
        'google-calendar',
      );
    }
  }

  async updateEvent(eventId: string, updates: Partial<CalendarEvent>): Promise<void> {
    try {
      const requestBody: calendar_v3.Schema$Event = {};

      if (updates.summary !== undefined) requestBody.summary = updates.summary;
      if (updates.description !== undefined) requestBody.description = updates.description;
      if (updates.location !== undefined) requestBody.location = updates.location;
      if (updates.start !== undefined) requestBody.start = { dateTime: updates.start };
      if (updates.end !== undefined) requestBody.end = { dateTime: updates.end };
      if (updates.attendees !== undefined) {
        requestBody.attendees = updates.attendees.map((email) => ({ email }));
      }

      await this.calendar.events.patch({
        calendarId: 'primary',
        eventId,
        requestBody,
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to update calendar event ${eventId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-calendar',
      );
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
    } catch (error) {
      throw new IntegrationError(
        `Failed to delete calendar event ${eventId}: ${error instanceof Error ? error.message : String(error)}`,
        'google-calendar',
      );
    }
  }

  private mapEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    return {
      id: event.id ?? '',
      summary: event.summary ?? '',
      description: event.description ?? '',
      start: event.start?.dateTime ?? event.start?.date ?? '',
      end: event.end?.dateTime ?? event.end?.date ?? '',
      attendees: (event.attendees ?? []).map((a) => a.email ?? ''),
      location: event.location ?? '',
    };
  }
}
