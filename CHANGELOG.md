# Changelog

## 3.0.0

- Complete the original extraction, keyword suggestion, editable review, and optional auto-approval workflow.
- Replace nonexistent World Info context access with a current SillyTavern adapter, fresh reads, checked writes and cache synchronization.
- Preserve aliases and entry options; review complete replacement text instead of repeated appends.
- Keep suggestions attached to their original chat and book, with persisted review queues, conflict checks and recent undo history.
- Restore automatic controls with defined assistant-turn counting and deduplicated generation events.
- Add responsive English/Chinese review UI, book creation, batch actions, export, visible errors and cancellation by discarding results.
- Validate model output and prompt budgets; protect omitted, ambiguous, constant and disabled entries from automatic changes.
- Add regression tests, package checks, CI, bilingual documentation and an evidence-based upstream audit.

Requires SillyTavern 1.18.0+. Existing settings are migrated. New installations leave automatic analysis and approval off. See the README for the change from upstream's message counting and fixed approval threshold.
