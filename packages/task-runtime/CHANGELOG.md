# Changelog

## [Unreleased]

### Added

- Independent audit-standard generation and revision specs, frozen basis context, template-row and source-excerpt validation, and bounded XLS/XLSX codec using the existing SheetJS dependency.
- Read-only audit-standard draft preflight exposed through the task's explicitly granted tools, retaining independent final validation.

### Fixed

- Store PostgreSQL state as JSON values instead of double-encoded text, so authorization leases and execution checkpoints remain readable across workers.
- Reject empty generated audit procedures and citations to non-selected source versions; validate partial-regeneration input rows and report output-contract error paths.
- Preserve partial-regeneration row order and require current-source evidence for added or updated revision opinions.

### Changed

- Specify clause relevance, conditional requirements, item grouping, executable procedures, source-supported obligations and generation self-review in the audit-standards prompt without extending workbook columns.
