import { expect, test } from 'vitest';
import { parseXbel } from '../src/domain/xbel';
import { bookmark, xbel } from './harness';
test('真实官方缩进、XML 实体、空标题与稳定位置', () => {
  const body = xbel('\n<folder id="1">\n  <title> A &amp; B </title>\n  <bookmark id="2" href="https://example.com/?a=1&amp;b=2">\n    <title></title>\n  </bookmark>\n</folder>', 2);
  const tree = parseXbel(body);
  expect(tree.nodes[1]).toMatchObject({ parent: 0, title: ' A & B ', position: 0 });
  expect(tree.nodes[2]).toMatchObject({ parent: 1, title: '', url: 'https://example.com/?a=1&b=2', position: 0 });
});
test('节点数量、深度、缺失 ID、重复根 ID、反序列化协议格式限制', () => {
  expect(() => parseXbel(xbel(bookmark(1) + bookmark(2), 2), 1)).toThrow('node_limit');
  expect(() => parseXbel(xbel('<folder id="0"><title>x</title></folder>'))).toThrow('invalid_node_id');
  expect(() => parseXbel(xbel('<bookmark href="https://example.com/"><title>x</title></bookmark>'))).toThrow('invalid_node_id');
  expect(() => parseXbel(xbel(bookmark(1)).replace('highestId', 'unknown'))).toThrow('highest_id_required');
  const nested = Array.from({ length: 70 }, (_, i) => `<folder id="${i + 1}"><title>x</title>`).join('') + '</folder>'.repeat(70);
  expect(() => parseXbel(xbel(nested, 70))).toThrow('tree_too_deep');
});
test('仅接收无凭证的安全 URL、禁止实体扩展和脚本协议', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://user:secret@example.com/', 'chrome://settings/']) expect(() => parseXbel(xbel(bookmark(1, 'x', url)))).toThrow('unsafe_url');
  expect(() => parseXbel(xbel(bookmark(1)).replace('<xbel', '<!ENTITY a "123"><xbel'))).toThrow('unsafe_xml');
  expect(() => parseXbel(xbel(bookmark(1)).replace('</bookmark>', ''))).toThrow('invalid_xml');
});
