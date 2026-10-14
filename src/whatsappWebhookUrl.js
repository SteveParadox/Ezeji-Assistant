// Validation for operator-provided, display-only Meta callback addresses.
// This is not an SSRF defense; the server must independently validate any
// URL it fetches. Do not display internal development endpoints as deployable.
export function isPublicHttpsWebhookUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host === "localhost.localdomain" ||
        host === "::1" || host.startsWith("fc") && host.includes(":") ||
        host.startsWith("fd") && host.includes(":") || host.startsWith("fe80:")) return false;
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? host.split(".").map(Number) : null;
    if (ipv4) {
      if (ipv4.some(n => n > 255)) return false;
      if (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] >= 224 ||
          ipv4[0] === 169 && ipv4[1] === 254 ||
          ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31 ||
          ipv4[0] === 192 && ipv4[1] === 168) return false;
    }
    return true;
  } catch {
    return false;
  }
}
