import { getTraitsView } from "../../lib/data";

// §6.16: there is no invisible profile. Every read that influences tethr's
// behavior is viewable — estimate, confidence, and the evidence count behind
// it — and correctable in conversation, where a correction is the
// highest-weight signal the model accepts.

export const dynamic = "force-dynamic";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const estimate = (value: unknown) => (typeof value === "number" ? value.toFixed(2) : "—");

export default async function TraitsPage() {
  const traits = await getTraitsView();

  return (
    <>
      <p className="kicker">What tethr believes</p>
      <h1>Inspectable, correctable — never invisible</h1>
      <p className="lede">
        Each read carries its confidence and its evidence. Tell tethr where it’s wrong — “I’m not
        avoiding customers, I’ve just been slammed” — and the correction outweighs everything else.
      </p>
      {traits.length === 0 ? (
        <p className="empty">
          No behavioral reads yet. Onboarding seeds the first low-confidence estimates; behavior
          sharpens them.
        </p>
      ) : (
        <section aria-label="Behavioral dimensions">
          <table className="traits">
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Family</th>
                <th scope="col">You say</th>
                <th scope="col">You do</th>
                <th scope="col">Confidence</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {traits.map((trait) => (
                <tr key={trait.dimension}>
                  <td>{trait.dimension.replaceAll("_", " ")}</td>
                  <td>{trait.family.replaceAll("_", " ")}</td>
                  <td>{estimate(trait.stated.estimate)}</td>
                  <td>{estimate(trait.revealed.estimate)}</td>
                  <td>{percent(Math.max(trait.stated.confidence, trait.revealed.confidence))}</td>
                  <td>
                    {trait.observationCount} observation{trait.observationCount === 1 ? "" : "s"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            “You say” and “you do” are kept separate on purpose — the gap between them is signal,
            and action policy follows what you do (§6.7).
          </p>
        </section>
      )}
    </>
  );
}
