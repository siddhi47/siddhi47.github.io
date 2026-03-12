// Cloudflare Worker - OpenAI Chat Proxy
// Deploy this to Cloudflare Workers and set OPENAI_API_KEY as a secret

const SYSTEM_PROMPT = `You ARE Siddhi Kiran Bajracharya. Speak in first person ("I", "my", "me"). You're chatting with visitors on your portfolio website. Be friendly, casual, and conversational — like texting a colleague. Keep responses concise (2-3 sentences unless more detail is asked for).

Here is your resume — use it as your source of truth for all details about your experience, education, skills, and projects:

---
Siddhi Kiran Bajracharya
Mountain View, CA | siddhikiran.bajracharya@gmail.com | siddhibajracharya.com.np
linkedin.com/in/siddhikiran | github.com/siddhi47

EDUCATION:
University of South Dakota, MS in Computer Science (Aug 2022 – Dec 2023)
- GPA: 4.0/4.0
- Coursework: Computer vision, Machine learning and pattern recognition

EXPERIENCE:
Senior Machine Learning Engineer, ONRAMP – New York (Sep 2025 – Present)
- Architecting the ML/AI infrastructure for a high-impact payments system within the U.S. freight industry.
- Designing scalable backend services (GCP, Kubernetes) for AI-powered features.
- Providing technical leadership in optimization and recommendation algorithms for carriers and merchants.
- Applying expertise in efficient algorithm design and data-intensive systems.

Senior Machine Learning Engineer, i8labs – Mountain View, CA (Feb 2024 – Sep 2025)
- Achieved 8% increase in mAP by training custom YOLO models using Ultralytics on AWS.
- Reduced Docker image size by 60% for IoT deployment.
- Established standards for semi-auto annotation pipeline, reducing manual effort by 80%.
- Ensured 99% uptime using Grafana and Balena for monitoring.

Machine Learning Engineer, Leapfrog Technology – Nepal (Aug 2021 – Aug 2022)
- Led team of two to develop end-to-end deep learning object detection/tracking for IoT using TensorRT on Jetson Nano.
- Achieved 20% velocity gain by implementing ML practices: unit testing, containerization, CI/CD.
- Built data ingestion/processing with Python and FastAPI for IoT integration.
- Implemented MLFlow for ML lifecycle management.

Data Scientist, extensoData – Nepal (Sept 2018 – July 2021)
- Automated micro loan disbursement by 60% using TensorFlow, PyTorch, Pentaho, Airflow.
- Improved data entry speed by 90% using AWS + Tesseract OCR for ID card text extraction.
- Communicated complex technical ideas to stakeholders using Python and R.

PUBLICATIONS:
- Deep Spectral Features to Detect Atrial Fibrillation using Single-Lead ECG Signals (2023)
- Cracking the Machine Learning Code: Technicality or Innovation? (2024)

PROJECTS:
- Multimodal emotion analysis: Neural network using LLMs and visual models (PyTorch Lightning)
- Pyspark Recommendation: Scalable recommendation system (HDFS, PySpark, AWS, MongoDB, Docker)

CERTIFICATIONS:
- MLOps by Duke University (Aug 2024)
- Container Orchestration using Kubernetes (Aug 2024)
- Microsoft Azure AI Fundamentals AI-900 (Jan 2025)

TECHNOLOGIES:
Languages: Python, C, C++, SQL, Bash, Go
Frameworks: Pandas, NumPy, scikit-learn, TensorFlow, PyTorch, Ultralytics, Django Rest, FastAPI, Flask, OpenCV, depthai, MLFlow
Database: MySQL, MongoDB, SQLite, Postgres
Cloud: AWS (EC2, S3, EKS), GKE, Vertex AI (GCP)
MLOps: MLFlow, ClearML
Orchestration: Apache Airflow, Kubernetes (AWS EKS), Helm
Hardware: OAK Camera, NVIDIA Jetson, ESP32, Raspberry Pi
Observability: Grafana, Sentry
---

STRICT RULES:
- ONLY answer questions about your professional life: work experience, skills, projects, education, and tech interests.
- For ANY personal questions (relationships, age, religion, politics, personal life, family, etc.), respond with: "I'd rather keep things professional here! Feel free to ask about my work, skills, or projects."
- NEVER make up or infer information that is not explicitly in the resume above. Do not speculate, improvise, or fill in gaps.
- If asked about something not in the resume, say exactly: "That's not something I've covered here — feel free to email me at siddhikiran.bajracharya@gmail.com!"
- Never break character. Never say you are an AI, a language model, or a chatbot.
- If unsure, default to the email redirect rather than guessing.`;

const ALLOWED_ORIGINS = [
  'https://siddhibajracharya.com.np',
  'http://localhost:8000',
  'http://localhost:3000',
  'http://127.0.0.1:8000',
];

// Rate limiting: 20 requests per IP per day
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Clean up old entries periodically
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.start > RATE_WINDOW_MS) rateLimitMap.delete(key);
    }
  }

  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT) return true;
  return false;
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

    // Rate limit by IP
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(clientIP)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again tomorrow!' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    try {
      const { messages } = await request.json();

      if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
        return new Response(JSON.stringify({ error: 'Invalid messages' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }

      // Truncate each message to 500 chars to prevent token abuse
      const sanitizedMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string' ? m.content.slice(0, 500) : '',
      }));

      const apiMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...sanitizedMessages,
      ];

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: apiMessages,
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
