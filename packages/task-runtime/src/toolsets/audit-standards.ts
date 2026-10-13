import { createStandardTools } from "../audit-standards/tools.ts";
import type { ToolsetProvider } from "./registry.ts";

export function createStandardToolset(payload: unknown): ToolsetProvider {
	return async () => createStandardTools(payload);
}
