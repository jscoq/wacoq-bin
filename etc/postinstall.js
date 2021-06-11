const fs = require('fs');

// Create links to required WASM binaries in other NPM packages
if (fs.existsSync('../ocaml-wasm')) {
    fs.symlinkSync('../../ocaml-wasm/bin', 'bin/ocaml');
}
if (fs.existsSync('../@ocaml-wasm/4.12--num')) {
    fs.symlinkSync('../../@ocaml-wasm/4.12--num/bin', 'bin/num');
}
if (fs.existsSync('../@ocaml-wasm/4.12--zarith')) {
    fs.symlinkSync('../../@ocaml-wasm/4.12--zarith/bin', 'bin/zarith');
}
