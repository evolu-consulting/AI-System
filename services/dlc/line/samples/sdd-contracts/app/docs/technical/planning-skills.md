# Planning skills for this app (onboarding, technical)

- Every validation lives in contracts.create; error messages start with the field name.
- A new field gets one test for the happy path and one per rule it must follow.
- Tests are named test_<case id>_<what>.
