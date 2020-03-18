
WORD_SIZE = 64

current_dir := ${shell pwd}

BUILD_CONTEXT = wacoq

COQBUILDDIR_REL := vendor/coq
COQBUILDDIR := $(current_dir)/_build/$(BUILD_CONTEXT)/$(COQBUILDDIR_REL)

EMSDK = ~/var/ext/emsdk
OCAML_INC = ${shell ocamlc -config-var standard_library}


.PHONY: bootstrap setup deps

bootstrap: setup deps
	
setup:
	etc/setup.sh

deps: coq coq-serapi

bin/coq/dllbyterun_stubs.wasm: src/backend/byterun_stubs.c
	source $(EMSDK)/emsdk_env.sh && \
	emcc -Os -s SIDE_MODULE=1 $< -o $@ -I${OCAML_INC}


dist-npm:
	rm -rf staging/dist
	parcel build -d staging/dist --no-source-maps src/index.html
	parcel build -d staging/dist --no-source-maps src/worker.ts
	cp package.json staging/
	ln -s ../bin staging/
	tar zchf wacoq-bin.tar.gz -C staging ./package.json ./dist ./bin	

########################################################################
# Externals
########################################################################

.PHONY: coq

COQ_SRC = vendor/coq

COQ_BRANCH=v8.11
COQ_REPOS=https://github.com/coq/coq.git

COQ_PATCHES = timeout $(COQ_PATCHES|$(WORD_SIZE))

COQ_PATCHES|64 = coerce-32bit

$(COQ_SRC):
	git clone --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $@
	cd $@ && git apply ${foreach p,$(COQ_PATCHES),$(current_dir)/etc/patches/$p.patch}

coq: $(COQ_SRC)
	cd $(COQ_SRC) && ./configure -prefix $(current_dir) -native-compiler no -bytecode-compiler no -coqide no
	dune build @vodeps $(DUNE_FLAGS)
	cd $(COQ_SRC) && dune exec ./tools/coq_dune.exe $(DUNE_FLAGS) --context="$(BUILD_CONTEXT)" $(COQBUILDDIR)/.vfiles.d


.PHONY: coq-serapi

SERAPI_SRC = vendor/coq-serapi

coq-serapi:
	git submodule update $(SERAPI_SRC)