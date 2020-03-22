import { FSInterface, fsif_native } from './fsif';
import { CoqDep } from './coqdep';
import arreq from 'array-equal';



class CoqProject {

    volume: FSInterface
    name: string
    searchPath: SearchPath

    constructor(name?: string, volume: FSInterface = fsif_native) {
        this.volume = volume;
        this.name = name;
        this.searchPath = new SearchPath(volume);
    }

    fromJson(json: {[root: string]: {prefix: string, dirpaths: string[]}},
             baseDir: string = '', volume: FSInterface = this.volume) {
        for (let root in json) {
            var prefix = this.searchPath.toDirPath(json[root].prefix);
            for (let sub of json[root].dirpaths) {
                var dirpath = this.searchPath.toDirPath(sub),
                    physical = volume.path.join(baseDir, root, ...dirpath),
                    logical = prefix.concat(dirpath);
                this.searchPath.addRecursive({volume, physical, logical, 
                    pkg: this.name});
            }
        }
        return this;
    }

    computeDeps() {
        var coqdep = new CoqDep();
        coqdep.searchPath = this.searchPath;

        coqdep.processPackage(this.name);
        return coqdep;
    }

    *modulesByExt(ext: string) {
        for (let mod of this.searchPath.modulesOf(this.name))
            if (mod.physical.endsWith(ext)) yield mod;
    }
    
    listModules() {
        let s = new Set(),
            key = (mod: SearchPathElement) => mod.logical.join('.');
        for (let mod of this.searchPath.modulesOf(this.name))
            s.add(key(mod));
        return s;
    }

    createManifest() {
        return {
            name: this.name,
            modules: [...this.listModules()],
            deps: this.computeDeps().depsToJson()
        };
    }

    async toZip() {
        const JSZip = await import('jszip'),
              z = new JSZip();

        for (let ext of ['.vo', '.cma']) {
            for (let mod of this.modulesByExt(ext)) {
                z.file(mod.logical.join('/') + ext,
                    mod.volume.fs.readFileSync(mod.physical));
            }
        }
        return z;
    }

}


class SearchPath {

    volume: FSInterface
    path: SearchPathElement[]

    constructor(volume: FSInterface = fsif_native) {
        this.volume = volume;
        this.path = [];
    }

    add({volume, physical, logical, pkg}: SearchPathAddParameters) {
        volume = volume || this.volume;
        logical = this.toDirPath(logical);
        this.path.push({volume, logical, physical, pkg});
    }

    addRecursive({volume, physical, logical, pkg}: SearchPathAddParameters) {
        volume = volume || this.volume;
        logical = this.toDirPath(logical);
        this.add({volume, physical, logical, pkg});
        for (let subdir of volume.fs.readdirSync(physical)) {
            var subphysical = volume.path.join(physical, subdir);
            if (volume.fs.statSync(subphysical).isDirectory())
                this.addRecursive({ volume,
                                    physical: subphysical,
                                    logical: logical.concat([subdir]),
                                    pkg });
        }
    }

    toLogical(filename: string) {
        var dir = this.volume.path.dirname(filename), 
            base = this.volume.path.basename(filename).replace(/[.]vo?$/, '');
        for (let {logical, physical} of this.path) {
            if (physical === dir) return logical.concat([base])
        }
    }

    toDirPath(name: string | string[]) {
        return (typeof name === 'string') ? name.split('.').filter(x => x) : name;
    }

    *modules(): Generator<SearchPathElement> {
        for (let {volume, logical, physical, pkg} of this.path) {
            for (let fn of volume.fs.readdirSync(physical)) {
                if (fn.match(/[.](vo?|cma)$/)) {
                    let base = fn.replace(/[.](vo?|cma)$/, ''),
                        fp = volume.path.join(physical, fn)
                    yield { volume,
                            logical: logical.concat([base]),
                            physical: fp,
                            pkg };
                }
            }
        }
    }

    *modulesOf(pkg: string=undefined) {
        for (let mod of this.modules())
            if (mod.pkg === pkg) yield mod;
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

type SearchPathAddParameters = {
    volume?: FSInterface
    logical: string[] | string
    physical: string
    pkg?: string
};

type SearchPathElement = {
    volume: FSInterface
    logical: string[]
    physical: string
    pkg?: string
};



export { CoqProject, SearchPath, SearchPathElement }
