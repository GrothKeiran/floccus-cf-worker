import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { initialAccount } from '../src/storage/initialize';
import type { Bindings } from '../src/types';
import { harness, PASSWORD } from './harness';
describe('初始化配置校验的明确错误提示', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  beforeAll(async () => { h = await harness({}, { migrate: false, legacySecrets: false }); });
  afterAll(async () => { await h?.close(); });
  const cases: [Record<string, string>, string][] = [
    [{ PASSWORD }, 'initial_username_missing'],
    [{ USERNAME: 'invalid name', PASSWORD }, 'initial_username_invalid'],
    [{ USERNAME: 'owner' }, 'initial_password_missing'],
    [{ USERNAME: 'owner', PASSWORD: 'tiny' }, 'initial_password_length_invalid'],
    [{ USERNAME: 'owner', PASSWORD: 'X'.repeat(257) }, 'initial_password_length_invalid'],
    [{ USERNAME: 'owner', PASSWORD: 'replace-with-a-real-password' }, 'initial_password_placeholder'],
  ];
  test.each(cases.map(([bindings, error]) => ({ bindings, error })))('区分错误配置 $error', async ({ bindings, error }) => {
    await h.restart(bindings, false);
    const response = await h.request('/init', 'GET', undefined, undefined, { Accept: 'application/json' });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error });
    expect(await h.db.prepare("SELECT name FROM sqlite_master WHERE name='users'").first()).toBeNull();
  });
  test('密码长度错误HTML明确说明未应用配置，不回显密码或输出成功文案', async () => {
    await h.restart({ USERNAME: 'owner', PASSWORD: 'Tin!' }, false);
    const response = await h.request('/init'); const text = await response.text();
    expect(response.status).toBe(503); expect(text).toContain('PASSWORD 长度不符合要求');
    expect(text).toContain('5～256'); expect(text).toContain('本次未应用新账号配置'); expect(text).not.toContain('Tin!');
    expect(text).not.toContain('<h1>初始化完成</h1>');
  });
  test('边界长度、大小写用户名和兼容别名保持原校验语义', () => {
    for (const length of [5, 256]) {
      expect(initialAccount({ USERNAME: ' SampleUser ', PASSWORD: 'X'.repeat(length) } as Bindings)).toEqual({ username: 'sampleuser', password: 'X'.repeat(length) });
    }
    expect(initialAccount({ BOOTSTRAP_USERNAME: 'owner', BOOTSTRAP_PASSWORD: PASSWORD } as Bindings)?.username).toBe('owner');
    expect(initialAccount({ USERNAME: 'owner', PASSWORD: 'X'.repeat(4) } as Bindings)).toBeNull();
  });
  test('非文本绑定安全拒绝，不因调用 trim 等字符串方法产生500', () => {
    expect(initialAccount({ USERNAME: 123, PASSWORD } as unknown as Bindings)).toBeNull();
    expect(initialAccount({ USERNAME: 'owner', PASSWORD: { secret: 'not-a-string' } } as unknown as Bindings)).toBeNull();
  });
});
