# Building waCoq binaries

The following instructions describe the procedure for building wacoq-bin
on a Unix-like system. The required packages can be obtained using
`apt` (Debian), MacPorts/Homebrew (macOS), or the like.

## Prerequisites

 * OPAM 2 (you can get the installer from https://opam.ocaml.org/doc/Install.html)
   - `bubblewrap` is a dependency of OPAM, you can either install it (`apt install bubblewrap`),
     or skip it by running `opam init --disable-sandboxing`.
     (Some platforms, such as WSL, do not support sandboxing, so choose the latter.)
 * m4 (`apt install m4`)
 * npm (bundled with latest Node.js, follow the [instructions](https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions)).
 * wasi-sdk ([version 12](https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-12) is recommended)
   - You can forego this prerequisite is all you want is to build library addons for waCoq, rather than build waCoq itself.
     See below.

## Build steps

 1. Clone the wacoq-bin repo.
```sh
git clone --recursive git@github.com:corwin-of-amber/wacoq-bin.git  # (this repo)
cd wacoq-bin
```

 2. Create on OPAM switch with OCaml 4.10.2.
```sh
opam switch create wacoq 4.10.2   # or 4.10.2+32bit for a 32-bit variant
```
 **Note** Since WASM is a 32-bit architecture, 32-bit builds are considered safer.
 However, on macOS 10.14 and above and on WSL you will have trouble building (native)
 32-bit executables. Building with a 64-bit toolchain has been tested and so far works fine.
 We use [a patch](https://github.com/jscoq/jscoq/blob/v8.13/etc/patches/coerce-32bit.patch)
 to make the generated `.vo` files compatible with the 32-bit runtime in the browser.

 3. Fetch Coq 8.13 sources from the repository and configure it for build.
```sh
opam make coq
```

 4. Build WASM binaries and additional package files.
    * Skip this stage if you just want to build some libraries for waCoq.
```sh
make wacoq
make dist-npm   # to make an NPM package
```

## Building libraries (optional)

 5. Install waCoq binaries.
```sh
make install   # this installs waCoq's version of Coq in the
               # wacoq OPAM switch
```

 6. Clone https://github.com/jscoq/addons in a separate working directory.
```sh
git clone --recursive https://github.com/jscoq/addons jscoq-addons
cd jscoq-addons
```

 **Note** The addons repo is common for jsCoq and waCoq.

 7. Build the libraries.
```sh
make CONTEXT=wacoq
```

You can also build any subset of the libraries by running `make` in their respective
directories.
The flag `CONTEXT=wacoq` only affects the top-level makefile though;
to build in subdirectories, set your `DUNE_WORKSPACE` environment variable to 
`path/to/jscoq-addons/dune-workspace.wacoq`.

 8. Create NPM packages for compiled libraries.
```sh
make pack   # in jscoq-addons working directory
```

This creates `.tgz` files for packages in `_build/wacoq`.
You can then `npm install` them in your waCoq distribution.
