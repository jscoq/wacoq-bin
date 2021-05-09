
WORD_SIZE = 64

current_dir := ${shell pwd}

BUILD_CONTEXT = wacoq

COQBUILDDIR_REL := vendor/coq
COQBUILDDIR := $(current_dir)/_build/$(BUILD_CONTEXT)/$(COQBUILDDIR_REL)

PACKAGE_VERSION = ${shell node -p 'require("./package.json").version'}


.PHONY: default bootstrap setup deps wacoq coq-pkgs

default: wacoq

bootstrap: setup deps
	
setup:
	etc/setup.sh

deps: coq coq-serapi

wacoq:
	dune build @coq @wacoq coq-pkgs
	mkdir -p dist && cp _build/$(BUILD_CONTEXT)/cli.js dist/cli.js
	ln -sf ${foreach m, ${wildcard _build/$(BUILD_CONTEXT)/coq-pkgs/*}, ../../$m} bin/coq/

wacoq-only:
	dune build @wacoq

install:
	# This unfortunately deletes some wacoq build artifacts
	# (re-run `make wacoq` to restore)
	dune build -p coq
	dune install coq

dist-npm:
	rm -rf staging
	npx parcel build -d staging/dist --no-source-maps --target node src/cli.ts
	npx parcel build -d staging/dist --no-source-maps --target node -o subproc.js src/backend/subproc/index.ts
	npx parcel build -d staging/dist --no-source-maps src/worker.ts
	cp package.json index.js README.md staging/
	mkdir staging/bin && ln -s ${addprefix ../../bin/, icoq.bc coq} staging/bin/
	mkdir staging/etc && cp etc/postinstall.js staging/etc
	tar zchf wacoq-bin-$(PACKAGE_VERSION).tar.gz \
	    --exclude='coqlib/**' --exclude='*.*.js' --exclude='*.so' \
	    -C staging ./package.json ./index.js ./dist ./bin ./etc

########################################################################
# Externals
########################################################################

.PHONY: coq

COQ_SRC = vendor/coq

COQ_BRANCH = V8.13.2
COQ_REPOS=https://github.com/coq/coq.git

COQ_PATCHES = timeout $(COQ_PATCHES|$(WORD_SIZE))

COQ_PATCHES|64 = coerce-32bit

$(COQ_SRC):
	git clone -c advice.detachedHead=false --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $@
	cd $@ && git apply ${foreach p,$(COQ_PATCHES),$(current_dir)/etc/patches/$p.patch}

coq: $(COQ_SRC)
	eval `opam env --switch=$(BUILD_CONTEXT)` && \
	cd $(COQ_SRC) && ./configure -prefix $(current_dir) -native-compiler no -bytecode-compiler no -coqide no


.PHONY: coq-serapi

SERAPI_SRC = vendor/coq-serapi

coq-serapi:
	git submodule update $(SERAPI_SRC)
