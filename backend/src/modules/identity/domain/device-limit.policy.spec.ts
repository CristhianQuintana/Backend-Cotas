import { resolveDeviceLimit } from './device-limit.policy';

describe('resolveDeviceLimit', () => {
  it('usa maxConnections de XUI cuando es >= 1', () => {
    expect(resolveDeviceLimit(15, 3)).toBe(15);
    expect(resolveDeviceLimit(10000, 3)).toBe(10000);
    expect(resolveDeviceLimit(1.9, 3)).toBe(1);
  });

  it('aplica failsafe ante null, undefined o inválidos', () => {
    expect(resolveDeviceLimit(null, 3)).toBe(3);
    expect(resolveDeviceLimit(undefined, 5)).toBe(5);
    expect(resolveDeviceLimit(0, 3)).toBe(3);
    expect(resolveDeviceLimit(-1, 3)).toBe(3);
    expect(resolveDeviceLimit(Number.NaN, 4)).toBe(4);
  });

  it('nunca permite failsafe menor a 1', () => {
    expect(resolveDeviceLimit(null, 0)).toBe(1);
    expect(resolveDeviceLimit(null, -2)).toBe(1);
  });
});
