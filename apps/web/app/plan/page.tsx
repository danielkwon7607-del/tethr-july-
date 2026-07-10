import { getPlanView } from "../../lib/data";

// The Plan (§4.3, Ch 12): a sequence with dependencies, never a flat
// checklist — the founder sees WHY THIS NEXT. Every Action shows its five
// mandatory fields, so “what do you want me to do” is always answerable.

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const plan = await getPlanView();

  return (
    <>
      <p className="kicker">The Plan</p>
      <h1>What happens next, and why</h1>
      {!plan ? (
        <p className="empty">
          No active plan yet. Planning generates one from the research verdict — sequenced against
          your actual capacity, grounded in Public Knowledge.
        </p>
      ) : (
        <section aria-label="Plan actions">
          <ol className="plan-list">
            {plan.actions.map((action) => (
              <li key={action.id}>
                <strong>{action.action}</strong> <span className="badge">{action.status}</span>
                <dl className="facts">
                  <dt>Done when</dt>
                  <dd>{action.definitionOfDone}</dd>
                  <dt>Needs from you</dt>
                  <dd>{action.founderRequirement || "nothing — tethr does this part"}</dd>
                  <dt>Estimated</dt>
                  <dd>{action.estimatedTime}</dd>
                  {action.dependsOn.length > 0 ? (
                    <>
                      <dt>Waits on</dt>
                      <dd>
                        {action.dependsOn.length} prior action
                        {action.dependsOn.length > 1 ? "s" : ""}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
          <p className="note">Push back on any action in the conversation — pushback re-plans.</p>
        </section>
      )}
    </>
  );
}
