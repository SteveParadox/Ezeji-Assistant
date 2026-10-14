import { setTimeout as delay } from 'node:timers/promises';

export class ProviderError extends Error {
  constructor(code, { retryable = false, retryAfter = 0 } = {}) {
    super('Assistant generation unavailable');
    this.code = code; this.retryable = retryable; this.retryAfter = retryAfter;
  }
}
const number = (env, key, fallback, min, max) => {
  const n = env[key] === undefined ? fallback : Number(env[key]);
  if (!Number.isFinite(n) || (key==='GROQ_MAX_ATTEMPTS'&&!Number.isInteger(n)) || n < min || n > max) throw new Error(`Invalid ${key}`);
  return n;
};
export function groqConfiguration(env = process.env) {
  const model = env.GROQ_MODEL || 'openai/gpt-oss-20b';
  if (!/^[a-zA-Z0-9/._-]{1,100}$/.test(model)) throw new Error('Invalid GROQ_MODEL');
  return {
    apiKey: env.GROQ_API_KEY, model,
    timeoutMs: number(env, 'GROQ_RESPONSE_TIMEOUT_MS', 15000, 100, 30000),
    connectionTimeoutMs: number(env, 'GROQ_CONNECTION_TIMEOUT_MS', 8000, 100, 15000),
    maxTokens: number(env, 'GROQ_MAX_REPLY_TOKENS', 700, 64, 2000),
    maxAttempts: number(env, 'GROQ_MAX_ATTEMPTS', 3, 1, 3),
    maxRequestBytes: 48000,
    inputUsdPerMillion: number(env, 'GROQ_INPUT_USD_PER_MILLION', 0, 0, 1000),
    outputUsdPerMillion: number(env, 'GROQ_OUTPUT_USD_PER_MILLION', 0, 0, 1000),
  };
}
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now) || 0;
}
export function parseCompletion(payload) {
  const choice = payload?.choices?.[0];
  if (!choice || choice.message?.role !== 'assistant') throw new ProviderError('invalid_response');
  if (choice.message.tool_calls?.length || choice.finish_reason === 'tool_calls') throw new ProviderError('unauthorized_tool_call');
  if (choice.message.refusal) throw new ProviderError('refusal');
  if (choice.finish_reason !== 'stop') throw new ProviderError(choice.finish_reason === 'length' ? 'truncated_output' : 'invalid_finish');
  const reply = typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
  if (!reply || reply.length > 8000) throw new ProviderError('empty_or_oversized_output');
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const n = payload.usage?.[key];
    if (Number.isSafeInteger(n) && n >= 0) usage[key] = n;
  }
  return { reply, usage };
}
export function createGroqClient({ env = process.env, fetchImpl = fetch, sleep = delay, random = Math.random, clock = Date.now } = {}) {
  const config = groqConfiguration(env);
  return async ({ messages, correlationId, signal }) => {
    if (!config.apiKey) throw new ProviderError('provider_unconfigured');
    const body = JSON.stringify({ model: config.model, temperature: 0.25, max_completion_tokens: config.maxTokens, messages });
    if (Buffer.byteLength(body) > config.maxRequestBytes) throw new ProviderError('context_too_large');
    const started = clock();
    // Only text generation is retried. Tools and business writes never go to the provider.
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const responseSignal = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(signal ? [signal] : [])]);
        const connection = new AbortController();
        const connectTimer=setTimeout(()=>connection.abort(new DOMException('Connection timeout','TimeoutError')),config.connectionTimeoutMs);
        let response;
        try {response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', signal: AbortSignal.any([responseSignal, connection.signal]),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, 'X-Request-ID': correlationId }, body,
        });}finally{clearTimeout(connectTimer);}
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError(response.status === 429 ? 'rate_limited' : response.status === 401 || response.status === 403 ? 'provider_credentials' : response.status >= 500 ? 'provider_unavailable' : 'provider_request_rejected',
            { retryable: response.status === 429 || response.status >= 500, retryAfter: retryAfterMs(response.headers.get('retry-after'), clock()) });
        }
        let payload;
        try {
          // Read with a size bound, under the response deadline; never log provider bodies.
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          while (true) {
            responseSignal.throwIfAborted();
            const { value, done } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 64000) { await reader.cancel(); throw new ProviderError('oversized_response'); }
            chunks.push(Buffer.from(value));
          }
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (error) { if (error instanceof ProviderError) throw error; if(responseSignal.aborted)throw new ProviderError('timeout'); throw new ProviderError('invalid_response'); }
        const result = parseCompletion(payload);
        return { ...result, provider: 'groq', model: config.model, latencyMs: clock() - started, attempts: attempt,
          estimatedCostUsd: config.inputUsdPerMillion || config.outputUsdPerMillion
            ? ((result.usage.prompt_tokens || 0) * config.inputUsdPerMillion + (result.usage.completion_tokens || 0) * config.outputUsdPerMillion) / 1e6 : null };
      } catch (error) {
        if (signal?.aborted) throw new ProviderError('cancelled');
        // Ambiguous network interruption/timeout may already have generated tokens.
        // Do not regenerate blindly; only explicit provider 429/5xx responses retry.
        const safe = error instanceof ProviderError ? error : new ProviderError(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network_interruption');
        if (!safe.retryable || attempt === config.maxAttempts || safe.retryAfter > 5000) throw safe;
        await sleep(Math.max(safe.retryAfter, 250 * 2 ** (attempt - 1) + random() * 200), undefined, { signal });
      }
    }
  };
}
