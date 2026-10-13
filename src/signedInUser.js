// Testable login resolver. Supabase identity always comes from authUser, never metadata.
export async function resolveSignedInUserWith(authUser, accessToken, { lookupProfile, lookupStaff }) {
  if (!authUser?.id || !authUser?.email || !accessToken) {
    throw new Error("A verified sign-in session is required.");
  }
  const metadata = authUser.user_metadata ?? {};
  const profile = await lookupProfile(authUser.id, authUser.email, metadata);
  if (profile) return profile;
  // The owner's registered business is provisioned by the authenticated
  // onboarding route. Do not let an unrelated staff lookup block that path.
  if (metadata?.business_registration?.business) return null;

  const response = await lookupStaff(accessToken);
  if (response.status === 404) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not load staff access.");
  if (typeof result.businessId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(result.businessId) ||
      !["Professional", "Business"].includes(result.plan)) {
    throw new Error("Invalid staff-access response.");
  }
  return {
    id: result.businessId,
    email: authUser.email,
    plan: result.plan,
    authUserId: authUser.id,
    isStaff: true,
  };
}
