// Account creation is intentionally separate from business configuration.
export function validateSignupFields(fields) {
  if (!String(fields?.name || "").trim()) return "Enter your full name.";
  if (!String(fields?.business || "").trim()) return "Enter your business name.";
  const email = String(fields?.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  if (String(fields?.password || "").length < 8) return "Use a password of at least 8 characters.";
  return null;
}
