import type { WorkflowDefinition, WorkflowEngine, WorkflowEvent } from "./engine";

/**
 * The narrow slice of the Inngest client this adapter touches, so tests can
 * inject a recording stub and the adapter stays honest about its dependency.
 * A real `Inngest` instance satisfies it structurally.
 */
export type InngestClientLike = {
  createFunction(
    options: { id: string; triggers: ({ event: string } | { cron: string })[] },
    handler: (input: {
      event: { name: string; data: Record<string, unknown> };
      step: {
        run: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
        sleepUntil: (name: string, until: Date) => Promise<void>;
      };
    }) => Promise<unknown>,
  ): unknown;
  send(payload: { name: string; data: Record<string, unknown> }): Promise<unknown>;
};

/**
 * Inngest adapter (handbook §18.3, chosen 2026-07-06): durable steps, retries,
 * and sleep-until belong to Inngest; this class only translates the contract.
 * Registered functions are exposed for the HTTP serve() integration.
 */
export class InngestWorkflowEngine implements WorkflowEngine {
  readonly functions: unknown[] = [];

  constructor(private readonly client: InngestClientLike) {}

  register(definition: WorkflowDefinition): void {
    this.functions.push(
      this.client.createFunction(
        { id: definition.id, triggers: [definition.trigger] },
        ({ event, step }) =>
          definition.handler(
            { name: event.name, data: event.data },
            {
              run: (name, fn) => step.run(name, fn),
              sleepUntil: (name, until) => step.sleepUntil(name, until),
            },
          ),
      ),
    );
  }

  async send(event: WorkflowEvent): Promise<void> {
    await this.client.send({ name: event.name, data: event.data });
  }
}
