# OMOS Intelligence and LiteLLM Rules

LiteLLM is OMOS's model gateway, not its mining intelligence architecture.

## Responsibility boundary

OMOS owns:

- mining business logic and deterministic rules;
- agent orchestration, prompt/agent policy and controlled tools;
- tenant/project/user context, RBAC, validation, escalation and audit;
- operational evidence, provenance and decision governance.

LiteLLM owns:

- provider abstraction, logical model aliases and routing;
- fallback, retry, timeout, rate limiting and provider availability;
- token/cost measurement and model-level usage visibility.

## Non-negotiable controls

- Never place provider keys in frontend code or committed files.
- Every AI request must propagate tenant, project, user, agent and request
  identity before model invocation.
- Agents must use controlled tools, not arbitrary AI-generated SQL against
  operational databases.
- AI may read or recommend by default. Any data change/action requires an
  OMOS workflow, authorization and human approval where policy requires it.
- Preserve tenant isolation in prompts, retrieval, tools, logs and cost data.
- Version prompts, agents, allowed tools/models and evaluation suites.
- Record model/provider, latency, token/cost, result status and relevant audit
  metadata without exposing sensitive payloads.

Read `OMOS_LITELLM_PROJECT_HANDOVER.md` before designing or changing the AI
service boundary. Treat that document as architectural/historical context and
verify every implementation claim in the repository first.

