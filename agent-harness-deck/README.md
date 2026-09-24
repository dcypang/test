# Building a Modern Personal Agent Harness (slide deck)

A 47-slide LaTeX Beamer deck. The diagrams are drawn in TikZ. It covers:

- **Foundations**: what a personal agent has to do (browse, shop, book travel, negotiate late returns, life admin) and the design principles behind it.
- **Reference architecture**: the agent loop, memory (write path and read path, five memory types), the tool ladder (API, then browser, then human), the browser subsystem, prompt-injection containment (dual LLM plus a policy engine), permission tiers, and per-task virtual cards.
- **Use-case flows**: sequence diagrams for shopping and travel, and a state flow for negotiating a late return, plus a negotiation playbook.
- **14 architecture variants**, each with a diagram and trade-offs, followed by a comparison matrix and a recommended combination.
- **Prototype stack (0 to thousands of users)**: architecture, a layer-by-layer stack table, a Temporal workflow code sketch, a 12-week plan, and capacity and cost estimates.
- **Scaling to millions**: phases, capacity math, a cell-based multi-region architecture, LLM cost reduction, the browser and voice fleet, reliability and SLOs, security and compliance, and the eval flywheel.
- **Team, risks, takeaways**.

## Build

```sh
make            # runs pdflatex twice -> personal_agent_harness.pdf
```

You need a TeX Live install with beamer, pgf/tikz, adjustbox, booktabs, tabularx, colortbl and listings. On Debian/Ubuntu these come with `texlive-latex-extra` and `texlive-pictures`.

Vendor names are examples of each category as of September 2026. Costs are order-of-magnitude estimates at list prices.
