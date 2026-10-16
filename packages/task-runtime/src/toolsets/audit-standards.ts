import { loadStandardStyleReference } from "../audit-standards/style-reference.ts";
import { createStandardTools, type StandardContextReader } from "../audit-standards/tools.ts";
import { parseStandardInput } from "../audit-standards/validation.ts";
import type { ToolsetProvider } from "./registry.ts";

export function createStandardToolset(
	payload: unknown,
	readContext?: StandardContextReader,
	workRoot?: string,
): ToolsetProvider {
	return async () => {
		const source = parseStandardInput(payload);
		const reference = await loadStandardStyleReference(source, workRoot);
		return createStandardTools(source, readContext, reference);
	};
}
