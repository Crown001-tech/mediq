import crypto from 'crypto';

/**
 * Format a doctor's name properly with Dr. prefix if not already present
 */
export function formatDoctorName(name?: string | null): string {
  if (!name || !name.trim()) return 'Attending Physician';
  const clean = name.trim();
  if (/^dr\.?\s+/i.test(clean)) {
    return `Dr. ${clean.replace(/^dr\.?\s+/i, '').trim()}`;
  }
  return `Dr. ${clean}`;
}

/**
 * Clean redundant or messy doctor prefix/suffix text
 */
export function cleanDoctorText(text?: string | null): string {
  if (!text) return '';
  return text.trim();
}

/**
 * Generate a cryptographically secure 32+ character video room token
 */
export function generateVideoRoomToken(): string {
  try {
    return (crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')).slice(0, 36);
  } catch {
    return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 36);
  }
}

/**
 * Construct secure, unguessable Jitsi room name using the full UUID and secondary token
 */
export function getJitsiRoomName(appointmentId: string, videoRoomToken?: string | null): string {
  const token = videoRoomToken ? `-${videoRoomToken}` : '';
  return `mediq-${appointmentId}${token}`;
}

/**
 * Construct full Jitsi Meet URL
 */
export function getJitsiUrl(appointmentId: string, videoRoomToken?: string | null): string {
  return `https://meet.jit.si/${getJitsiRoomName(appointmentId, videoRoomToken)}`;
}
