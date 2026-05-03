/** Hosts/paths allowed for CloudLens UI (toolbar + content script). Keep in sync with manifest.json content_scripts.matches. */

const EXACT_HOSTS = new Set([
  'aws.amazon.com',
  'console.aws.amazon.com',
  'console.cloud.google.com',
  'cloud.google.com',
  'portal.azure.com',
  'admin.microsoft.com',
  'entra.microsoft.com',
  'learn.microsoft.com',
  'docs.aws.amazon.com',
  'kubernetes.io',
  'app.terraform.io',
]);

const HOST_SUFFIXES = [
  '.aws.amazon.com',
  '.amazonaws.com',
  '.cloud.google.com',
  '.azure.com',
  '.portal.azure.com',
  '.terraform.io',
];

export function isCloudLensPageUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (EXACT_HOSTS.has(h)) return true;
  for (const suf of HOST_SUFFIXES) {
    if (h.endsWith(suf)) return true;
  }
  return false;
}
