# Peira demo service — secured echo

## Signed echo
<!-- peira: id=hmac-echo kind=ac -->
The service exposes `POST /secure/echo` for authenticated users.

The request body is exactly `{"payload": "<string>", "signature": "<hex string>"}`.
`signature` must be the lowercase hex HMAC-SHA256 of the payload string, keyed with the shared
demo secret `peira-demo-secret` (the secret is public by design for this demo service; it is
not a principal credential).

A correctly signed request returns 200 with body `{"echo": "<payload>", "verified": true}`.
A request with a wrong signature returns 400.
