"use client";

import type { Candidate, EntryPathId, Question, Step, TapOption } from "@tethr/entry";
import { type FormEvent, useState, useTransition } from "react";
import {
  type FinishResult,
  finish,
  pickCandidate,
  type StepResult,
  startPath,
  submitAnswer,
  surfaceCandidates,
} from "./actions";

// The conversational entry surface (§3.6). One question at a time — a chat, not
// a form. Tap options are buttons; free text is a single field; the channel
// question reveals a phone input for iMessage/WhatsApp/SMS. Interstitials are
// tethr's between-answer lines (verbatim copy on the question). Deliberately
// thin: the state machine + persistence live in @tethr/entry.

const PHONE_CHANNELS = new Set(["imessage", "whatsapp", "sms"]);

const PATHS: { path: EntryPathId; label: string; sub: string }[] = [
  { path: "A", label: "I have a specific idea", sub: "tethr starts researching it right away." },
  { path: "B", label: "I have a direction, not an idea yet", sub: "tethr helps sharpen it." },
  { path: "C", label: "I have nothing yet", sub: "tethr helps surface a place to start." },
];

type View =
  | { kind: "picker" }
  | { kind: "question"; question: Question }
  | { kind: "synthesize"; candidates?: Candidate[] }
  | { kind: "complete" }
  | { kind: "done"; verificationSent: boolean; hasChannel: boolean };

const viewFor = (step: Step | null): View => {
  if (!step) return { kind: "picker" };
  if (step.type === "question") return { kind: "question", question: step.question };
  if (step.type === "synthesize") return { kind: "synthesize" };
  return { kind: "complete" };
};

export function Conversation({ initialStep }: { initialStep: Step | null }) {
  const [view, setView] = useState<View>(() => viewFor(initialStep));
  const [interstitial, setInterstitial] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  const applyStep = (result: StepResult, priorInterstitial?: string) => {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(undefined);
    setInterstitial(priorInterstitial);
    setView(viewFor(result.step));
  };

  return (
    <section aria-labelledby="start-heading" className="onb">
      <p className="kicker">Onboarding</p>
      <h1 id="start-heading">Talk to tethr</h1>

      {interstitial ? <p className="onb-interstitial">{interstitial}</p> : null}
      {error ? (
        <p className="onb-error" role="alert">
          {error}
        </p>
      ) : null}

      {view.kind === "picker" ? (
        <PathPicker
          pending={pending}
          onPick={(path) => start(async () => applyStep(await startPath(path)))}
        />
      ) : null}

      {view.kind === "question" ? (
        <QuestionCard
          key={view.question.id}
          question={view.question}
          pending={pending}
          onAnswer={(input) =>
            start(async () =>
              applyStep(
                await submitAnswer(view.question.id, input),
                view.question.interstitialAfter,
              ),
            )
          }
        />
      ) : null}

      {view.kind === "synthesize" ? (
        <Synthesize
          candidates={view.candidates}
          pending={pending}
          onSurface={() =>
            start(async () => {
              const r = await surfaceCandidates();
              if (!r.ok) setError(r.error);
              else setView({ kind: "synthesize", candidates: r.candidates });
            })
          }
          onPick={(c) => start(async () => applyStep(await pickCandidate(c)))}
        />
      ) : null}

      {view.kind === "complete" ? (
        <div className="onb-panel">
          <p>That's everything tethr needs. It will start working the moment you finish.</p>
          <button
            type="button"
            className="onb-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r: FinishResult = await finish();
                if (!r.ok) setError(r.error);
                else
                  setView({
                    kind: "done",
                    verificationSent: r.verificationSent,
                    hasChannel: r.hasChannel,
                  });
              })
            }
          >
            {pending ? "Finishing…" : "Finish and start"}
          </button>
        </div>
      ) : null}

      {view.kind === "done" ? (
        <Done verificationSent={view.verificationSent} hasChannel={view.hasChannel} />
      ) : null}
    </section>
  );
}

function PathPicker({ pending, onPick }: { pending: boolean; onPick: (p: EntryPathId) => void }) {
  return (
    <div className="onb-picker">
      <p className="lede">Where are you starting from?</p>
      {PATHS.map((p) => (
        <button
          key={p.path}
          type="button"
          className="onb-option"
          disabled={pending}
          onClick={() => onPick(p.path)}
        >
          <span className="onb-option-label">{p.label}</span>
          <span className="onb-option-sub">{p.sub}</span>
        </button>
      ))}
    </div>
  );
}

function QuestionCard({
  question,
  pending,
  onAnswer,
}: {
  question: Question;
  pending: boolean;
  onAnswer: (
    input: { kind: "free_text"; text: string } | { kind: "tap"; value: string; phone?: string },
  ) => void;
}) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<string | undefined>();
  const [phone, setPhone] = useState("");

  const submitText = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onAnswer({ kind: "free_text", text: text.trim() });
  };

  return (
    <div className="onb-panel">
      <p className="onb-prompt">{question.prompt}</p>

      {question.kind === "free_text" ? (
        <form onSubmit={submitText} className="onb-freetext">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            aria-label={question.prompt}
            placeholder="Type your answer…"
          />
          <button type="submit" className="onb-primary" disabled={pending || !text.trim()}>
            {pending ? "…" : "Send"}
          </button>
        </form>
      ) : null}

      {question.kind === "tap" ? (
        <div className="onb-options">
          {question.options?.map((o: TapOption) => (
            <button
              key={o.value}
              type="button"
              className="onb-option"
              disabled={pending}
              onClick={() => onAnswer({ kind: "tap", value: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}

      {question.kind === "tap_phone" ? (
        <div className="onb-options">
          {question.options?.map((o: TapOption) => (
            <button
              key={o.value}
              type="button"
              className={`onb-option${channel === o.value ? " selected" : ""}`}
              disabled={pending}
              onClick={() => {
                if (PHONE_CHANNELS.has(o.value)) setChannel(o.value);
                else onAnswer({ kind: "tap", value: o.value });
              }}
            >
              {o.label}
            </button>
          ))}
          {channel ? (
            <form
              className="onb-phone"
              onSubmit={(e) => {
                e.preventDefault();
                if (phone.trim()) onAnswer({ kind: "tap", value: channel, phone: phone.trim() });
              }}
            >
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Your number, e.g. +1 555 123 4567"
                aria-label="Phone number"
              />
              <button type="submit" className="onb-primary" disabled={pending || !phone.trim()}>
                Confirm
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Synthesize({
  candidates,
  pending,
  onSurface,
  onPick,
}: {
  candidates: Candidate[] | undefined;
  pending: boolean;
  onSurface: () => void;
  onPick: (c: Candidate) => void;
}) {
  if (!candidates) {
    return (
      <div className="onb-panel">
        <p>tethr has enough to surface a few starting directions from what you told it.</p>
        <button type="button" className="onb-primary" disabled={pending} onClick={onSurface}>
          {pending ? "Thinking…" : "Show me directions"}
        </button>
      </div>
    );
  }
  return (
    <div className="onb-picker">
      <p className="lede">Pick the one that pulls at you. You'll go deeper on it next.</p>
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          className="onb-option"
          disabled={pending}
          onClick={() => onPick(c)}
        >
          <span className="onb-option-label">{c.title}</span>
          <span className="onb-option-sub">{c.summary}</span>
        </button>
      ))}
    </div>
  );
}

function Done({
  verificationSent,
  hasChannel,
}: {
  verificationSent: boolean;
  hasChannel: boolean;
}) {
  return (
    <div className="onb-panel onb-done">
      <h2>tethr is on it.</h2>
      {hasChannel ? (
        <p>
          {verificationSent
            ? "Check your phone — reply with the code tethr just sent to confirm this is you. From then on, tethr reaches you there."
            : "tethr will text you a code to confirm your channel. Reply with it to let tethr reach you."}
        </p>
      ) : (
        <p>
          You chose not to be reached out to. tethr will keep working; open the app to see where
          things stand.
        </p>
      )}
      <p className="note">Research has started — you didn't have to ask.</p>
      <a className="onb-primary" href="/">
        See my company
      </a>
    </div>
  );
}
