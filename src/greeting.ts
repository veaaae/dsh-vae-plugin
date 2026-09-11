/** Canonical `vae_status` result. */
export interface VaeStatus {
  plugin: string
  label: string
  note: string
}

/**
 * Format the model-facing `vae_status` line.
 * @param value - canonical tool result
 * @returns one-line status text
 */
export function formatVaeStatus(value: VaeStatus): string {
  return `[${value.label}] ${value.plugin}: ${value.note}`
}
