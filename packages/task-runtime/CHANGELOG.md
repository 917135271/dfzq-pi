# Changelog

## [Unreleased]

### Added

- Load private workbook-derived naming and procedure examples into the existing audit-standard generation context, bounded and selected by category; examples remain separate from legal evidence and are not stored in source control.

- Batch large audit-standard generation sources in isolated, bounded model sessions, retaining adjacent context and verified excerpts before unified item generation; keep small-source and revision flows unchanged.

- Independent audit-standard generation and revision specs, frozen basis context, template-row and source-excerpt validation, and bounded XLS/XLSX codec using the existing SheetJS dependency.
- Read-only audit-standard draft preflight exposed through the task's explicitly granted tools, retaining independent final validation.

### Fixed

- Pass the configured audit-standard reference root into worker toolsets and allow only the named reference-path override through the worker environment; constrain generated procedures to current obligations and remove non-actionable technical warnings after real-model review.

- Store PostgreSQL state as JSON values instead of double-encoded text, so authorization leases and execution checkpoints remain readable across workers.
- Reject empty generated audit procedures and citations to non-selected source versions; validate partial-regeneration input rows and report output-contract error paths.
- Preserve partial-regeneration row order and require current-source evidence for added or updated revision opinions.

### Changed

- Generate audit procedures before deriving items and sections within fixed categories; accept category-only scopes and optional per-category document associations, enforce association-aware references in generation and revision, and retain current task inputs without requiring frontend changes.

- Accept multiple selected classification scopes and readable source-version labels in audit-standard inputs; validate generated rows against the selected scope set.

- Specify clause relevance, conditional requirements, item grouping, executable procedures, source-supported obligations and generation self-review in the audit-standards prompt without extending workbook columns.
