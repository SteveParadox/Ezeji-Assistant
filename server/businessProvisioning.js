export function validatedBusinessFields(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const clean = (key, max) =>
    typeof source[key] === "string" ? source[key].trim().slice(0, max) : "";
  const business = clean("business", 160);
  if (!business) return null;
  return {
    name: clean("name", 120) || business,
    business,
    business_type: clean("businessType", 80) || "Other",
    custom_business_type: clean("customBusinessType", 120),
    service_name: clean("serviceName", 160),
    price: clean("price", 100),
    hours: clean("hours", 160),
    description: clean("description", 2000),
  };
}

export class OnboardingInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 422;
  }
}

export async function ensureOwnerBusiness(db, ownerId, submitted, userMetadata, now = () => Date.now()) {
  const find = () => db.from("profiles").select("id,business,name").eq("id", ownerId).maybeSingle();
  const { data: existing, error: lookupError } = await find();
  if (lookupError) throw lookupError; // A timeout is not a missing record.
  if (existing?.business?.trim()) return { businessId: ownerId, created: false };

  const fields = validatedBusinessFields(submitted) || validatedBusinessFields(userMetadata);
  if (!fields) throw new OnboardingInputError("Please provide your business name to complete onboarding.");
  if (existing) {
    const patch = { business: fields.business };
    if (!existing.name) patch.name = fields.name;
    const { error } = await db.from("profiles").update(patch).eq("id", ownerId);
    if (error) throw error;
    return { businessId: ownerId, created: false, recovered: true };
  }

  const profile = {
    id: ownerId,
    ...fields,
    plan: "14-day trial",
    payment_status: "trial",
    trial_active: true,
    trial_ends_at: new Date(now() + 14 * 86400000).toISOString(),
    billing_period: "monthly",
    currency: "NGN",
  };
  // profiles.id is the auth-user primary key. DO NOTHING preserves existing
  // plan/billing fields even when concurrent requests both attempt insertion.
  const { error: insertError } = await db.from("profiles")
    .upsert(profile, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  const { data: resolved, error: readError } = await find();
  if (readError) throw readError;
  if (!resolved?.business) throw new Error("Business setup is incomplete. Please retry.");
  return { businessId: ownerId, created: true };
}
