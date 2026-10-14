// Supabase query builders support abortSignal. Mocks may be promises without it.
// DB timeouts can have ambiguous commit outcomes, so callers retry only durable RPCs.
export function assistantDatabaseRequest(query) {
 const timeout=Number(process.env.ASSISTANT_DATABASE_TIMEOUT_MS||10000);
 if(!Number.isInteger(timeout)||timeout<100||timeout>15000)throw new Error('Invalid ASSISTANT_DATABASE_TIMEOUT_MS');
 return typeof query.abortSignal==='function'?query.abortSignal(AbortSignal.timeout(timeout)):query;
}
