import {
  presentChannelEpg,
  programStatus,
  sortSearchHits,
  toSearchHit,
} from '../../application/epg.presenter';
import type { XuiEpgEntry } from '../../../integrations/xui/domain/models';

function entry(partial: Partial<XuiEpgEntry> & Pick<XuiEpgEntry, 'id' | 'title'>): XuiEpgEntry {
  return {
    description: null,
    start: null,
    end: null,
    startAt: null,
    endAt: null,
    ...partial,
  };
}

describe('presentChannelEpg', () => {
  it('elige now y next según la ventana ISO', () => {
    const at = new Date('2026-10-29T15:30:00.000Z');
    const guide = presentChannelEpg(
      '10',
      [
        entry({
          id: '1',
          title: 'Pasado',
          startAt: '2026-10-29T14:00:00.000Z',
          endAt: '2026-10-29T15:00:00.000Z',
        }),
        entry({
          id: '2',
          title: 'Ahora',
          startAt: '2026-10-29T15:00:00.000Z',
          endAt: '2026-10-29T16:00:00.000Z',
        }),
        entry({
          id: '3',
          title: 'Siguiente',
          startAt: '2026-10-29T16:00:00.000Z',
          endAt: '2026-10-29T17:00:00.000Z',
        }),
      ],
      at,
    );
    expect(guide.now?.id).toBe('2');
    expect(guide.next?.id).toBe('3');
    expect(guide.streamId).toBe('10');
    expect(guide.items).toHaveLength(3);
  });

  it('sin marcas de tiempo usa el primer ítem como now', () => {
    const guide = presentChannelEpg('1', [
      entry({ id: 'a', title: 'Uno' }),
      entry({ id: 'b', title: 'Dos' }),
    ]);
    expect(guide.now?.id).toBe('a');
    expect(guide.next?.id).toBe('b');
  });

  it('calcula estado y ordena hits de búsqueda', () => {
    const at = new Date('2026-10-30T15:30:00.000Z');
    const live = entry({
      id: '2',
      title: 'Ahora',
      startAt: '2026-10-30T15:00:00.000Z',
      endAt: '2026-10-30T16:00:00.000Z',
    });
    const upcoming = entry({
      id: '3',
      title: 'Luego',
      startAt: '2026-10-30T16:00:00.000Z',
      endAt: '2026-10-30T17:00:00.000Z',
    });
    const ended = entry({
      id: '1',
      title: 'Antes',
      startAt: '2026-10-30T14:00:00.000Z',
      endAt: '2026-10-30T15:00:00.000Z',
    });
    expect(programStatus(live, at)).toBe('live');
    expect(programStatus(upcoming, at)).toBe('upcoming');
    expect(programStatus(ended, at)).toBe('ended');
    const channel = { id: '10', name: 'Demo', iconUrl: null };
    const hits = sortSearchHits([
      toSearchHit(ended, channel, at),
      toSearchHit(upcoming, channel, at),
      toSearchHit(live, channel, at),
    ]);
    expect(hits.map((hit) => hit.status)).toEqual(['live', 'upcoming', 'ended']);
    expect(hits[0]?.statusLabel).toBe('en emisión');
    expect(hits[0]?.startLocal).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
