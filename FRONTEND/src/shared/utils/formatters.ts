/**
 * Utility functions for formatting names and medical text consistently across MEDIQ.
 */

/**
 * Ensures a doctor's name is properly formatted with exactly one "Dr." prefix.
 * Strips any redundant or duplicated "Dr.", "Dr", "dr.", etc.
 * 
 * Examples:
 * - "Dr. Samuel Akindayo" -> "Dr. Samuel Akindayo"
 * - "Dr. Dr. Samuel Akindayo" -> "Dr. Samuel Akindayo"
 * - "Dr Samuel Akindayo" -> "Dr. Samuel Akindayo"
 * - "Samuel Akindayo" -> "Dr. Samuel Akindayo"
 * - "" / null / undefined -> fallback (default: 'Attending Physician')
 */
export function formatDoctorName(name?: string | null, fallback = 'Attending Physician'): string {
  if (!name || !name.trim()) return fallback
  const cleaned = name.trim().replace(/^(dr\.?\s*)+/i, '').trim()
  if (!cleaned) return fallback
  return `Dr. ${cleaned}`
}

/**
 * Cleans any duplicate "Dr. Dr." occurrences within arbitrary sentences/strings.
 * 
 * Examples:
 * - "Dr. Dr. Samuel Akindayo reviewed your note." -> "Dr. Samuel Akindayo reviewed your note."
 * - "Reassigned to Dr. Dr. Oladele Precious." -> "Reassigned to Dr. Oladele Precious."
 */
export function cleanDoctorText(text?: string | null): string {
  if (!text) return ''
  return text.replace(/\b(dr\.?\s*){2,}/gi, 'Dr. ')
}
