import { FSInterface, fsif_native } from './fsif';
import { CoqDep } from './coqdep';
import arreq from 'array-equal';
import JSZip from 'jszip';
        


class CoqProject {

    volume: FSInterface
    name: string
    deps: string[]
    searchPath: SearchPath

    constructor(name?: string, volume: FSInterface = fsif_native) {
        this.volume = volume;
        this.name = name;
        this.deps = [];
        this.searchPath = new SearchPath(volume);
    }

    fromJson(json: {[root: string]: {prefix?: string, dirpaths: string[]}},
             baseDir: string = '', volume: FSInterface = this.volume) {
        for (let root in json) {
            var prefix = this.searchPath.toDirPath(json[root].prefix) || [];
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

    fromVolume(volume = this.volume) {
        this.searchPath.addRecursive({volume,
                    physical: '', logical: '', pkg: this.name});
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
        return this.searchPath.listModulesOf(this.name);
    }

    createManifest() {
        var mdeps = this.computeDeps().depsToJson(),
            modules:any = {};
        for (let k of this.listModules())
            modules[k] = {deps: mdeps[k]};
        return {name: this.name, deps: this.deps, modules};
    }

    async toZip() {
        const JSZip = <any>await import('jszip') as JSZip,
              z = new JSZip();

        for (let ext of ['.vo', '.cma']) {
            for (let mod of this.modulesByExt(ext)) {
                z.file(mod.logical.join('/') + ext,
                    mod.volume.fs.readFileSync(mod.physical));
            }
        }
        return z;
    }

    toPackage(filename: string) : Promise<{pkgfile: string, jsonfile: string}> {
        if (!filename.match(/[.][^./]+$/)) filename += '.coq-pkg';

        var pkgfile = filename,
            jsonfile = pkgfile.replace(/[.][^./]+$/, '.json');

        fs.writeFileSync(jsonfile, JSON.stringify(this.createManifest()));

        return new Promise(async resolve => {
            var z = await this.toZip();
            z.generateNodeStream({compression: 'DEFLATE'})
                .pipe(fs.createWriteStream(pkgfile))
                .on('finish', () => resolve({pkgfile, jsonfile}));
        });
    }

}


class SearchPath {

    volume: FSInterface
    path: SearchPathElement[]

    moduleIndex: ModuleIndex

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

    addFrom(other: SearchPath | CoqProject) {
        if (other instanceof CoqProject) other = other.searchPath;
        this.path.push(...other.path);
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

    listModules() {
        return this._listNames(this.modules());
    }

    listModulesOf(pkg: string=undefined) {
        return this._listNames(this.modulesOf(pkg));
    }

    _listNames(modules: Generator<SearchPathElement>) {
        let s = new Set<string>(),
            key = (mod: SearchPathElement) => mod.logical.join('.');
        for (let mod of modules)
            s.add(key(mod));
        return s;
    }

    *findModules(prefix: string | string[], name: string | string[], exact=false) {
        var lprefix = this.toDirPath(prefix) || [],
            lsuffix = this.toDirPath(name);

        let startsWith = (arr, prefix) => arreq(arr.slice(0, prefix.length), prefix);
        let endsWith = (arr, suffix) => suffix.length == 0 || arreq(arr.slice(-suffix.length), suffix);

        let matches = exact ? name => arreq(name, lprefix.concat(lsuffix))
                            : name => startsWith(name, lprefix) &&
                                      endsWith(name, lsuffix);

        for (let mod of this.modules())
            if (matches(mod.logical)) yield mod;
    }

    createIndex() {
        this.moduleIndex = new ModuleIndex();
        for (let mod of this.modules())
            this.moduleIndex.add(mod);
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


/**
 * @todo there is some duplication with backend's PackageIndex.
 */
class ModuleIndex {

    index: Map<string, SearchPathElement>

    constructor() {
        this.index = new Map();
    }

    add(mod: SearchPathElement) {
        let key = (mod: SearchPathElement) => mod.logical.join('.');
        this.index.set(key(mod), mod);
    }

    *findModules(prefix: string, suffix: string) {
        prefix = prefix ? prefix + '.' : '';
        var dotsuffix = '.' + suffix;
        for (let k of this.index.keys()) {
            if (k.startsWith(prefix) && (k == suffix || k.endsWith(dotsuffix)))
                yield this.index.get(k);
        }
    }
}


import fs from 'fs';
import path from 'path';
//import JSZip from 'jszip';

class ZipVolume implements FSInterface {
    fs: typeof fs
    path: typeof path
    zip: JSZip

    _files: string[]

    constructor(zip: JSZip) {
        this.fs = <any>this;
        this.path = fsif_native.path;
        this.zip = zip;

        this._files = [];
        this.zip.forEach((fn: string) => this._files.push(fn));
    }

    readdirSync(dir: string) {
        let d = [];
        if (dir !== '' && !dir.endsWith('/')) dir = dir + '/';
        for (let fn of this._files) {
            if (fn.startsWith(dir)) {
                var steps = fn.substring(dir.length).split('/').filter(x => x);
                if (steps.length == 1)
                    d.push(steps[0]);
            }
        }
        return d;
    }

    statSync(fp: string) {
        var entry = this.zip.files[fp] || this.zip.files[fp + '/'];
        return {
            isDirectory() { return entry && entry.dir; }
        }
    }

    static async fromFile(zipFilename: string) {
        const JSZip = await import('jszip');
        return new ZipVolume(
            await JSZip.loadAsync(fs.readFileSync(zipFilename)));
    }
}



export { CoqProject, SearchPath, SearchPathElement, ModuleIndex, ZipVolume }
