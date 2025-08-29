import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

const zScriptResponse = z.object({
  storyDetails: z.string().min(1),
  songAnalysis: z.string().min(1),
  whyThisWorks: z.string().min(1),
  scripts: z.array(z.object({
    script: z.string().min(1),
    deliveryNotes: z.string().min(1)
  })).length(3)
});

const zPersonalStyle = z.object({
  styleProfile: z.string().min(1),
  keyCharacteristics: z.array(z.string()).min(1),
  samplePhrases: z.array(z.string()).min(1),
  instructions: z.string().min(1)
});

const jsonGuard = (exampleJson) => `
You MUST return ONLY valid, parseable JSON with no surrounding text or markdown fences.
Match this shape exactly. Do not add extra keys. Do not include comments.

Example shape:
${exampleJson}
`;

function tryParseWith(schema, raw) {
  const clean = String(raw || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/,'');
  const parsed = JSON.parse(clean);
  return schema.parse(parsed);
}

async function completeStrictJSON({ anthropic, userPrompt, schema, exampleJson, maxTokens = 1400, temperature = 0.7, retries = 2 }) {
  let lastErr = null;
  const system = jsonGuard(exampleJson);
  let messages = [{ role: 'user', content: `${system}\n\n${userPrompt}` }];

  for (let i = 0; i <= retries; i++) {
    const msg = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: maxTokens,
      temperature,
      messages
    });
    const text = (msg.content || []).map(c => c?.text || '').join('');
    try {
      return tryParseWith(schema, text);
    } catch (err) {
      lastErr = err;
      const errMsg = err?.message?.slice(0, 800) || 'Validation failed';
      messages = [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: `Your previous output failed JSON validation:\n${errMsg}\n\nReturn ONLY valid JSON that matches the required shape.` }
      ];
    }
  }
  throw lastErr || new Error('Validation failed');
}

// Node.js serverless function signature (forces Node runtime)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { mode, prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Missing prompt' });
    if (!['script','style'].includes(mode)) return res.status(400).json({ error: 'Invalid mode (use "script" or "style")' });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    if (mode === 'script') {
      const example = JSON.stringify({
        storyDetails: "string",
        songAnalysis: "string",
        whyThisWorks: "string",
        scripts: [
          { script: "string", deliveryNotes: "string" },
          { script: "string", deliveryNotes: "string" },
          { script: "string", deliveryNotes: "string" }
        ]
      }, null, 2);

      const data = await completeStrictJSON({
        anthropic,
        userPrompt: prompt,
        schema: zScriptResponse,
        exampleJson: example,
        maxTokens: 1600,
        temperature: 0.7,
        retries: 2
      });
      return res.status(200).json({ ok: true, data });
    }

    if (mode === 'style') {
      const example = JSON.stringify({
        styleProfile: "string",
        keyCharacteristics: ["string"],
        samplePhrases: ["string"],
        instructions: "string"
      }, null, 2);

      const data = await completeStrictJSON({
        anthropic,
        userPrompt: prompt,
        schema: zPersonalStyle,
        exampleJson: example,
        maxTokens: 1200,
        temperature: 0.5,
        retries: 2
      });
      return res.status(200).json({ ok: true, data });
    }
  } catch (e) {
    return res.status(500).json({ error: 'LLM JSON endpoint failed', detail: String(e?.message || e) });
  }
}
