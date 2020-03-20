const fs = require('fs');

// Create links to required WASM binaries in other NPM packages
if (fs.existsSync('../ocaml-wasm')) {
    fs.symlinkSync('../../ocaml-wasm/bin', 'bin/ocaml');
    if (fs.existsSync('../ocaml-wasm.4.08--num') && !fs.existsSync('bin/ocaml/dllnums.wasm')) {
        fs.symlinkSync('../../ocaml-wasm.4.08--num/bin/dllnums.wasm', 'bin/ocaml/dllnums.wasm');
    }
}
