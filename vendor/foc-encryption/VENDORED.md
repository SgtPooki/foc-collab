# foc-encryption (vendored)

Kuba's reference FEE implementation, `packages/foc-encryption/src` from
https://github.com/Kubuxu/foc-encryption-demo at
6d9f5750530fdd8940574be8eb781626c092da5b, transpiled with esbuild
(types stripped, nothing else changed). To regenerate, from that
checkout's `packages/foc-encryption/src`:

    npx esbuild $(find . -name '*.ts') --outdir=<repo>/vendor/foc-encryption --format=esm --target=es2022

License: Apache-2.0 OR MIT, like this repo.

Temporary. It predates the FIP amendments that FilOzone/synapse-sdk#967
adopts, so blobs written with it will not open with
`@filoz/filecoin-encryption-envelope`. Only `games/lib/seal.js` imports
it; replace it there when the production package ships AEAD.
