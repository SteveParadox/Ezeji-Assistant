import crypto from "node:crypto";
import { buildAssistantSystemPrompt } from "./assistantPrompt.js";

// Owner-only preview: real saved configuration, no customer conversation writes.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

export function attachAssistantPreviewRoute(app, supabase, generateAssistantReply) {
  app.post("/assistant-preview", async (req, res) => {
    let reservedId = null;
    try {
      if (!supabase) return res.status(503).json({ error: "Assistant preview is unavailable." });
      const match = /^Bearer (\S+)$/i.exec(req.headers.authorization || "");
      if (!match) return res.status(401).json({ error: "Sign in to test your assistant." });
      const { data: auth, error: authError } = await supabase.auth.getUser(match[1]);
      if (authError || !auth?.user?.id) return res.status(401).json({ error: "Session expired. Sign in again." });

      const { message, businessId, conversation, requestId } = req.body || {};
      if (typeof businessId !== "string" || !UUID_PATTERN.test(businessId) || auth.user.id !== businessId) {
        return res.status(403).json({ error: "Only the business owner can preview this assistant." });
      }
      if (typeof message !== "string" || !message.trim() || message.length > 2000) {
        return res.status(400).json({ error: "Enter a message of 2,000 characters or fewer." });
      }
      if (conversation !== undefined && (!Array.isArray(conversation) || conversation.length > 12 ||
        conversation.some((row) => !row || !["customer", "ai"].includes(row.from) ||
          typeof row.text !== "string" || row.text.length > 2000))) {
        return res.status(400).json({ error: "Invalid conversation history." });
      }

      const [profile, faqs, services] = await Promise.all([
        supabase.from("profiles")
          .select("id,business,plan,service_name,price,hours,description,assistant_name,tone,greeting,escalation_keywords,hours_json")
          .eq("id", businessId).maybeSingle(),
        supabase.from("faqs").select("question,answer").eq("business_id", businessId).limit(60),
        supabase.from("services").select("name,price,duration").eq("business_id", businessId).limit(60),
      ]);
      if (profile.error || faqs.error || services.error) throw new Error("Unable to load saved assistant settings.");
      if (!profile.data) return res.status(404).json({ error: "Business account is unavailable." });
      const p = profile.data;
      const idempotencyKey = typeof requestId === "string" && UUID_PATTERN.test(requestId)
        ? requestId : crypto.randomUUID();
      const { data: reservation, error: reservationError } = await supabase.rpc("reserve_ai_usage", {
        p_business_id: businessId,
        p_period_key: p.plan === "14-day trial" ? "trial" : new Date().toISOString().slice(0, 7),
        p_idempotency_key: idempotencyKey,
      });
      if (reservationError) {
        if (reservationError.code === "P0003") return res.status(409).json({ error: "This preview request was already processed." });
        if (["P0001", "P0004", "42501"].includes(reservationError.code)) {
          return res.status(429).json({ error: "Preview is unavailable because this business has reached its AI allowance." });
        }
        throw reservationError;
      }
      reservedId = reservation;
      const systemPrompt = buildAssistantSystemPrompt(p, services.data || [], faqs.data || []);
      const result = await generateAssistantReply({
        message: message.trim(), profile: {
          business: p.business, serviceName: p.service_name, price: p.price, hours: p.hours,
        }, conversation: conversation || [], systemPrompt,
      });
      const { error: finalError } = await supabase.rpc("finalize_ai_usage", {
        p_reservation_id: reservedId, p_success: result.provider === "groq",
      });
      if (finalError) throw finalError;
      reservedId = null;
      // Crucially: no INSERT INTO conversations, no bookings, no customer delivery.
      return res.json({ reply: result.reply, provider: result.provider, preview: true });
    } catch (error) {
      if (reservedId && supabase) {
        const { error: releaseError } = await supabase.rpc("finalize_ai_usage", {
          p_reservation_id: reservedId, p_success: false,
        });
        if (releaseError) console.error("Preview reservation release error:", releaseError.message);
      }
      console.error("Assistant preview error:", error.message);
      return res.status(503).json({ error: "Assistant preview temporarily unavailable." });
    }
  });
}
