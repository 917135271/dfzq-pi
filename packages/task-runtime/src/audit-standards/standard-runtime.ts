import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Runtime, RunUsage } from "../runtime/contract.ts";
import { sealDelivery } from "../runtime/delivery.ts";
import { extractJsonBlock } from "../runtime/output-contract.ts";
import { type CreateSessionRuntimeOptions, createSessionRuntime } from "../runtime/session-runtime.ts";
import type { RuntimeSpec } from "../spec/types.ts";
import { ToolsetRegistry } from "../toolsets/registry.ts";
import { planStandardBatches, prepareStandardContext, validateBatchExtraction } from "./batching.ts";
import { type StandardContextReader, standardDelivery } from "./tools.ts";
import { parseStandardInput } from "./validation.ts";

/** Task-local batching; no direct provider calls, shared report state or new business output fields. */
export async function createStandardRuntime(
	options: Omit<CreateSessionRuntimeOptions, "toolsets" | "beforeRun" | "resolveOutput"> & {
		payload: unknown;
		batchSpec: RuntimeSpec;
		buildToolsets: (readContext?: StandardContextReader) => ToolsetRegistry;
	},
): Promise<Runtime> {
	const source = parseStandardInput(options.payload);
	const batches = planStandardBatches(source);
	if (!batches.length)
		return createSessionRuntime({
			...options,
			...standardDelivery,
			toolsets: options.buildToolsets(),
			spec: {
				...options.spec,
				limits: {
					maxTurns: Math.min(options.spec.limits.maxTurns ?? 10, 10),
					runTimeoutMs: Math.min(options.spec.limits.runTimeoutMs ?? 240000, 240000),
				},
			},
		});
	if (options.resume || options.onCheckpoint || options.interaction)
		throw new Error("Batched standard generation does not support session recovery");
	const maxTurns = options.spec.limits.maxTurns;
	const timeout = options.spec.limits.runTimeoutMs;
	if (!maxTurns || !timeout) throw new Error("Batched standard generation requires bounded turns and time");
	if (
		options.batchSpec.toolMode !== "none" ||
		options.batchSpec.tools.length ||
		options.batchSpec.outputContract ||
		options.batchSpec.skills?.length ||
		options.batchSpec.workflow ||
		options.batchSpec.fastPath
	)
		throw new Error("Standard batch extraction requires an isolated tool-free spec");
	let running = false;
	let deadlineAt = 0;
	let turns = 0;
	let turnLimitExceeded = false;
	let prepared = false;
	let pendingContext: Promise<unknown> | undefined;
	let child: Runtime | undefined;
	let controller: AbortController | undefined;
	let usage: RunUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
	const consumeModelTurn = () => {
		if (turns >= maxTurns) {
			turnLimitExceeded = true;
			controller?.abort(new Error("maxTurns"));
			void main.abort().catch(() => {});
			throw new Error("maxTurns");
		}
		options.consumeModelTurn?.();
		turns++;
	};
	const main = await createSessionRuntime({
		...options,
		consumeModelTurn,
		resolveOutput: async (text, callTool) => {
			if (!prepared) throw new Error("全部依据分批处理成功后才能交付规范");
			return standardDelivery.resolveOutput!(text, callTool);
		},
		toolsets: options.buildToolsets(async (toolSignal) => {
			if (!running || !controller) throw new Error("Standard context requires an active run");
			const signal = AbortSignal.any([
				controller.signal,
				...(toolSignal ? [toolSignal] : []),
				...(options.signal ? [options.signal] : []),
			]);
			signal.throwIfAborted();
			pendingContext ??= prepareStandardContext(source, batches, async (batch) => {
				signal.throwIfAborted();
				await options.authorizeExecution?.();
				const remainingMs = deadlineAt - Date.now();
				if (remainingMs <= 0) throw new Error("规范分批处理超时");
				const spec = {
					...options.batchSpec,
					limits: {
						...options.batchSpec.limits,
						runTimeoutMs: Math.min(remainingMs, options.batchSpec.limits.runTimeoutMs ?? remainingMs),
					},
				};
				const registry = new ToolsetRegistry();
				registry.register(spec.toolset, async () => []);
				const suffix = `batch-${randomUUID()}`;
				child = await createSessionRuntime({
					spec,
					profile: options.profile,
					registry: options.registry,
					toolsets: registry,
					signal,
					assemblyTimeoutMs: Math.min(options.assemblyTimeoutMs ?? 60000, remainingMs),
					authorizeExecution: options.authorizeExecution,
					consumeModelTurn,
					cwd: join(options.cwd, suffix),
					agentDir: join(options.agentDir, suffix),
					resolveOutput: async (text) => {
						const parsed = extractJsonBlock(text);
						if (parsed.kind !== "ok") throw new Error("条款提取须返回 JSON");
						return JSON.stringify(validateBatchExtraction(parsed.value, batch));
					},
				});
				const current = child;
				const abort = () => {
					void current.abort().catch(() => {});
				};
				signal.addEventListener("abort", abort, { once: true });
				try {
					signal.throwIfAborted();
					const result = await current.run(
						JSON.stringify({
							note: source.note,
							targetRows: source.rows.filter(
								(row) =>
									source.targetSequences.includes(row.审计事项序号) &&
									batch.scopes.some((scope) => scope.category === row.大类),
							),
							...batch,
						}),
					);
					for (const key of Object.keys(usage) as Array<keyof RunUsage>) usage[key] += result.usage[key];
					signal.throwIfAborted();
					await options.authorizeExecution?.();
					if (result.status !== "completed")
						throw new Error(`条款分批提取失败：${result.errorMessage ?? result.status}`);
					return JSON.parse(result.output!);
				} finally {
					signal.removeEventListener("abort", abort);
					await current.dispose();
					child = undefined;
				}
			}).then((context) => {
				signal.throwIfAborted();
				prepared = true;
				return context;
			});
			return pendingContext;
		}),
	});
	return {
		id: main.id,
		specId: main.specId,
		sessionId: main.sessionId,
		async run(input, runOptions) {
			if (running) throw new Error("Standard runtime already has an active run");
			running = true;
			controller = new AbortController();
			const startedAt = Date.now();
			deadlineAt = startedAt + timeout;
			turns = 0;
			turnLimitExceeded = false;
			prepared = false;
			pendingContext = undefined;
			usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
			try {
				const result = await main.run(input, runOptions);
				for (const key of Object.keys(usage) as Array<keyof RunUsage>) result.usage[key] += usage[key];
				result.turns = turns;
				result.durationMs = Date.now() - startedAt;
				if (turnLimitExceeded) {
					result.status = "limit_exceeded";
					result.limit = "maxTurns";
					delete result.answer;
				}
				return sealDelivery(result, result.delivery?.validation ?? "not_checked", result.delivery?.schemaHash);
			} finally {
				running = false;
			}
		},
		steer: (text) => main.steer(text),
		followUp: (text) => main.followUp(text),
		async abort() {
			controller?.abort();
			await main.abort();
			await child?.abort();
		},
		waitForIdle: () => main.waitForIdle(),
		subscribe: (listener) => main.subscribe(listener),
		get isIdle() {
			return !running && main.isIdle;
		},
		get lastActiveAt() {
			return main.lastActiveAt;
		},
		snapshot: () => main.snapshot(),
		async dispose() {
			controller?.abort();
			await main.abort();
			await child?.abort();
			await main.dispose();
		},
	};
}
