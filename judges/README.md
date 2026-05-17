# Judge Research Briefs

Created from the judge list in `hackathon.md` on May 16, 2026.

Use these as directional signal, not definitive psychology. Public information is uneven: Brian Lovin, Matt Palmer, Max Schoening, Anthony Morris, and Mike Vernal have clearer public signals; several Notion/Anthropic engineers have lower public footprints, so their notes lean more on role/company context and event themes.

## Fast Takeaways

- **Notion judges** likely reward projects that make Notion feel like an extensible operating system: Workers, databases, Custom Agents, webhooks, and useful workflows that turn messy work into durable shared context.
- **Anthropic judges** likely reward agentic systems that are reliable, tool-using, inspectable, and safe enough for real workflows. For Claude Code-adjacent judges, show real code changes, tests, diffs, logs, and human approval points.
- **Vercel judges** likely reward polished developer/product execution: fast web UX, clean deployment story, AI-native interfaces, and production-minded architecture.
- **Investor judges** likely reward a wedge that can become a company: a painful workflow, a clear buyer/user, strong demo magic, and a credible path beyond the hackathon.
- **DevRel/DX judges** likely reward explainability: a demo that teaches itself, great docs, sensible onboarding, and obvious developer leverage.

## Judge Files

- [Alfred Xing](alfred-xing.md)
- [Alice Zhao](alice-zhao.md)
- [Andrew Qu](andrew-qu.md)
- [Anthony Morris](anthony-morris.md)
- [Brian Lovin](brian-lovin.md)
- [Carter Pedersen](carter-pedersen.md)
- [Charmaine Lee](charmaine-lee.md)
- [Cole Bemis](cole-bemis.md)
- [Jules Qiu](jules-qiu.md)
- [Lakshmi Subbramanian](lakshmi-subbramanian.md)
- [Matt Palmer](matt-palmer.md)
- [Max Schoening](max-schoening.md)
- [Mike Vernal](mike-vernal.md)
- [Neena Parikh](neena-parikh.md)
- [Paul Scherer](paul-scherer.md)
- [Pavla Bobosikova](pavla-bobosikova.md)
- [Simon Last](simon-last.md)

## Highest-Expected-Value Idea Shape

A strong project for this panel is probably not "AI chatbot in Notion." It is closer to:

> A Notion Worker-powered agent that watches real external systems, maintains durable Notion memory, translates signals into structured databases/tasks/docs, proposes risky actions for approval, and can show an audit trail of what it did and why.

Good demo pattern:

1. Trigger: a webhook, schedule, or external event arrives.
2. Agent reads multiple sources.
3. Agent updates Notion databases/pages with structured state.
4. Agent drafts or performs a real action through a tool.
5. Human approves risky/public/expensive actions.
6. Demo shows logs, memory, evaluation checks, and final artifact.

Avoid:

- generic RAG
- education/medical/personality/companion chatbots
- Streamlit
- a demo that is mostly slides
- brittle one-shot prompts with no persistent workflow state

