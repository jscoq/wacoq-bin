
WORD_SIZE = 64

current_dir := ${shell pwd}

BUILD_CONTEXT = wacoq

COQBUILDDIR_REL := vendor/coq
COQBUILDDIR := $(current_dir)/_build/$(BUILD_CONTEXT)/$(COQBUILDDIR_REL)

########################################################################
# Externals
########################################################################

.PHONY: coq coq-get

COQ_BRANCH=v8.11
COQ_REPOS=https://github.com/coq/coq.git

COQ_PATCHES = timeout $(COQ_PATCHES|$(WORD_SIZE))

COQ_PATCHES|64 = coerce-32bit

COQSRC = vendor/coq

$(COQSRC):
	git clone --depth=1 -b $(COQ_BRANCH) $(COQ_REPOS) $@
	cd $@ && git apply ${foreach p,$(COQ_PATCHES),$(current_dir)/etc/patches/$p.patch}

coq: $(COQSRC)
	cd $(COQSRC) && ./configure -prefix $(current_dir) -native-compiler no -bytecode-compiler no -coqide no
	dune build @vodeps $(DUNE_FLAGS)
	cd $(COQSRC) && dune exec ./tools/coq_dune.exe $(DUNE_FLAGS) --context="$(BUILD_CONTEXT)" $(COQBUILDDIR)/.vfiles.d
