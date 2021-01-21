# wacoq-bin

This is the WebAssmebly back-end for waCoq (currently a subsidiary of
jsCoq). It is meant to be used internally by waCoq.
For the frontend, see [here (GitHub)](https://github.com/corwin-of-amber/jscoq/tree/v8.12+wacoq) and [here (npm)](https://www.npmjs.com/package/wacoq).

This package contains:
 * `icoq.bc`, which is compiled OCaml bytecode of Coq with a JSON interface for accessing the STM.
 * `dllbyterun_stubs.wasm`, which contains stubs for C primitives (with empty implementations -- the native compiler and VM are turned off).
 * `.coq-pkg` archives for the Coq standard library bundle.