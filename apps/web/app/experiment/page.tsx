import { getExperimentView } from "../../lib/data";

// The Experiment (§4.3, Ch 13): hypothesis and success/failure criteria up
// front, set in advance — the founder knows before running it what outcome
// counts as learning, and what counts as a kill signal.

export const dynamic = "force-dynamic";

export default async function ExperimentPage() {
  const experiment = await getExperimentView();

  return (
    <>
      <p className="kicker">Active Experiment</p>
      <h1>The riskiest assumption, tested first</h1>
      {!experiment ? (
        <p className="empty">
          No experiment designed yet. Validation targets the single highest-risk assumption in the
          plan — the one whose failure would most cheaply kill the idea.
        </p>
      ) : (
        <section aria-label="Experiment design">
          <div className="panel">
            <dl className="facts">
              <dt>Hypothesis</dt>
              <dd>{experiment.hypothesis}</dd>
              <dt>Succeeds if</dt>
              <dd>{experiment.successCriteria}</dd>
              <dt>Fails if</dt>
              <dd>{experiment.failureCriteria}</dd>
              <dt>Duration</dt>
              <dd>{experiment.duration}</dd>
              <dt>Sample size</dt>
              <dd>{experiment.sampleSize}</dd>
              <dt>Status</dt>
              <dd>
                <span className="badge">{experiment.status}</span>
              </dd>
            </dl>
          </div>
          <p className="note">
            Criteria were set before the run — results get read, not rationalized.
          </p>
        </section>
      )}
    </>
  );
}
