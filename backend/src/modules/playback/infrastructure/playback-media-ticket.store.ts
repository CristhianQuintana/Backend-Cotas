import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface PlaybackMediaTicket {
  id: string;
  upstreamUrl: string;
  upstreamOrigin: string;
  protocolHint: 'hls' | 'progressive';
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class PlaybackMediaTicketStore {
  private readonly tickets = new Map<string, PlaybackMediaTicket>();

  issue(input: {
    upstreamUrl: string;
    protocolHint: 'hls' | 'progressive';
    ttlMs?: number;
  }): PlaybackMediaTicket {
    this.purgeExpired();
    const upstream = new URL(input.upstreamUrl);
    const ticket: PlaybackMediaTicket = {
      id: randomUUID().replace(/-/gu, ''),
      upstreamUrl: input.upstreamUrl,
      upstreamOrigin: `${upstream.protocol}//${upstream.host}`,
      protocolHint: input.protocolHint,
      expiresAtMs: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  get(id: string): PlaybackMediaTicket | null {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return null;
    }
    if (ticket.expiresAtMs <= Date.now()) {
      this.tickets.delete(id);
      return null;
    }
    return ticket;
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAtMs <= now) {
        this.tickets.delete(id);
      }
    }
  }
}
