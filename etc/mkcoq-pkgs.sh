S=`pwd`
SWITCH=wacoq

INIT_PLUGINS='plugins/ssrmatching plugins/ssr plugins/cc plugins/syntax
  plugins/btauto plugins/ltac plugins/firstorder'

mkdir -p bin/coq

# init
rm -f bin/coq/init.coq-pkg
zip -j bin/coq/init.coq-pkg ./_build/$SWITCH/src/icoq.bc

rm -rf staging ; mkdir staging

mkdir staging/Coq
cp -r _build/$SWITCH/vendor/coq/theories/Init staging/Coq/
for dir in $INIT_PLUGINS; do
  cp -r _build/$SWITCH/vendor/coq/$dir staging/Coq/
done

( cd staging ;
  zip -r $S/bin/coq/init.coq-pkg `find Coq -name '*.vo' -o -name '*.cma'` )

rm -rf staging ; mkdir staging

# coq-all
rm -f bin/coq/coq-all.coq-pkg

mkdir staging/Coq
cp -r _build/$SWITCH/vendor/coq/theories/* staging/Coq/
cp -r _build/$SWITCH/vendor/coq/plugins/* staging/Coq/

( cd staging ;
  zip -r $S/bin/coq/coq-all.coq-pkg `find Coq -name '*.vo' -o -name '*.cma'` )

rm -rf staging
