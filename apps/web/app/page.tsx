import { loadConfig } from "@tethr/core";
import { getCompanyView } from "../lib/data";

// Company State (§1.9, §17.2): the always-current answer to "where is my
// company", plus the §4.5 cadence surface — tethr's current contact posture,
// read from the instrumented policy decisions. Adjusting cadence happens in
// words, in the conversation; it is a Founder Model signal, not a setting.
// The Build 0 fail-fast property is preserved: the page renders only under a
// valid, explicitly scoped environment.

export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  loadConfig(process.env);
  const view = await getCompanyView();

  if (!view) {
    return (
      <>
        <p className="kicker">Company State</p>
        <h1>Nothing here yet</h1>
        <p className="empty">
          Company State is seeded by onboarding (Build 6) and kept current by the ratchet — every
          interaction leaves it strictly better.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="kicker">Company State · {view.stage}</p>
      <h1>{view.companyName ?? "Unnamed company"}</h1>
      <p className="lede">The always-current answer to “where is my company.”</p>

      {view.verdict ? (
        <section aria-labelledby="verdict-heading">
          <h2 id="verdict-heading">Latest verdict</h2>
          <div className="panel">
            <span className={`badge ${view.verdict.verdict === "pivot" ? "hold" : "act"}`}>
              {view.verdict.verdict.replace("_", " ")}
            </span>
            <p className="note">{view.verdict.summary}</p>
          </div>
        </section>
      ) : null}

      <section aria-labelledby="cadence-heading">
        <h2 id="cadence-heading">Contact cadence</h2>
        {view.cadence ? (
          <div className="panel">
            <dl className="facts">
              <dt>Last initiation decision</dt>
              <dd>
                {view.cadence.behavior}{" "}
                <span className={`badge ${view.cadence.decision === "act" ? "act" : "hold"}`}>
                  {view.cadence.decision === "act" ? "reached out" : "held back"}
                </span>
              </dd>
              <dt>Wellbeing guard</dt>
              <dd>
                {view.cadence.vetoApplied
                  ? "burnout veto active — pace-increasing nudges suppressed"
                  : "not engaged"}
              </dd>
              <dt>Decided</dt>
              <dd>{view.cadence.decidedAt.toLocaleString()}</dd>
            </dl>
            <p className="note">
              Cadence is set by the intervention policy, not a schedule. Say “ease off this week” in
              the conversation and tethr treats it as a signal about you — not a buried setting.
            </p>
          </div>
        ) : (
          <p className="empty">
            No initiated contact yet — the policy hasn’t had a reason to reach out.
          </p>
        )}
      </section>

      <section aria-labelledby="thread-heading">
        <h2 id="thread-heading">Recent conversation</h2>
        {view.thread.length > 0 ? (
          <ul className="thread">
            {view.thread.map((message) => (
              <li key={message.id} className={message.direction}>
                {message.body}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">
            The conversation lives on your own channels; recent turns appear here.
          </p>
        )}
      </section>
    </>
  );
}
