
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
	dune build @coq @wacoq

wacoq-only:
	dune build @wacoq

dist/cli.js:
	parcel build --target node src/cli.ts

coq-pkgs:
	dune build -p coq
	node dist/cli.js --nostdlib src/build/metadata/coq-pkgs.json

install:
	dune build -p coq
	dune install coq

dist-npm:
	rm -rf staging
	parcel build -d staging/dist --no-source-maps --target node src/cli.ts
	parcel build -d staging/dist --no-source-maps --target node -o subproc.js src/backend/subproc/index.ts
	parcel build -d staging/dist --no-source-maps src/worker.ts
	cp package.json index.js staging/
	mkdir staging/bin && ln -s ../../bin/{icoq.bc,coq} staging/bin/
	mkdir staging/etc && cp etc/postinstall.js staging/etc
	tar zchf wacoq-bin-$(PACKAGE_VERSION).tar.gz \
	    --exclude='coqlib/**' --exclude='*.*.js' \
	    -C staging ./package.json ./index.js ./dist ./bin ./etc

########################################################################
# Externals
########################################################################

.PHONY: coq

COQ_SRC = vendor/coq

COQ_BRANCH=V8.12.0
COQ_REPOS=https://github.com/coq/coq.git

COQ_PATCHES = timeout $(COQ_PATCHES|$(WORD_SIZE))

COQ_PATCHES|64 = coerce-32bit

$(COQ_SRC):
	git clone --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $@
	cd $@ && git apply ${foreach p,$(COQ_PATCHES),$(current_dir)/etc/patches/$p.patch}

coq: $(COQ_SRC)
	eval `opam env --switch=$(BUILD_CONTEXT)` && \
	cd $(COQ_SRC) && ./configure -prefix $(current_dir) -native-compiler no -bytecode-compiler no -coqide no


.PHONY: coq-serapi

SERAPI_SRC = vendor/coq-serapi

coq-serapi:
	git submodule update $(SERAPI_SRC)
