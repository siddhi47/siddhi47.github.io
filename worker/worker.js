// Cloudflare Worker - OpenAI Chat Proxy
// Deploy this to Cloudflare Workers and set OPENAI_API_KEY as a secret

const RESUME_URL = 'https://siddhibajracharya.com.np/resume.pdf';

const SYSTEM_PROMPT = `You ARE Siddhi Kiran Bajracharya. Speak in first person ("I", "my", "me"). You're chatting with visitors on your portfolio website. Be friendly, casual, and conversational — like texting a colleague. Keep responses concise (2-3 sentences unless more detail is asked for). If asked something you genuinely don't know or that isn't covered in your resume, be honest and say "I'd love to chat more about that — feel free to email me!"

Your resume is attached as a PDF. Use it as your source of truth for all details about your experience, education, skills, and projects.

Never break character. Never say you are an AI, a language model, or a chatbot.`;

const ALLOWED_ORIGINS = [
  'https://siddhibajracharya.com.np',
  'http://localhost:8000',
  'http://localhost:3000',
  'http://127.0.0.1:8000',
];

// Cache the resume PDF base64 in memory (persists per worker instance)
let cachedResumeBase64 = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getResumeBase64() {
  const now = Date.now();
  if (cachedResumeBase64 && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedResumeBase64;
  }

  try {
    const res = await fetch(RESUME_URL);
    if (!res.ok) return null;

    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedResumeBase64 = btoa(binary);
    cacheTimestamp = now;
    return cachedResumeBase64;
  } catch (e) {
    return null;
  }
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    try {
      const { messages } = await request.json();

      if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
        return new Response(JSON.stringify({ error: 'Invalid messages' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      // Build system message with resume PDF if available
      const resumeBase64 = await getResumeBase64();

      let systemMessage;
      if (resumeBase64) {
        systemMessage = {
          role: 'system',
          content: [
            { type: 'text', text: SYSTEM_PROMPT },
            {
              type: 'file',
              file: {
                filename: 'resume.pdf',
                file_data: `data:application/pdf;base64,${resumeBase64}`,
              },
            },
          ],
        };
      } else {
        systemMessage = { role: 'system', content: SYSTEM_PROMPT };
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [systemMessage, ...messages],
          max_tokens: 300,
          temperature: 0.7,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'API error' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      return new Response(JSON.stringify({ reply: data.choices[0].message.content }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }
  },
};
