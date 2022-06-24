
WORD_SIZE = 64

current_dir := ${shell pwd}

BUILD_CONTEXT = wacoq

COQBUILDDIR_REL := vendor/coq
COQBUILDDIR := $(current_dir)/_build/$(BUILD_CONTEXT)/$(COQBUILDDIR_REL)

PACKAGE_VERSION = ${shell node -p 'require("./package.json").version'}

OPAM_ENV = eval `opam env --set-switch --switch $(BUILD_CONTEXT)`
DUNE = $(OPAM_ENV) && dune

.PHONY: default bootstrap setup deps wacoq wacoq-only symb install clean distclean _*

default: wacoq

bootstrap: setup deps
	
setup:
	etc/setup.sh

deps: coq coq-serapi

wacoq: | _build _wrapup  # need to sequentialize for ${wildcard}

_build:
	$(DUNE) build @coq @wacoq coq-pkgs
_wrapup:
	mkdir -p dist && cp _build/$(BUILD_CONTEXT)/cli.js dist/cli.js
	ln -sf ${foreach m, ${wildcard _build/$(BUILD_CONTEXT)/coq-pkgs/*}, ../../$m} bin/coq/

wacoq-only:
	$(DUNE) build @wacoq

symb:
	node dist/cli.js inspect

install:
	$(DUNE) build ${foreach p, coq-core coq-stdlib, vendor/coq/$p.install}
	$(DUNE) install coq-core coq-stdlib

dist-npm:
	rm -rf package
	npx webpack --mode production --env outDir=package/dist \
	    ${addprefix --config-name , cli worker subproc}
	cp package.json index.js README.md package/
	mkdir package/bin && ln -s ${addprefix ../../bin/, icoq.bc coq} package/bin/
	mkdir package/etc && cp etc/postinstall.js package/etc
	tar zchf wacoq-bin-$(PACKAGE_VERSION).tar.gz \
	    --exclude='coqlib/**' --exclude='*.*.js' --exclude='*.so' \
	    ${addprefix package/, package.json index.js dist bin etc}

########################################################################
# Externals
########################################################################

.PHONY: coq

COQ_SRC = vendor/coq

COQ_BRANCH = V8.16+rc1
COQ_REPOS=https://github.com/coq/coq.git

COQ_PATCHES = timeout extern $(COQ_PATCHES|$(WORD_SIZE))

COQ_PATCHES|64 = coerce-32bit

coq_configure = ./tools/configure/configure.exe

$(COQ_SRC):
	git clone -c advice.detachedHead=false --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $@
	cd $@ && git apply ${foreach p,$(COQ_PATCHES),$(current_dir)/etc/patches/$p.patch}

coq: $(COQ_SRC)
	rm -rf _build/$(BUILD_CONTEXT)/$(COQ_SRC)  # safeguard
	cd $(COQ_SRC) && \
	    dune exec --context=$(BUILD_CONTEXT) $(coq_configure) \
	        -- -prefix $(current_dir) -native-compiler no -bytecode-compiler no -coqide no


.PHONY: coq-serapi

SERAPI_SRC = vendor/coq-serapi

coq-serapi:
	git submodule update $(SERAPI_SRC)

clean:
	$(DUNE) clean
	rm -f wacoq-bin-*.tar.gz

distclean: clean
	rm -rf vendor/coq

ci:
	$(MAKE) distclean
	$(MAKE) coq
	$(MAKE) && $(MAKE) dist-npm
	$(MAKE) install
	npm link    # makes `wacoq` cli available
