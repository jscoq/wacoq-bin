

class PackageIndex {

    pkgs: {[name: string]: PackageManifest}
    loaded: string[]
    futures: {[name: string]: Future<any>}

    moduleIndex: Map<string, PackageManifest>

    worker: WorkerInterface

    constructor() {
        this.pkgs = {};
        this.loaded = [];
        this.futures = {};
        this.moduleIndex = new Map();
    }

    attach(worker: WorkerInterface) {
        this.worker = worker;
        worker.addEventListener('message', ev => this.handleEvent(ev));
        return this;
    }

    add(pkg: PackageManifest, uri?: string, name?: string) {
        if (uri && !pkg.archive) {
            pkg.archive = name ? uri.replace(/[^/]*$/, `${name}.coq-pkg`)
                               : uri.replace(/[.]json$/, '.coq-pkg');
        }
        this.pkgs[pkg.name] = pkg;
        for (let mod in pkg.modules || {})
            this.moduleIndex.set(mod, pkg);
    }

    async addBlob(pkg: Blob) {
        var z = await (await import('jszip')).loadAsync(pkg),
            manifest = JSON.parse(await z.file('coq-pkg.json').async('string'));
        manifest.archive = URL.createObjectURL(pkg);
        this.add(manifest);
    }

    populate(pkgs: string[], baseDir: string) {
        var uris = pkgs.map(pkg => `${baseDir}/${pkg}.json`);
        return this.loadInfo(uris);
    }
    
    loadInfo(uris: string[]) {
        return Promise.all(uris.map(async uri => {
            var manifest = await (await fetch(uri)).json();
            if (manifest.chunks)
                for (let c of manifest.chunks)
                    this.add(c, uri, c.name);
            else 
                this.add(manifest, uri);
        }));
    }

    loadPkgs(pkgs: string[]) {
        pkgs = pkgs.filter(pkg => !this.loaded.includes(pkg))

        var issue = [];
        var promises = pkgs.map(pkg => {
            if (!this.futures[pkg]) {
                this.futures[pkg] = new Future();
                issue.push(pkg);
            }
            return this.futures[pkg].promise;
        });
        var uris = issue.map(pkg => this.pkgs[pkg].archive || `+${pkg}`);
        this.worker.postMessage(['LoadPkg', uris]);
        return Promise.all(promises);
    }


    computeModuleDeps(mods: string[]) {
        return closure(new Set(mods), mod => {
            let pkg = this.moduleIndex.get(mod),
                o = (pkg && pkg.modules || {})[mod];
            return (o && o.deps) || [];
        });
    }

    async loadModuleDeps(mods: string[]) {
        var pdeps = new Set<string>();
        for (let m of this.computeModuleDeps(mods)) {
            var pkg = this.moduleIndex.get(m);
            if (!pkg) console.warn(`missing package dependency for module '${m}'`);
            pdeps.add(pkg.name);
        }
        // consistent order
        return this.loadPkgs([...pdeps]);
    }

    findModule(prefix: string, suffix: string) {
        prefix = prefix ? prefix + '.' : '';
        var dotsuffix = '.' + suffix;
        for (let k of this.moduleIndex.keys()) {
            if (k.startsWith(prefix) && (k == suffix || k.endsWith(dotsuffix)))
                return k;
        }
    }

    findModules(prefix: string, modrefs: string[]) {
        return modrefs.map(mr => this.findModule(prefix, mr)).filter(x => x);
    }

    handleEvent(ev: any) {
        switch (ev.data[0]) {
        case 'LoadedPkg':
            for (let uri of ev.data[1]) {
                var name = uri.replace(/^([+]|.*[/])/, '')
                              .replace(/[.][^.]*$/, '');
                this.loaded.push(name);
                if (this.futures[name]) this.futures[name].resolve();
            }
        }
    }

}

type PackageManifest = {name: string, deps?: string[], modules: any[], archive?: string};

type WorkerInterface = {
    addEventListener(ev: string, cb: any): void;
    postMessage(msg: any): void;
};

class Future<T> {
    promise: Promise<T>
    _resolve: (val: T) => void
    _reject: (err: any) => void
    _done: boolean
    _success: boolean

    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        this._done = false;
        this._success = false;
    }

    resolve(val?: T)  { if (!this._done) { this._done = this._success = true; this._resolve(val); } }
    reject(err: any)  { if (!this._done) { this._done = true; this._reject(err); } }

    isDone()        { return this._done; }
    isSuccessful()  { return this._success; }
    isFailed()      { return this._done && !this._success; }
}


function closure<T>(s: Set<T>, tr: (t: T) => T[]) {
    var wl = [...s];
    while (wl.length > 0) {
        var u = wl.shift();
        for (let v of tr(u)) {
            if (!s.has(v)) {
                s.add(v);
                wl.push(v);
            }
        }
    }
    return s;
}



export { PackageIndex }
