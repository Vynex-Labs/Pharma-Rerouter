# P2 — Cross-Role Architecture Evaluation (Master Prompt §37 Step 7)

Six roles independently evaluated Architectures A, B, C. The objective is not agreement.
Dissent and unresolved concerns are recorded verbatim as conditions on approval.

---

## Product Manager (Role 2)
**Verdict: C.**
"A is a demo of an AI framework, not a product. Our user, Ravi, does not want a system that
*sometimes* takes a different path — during a disruption he needs the same reliable procedure every
time, because he will be judged on the outcome. B is a product but it does not reduce his real
bottleneck, which is *interpretation* — reading the advisory, understanding what it means, and
explaining the choice to Compliance. C puts AI exactly where his time actually goes."

**Condition PM-1:** the UI must make it visually obvious which text is computed and which is
model-generated. If a manager cannot tell, we have built a liability.

---

## Pharmaceutical Supply-Chain Domain Expert (Role 3)
**Verdict: C, with a hard requirement.**
"No supply-chain professional will accept an LLM producing a days-of-cover number. In this domain a
wrong number is not an inconvenience, it is a shortage. C is the only option where that is
structurally impossible rather than merely discouraged."

**Challenge:** "Your state machine goes straight from RANKED to POLICY. Real operations have a step
you have omitted: *someone confirms the option is executable with the carrier/site*. If you skip it
you will look naive."
**Resolution accepted into design:** the execution step is modelled as *bounded intent + confirmation
of updated shipment state*, and the UI labels it "Execute (simulated carrier confirmation)". We do
not pretend to book freight. Recorded as an explicit limitation, not hidden.

**Condition DE-1:** cold-chain feasibility must be a gate, not a weighted cost term.
**Condition DE-2:** supplier qualification per destination market must be able to return BLOCKED.

---

## AI / Agent Architect (Role 5)
**Verdict: C.**
Applying the Role-5 questionnaire to each seam:

| Seam | Why AI? | Why not deterministic? | Can decide | Cannot decide | Low confidence → |
|---|---|---|---|---|---|
| S1 Sensing | free-text advisories are unstructured | regex/keyword rules break on unseen phrasing | event type, severity band, confidence, geography | which shipments are affected | mark UNCERTAIN; force RECOMMEND, never AUTONOMOUS |
| S2 Impact narration | audience-appropriate summarisation | templates are unreadable at scale | wording, emphasis | any figure | fall back to template |
| S3 Scenario reasoning | qualitative trade-offs across incommensurate axes | ranking alone cannot explain *why* | candidate strategy intents, ordering rationale | cost, ETA, risk, feasibility | present engine ranking without narrative |
| S5 Explanation | approver needs a readable evidence pack | as above | prose | the policy verdict | template |
| S6 Compliance | narrative attribution of sources | as above | prose | the hash chain | template |
| Orchestrator | anomaly noticing, next-step suggestion | — | *suggestions only* | any state transition | silent |

"Note that S4 Policy has **no agent**. That is deliberate and it is the single most defensible
decision in this architecture — the thing that decides whether a human must approve is not
probabilistic."

**Condition AI-1:** every agent must declare `confidence` and an explicit `uncertainty` field;
hiding uncertainty is a §11 violation and must fail an eval test in P11.
**Condition AI-2:** an eval must prove that a schema-invalid or entity-invalid agent output is
rejected, not coerced.

---

## Data Architect (Role 6)
**Verdict: C, conditionally.**
"C is the only architecture with a coherent persistence story, because the state machine gives every
row a lifecycle. A's state lives in transcripts, which is not a data model."

**Concern DA-1:** the hash chain must cover the *semantically meaningful* payload, not a JSON string
whose key order can vary — otherwise verification will produce false failures. Requires canonical
serialisation. Carried into P4 as binding.
**Concern DA-2:** scenarios must be persisted with the *inputs they were computed from* (a snapshot
reference), or recovery verification and stale-approval detection cannot work. Carried into P4.

---

## SAP Strategy Specialist (Role 12)
**Verdict: C.**
"C gives a clean answer to 'where exactly is SAP?': the deterministic core reads its inventory and
product master through a port, and that port's primary implementation is S/4HANA Cloud OData. In A,
SAP would be one tool among many that an LLM may or may not call — which is exactly the kind of claim
that collapses under a judge's follow-up question."

**Condition SAP-1:** no slide, README line or UI string may say "integrated with SAP" until P7
attaches request/response evidence. Until then the permitted phrasing is
*"SAP S/4HANA Cloud OData contract implemented; running against sandbox / simulated data."*
**Condition SAP-2:** the fallback mode must be visible in the demo at least once, deliberately. A
system that only looks honest when nothing fails is not honest.

---

## Competition / Judge Analyst (Role 27)
**Verdict: C.**
Rehearsing the hostile questions:

- *"Why AI?"* → Seam table, S1/S3 specifically. Answerable in 20 seconds.
- *"Why agents rather than one prompt?"* → distinct authorities and distinct tool allow-lists per
  seam; an agent that may classify text physically cannot mint an execution authorization.
- *"Why not ordinary automation?"* → because ordinary automation cannot read an advisory it has never
  seen, and cannot explain a trade-off to a compliance officer.
- *"What happens when the AI is wrong?"* → **strongest answer we have.** The decision does not change;
  only the prose does. We will demonstrate this live by disabling the model mid-demo.
- *"What is genuinely autonomous?"* → only low-risk reversible actions, by policy, and we will say so
  plainly rather than overclaim.

**Concern CA-1:** the honest weakness of C is that a judge may say *"your agents are just fancy
summarisers."* We must pre-empt it, not dodge it: S1 (unstructured→structured classification driving
a real branch) and S3 (strategy-intent generation that changes which scenarios are computed) are
where agents *materially alter outcomes*. P6 must ensure S3 genuinely influences scenario generation
rather than merely commenting on a fixed list — otherwise CA-1 is a fair hit.
**Condition CA-2:** S3 must feed strategy intents into the generator. Binding on P6.

---

## Master Orchestrator — Consolidation

**Unanimous selection: Architecture C.**

Approval is **APPROVED_WITH_CONDITIONS**. The conditions are not advisory; each is assigned an owning
phase and must be closed before that phase can pass.

| Condition | Owner phase | Closes |
|---|---|---|
| PM-1 computed vs generated text visually distinct | P8 | AR-1 credibility |
| DE-1 cold-chain feasibility is a gate | P5 | AD-8 |
| DE-2 supplier qualification can BLOCK | P5 | AD-8 |
| AI-1 confidence + uncertainty mandatory | P6 | §11 |
| AI-2 invalid agent output rejected, proven by eval | P11 | AR-2 |
| DA-1 canonical serialisation for hashing | P4 | AR-4 |
| DA-2 scenarios persist their input snapshot | P4 | AR-3 |
| SAP-1 no integration claim without evidence | P7 | §30 |
| SAP-2 fallback demonstrated in the demo | P18 | §30 |
| CA-2 S3 intents genuinely drive generation | P6 | CA-1 |

No phase may mark itself PASSED while carrying an open condition it owns.
