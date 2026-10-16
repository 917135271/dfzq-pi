import { type Static, Type } from "typebox";

// Column names and order are taken from the supplied workbook. Metadata lives outside rows.
export const STANDARD_COLUMNS = [
	"审计规范",
	"大类",
	"分项",
	"审计事项(底稿名称)",
	"审计步骤(稽核要点及程序)",
	"审计目标",
	"审计依据",
	"审计事项序号",
] as const;
export const standardRowSchema = Type.Object(
	Object.fromEntries(STANDARD_COLUMNS.map((name) => [name, Type.String({ maxLength: 30000 })])),
	{ additionalProperties: false },
);
export type StandardRow = Record<(typeof STANDARD_COLUMNS)[number], string>;
export const sourceSchema = Type.Object(
	{
		documentId: Type.String({ minLength: 1 }),
		versionId: Type.String({ minLength: 1 }),
		title: Type.String({ minLength: 1 }),
		kind: Type.Union([Type.Literal("external"), Type.Literal("internal")]),
		versionNumber: Type.Optional(Type.String()),
		clauses: Type.Array(
			Type.Object(
				{ clause_id: Type.String({ minLength: 1 }), text: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 2000 },
		),
	},
	{ additionalProperties: false },
);
export const referenceSchema = Type.Object(
	{
		documentId: Type.String({ minLength: 1 }),
		versionId: Type.String({ minLength: 1 }),
		clause_id: Type.String({ minLength: 1 }),
		quote: Type.String({ minLength: 4 }),
	},
	{ additionalProperties: false },
);
export const inputSchema = Type.Object(
	{
		taskId: Type.String({ minLength: 1 }),
		mode: Type.Union([Type.Literal("generate"), Type.Literal("revise")]),
		name: Type.String({ minLength: 1 }),
		category: Type.Optional(Type.String()),
		subcategory: Type.Optional(Type.String()),
		scopes: Type.Optional(
			Type.Array(
				Type.Object(
					{
						category: Type.String({ minLength: 1 }),
						subcategory: Type.Optional(Type.String()),
						documentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 })),
					},
					{ additionalProperties: false },
				),
				{ minItems: 1, maxItems: 100 },
			),
		),
		note: Type.String(),
		rows: Type.Array(standardRowSchema, { maxItems: 2000 }),
		sources: Type.Array(sourceSchema, { minItems: 1, maxItems: 100 }),
		previousSources: Type.Array(sourceSchema, { maxItems: 100 }),
		targetSequences: Type.Array(Type.String({ minLength: 1 }), { maxItems: 2000 }),
	},
	{ additionalProperties: false },
);
export type StandardScope = NonNullable<Static<typeof inputSchema>["scopes"]>[number];
// Normalized at the task boundary; existing callers can keep sending their current scope fields.
export type StandardInput = Static<typeof inputSchema> & {
	category: string;
	subcategory: string;
	scopes: StandardScope[];
};
export const outputSchema = Type.Object(
	{
		taskId: Type.String({ minLength: 1 }),
		mode: Type.Union([Type.Literal("generate"), Type.Literal("revise")]),
		rows: Type.Array(standardRowSchema, { minItems: 1, maxItems: 2000 }),
		citations: Type.Array(
			Type.Object(
				{
					sequence: Type.String({ minLength: 1 }),
					references: Type.Array(referenceSchema, { minItems: 1, maxItems: 100 }),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 2000 },
		),
		opinions: Type.Array(
			Type.Object(
				{
					sequence: Type.String({ minLength: 1 }),
					action: Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("delete")]),
					before: Type.Union([standardRowSchema, Type.Null()]),
					after: Type.Union([standardRowSchema, Type.Null()]),
					reason: Type.String({ minLength: 1 }),
					references: Type.Array(referenceSchema, { minItems: 1, maxItems: 100 }),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 2000 },
		),
		warnings: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
	},
	{ additionalProperties: false },
);
export type StandardOutput = Static<typeof outputSchema>;
export type StandardReference = Static<typeof referenceSchema>;
