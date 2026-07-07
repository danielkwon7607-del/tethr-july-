import type { JsonValue, WorkflowDefinition, WorkflowEngine, WorkflowEvent } from "./engine";

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
  send(payload: { name: string; data: Record<string, unknown>; id?: string }): Promise<unknown>;
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
            // Inngest event payloads went through its JSON transport, so the
            // narrowing to JsonValue reflects what actually arrived.
            { name: event.name, data: event.data as Record<string, JsonValue> },
            {
              run: (name, fn) => step.run(name, fn),
              sleepUntil: (name, until) => step.sleepUntil(name, until),
            },
          ),
      ),
    );
  }

  async send(event: WorkflowEvent): Promise<void> {
    await this.client.send({
      name: event.name,
      data: event.data,
      ...(event.id !== undefined ? { id: event.id } : {}),
    });
  }
}
