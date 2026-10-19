import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { fail } from '../http';
import type { NodeRecord, Snapshot } from '../types';
const OFFICIAL_DOCTYPE = '<!DOCTYPE xbel PUBLIC "+//IDN python.org//DTD XML Bookmark Exchange Language 1.0//EN//XML" "http://pyxml.sourceforge.net/topics/dtds/xbel.dtd">';
export function parseXbel(xml: string, maxNodes = 5000): Snapshot {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) fail(422, 'xbel_declaration_required');
  // Allow the exact inert Floccus header; never resolve DTDs, external entities or XInclude.
  const withoutDoctype = xml.replace(OFFICIAL_DOCTYPE, '');
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA|<\?xml-stylesheet/i.test(withoutDoctype)) fail(422, 'unsafe_xml');
  let depth = 0;
  for (const match of withoutDoctype.matchAll(/<(\/?)([a-zA-Z][\w:.-]*)\b[^>]*>/g)) {
    if (match[1]) depth--; else if (!match[0].endsWith('/>')) depth++;
    if (depth > 68) fail(422, 'tree_too_deep');
  }
  if (XMLValidator.validate(xml) !== true) fail(422, 'invalid_xml');
  const high = [...xml.matchAll(/<!--- highestId :(\d+): for Floccus bookmark sync browser extension -->/g)];
  if (high.length !== 1) fail(422, 'highest_id_required');
  const highestId = Number(high[0][1]);
  if (!Number.isSafeInteger(highestId)) fail(422, 'invalid_highest_id');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, ignorePiTags: true, parseTagValue: false, trimValues: false });
  // XML parser types are intentionally narrowed here, not exposed to the rest of the application.
  type Part = { [key: string]: Part[] | string | Record<string, string> };
  let parsed: Part[];
  try { parsed = parser.parse(xml) as Part[]; } catch { return fail(422, 'invalid_xml'); }
  if (parsed.length !== 1 || !Array.isArray(parsed[0].xbel)) fail(422, 'xbel_root_required');
  const nodes: NodeRecord[] = [{ id: 0, parent: null, type: 'folder', title: 'root', url: null, position: 0 }];
  const seen = new Set([0]);
  function title(parts: Part[]): string {
    const first = parts.find(part => !('#text' in part))?.title;
    if (!Array.isArray(first)) fail(422, 'title_must_be_first');
    if (first.some(part => !('#text' in part))) fail(422, 'invalid_title');
    const value = first.map(part => String(part['#text'] ?? '')).join('');
    if (value.length > 4096) fail(422, 'title_too_long');
    return value;
  }
  function walk(parts: Part[], parent: number, depth: number): void {
    if (depth > 64) fail(422, 'tree_too_deep');
    let position = 0;
    for (const part of parts) {
      if ('title' in part || '#text' in part) continue;
      const type = 'folder' in part ? 'folder' : 'bookmark' in part ? 'bookmark' : null;
      if (!type || !Array.isArray(part[type])) fail(422, 'unsupported_xbel_element');
      const attr = (part[':@'] ?? {}) as Record<string, string>;
      if (!/^[1-9][0-9]*$/.test(attr['@_id'] ?? '')) fail(422, 'invalid_node_id');
      const id = Number(attr['@_id']);
      if (!Number.isSafeInteger(id) || id > highestId || seen.has(id)) fail(422, 'duplicate_or_invalid_id');
      seen.add(id);
      let url: string | null = null;
      if (type === 'bookmark') {
        url = attr['@_href'];
        if (typeof url !== 'string' || url.length > 4096 || /[\u0000-\u001f\u007f]/.test(url)) fail(422, 'invalid_url');
        let parsedUrl: URL;
        try { parsedUrl = new URL(url); } catch { return fail(422, 'invalid_url'); }
        if (!['https:', 'http:', 'ftp:', 'mailto:', 'tel:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) fail(422, 'unsafe_url');
        if ((part.bookmark as Part[]).some(p => !('title' in p) && !('#text' in p))) fail(422, 'bookmark_cannot_have_children');
      }
      const children = part[type] as Part[];
      nodes.push({ id, parent, type, title: title(children), url, position: position++ });
      if (nodes.length - 1 > maxNodes) fail(422, 'node_limit');
      if (type === 'folder') walk(children, id, depth + 1);
    }
  }
  walk(parsed[0].xbel as Part[], 0, 0);
  return { nodes, highestId };
}
