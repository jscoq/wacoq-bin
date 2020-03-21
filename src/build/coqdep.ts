import { FSInterface, fsif_native } from './fsif';
import { SearchPath, SearchPathElement } from './project';



class CoqDep {

    fsif: FSInterface
    searchPath: SearchPath
    deps: {from: SearchPathElement, to: SearchPathElement[]}[]

    constructor(fsif=fsif_native) {
        this.fsif = fsif;
        this.searchPath = new SearchPath();
        this.deps = [];
    }

    processModule(mod: SearchPathElement) {
        if (mod.physical.endsWith('.v'))
            this.processVernacFile(mod.physical, mod);
    }

    processVernacFile(filename: string, mod?: SearchPathElement) {
        mod = mod || {logical: this.searchPath.toLogical(filename),
                      physical: filename};
        if (mod.logical) {
            this.processVernac(this.fsif.fs.readFileSync(filename, 'utf-8'), 
                               mod);
        }
    }

    processVernac(v_text: string, mod: SearchPathElement) {
        var deps = [...this._extractImports(v_text)];
        if (deps.length > 0)
            this.deps.push({from: mod, to: deps});
    }

    /**
     * Basically, topological sort.
     * (TODO: allow parallel builds?)
     */
    buildOrder() {
        // Prepare graph
        var adj: Map<string, string[]> = new Map(),
            modules: Map<string, SearchPathElement> = new Map(),
            key = (mod: SearchPathElement) => mod.logical.join('.');

        for (let {from, to} of this.deps) {
            let ku = key(from);
            for (let v of to) {
                let kv = key(v);
                adj.set(kv, (adj.get(kv) || []).concat([ku]));
            }
        }

        for (let m of this.searchPath.modules()) {
            modules.set(key(m), m);
        }

        // Now the topological sort
        var scan = this._topologicalSort([...modules.keys()], adj);
        return scan.map(k => modules.get(k));
    }

    _topologicalSort(vertices: string[], adj: Map<string, string[]>) {
        var indegrees: Map<string, number> = new Map();
    
        for (let v of vertices)
            indegrees.set(v,
                vertices.filter(u => (adj.get(u) || []).includes(v)).length);

        // Start scan
        var scan = [],
            worklist = vertices.filter(k => !indegrees.get(k));  // roots

        while (worklist.length > 0) {
            var u = worklist.shift();
            scan.push(u);
            for (let v of adj.get(u) || []) {
                let r = indegrees.get(v) - 1;
                indegrees.set(v, r);
                if (r == 0) worklist.push(v);
            }
        }

        if (scan.length < vertices.length)
            console.warn('coqdep: cyclic dependency detected',
                vertices.filter(k => scan.indexOf(k) == -1));

        return scan;
    }

    *_extractImports(v_text: string) {
        // Strip comments
        v_text = v_text.replace(/\(\*([^*]|[*][^)])*?\*\)/g, ' ');

        // Split sentences
        for (let sentence of v_text.split(/[.](?:\s|$)/)) {
            var mo = /^\s*(?:From\s+(.*?)\s+)?Require(\s+(?:Import|Export))*\s+(.*)/
                     .exec(sentence);
            if (mo) {
                var [_, prefix, import_export, modnames] = mo,
                    lmodnames = modnames.split(/\s+/);

                for (let modname of lmodnames) {
                    let lu = this.searchPath.searchModule(prefix || [], modname);
                    if (lu)
                        yield lu;
                }
            }
        }
    }

}



export { CoqDep }