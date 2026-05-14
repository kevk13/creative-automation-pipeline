import { z } from "zod";

/**
 * Mastra-compatible workflow API.
 * This module implements the createStep/createWorkflow pattern from @mastra/core/workflows.
 * The API is intentionally compatible — swapping imports to "@mastra/core/workflows"
 * requires no changes to step or workflow definitions.
 *
 * See: https://mastra.ai/docs/workflows
 */

export type StepExecuteParams<TInput> = {
  inputData: TInput;
};

export type StepConfig<TInput, TOutput> = {
  id: string;
  description?: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (params: StepExecuteParams<TInput>) => Promise<TOutput>;
};

export type StepDef<TInput, TOutput> = StepConfig<TInput, TOutput>;

export function createStep<TInput, TOutput>(
  config: StepConfig<TInput, TOutput>
): StepDef<TInput, TOutput> {
  return config;
}

export type WorkflowRunResult<TOutput> = {
  results: TOutput;
  error?: string;
};

export type WorkflowRun<TInput, TOutput> = {
  start(params: { inputData: TInput }): Promise<WorkflowRunResult<TOutput>>;
};

export type CompiledWorkflow<TInput, TOutput> = {
  id: string;
  createRun(): WorkflowRun<TInput, TOutput>;
};

type WorkflowBuilder<TInput, TOutput> = {
  then<TNext>(step: StepDef<TOutput, TNext>): WorkflowBuilder<TInput, TNext>;
  commit(): CompiledWorkflow<TInput, TOutput>;
};

export function createWorkflow<TInput, TOutput = TInput>(config: {
  id: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
}): WorkflowBuilder<TInput, TInput> {
  const steps: StepDef<any, any>[] = [];
  const workflowId = config.id;

  function builder<TCurrent>(): WorkflowBuilder<TInput, TCurrent> {
    return {
      then<TNext>(step: StepDef<TCurrent, TNext>): WorkflowBuilder<TInput, TNext> {
        steps.push(step);
        return builder<TNext>();
      },
      commit(): CompiledWorkflow<TInput, TCurrent> {
        const frozenSteps = [...steps];
        return {
          id: workflowId,
          createRun(): WorkflowRun<TInput, TCurrent> {
            return {
              async start({ inputData }): Promise<WorkflowRunResult<TCurrent>> {
                try {
                  let current: any = config.inputSchema.parse(inputData);
                  for (const step of frozenSteps) {
                    const validated = step.inputSchema.parse(current);
                    current = await step.execute({ inputData: validated });
                  }
                  return { results: current as TCurrent };
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  return {
                    results: null as unknown as TCurrent,
                    error: message,
                  };
                }
              },
            };
          },
        };
      },
    };
  }

  return builder<TInput>();
}
