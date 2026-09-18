# OMOS Mobile Web Rules

Mobile workflows are field-facing and must tolerate unreliable connectivity.

- Prioritize clear, low-friction field data entry, validation feedback and safe
  recovery from interrupted work.
- Do not assume continuous connectivity. Evaluate pending state, retry,
  duplicate protection, conflict handling and synchronization visibility for
  operational writes.
- Preserve server-authoritative authorization and validation; local state must
  never bypass them.
- Treat location, attendance, photos and biometric-related data as sensitive:
  minimize collection, avoid logging sensitive payloads and do not expose
  credentials.
- Keep payloads and media handling efficient for constrained site networks.

