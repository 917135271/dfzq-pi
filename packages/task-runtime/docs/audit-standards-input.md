# Audit-standard category scopes

`payload.scopes` supplies the fixed category names selected by the business caller. The Agent does not invent a category catalogue. Sections (`分项`) and item names are derived from valid audit procedures and remain part of the existing eight-column output.

Category-specific sources use this shape:

```json
{
  "scopes": [
    { "category": "大类甲", "documentIds": ["document-a", "document-shared"] },
    { "category": "大类乙", "documentIds": ["document-b", "document-shared"] }
  ]
}
```

This is the scope fragment of the task input, not a complete request. All IDs must refer to `sources[].documentId` in the same immutable input snapshot. If any scope supplies `documentIds`, every scope must supply a non-empty list, and every current source must belong to at least one category. A document can belong to multiple categories. Missing, duplicate or unknown references fail input validation. Citations for current requirements cannot cross these category associations.

Generation can omit `category` and `subcategory` when `scopes` is supplied. Existing `category/subcategory` and `scopes[].subcategory` inputs remain accepted while the frontend is unchanged; only categories restrict generation, and supplied sections do not restrict new section names. Without explicit document associations, all selected documents remain candidates for the selected categories. Repeated category scopes are merged. Revision without explicit scopes inherits categories from original rows; it does not infer persisted per-category document associations from a flat source list.

Large-input batch extraction receives only the categories associated with the current document. Main generation receives the normalized scope associations and verified excerpts. Final validation uses the full original source snapshot. Partial regeneration preserves untouched rows, sequence and order. Revision can add, update or delete items, with corresponding opinions and evidence; new or updated items require non-empty procedures and a permitted category.

The Java caller owns catalogue validation, association persistence and subsequent snapshot loading. This Agent change does not implement frontend fields or Java storage. The output contract and workbook columns are unchanged.

## Private style reference

Generation and partial regeneration can receive a deployment-owned reference through `read_standard_context.styleReference`. Configure `AUDIT_STANDARD_STYLE_REFERENCE_PATH`, or place `audit-standard-style-reference.json` under `TASK_RUNTIME_WORK_ROOT`. An explicitly configured missing or invalid file fails task assembly; an absent default file leaves generation available without examples. Revision uses original rows and does not load this reference.

The JSON format is `{version:1, sourceName, sourceSheet, sourceSha256, examples:[{category, section, item, procedures, sourceRow}]}`. `sourceSha256` is the workbook's SHA-256, and `sourceRow` is the one-based worksheet row. The file is at most 512000 bytes. Keep customer reference files outside Git. The reader selects names for the chosen categories and up to 24 full procedure examples across categories/sections within a 16000-character context budget; it does not truncate example procedures. All matched names remain in `catalog`; `matchedCount` and `omittedExampleCount` distinguish catalogue coverage from sampled procedures. Categories without matching examples have no fabricated fallback.

Examples guide naming, item granularity and procedure organization only. They are not added to `sources`, legal citations, or the workbook output contract. Large-source extraction is unchanged; the reference joins the final unified generation context once all batches finish. Final evidence validation continues to use only the immutable legal-source snapshot.
