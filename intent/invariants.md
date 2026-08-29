# Peira demo invariants for the 2022 groovy runner

## Result isolation
<!-- peira: id=result-isolation kind=invariant -->
Execution results are visible only to the user who submitted the request.
Invariant: for all requests r, for all users u ≠ submitter(r): GET /groovy/status for r as u → 403 Forbidden.
(Any authenticated principal may be the submitter; any *different* principal must be refused.)

## Submit accepts any valid script
<!-- peira: id=submit-accepts-any-valid-script kind=invariant -->
Invariant: for all authenticated principals p, for all valid groovy arithmetic expressions e:
POST /groovy/submit as p with code e → 200 with a request id, and the request eventually reaches
status COMPLETED with the result field equal to the exact value of e (as a string).
