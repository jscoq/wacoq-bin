opam switch wacoq || exit 1
eval $(opam env)
opam install --deps-only .
