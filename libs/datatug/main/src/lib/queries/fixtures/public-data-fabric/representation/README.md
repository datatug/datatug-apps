# Synthetic consumer compatibility fixture

Copied byte-for-byte from `openvaultdb/ovdb` commit `aec07d17be1e074210acefddb858363ce7777704`, `publisher/representation/testdata`, after independent review of the schema1 helper. These example repositories and labels are hypothetical test inputs. They do not register a provider or admit a semantic decision. Tests mutate copies and retain the original pinned bytes here.

The consumer remains closed pending real Directory/provider companions, independent scoped semantic acceptance and runtime publication. Direct native identifier mode is a separate, unfrozen schema proposal; this fixture only exercises the reviewed label bridge shape.

`directory.pinned.json` and `models.pinned.json` are exact canonical index bytes from Directory commit `02db362144d7924c6081dd6768cc0d7187ac9bc3` and ModelSpec registry commit `48b30b250a61385d94d46a70968677870750ea35`. Their SHA256 values match INITIAL_CANONICAL_PINS. They test connection/provider/entity/property coordinates and never grant semantic eligibility. The configured adapter test uses an explicit synthetic representation namespace; its source schema hash is the actual Chinook model JSON at Directory provider commit `26e852cca00101f53a84ef8ee1f1ae389067f5cf`.
