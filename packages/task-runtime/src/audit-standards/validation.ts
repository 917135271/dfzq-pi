import { isDeepStrictEqual } from "node:util";
import { Value } from "typebox/value";
import {
	inputSchema,
	outputSchema,
	STANDARD_COLUMNS,
	type StandardInput,
	type StandardOutput,
	type StandardReference,
	type StandardRow,
	type StandardScope,
} from "./contracts.ts";

export function validateRows(rows: readonly StandardRow[]): void {
	if (!rows.length || rows.length > 2000) throw new Error("规范需要 1 至 2000 个审计事项");
	const seen = new Set<string>();
	for (const row of rows) {
		if (STANDARD_COLUMNS.some((key) => typeof row[key] !== "string") || Object.keys(row).length !== 8)
			throw new Error("规范仅接受模板的八个字段");
		const sequence = row.审计事项序号;
		if (!/^[1-9]\d{0,8}$/.test(sequence) || seen.has(sequence)) throw new Error("事项序号须为唯一正整数");
		seen.add(sequence);
		for (const key of ["审计规范", "大类", "分项", "审计事项(底稿名称)"] as const)
			if (!row[key].trim()) throw new Error(`${key}不能为空`);
	}
}

export function parseStandardInput(value: unknown): StandardInput {
	if (!Value.Check(inputSchema, value)) throw new Error("审计规范任务输入格式错误");
	if (JSON.stringify(value).length > 1500000) throw new Error("规范任务资料过多，请缩小本次审计范围");
	const requestedScopes: StandardScope[] =
		value.scopes ??
		(value.category?.trim()
			? [{ category: value.category, subcategory: value.subcategory }]
			: value.mode === "revise"
				? [...new Set(value.rows.map((row) => row.大类))].map((category) => ({ category }))
				: []);
	if (!requestedScopes.length) throw new Error("生成规范需要选择固定大类");
	const mapped = requestedScopes.some((scope) => scope.documentIds !== undefined);
	if (mapped && requestedScopes.some((scope) => !scope.documentIds?.length))
		throw new Error("按大类关联依据时，每个大类均须提供关联资料");
	const scopes = new Map<string, StandardScope>();
	const currentIds = new Set(value.sources.map((doc) => doc.documentId));
	const associatedIds = new Set<string>();
	for (const scope of requestedScopes) {
		const category = scope.category.trim();
		if (!category) throw new Error("大类不能为空");
		if (
			scope.documentIds &&
			(new Set(scope.documentIds).size !== scope.documentIds.length ||
				scope.documentIds.some((id) => !currentIds.has(id)))
		)
			throw new Error("大类关联资料不能重复，且须来自本次依据快照");
		const entry = scopes.get(category) ?? { category, ...(mapped ? { documentIds: [] } : {}) };
		for (const id of scope.documentIds ?? []) {
			associatedIds.add(id);
			if (!entry.documentIds!.includes(id)) entry.documentIds!.push(id);
		}
		scopes.set(category, entry);
	}
	if (mapped && [...currentIds].some((id) => !associatedIds.has(id)))
		throw new Error("本次每份依据须明确关联至少一个大类");
	const source: StandardInput = {
		...structuredClone(value),
		category: [...scopes.keys()][0],
		subcategory: value.subcategory ?? "",
		scopes: [...scopes.values()],
	};
	if (source.mode === "revise" || source.rows.length) validateRows(source.rows as StandardRow[]);
	if (source.mode === "generate" && source.rows.length && !source.targetSequences.length)
		throw new Error("生成任务只有局部重新生成时才接受原始事项");
	const versions = new Set<string>();
	for (const doc of source.sources) {
		if (versions.has(doc.documentId)) throw new Error("每项关联依据只能选择一个当前版本");
		versions.add(doc.documentId);
	}
	for (const doc of [...source.sources, ...source.previousSources]) {
		if (new Set(doc.clauses.map((clause) => clause.clause_id)).size !== doc.clauses.length)
			throw new Error("同一依据版本中的条款标识不能重复");
	}
	const sequences = new Set(source.rows.map((row) => row.审计事项序号));
	if (
		new Set(source.targetSequences).size !== source.targetSequences.length ||
		source.targetSequences.some((id) => !sequences.has(id))
	)
		throw new Error("重新生成的事项须来自原始规范且不能重复");
	return source;
}

export function validateStandardOutput(value: unknown, source: StandardInput): StandardOutput {
	if (!Value.Check(outputSchema, value)) {
		const problems = [...Value.Errors(outputSchema, value)]
			.slice(0, 3)
			.map((error) => `${error.instancePath || "/"}: ${error.message}`);
		throw new Error(`规范输出格式错误：${problems.join("；")}`);
	}
	if (value.taskId !== source.taskId || value.mode !== source.mode) throw new Error("规范任务身份不一致");
	const result = structuredClone(value);
	validateRows(result.rows as StandardRow[]);
	const old = new Map(source.rows.map((row) => [row.审计事项序号, row]));
	const next = new Map(result.rows.map((row) => [row.审计事项序号, row]));
	const categories = new Set(source.scopes.map((scope) => scope.category));
	const isCurrentSource = (ref: StandardReference) =>
		source.sources.some((doc) => doc.documentId === ref.documentId && doc.versionId === ref.versionId);
	const docs = [...source.sources, ...source.previousSources];
	const checkReferences = (references: readonly StandardReference[], row?: StandardRow) => {
		const seen = new Set<string>();
		for (const ref of references) {
			const key = JSON.stringify([ref.documentId, ref.versionId, ref.clause_id]);
			const doc = docs.find((item) => item.documentId === ref.documentId && item.versionId === ref.versionId);
			const clause = doc?.clauses.find((item) => item.clause_id === ref.clause_id);
			if (seen.has(key) || !clause || !clause.text.includes(ref.quote) || !ref.quote.trim())
				throw new Error("引用必须来自关联依据的真实条款，且摘录须与原文一致");
			seen.add(key);
			if (row && doc && !row.审计依据.includes(doc.title)) throw new Error("成品审计依据必须包含所引用资料的名称");
			const scope = row && source.scopes.find((item) => item.category === row.大类);
			if (scope?.documentIds && isCurrentSource(ref) && !scope.documentIds.includes(ref.documentId))
				throw new Error("审计事项只能引用其大类关联的本次依据");
		}
	};
	const cited = new Set<string>();
	for (const cite of result.citations) {
		const row = next.get(cite.sequence);
		if (!row || cited.has(cite.sequence)) throw new Error("引用关联了不存在或重复的审计事项");
		cited.add(cite.sequence);
		checkReferences(cite.references, row as StandardRow);
	}
	if (result.rows.some((row) => row.审计规范 !== source.name)) throw new Error("规范名称不能由模型更改");
	if (source.mode === "generate") {
		if (result.opinions.length) throw new Error("生成任务不能输出修订意见");
		const selected = new Set(source.targetSequences);
		if (selected.size && (next.size !== old.size || [...old.keys()].some((id) => !next.has(id))))
			throw new Error("局部重新生成不能增加或删除原始事项");
		if (selected.size && result.rows.some((row, index) => row.审计事项序号 !== source.rows[index].审计事项序号))
			throw new Error("局部重新生成不能改变原始事项的排列顺序");
		for (const row of result.rows) {
			const seq = row.审计事项序号;
			if (selected.size && !selected.has(seq)) {
				if (!isDeepStrictEqual(old.get(seq), row)) throw new Error("重新生成不能更改未选择的审计事项");
			} else if (!cited.has(seq) || !categories.has(row.大类))
				throw new Error("生成事项必须属于所选固定大类，并提供依据引用；分项按检查内容归纳");
			else {
				if (!row["审计步骤(稽核要点及程序)"].trim()) throw new Error("生成事项必须提供具体审计步骤");
				const citation = result.citations.find((item) => item.sequence === seq);
				if (
					citation?.references.some(
						(ref) =>
							!source.sources.some(
								(doc) => doc.documentId === ref.documentId && doc.versionId === ref.versionId,
							),
					)
				)
					throw new Error("生成事项必须引用本次选定的依据版本，不能引用旧版资料");
			}
		}
	} else {
		const changed = new Set<string>();
		for (const opinion of result.opinions) {
			const previous = old.get(opinion.sequence) ?? null;
			const after = next.get(opinion.sequence) ?? null;
			if (
				changed.has(opinion.sequence) ||
				!isDeepStrictEqual(opinion.before, previous) ||
				!isDeepStrictEqual(opinion.after, after)
			)
				throw new Error("修订意见必须准确反映原规范与新规范的差异");
			if (
				(opinion.action === "add" && (previous || !after)) ||
				(opinion.action === "delete" && (!previous || after)) ||
				(opinion.action === "update" && (!previous || !after || isDeepStrictEqual(previous, after)))
			)
				throw new Error("修订操作与前后内容不一致");
			changed.add(opinion.sequence);
			if (after && !categories.has(after.大类)) throw new Error("修订事项不能使用范围外的大类");
			if (after && !after["审计步骤(稽核要点及程序)"].trim()) throw new Error("新增或调整事项必须保留有效审计步骤");
			checkReferences(opinion.references, after as StandardRow | undefined);
			if (
				after &&
				!opinion.references.some((ref) =>
					source.sources.some((doc) => doc.documentId === ref.documentId && doc.versionId === ref.versionId),
				)
			)
				throw new Error("新增或调整事项必须提供本次依据版本的引用，不能仅以旧版条款支撑新内容");
		}
		for (const seq of new Set([...old.keys(), ...next.keys()]))
			if (!isDeepStrictEqual(old.get(seq), next.get(seq)) && !changed.has(seq))
				throw new Error("每项实际修改都必须提供修改意见和依据");
	}
	return result;
}
