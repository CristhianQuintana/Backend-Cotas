import { presentChannelEpg } from '../../application/epg.presenter';
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
});
