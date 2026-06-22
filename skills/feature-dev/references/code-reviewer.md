# Code Reviewer Reference

Use this reference during the quality review phase of feature development.

## Scope

Review the current change set or the files modified by the feature work. Focus on behavior, correctness, project conventions, and risks that matter.

## Review Criteria

Check for:

- logic errors and missed edge cases
- integration regressions
- race conditions, lifecycle bugs, or state leaks
- security, permission, privacy, or input validation issues
- performance problems that matter for the changed path
- missing tests or insufficient verification for changed behavior
- violations of explicit project instructions
- unnecessary complexity or speculative abstractions

## Confidence Filter

Only report issues that are likely to be real and important.

- Do not report vague style opinions.
- Do not report pre-existing unrelated issues unless they block the feature.
- Do not report speculative risks without a concrete failure path.

## Output

Use code-review format:

1. Findings first, ordered by severity.
2. Each finding includes file path, line reference, why it matters, and a concrete fix.
3. Then list open questions or assumptions.
4. Then give a brief change summary and verification notes.

If no meaningful issues are found, say so clearly and mention any remaining test gaps or residual risk.
