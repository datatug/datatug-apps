# Hypothetical real-ROR user input

These eight input rows declare a hypothetical `affiliations.Affiliation.ror_id`
string property. They are not a native field of any DemoDB database. The two
published URL IDs occur in the full ROR release dated 2026-09-22 (ROR release
v2.13, JSON member SHA256
`6d032ff473f771e015da0837fe28b881a8f85822ee7815effefe11dc49c4346c`),
verified against `ingitdb/ror-ingitdb` source output at
`bbbec903248680caea04e68f94b9a957b6efc55b`.

Proposed representation is native ROR URL (`ROR:URL`), UTF8 byte-exact identity,
with no trimming, case folding, URL shortening or organization-name inference.
`a1` and `a3` are two distinct affiliations to one organization. Multiple ROR
locations would remain ordered details of that organization, without multiplying
the affiliation denominator. NULL, empty, malformed case/space and synthetic
name inputs remain separate exceptions, preserving their raw strings.

The exact immutable app commit and the schema path/hash identify this proposed
user mapping for a fresh independent reconciler. These files do not grant
semantic acceptance, canonical registration, native-id runtime support,
production eligibility or live journey acceptance. A committed declaration is
still pending until the dedicated decision and canonical companions land.

Fixture rows and schema are app test material under the app repository licence;
referenced ROR metadata is CC0-1.0. Embedded ROR GeoNames location data, when
displayed, carries CC-BY-4.0 attribution separately.
