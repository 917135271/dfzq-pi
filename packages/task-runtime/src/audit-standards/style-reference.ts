import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { StandardInput } from "./contracts.ts";

const referenceSchema = Type.Object(
	{
		version: Type.Literal(1),
		sourceName: Type.String({ minLength: 1, maxLength: 200 }),
		sourceSheet: Type.String({ minLength: 1, maxLength: 200 }),
		sourceSha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		examples: Type.Array(
			Type.Object(
				{
					category: Type.String({ minLength: 1, maxLength: 200 }),
					section: Type.String({ minLength: 1, maxLength: 200 }),
					item: Type.String({ minLength: 1, maxLength: 300 }),
					procedures: Type.String({ minLength: 1, maxLength: 30000 }),
					sourceRow: Type.Integer({ minimum: 2 }),
				},
				{ additionalProperties: false },
			),
			{ minItems: 1, maxItems: 2000 },
		),
	},
	{ additionalProperties: false },
);

type StyleReference = Static<typeof referenceSchema>;
export interface StandardStyleContext {
	purpose: "style-only";
	sourceName: string;
	sourceSheet: string;
	sourceSha256: string;
	catalog: Array<Omit<StyleReference["examples"][number], "procedures">>;
	examples: StyleReference["examples"];
	matchedCount: number;
	omittedExampleCount: number;
}

/** Private deployment configuration, never a caller-supplied model tool path or legal evidence. */
export async function loadStandardStyleReference(
	source: StandardInput,
	workRoot = process.env.TASK_RUNTIME_WORK_ROOT,
): Promise<StandardStyleContext | undefined> {
	if (source.mode !== "generate") return undefined;
	const explicit = process.env.AUDIT_STANDARD_STYLE_REFERENCE_PATH;
	const path = explicit || (workRoot ? join(workRoot, "audit-standard-style-reference.json") : undefined);
	if (!path) return undefined;
	let text: string;
	try {
		if ((await stat(path)).size > 512000) throw new Error("审计规范参考资料超过大小上限");
		text = await readFile(path, "utf8");
	} catch (error) {
		if (!explicit && error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
	const parsed: unknown = JSON.parse(text);
	if (!Value.Check(referenceSchema, parsed)) throw new Error("审计规范参考资料格式错误");
	const categoryOrder = source.scopes.map((scope) => scope.category);
	const matched = parsed.examples.filter((item) => categoryOrder.includes(item.category));
	const context: StandardStyleContext = {
		purpose: "style-only",
		sourceName: parsed.sourceName,
		sourceSheet: parsed.sourceSheet,
		sourceSha256: parsed.sourceSha256,
		catalog: matched.map(({ procedures: _procedures, ...item }) => item),
		examples: [],
		matchedCount: matched.length,
		omittedExampleCount: matched.length,
	};
	// Preserve complete examples. Round-robin across categories and sections before adding a second example.
	const groups = categoryOrder.flatMap((category) => {
		const sections = [...new Set(matched.filter((item) => item.category === category).map((item) => item.section))];
		return sections.map((section) =>
			matched.filter((item) => item.category === category && item.section === section),
		);
	});
	const byCategory = categoryOrder.map((category) => groups.filter((group) => group[0]?.category === category));
	const orderedGroups = Array.from({ length: Math.max(0, ...byCategory.map((items) => items.length)) }, (_, index) =>
		byCategory.flatMap((items) => (items[index] ? [items[index]] : [])),
	).flat();
	if (JSON.stringify(context).length > 16000) throw new Error("参考名称目录过大，请精简配置资料");
	for (let offset = 0; offset < 2; offset++) {
		for (const group of orderedGroups) {
			const example = group[offset];
			if (!example || context.examples.length >= 24) continue;
			context.examples.push(example);
			if (JSON.stringify(context).length > 16000) context.examples.pop();
		}
	}
	context.omittedExampleCount = matched.length - context.examples.length;
	return context;
}
