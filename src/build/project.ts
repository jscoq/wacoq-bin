import { FSInterface, fsif_native } from './fsif'
import arreq from 'array-equal'




class SearchPath {

    fsif: FSInterface
    path: SearchPathElement[]

    constructor(fsif: FSInterface = fsif_native) {
        this.fsif = fsif;
        this.path = [];
    }

    add(physical: string, logical: string | string[]) {
        logical = this.toDirPath(logical);
        this.path.push({logical, physical});
    }

    toLogical(filename: string) {
        var dir = this.fsif.path.dirname(filename), 
            base = this.fsif.path.basename(filename).replace(/[.]vo?$/, '');
        for (let {logical, physical} of this.path) {
            if (physical === dir) return logical.concat([base])
        }
    }

    toDirPath(name: string | string[]) {
        return (typeof name === 'string') ? name.split('.').filter(x => x) : name;
    }

    *modules(): Generator<SearchPathElement> {
        for (let {logical, physical, pkg} of this.path) {
            for (let fn of this.fsif.fs.readdirSync(physical)) {
                if (fn.match(/[.]vo?$/)) {
                    let base = fn.replace(/[.]vo?$/, ''),
                        fp = this.fsif.path.join(physical, fn)
                    yield {logical: logical.concat([base]),
                           physical: fp, pkg};
                }
            }
        }
    }

    searchModule(prefix: string | string[], name: string | string[], exact=false) {
        var lprefix = this.toDirPath(prefix),
            lsuffix = this.toDirPath(name);

        let startsWith = (arr, prefix) => arreq(arr.slice(0, prefix.length), prefix);
        let endsWith = (arr, suffix) => suffix.length == 0 || arreq(arr.slice(-suffix.length), suffix);

        let matches = exact ? name => arreq(name, lprefix.concat(lsuffix))
                            : name => startsWith(name, lprefix) &&
                                      endsWith(name, lsuffix);

        for (let mod of this.modules())
            if (matches(mod.logical)) return mod;
    }

}

type SearchPathElement = {logical: string[], physical: string, pkg?: string};



export { SearchPath, SearchPathElement }
