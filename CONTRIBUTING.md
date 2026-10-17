# Contributing to REVRA

## License of contributions (DCO/CLA)

By contributing you agree that your code is released under **Apache-2.0** and that
the maintainer may include it in future versions, including under different licenses
or in commercial editions (open-core). Sign your agreement with `Signed-off-by` in
the commit (`git commit -s`, DCO): it certifies the contribution is yours and that
you have the right to release it under Apache-2.0.

## Rules

1. **Dependency licenses:** MIT / Apache-2.0 only ([ADR-0002](docs/adr/0002-licenze-tool-mit-apache.md)).
   Tools under other licenses: out-of-process only, never linked/vendored — and only
   if no approved alternative exists.
2. **LLM providers:** bring-your-own via environment ([ADR-0003](docs/adr/0003-llm-provider-byom.md)).
   No keys in the repository (`scripts/secret-scan.sh` must stay clean).
3. **Claims need evidence:** every gate or benchmark changes only with a reproducible
   measurement (anti-gaming contract: we improve the system, not the threshold — PRD §0).
4. Build and test before opening a PR: `pnpm build && pnpm typecheck && pnpm test`.
