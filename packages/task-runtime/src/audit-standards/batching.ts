import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { StandardInput, StandardScope } from "./contracts.ts";

const DIRECT_CONTEXT_CHARS = 24000;
const BATCH_CHARS = 12000;
const MAX_BATCHES = 16;
const MERGED_CONTEXT_CHARS = 48000;

export interface StandardBatch {
	scopes: StandardScope[];
	document: Omit<StandardInput["sources"][number], "clauses">;
	clauses: StandardInput["sources"][number]["clauses"];
	context: StandardInput["sources"][number]["clauses"];
}

const extractionSchema = Type.Object(
	{
		clauses: Type.Array(
			Type.Object(
				{
					clause_id: Type.String({ minLength: 1 }),
					relevant: Type.Boolean(),
					requirement: Type.String({ maxLength: 3000 }),
					excerpts: Type.Array(Type.String({ minLength: 4, maxLength: BATCH_CHARS }), { maxItems: 20 }),
				},
				{ additionalProperties: false },
			),
			{ maxItems: 2000 },
		),
		warnings: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 20 }),
	},
	{ additionalProperties: false },
);
type Extraction = Static<typeof extractionSchema>;

/** Cover every clause in source order. Neighbours are context only, never another batch's output. */
export function planStandardBatches(source: StandardInput): StandardBatch[] {
	if (source.mode !== "generate" || JSON.stringify(source.sources).length <= DIRECT_CONTEXT_CHARS) return [];
	const batches: StandardBatch[] = [];
	for (const doc of source.sources) {
		const scopes = source.scopes.filter((scope) => !scope.documentIds || scope.documentIds.includes(doc.documentId));
		const { clauses, ...document } = doc;
		let start = 0;
		while (start < clauses.length) {
			let end = start;
			let size = 0;
			while (end < clauses.length) {
				const length = JSON.stringify(clauses[end]).length;
				if (length > BATCH_CHARS) throw new Error("单条依据过长，请按完整业务条款拆分后生成");
				if (end > start && size + length > BATCH_CHARS) break;
				size += length;
				end++;
			}
			const contextIndexes = new Set([0, 1, start - 1, end]);
			const context = [...contextIndexes]
				.sort((a, b) => a - b)
				.filter((i) => i >= 0 && i < clauses.length && (i < start || i >= end))
				.map((i) => clauses[i]);
			batches.push({ scopes, document, clauses: clauses.slice(start, end), context });
			if (batches.length > MAX_BATCHES) throw new Error("规范依据超出分批处理上限，请缩小本次范围");
			start = end;
		}
	}
	return batches;
}

export function validateBatchExtraction(value: unknown, batch: StandardBatch): Extraction {
	if (!Value.Check(extractionSchema, value)) throw new Error("条款分批提取结果格式错误");
	const seen = new Set<string>();
	for (const entry of value.clauses) {
		const clause = batch.clauses.find((item) => item.clause_id === entry.clause_id);
		if (!clause || seen.has(entry.clause_id)) throw new Error("分批提取包含不存在或重复的条款");
		seen.add(entry.clause_id);
		if (entry.relevant && (!entry.requirement.trim() || !entry.excerpts.length))
			throw new Error("相关条款须保留业务要求及原文摘录");
		if (!entry.relevant && (entry.requirement || entry.excerpts.length)) throw new Error("无关条款不能输出业务要求");
		if (entry.excerpts.some((excerpt) => !excerpt.trim() || !clause.text.includes(excerpt)))
			throw new Error("分批提取摘录必须来自该条款原文");
	}
	if (seen.size !== batch.clauses.length) throw new Error("分批提取遗漏条款，不能继续生成");
	return structuredClone(value);
}

/** Transient generation context; the complete frozen source remains the final validation authority. */
export async function prepareStandardContext(
	source: StandardInput,
	batches: StandardBatch[],
	extract: (batch: StandardBatch) => Promise<unknown>,
): Promise<unknown> {
	const sources: StandardInput["sources"] = [];
	const requirements: Array<{ documentId: string; versionId: string; clause_id: string; requirement: string }> = [];
	const warnings = new Set<string>();
	for (const batch of batches) {
		const result = validateBatchExtraction(await extract(batch), batch);
		for (const warning of result.warnings) warnings.add(warning);
		let doc = sources.find((item) => item.documentId === batch.document.documentId);
		if (!doc) {
			doc = { ...batch.document, clauses: [] };
			sources.push(doc);
		}
		for (const entry of result.clauses) {
			if (!entry.relevant) continue;
			doc.clauses.push({ clause_id: entry.clause_id, text: [...new Set(entry.excerpts)].join("\n") });
			requirements.push({
				documentId: doc.documentId,
				versionId: doc.versionId,
				clause_id: entry.clause_id,
				requirement: entry.requirement,
			});
		}
	}
	if (!requirements.length) throw new Error("所选依据未提取到相关要求，请检查范围和资料");
	const context = {
		...source,
		sources: sources.filter((doc) => doc.clauses.length),
		batchAnalysis: {
			batchCount: batches.length,
			requirements,
			warnings: [...warnings],
		},
	};
	if (JSON.stringify(context).length > MERGED_CONTEXT_CHARS)
		throw new Error("相关要求汇总过大，请缩小本次审计范围；系统未截断资料");
	return context;
}
