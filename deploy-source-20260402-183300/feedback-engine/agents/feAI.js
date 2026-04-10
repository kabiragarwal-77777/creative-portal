// =============================================================================
// Feedback Engine — Shared AI Helper
// Uses OpenAI SDK (GPT-5.4) for all AI calls across agents
// =============================================================================

try { require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') }); } catch (e) { /* dotenv optional */ }

let OpenAI;
try { OpenAI = require('openai'); } catch (e) { /* will be handled in callAI */ }

const MODEL = process.env.FE_AI_MODEL || 'gpt-5.4';

let client = null;
function getClient() {
    if (!client && OpenAI) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}

/**
 * Call AI model with a prompt, return text response.
 * Falls back gracefully if no API key or SDK available.
 */
async function callAI(prompt, { system, maxTokens = 2048 } = {}) {
    const ai = getClient();
    if (!ai) {
        console.warn('[FE:AI] OpenAI SDK not available — skipping AI call');
        return null;
    }
    if (!process.env.OPENAI_API_KEY) {
        console.warn('[FE:AI] No OPENAI_API_KEY set — skipping AI call');
        return null;
    }

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const response = await ai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: maxTokens,
        messages
    });

    return response.choices[0].message.content.trim();
}

/**
 * Call AI and parse JSON from response.
 * Returns parsed object or fallback value on failure.
 */
async function callAIJson(prompt, { system, maxTokens = 2048, fallback = null } = {}) {
    const text = await callAI(prompt, { system, maxTokens });
    if (!text) return fallback;
    try {
        // Try direct parse
        return JSON.parse(text);
    } catch (e) {
        // Try extracting JSON from markdown fences or partial response
        const arrMatch = text.match(/\[[\s\S]*\]/);
        if (arrMatch) return JSON.parse(arrMatch[0]);
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) return JSON.parse(objMatch[0]);
        console.warn('[FE:AI] Failed to parse JSON from AI response:', text.substring(0, 200));
        return fallback;
    }
}

module.exports = { callAI, callAIJson, MODEL };
