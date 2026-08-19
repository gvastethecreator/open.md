# Windows release checklist

## Build

- [ ] version is final and matches the release tag
- [ ] `pnpm run verify` passes
- [ ] Store/direct distribution channel is explicit
- [ ] installer is standalone/offline
- [ ] no development certificate or debug artifact is included

## Signing

- [ ] trusted OV certificate is available
- [ ] certificate has Code Signing EKU and is currently valid
- [ ] SHA-256 Authenticode signature applied to every shipped PE
- [ ] RFC 3161 timestamp applied
- [ ] installer signature verified with `signtool verify /pa /all /tw`
- [ ] expected signer subject verified

## Hosting

- [ ] versioned R2 key created
- [ ] object upload used conditional no-overwrite semantics
- [ ] final HTTPS URL returns the exact candidate bytes
- [ ] downloaded SHA-256 equals local evidence
- [ ] cache policy is immutable
- [ ] no `latest` URL is submitted to Partner Center

## Store

- [ ] exact reserved Store identity is configured
- [ ] package URL points to the immutable candidate
- [ ] silent install works
- [ ] clean install/upgrade/uninstall evidence is captured
- [ ] privacy URL is public
- [ ] certification notes are complete
- [ ] publication hold is used for the first submission

## Evidence

Retain the signed installer, SHA-256 manifest, signer subject/thumbprint, source commit, final URL, and clean-machine lifecycle evidence for every submission.