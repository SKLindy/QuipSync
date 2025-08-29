import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

// Node.js serverless function signature (forces Node runtime)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const url = req.body?.url || '';
    if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'Invalid URL' });

    // Node 18+ has global fetch
    const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text());
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    res.status(200).json({ text: article?.textContent || '' });
  } catch (e) {
    res.status(500).json({ error: 'Extract failed', detail: String(e) });
  }
}
import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const body = await req.json();
    const url = body?.url || '';
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400 });
    }
    const html = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }}).then(r => r.text());
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return new Response(JSON.stringify({ text: article?.textContent || '' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Extract failed', detail: String(e) }), { status: 500 });
  }
}
